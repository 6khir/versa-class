'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { TaskStore } = require('../src/task-store.cjs');
const {
  KIND, LANES, DEADLINES, dedupeKey, createPipelineRunner, awaitTask, projectTaskState
} = require('../src/pipeline-tasks.cjs');

function fakeStore() {
  return { tasks: new TaskStore(new DatabaseSync(':memory:'), { backoff: { baseMs: 10, maxMs: 50 } }) };
}
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// The browser is one Chrome profile with one composer. Two stages driving it at
// once overwrite each other's uploads, which is why they share a lane.

test('every browser-driving stage shares one lane', () => {
  for (const kind of [KIND.ANALYSIS, KIND.INTERIOR, KIND.THUMBNAILS, KIND.PREVIEW]) {
    assert.ok(LANES.browser.includes(kind), `${kind} drives Chrome and must be in the browser lane`);
  }
  // Local work has its own lane so a page being read does not wait behind a gem.
  for (const kind of [KIND.INTERIOR_TEXT, KIND.EDITABLE_PPT, KIND.EXPORT]) {
    assert.ok(LANES.local.includes(kind), `${kind} is local work`);
  }
  const all = [...LANES.browser, ...LANES.local];
  assert.equal(new Set(all).size, all.length, 'a kind belongs to exactly one lane');
});

test('every stage has a deadline, so none can run forever', () => {
  for (const kind of Object.values(KIND)) {
    assert.ok(DEADLINES[kind] > 0, `${kind} needs a deadline`);
  }
  // Generous on purpose: a deadline breaks a hang, it does not hurry a model.
  assert.ok(DEADLINES[KIND.INTERIOR] >= 60 * 60_000, 'a long book must not be cut off mid-run');
  assert.ok(DEADLINES[KIND.ANALYSIS] <= 15 * 60_000, 'analysis is the stage that was getting stuck');
});

test('a dedupe key is stable for the same work and distinct across projects', () => {
  assert.equal(dedupeKey(KIND.INTERIOR, 'p1'), dedupeKey(KIND.INTERIOR, 'p1'));
  assert.notEqual(dedupeKey(KIND.INTERIOR, 'p1'), dedupeKey(KIND.INTERIOR, 'p2'));
  assert.notEqual(dedupeKey(KIND.INTERIOR, 'p1'), dedupeKey(KIND.PREVIEW, 'p1'));
  assert.notEqual(dedupeKey(KIND.INTERIOR, 'p1', 'page-7'), dedupeKey(KIND.INTERIOR, 'p1', 'page-8'));
});

test('awaitTask resolves with the result when the stage finishes', async (t) => {
  const store = fakeStore();
  const runner = createPipelineRunner({
    store,
    handlers: { [KIND.ANALYSIS]: async () => ({ project: { id: 'p1' } }) },
    idleMs: 5
  });
  t.after(() => runner.stop());
  const task = store.tasks.enqueue({ kind: KIND.ANALYSIS, dedupeKey: 'a' });
  runner.start();
  const finished = await awaitTask(store, task.id, { timeoutMs: 4_000, pollMs: 10 });
  assert.equal(finished.state, 'done');
  assert.deepEqual(finished.result, { project: { id: 'p1' } });
});

test('awaitTask rejects with the stage error rather than hanging', async (t) => {
  const store = fakeStore();
  const runner = createPipelineRunner({
    store,
    handlers: { [KIND.ANALYSIS]: async () => { throw Object.assign(new Error('gem refused'), { retryable: false }); } },
    idleMs: 5
  });
  t.after(() => runner.stop());
  const task = store.tasks.enqueue({ kind: KIND.ANALYSIS, dedupeKey: 'a' });
  runner.start();
  await assert.rejects(
    () => awaitTask(store, task.id, { timeoutMs: 4_000, pollMs: 10 }),
    (error) => error.code === 'TASK_FAILED' && /gem refused/.test(error.message)
  );
});

// The point of the split: giving up on the wait is not giving up on the work.

test('abandoning the wait does not abandon the task', async (t) => {
  const store = fakeStore();
  let finished = false;
  const runner = createPipelineRunner({
    store,
    handlers: { [KIND.ANALYSIS]: async () => { await settle(300); finished = true; return { ok: true }; } },
    idleMs: 5
  });
  t.after(() => runner.stop());
  const task = store.tasks.enqueue({ kind: KIND.ANALYSIS, dedupeKey: 'a' });
  runner.start();

  await assert.rejects(
    () => awaitTask(store, task.id, { timeoutMs: 60, pollMs: 10 }),
    (error) => error.code === 'TASK_STILL_RUNNING'
  );
  // The caller stopped waiting; the stage kept going and committed its result.
  await settle(500);
  assert.equal(finished, true);
  assert.equal(store.tasks.get(task.id).state, 'done');
});

test('project task state is readable after a restart, not only while listening', () => {
  const db = new DatabaseSync(':memory:');
  const store = { tasks: new TaskStore(db) };
  const t1 = store.tasks.enqueue({ kind: KIND.INTERIOR, projectId: 'p1', dedupeKey: 'i' });
  store.tasks.lease({ owner: 'w' });
  store.tasks.checkpoint(t1.id, 'w', { pagesDone: 12 });

  // A different process opens the same database and can still say exactly where
  // the stage got to — the UI no longer depends on having been open at the time.
  const reopened = { tasks: new TaskStore(db) };
  const view = projectTaskState(reopened, 'p1');
  assert.equal(view.byKind[KIND.INTERIOR].state, 'leased');
  assert.deepEqual(view.byKind[KIND.INTERIOR].checkpoint, { pagesDone: 12 });
  assert.equal(view.stats.total, 1);
});

test('the app boots the runner and routes analysis through it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /pipelineRunner = createPipelineRunner\(\{/);
  assert.match(main, /pipelineRunner\.start\(\);/);
  assert.match(main, /\[TASK_KIND\.ANALYSIS\]: runAnalysisTask/);

  const start = main.indexOf("ipcMain.handle('analysis:analyze'");
  const handler = main.slice(start, main.indexOf('ipcMain.handle(', start + 10));
  // The handler enqueues and waits; it no longer owns the work on its own stack.
  assert.match(handler, /store\.tasks\.enqueue\(\{/);
  assert.match(handler, /awaitTask\(store, task\.id/);
  assert.match(handler, /if \(!listing\.productUrl\) assertIdle\(\)/);
  assert.doesNotMatch(handler, /await browser\.analyzeProductWithGpt/);

  // And the stage itself is abortable and checkpointed.
  const fnStart = main.indexOf('async function runAnalysisTask(');
  const fn = main.slice(fnStart, main.indexOf('\n}\n', fnStart));
  assert.match(fn, /if \(signal\.aborted\) throw signal\.reason;/);
  assert.match(fn, /checkpoint\(\{ phase: 'analysed'/);
  assert.match(fn, /await browser\.analyzeProductWithGpt/);
  // A leftover pause must not poison a new URL/agent analysis. beginWork clears
  // abortRequested at task start; a pause after that still stops the gem call.
  const beginWorkAt = fn.search(/browser\.beginWork\??\.?\(\)/);
  const analyzeAt = fn.indexOf('await browser.analyzeProductWithGpt');
  assert.ok(beginWorkAt > -1 && beginWorkAt < analyzeAt, 'runAnalysisTask must call beginWork before analyzeProductWithGpt');
  assert.match(fn, /analysis:finished/);
  assert.match(fn, /selectedProjectId', projectId/);
});

test('the queue lives in the app database, so tasks and projects commit together', () => {
  const store = fs.readFileSync(path.join(__dirname, '..', 'src', 'store.cjs'), 'utf8');
  assert.match(store, /this\.tasks = new TaskStore\(this\.db\)/);
  assert.match(store, /require\('\.\/task-store\.cjs'\)/);
});

test('a wedged vision worker is killed rather than left in place', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'src', 'vision-bridge.cjs'), 'utf8');
  // The timeout used to reject and leave the process running, so every later
  // request went back into the same wedged interpreter.
  assert.match(bridge, /#killWedged\(/);
  assert.match(bridge, /detached: true/, 'the worker needs its own group for the kill to reach its children');
  assert.match(bridge, /process\.kill\(-pid, sig\)/);
  // Bounded at the method definition, not the first mention: the first mention
  // is the call inside send(), which is the thing being asserted.
  const send = bridge.slice(bridge.indexOf('async send('), bridge.indexOf('  #killWedged(reason)'));
  assert.match(send, /this\.#killWedged\(/, 'a timeout must kill, not just reject');
  assert.match(send, /code: 'WORKER_TIMEOUT', retryable: true/, 'and the caller may retry against a fresh worker');
});

// The automation manager keeps its retries, verification and stall watchdog; what
// it gives up is holding a stage on its own stack.

test('automated steps are dispatched through the queue', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const start = main.indexOf('dispatchStep: async ({ step, projectId, onProgress, runner })');
  assert.ok(start > -1, 'the manager should be given a dispatcher');
  const fn = main.slice(start, main.indexOf('\n    },', start));

  assert.match(fn, /store\.tasks\.enqueue\(\{/);
  assert.match(fn, /awaitTask\(store, task\.id/);
  // The manager already retries with its own backoff; letting the queue retry too
  // would multiply the two.
  assert.match(fn, /maxAttempts: 1/);
  // A step the queue does not know must still run, not silently stop.
  assert.match(fn, /if \(!kind \|\| !pipelineRunner\) return runner\(projectId, onProgress\)/);
});

test('a task kind selects the lane; the step selects the runner', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  // interior and interior_artwork share a lane and a deadline but are different
  // runners, so the step travels in the payload and into the dedupe key —
  // otherwise starting artwork would find the interior task and return it.
  assert.match(main, /interior_artwork: TASK_KIND\.INTERIOR/);
  assert.match(main, /const step = task\.payload\?\.step \|\| defaultStep;/);
  assert.match(main, /dedupeKey\(kind, projectId, step\)/);
  assert.doesNotMatch(main, /const defaultStep = step;/, 'the loop variable must not be shadowed');
});

test('the manager falls back to calling a runner directly when no queue is wired', () => {
  const manager = fs.readFileSync(path.join(__dirname, '..', 'src', 'automation-manager.cjs'), 'utf8');
  assert.match(manager, /typeof this\._dispatchStep === 'function'/);
  assert.match(manager, /\(onProgress\) => runner\(projectId, onProgress\)/);
  // The stall watchdog still wraps whichever path is taken.
  const start = manager.indexOf('async _runStepWithWatchdog(');
  const fn = manager.slice(start, manager.indexOf('\n  async ', start + 1));
  assert.match(fn, /const runPromise = \(async \(\) => invoke\(/);
});

test('the renderer can read stage progress from the state payload', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  // Read from the table, not from whatever events the window was open for — after
  // a restart this is still the truth.
  assert.match(main, /const tasks = pipelineRunner && store\.tasks/);
  assert.match(main, /projectTaskState\(store, project\.id\)/);
  assert.match(main, /return \{\n\s*vision,\n\s*tasks,/);
});

test('the runner is started only once its handlers can reach their runners', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const published = main.indexOf('pipelineStepRunners = stepRunners;');
  const started = main.indexOf('pipelineRunner.start();');
  assert.ok(published > -1 && started > -1);
  // A task leased before the runners are published would fail for no reason other
  // than boot order.
  assert.ok(started > published, 'start() must come after the runners are published');
});

// --- The renderer reads durable state -------------------------------------

test('stage panels read the queue, not only live events', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  // Progress events only exist while the window is open. After a restart the
  // panels used to show whatever they last caught, which was usually nothing.
  assert.match(renderer, /function taskStateFor\(project, stage\)/);
  assert.match(renderer, /state\?\.tasks\?\.byProject\?\.\[project\?\.id\]\?\.byKind/);
  assert.match(renderer, /interior: queueHere \|\| taskIsRunning\(project, 'interior'\)/);
  // Where the queue has no opinion the derived figure stands, so nothing
  // regresses to zero.
  assert.match(renderer, /taskPercent\(project, stage\) \?\? derived/);
  // A stage the queue failed reads as failed even if the project row says pending.
  assert.match(renderer, /taskFailure\(project, 'preview'\) \? 'failed' :/);
});

test('a stage says why it stopped and which attempt it is on', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const start = renderer.indexOf('function stageDetail(project, stage, fallback) {');
  assert.ok(start > -1);
  const fn = renderer.slice(start, renderer.indexOf('\n}\n', start));
  assert.match(fn, /Failed — /);
  assert.match(fn, /attempt \$\{task\.attempts\}\/\$\{task\.maxAttempts\}/);
  assert.match(fn, /Retrying/);
  assert.match(fn, /Queued/);
});

// --- VERSA AGENT -----------------------------------------------------------

test('the agent is a browser-lane task with its own deadline', () => {
  assert.equal(KIND.TREND_SCAN, 'trend_scan');
  assert.ok(LANES.browser.includes(KIND.TREND_SCAN), 'it drives Chrome, so it shares the browser lane');
  assert.ok(!LANES.local.includes(KIND.TREND_SCAN));
  assert.ok(DEADLINES[KIND.TREND_SCAN] > 0 && DEADLINES[KIND.TREND_SCAN] <= 15 * 60_000);
});

test('the agent hands off to analysis rather than doing it itself', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const start = main.indexOf('async function runTrendScanTask(');
  assert.ok(start > -1, 'the agent stage should exist');
  const fn = main.slice(start, main.indexOf('\n}\n', start));

  // Two phases: the trend feed says what is rising, the marketplaces say whether
  // it sells. Merging them into one ranked list threw that distinction away.
  assert.match(fn, /browser\.withVisibleMarketContext\(async \(context\) => \{/);
  assert.match(fn, /const openPage = \(\) => context\.newPage\(\);/);
  assert.match(fn, /discoverKeywords\(\{ openPage, signal, seed \}\)/);
  assert.match(fn, /validateKeyword\(\{ keyword, marketplaces, openPage, signal \}\)/);
  assert.match(fn, /chooseOpportunity\(validations, \{ excludeUrls: recentTrendPickUrls\(store\) \}\)/);
  assert.match(fn, /pickTrendListing\(listings, \{ query: queryLabel, excludeUrls \}\)/);
  // The scan returns a handoff payload. The renderer starts the durable analysis
  // task so the user flows through the normal URL-analysis screens.
  assert.doesNotMatch(fn, /kind: TASK_KIND\.ANALYSIS/);
  assert.doesNotMatch(fn, /dedupeKey\(TASK_KIND\.ANALYSIS/);
  assert.doesNotMatch(fn, /analysisTaskId/);
  assert.match(fn, /const analysisInput = toAnalysisInput\(choice\.candidate/);
  assert.match(fn, /chosen: analysisInput/);
  assert.match(fn, /\banalysisInput,/);
  assert.match(fn, /opportunity: choice/);
  // The evidence travels with the handoff, so analysis is told what the market
  // looks like rather than just given a link.
  assert.match(fn, /trendMetadata\.opportunity = \{/);
  assert.match(fn, /if \(signal\.aborted\) throw signal\.reason;/);
  // Checkpointed per keyword, so an interrupted scan resumes with what it proved.
  assert.match(fn, /checkpoint\(\{\s*phase: 'validating'/);
  assert.match(fn, /checkpoint\(\{ phase: 'discovering', marketplace \}\)/);
});

test('the agent uses a visible marketplace tab, not the Gemini tab', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /browser\.withVisibleMarketContext\(async \(context\) => \{/);
  assert.match(main, /const openPage = \(\) => context\.newPage\(\);/);
  const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-controller.cjs'), 'utf8');
  assert.match(controller, /async withVisibleMarketContext\(work\)/);
  assert.match(controller, /async withHeadlessScratchContext\(work\)/);
  const start = controller.indexOf('async withVisibleMarketContext(work)');
  const fn = controller.slice(start, controller.indexOf('\n  }\n', start));
  assert.match(fn, /launch\(\{ skipHome: true, interactive: true \}\)/);
  assert.match(fn, /#showWindow\(page\)/);
  assert.doesNotMatch(fn, /this\.page\.goto/);
  assert.match(controller, /scratchBrowser\.newContext/);
  assert.match(controller, /scratchBrowser\.close\(\)/);
  assert.match(controller, /function managedBrowserOptions[\s\S]*headless: false/);
});

test('the agent is offered in the new-book modal, as two phases', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /data-action="choose-agent-method"/);
  assert.match(html, />Versa Agent</);
  assert.match(html, />Recommended</);
  assert.match(html, /data-testid="project-dialog-close"/);
  assert.match(html, /aria-label="Close new book dialog"/);
  assert.match(html, /id="project-agent-step"/);

  const agentMethodIndex = html.indexOf('data-testid="project-method-agent"');
  const analysisMethodIndex = html.indexOf('data-testid="project-method-analysis"');
  const promptsMethodIndex = html.indexOf('data-testid="project-method-prompts"');
  assert.ok(agentMethodIndex >= 0, 'VERSA AGENT method should be present');
  assert.ok(analysisMethodIndex >= 0, 'Analysis method should be present');
  assert.ok(promptsMethodIndex >= 0, 'Ready-made prompts method should be present');
  assert.ok(agentMethodIndex < analysisMethodIndex, 'VERSA AGENT should be the first method');
  assert.ok(analysisMethodIndex < promptsMethodIndex, 'Analysis should appear before ready-made prompts');
  assert.doesNotMatch(html, /class="pipeline-choice"/, 'Static/Editable pipeline cards should not appear in the new-book method picker');
  assert.doesNotMatch(html, /data-pipeline-choice="(?:static|editable)"/, 'Visible pipeline choice buttons should be removed from this modal screen');

  // Discovery and validation are different jobs, so they are different steps in
  // the UI too. The trending feed is not a checkbox beside the marketplaces —
  // offering it as a peer is what made the agent merge two kinds of signal.
  assert.match(html, /data-testid="agent-phase-discover"/);
  assert.match(html, /data-testid="agent-phase-validate"/);
  assert.match(html, />Keyword</);
  assert.match(html, />Storefront</);
  assert.match(html, /role="radiogroup" aria-label="Marketplace to validate against"/);
  for (const market of ['tpt', 'kdp', 'etsy']) {
    assert.match(html, new RegExp(`data-testid="agent-market-${market}"`), `${market} should be selectable`);
    assert.match(html, new RegExp(`type="radio" name="agentMarketplace" value="${market}"`), `${market} should be a single-choice radio`);
  }
  assert.match(html, /type="radio" name="agentMarketplace" value="tpt" checked/, 'TPT is the default validation marketplace');
  assert.doesNotMatch(html, /<input type="checkbox" value="(?:tpt|kdp|etsy)"/, 'marketplaces are single-choice, not checkboxes');
  assert.doesNotMatch(html, /<input type="checkbox" value="trending"/, 'the trend feed is a phase, not a marketplace');

  // The boundary is stated where the person choosing can read it.
  assert.match(html, /Public pages only\. Never signs in\./);
  assert.match(html, /data-market-rail/);
  assert.match(html, /data-market-stage="scan"/);
  assert.match(html, /Reads public listings, then hands the book to analysis\./);

  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.match(renderer, /function setProjectMethodChoice\(choice = 'agent'\)/);
  assert.match(renderer, /setProjectMethodChoice\('agent'\)/);
  assert.match(renderer, /setProjectMethodChoice\('analysis'\)/);
  assert.match(renderer, /setProjectMethodChoice\('prompts'\)/);
  assert.match(renderer, /showProjectMethodStep\('agent'\)/);
  assert.match(renderer, /action === 'choose-agent-method'/);
  assert.match(renderer, /action === 'run-agent'/);
  assert.match(renderer, /function selectedAgentMarketplace\(\)/);
  assert.match(renderer, /api\.scanTrends\(\{ query, marketplace \}\)/);
  assert.match(renderer, /async function startAgentAnalysisHandoff\(scanResult = \{\}\)/);
  assert.match(renderer, /const chosen = normalizeAgentAnalysisInput\(scanResult\)/);
  assert.match(renderer, /setAnalysisMode\('url'\)/);
  assert.match(renderer, /elements\.analysisProductUrl\.value = chosen\.productUrl/);
  assert.match(renderer, /showProjectAnalysisLoadingStep\(true\)/);
  assert.match(renderer, /api\.analyzeProduct\(chosen\)/);
  assert.match(renderer, /await finishGateAnalysis\(result\)/);
  assert.match(renderer, /await startAgentAnalysisHandoff\(scan\.result\)/);
  assert.match(renderer, /showProjectAnalysisResultStep\(\)/);
  assert.doesNotMatch(renderer, /agent-(?:bottom-)?tabs|agent-result-tabs/, 'the agent handoff must not render a second tab strip');
  // Closing the dialog must not cancel the work.
  assert.match(renderer, /Still scanning\. It will finish in the background/);
  assert.match(renderer, /const agentStep = document\.getElementById\('project-agent-step'\)/);
});

// The app is meant to be drivable by an agent as well as read by a person. An
// agent that can click but cannot read the outcome is not automating anything.

test('outcomes are readable as data, not only as colour and prose', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  // A class name is a styling decision — every one of them was rewritten in this
  // project already. data-state is a contract.
  assert.match(renderer, /card\.dataset\.state = state;/);
  assert.match(renderer, /card\.dataset\.testid = `stage-\$\{stageId\}`;/);
  assert.match(renderer, /tab\.dataset\.state = state;/);

  // The agent step reports its own state and publishes its full result as data,
  // so a caller reads a value instead of parsing a sentence.
  assert.match(renderer, /step\.dataset\.state = value;/);
  assert.match(renderer, /resultBox\.dataset\.result = JSON\.stringify\(payload\)/);
  for (const state of ['running', 'done', 'failed', 'invalid']) {
    assert.match(renderer, new RegExp(`setState\\('${state}'`), `${state} should be reported`);
  }
});

test('the controls an agent would drive are addressable by stable names', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  for (const id of ['run-pipeline', 'pause-pipeline', 'start-automation', 'new-book', 'agent-run', 'agent-keyword', 'agent-status', 'agent-result']) {
    assert.match(html, new RegExp(`data-testid="${id}"`), `${id} should be addressable`);
  }
});

test('the agent bridge exists on both sides of the IPC boundary', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.cjs'), 'utf8');
  assert.match(preload, /scanTrends: \(input\) => ipcRenderer\.invoke\('agent:scan-trends', input\)/);
  assert.match(preload, /agentScanResult: \(taskId\) => ipcRenderer\.invoke\('agent:scan-result', taskId\)/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /ipcMain\.handle\('agent:scan-trends'/);
  assert.match(main, /const marketplace = normalizeTrendMarketplace\(input\?\.marketplace \?\? input\?\.sources\)/);
  assert.match(main, /dedupeKey\(TASK_KIND\.TREND_SCAN, null, `\$\{marketplace\}:\$\{query \|\| 'all'\}`\)/);
  assert.match(main, /payload: \{ query, marketplace \}/);
  assert.match(main, /ipcMain\.handle\('agent:scan-result'/);
  assert.match(main, /\[TASK_KIND\.TREND_SCAN\]: runTrendScanTask/);
});
