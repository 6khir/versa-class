'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'renderer/index.html'), 'utf8');
const css = readFileSync(join(root, 'renderer/styles.css'), 'utf8');
const refined = readFileSync(join(root, 'renderer/refined.css'), 'utf8');
const renderer = readFileSync(join(root, 'renderer/renderer.js'), 'utf8');
const uiJs = readFileSync(join(root, 'renderer/ui.js'), 'utf8');
const preload = readFileSync(join(root, 'src/preload.cjs'), 'utf8');
const removedPlatform = 'can' + 'va';

test('workspace keeps a sticky live dock on every view', () => {
  assert.match(html, /id="live-dock"/);
  assert.match(html, /class="appearance-switch"/);
  assert.match(css, /\.workspace-command-strip/);
  assert.doesNotMatch(html, /class="progress-card glass-panel" data-workspace-section="overview"/);
  assert.match(css, /\.live-dock\.is-live/);
  assert.match(css, /position:\s*sticky/);
});

test('overview is a pipeline plus activity board, not an 8-card wrap grid', () => {
  assert.match(html, /class="overview-board"/);
  assert.match(html, /class="logs-panel v-glass studio-now-log"/);
  assert.match(css, /\.event-log[\s\S]*min-height:\s*420px/);
});

test('the pipeline is a rail of nodes, and only refined.css says how', () => {
  // The stage numbers are content now. They used to be a CSS counter printed
  // through ::before onto a span with font-size: 0, which meant the Static
  // engine's four stages still counted to seven.
  assert.doesNotMatch(css, /counter-increment:\s*pipeline/);
  assert.match(html, /<span class="n-idx">01<\/span>/);
  assert.match(renderer, /function renumberPipeline\(\)/);

  // One owner. If any of the other stylesheets starts laying the rail out
  // again, this is the slice where that regression began.
  const refined = readFileSync(join(root, 'renderer/refined.css'), 'utf8');
  assert.match(refined, /\.pipeline-rail-track \{[^}]*flex-direction: row/s);
  assert.match(refined, /\.pipeline-rail-track \{[^}]*flex-wrap:\s*wrap/s);
  assert.match(refined, /\.pipeline-rail-track \.overview-stage-card\.node \{/);
  for (const sheet of ['styles.css', 'components.css', 'studio.css', 'pro-suite.css', 'mac-theme.css', 'midnight-theme.css']) {
    const other = readFileSync(join(root, 'renderer', sheet), 'utf8');
    assert.doesNotMatch(other, /\.overview-stage-card[^,{}]*\{[^}]*grid-template-columns/s, `${sheet} lays out the stage card`);
    assert.doesNotMatch(other, /\.overview-stage-card[^,{}]*\{[^}]*min-height/s, `${sheet} sets a stage card height`);
  }
});

test('overview nodes keep a single non-overlapping stack', () => {
  const refined = readFileSync(join(root, 'renderer/refined.css'), 'utf8');
  const owner = refined.slice(refined.indexOf('THE OVERVIEW — PRODUCTION PIPELINE'));
  const nodeBtn = owner.match(/\.pipeline-rail-track \.node \.stage-run-btn \{[^}]+\}/)?.[0] || '';
  assert.match(nodeBtn, /position:\s*static/);
  assert.doesNotMatch(nodeBtn, /position:\s*absolute/);
  assert.match(nodeBtn, /min-width:\s*0/);
  assert.match(nodeBtn, /max-width:\s*100%/);
  assert.match(nodeBtn, /text-overflow:\s*ellipsis/);
  assert.match(owner, /\.pipeline-rail-track \.node \.overview-stage-label \{[^}]*white-space:\s*nowrap/s);
  assert.match(owner, /\.pipeline-rail-track \.node \.overview-stage-label \{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(owner, /\.pipeline-rail-track \.node > strong \{[^}]*white-space:\s*nowrap/s);
  assert.match(owner, /\.pipeline-rail-track \.node > strong \{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(owner, /\.pipeline-rail-track \.overview-stage-card\.node \{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.match(owner, /background-size:\s*48px 48px/);
  assert.match(renderer, /function isOverviewNodeAction/);
  assert.match(renderer, /function layoutPipelineRail/);
  assert.match(renderer, /btn\.removeAttribute\('title'\)/);
});

test('preview lab keeps an in-card start action even when blocked', () => {
  assert.match(html, /data-action="run-stage" data-stage="preview"/);
  assert.match(html, /data-stage="preview"[^>]*>Start</);
  assert.match(html, /class="stage-run-reason"/);
  assert.match(renderer, /function overviewNodeActionLabel/);
  assert.match(renderer, /disable: running \|\| Boolean\(reason\)/);
  assert.doesNotMatch(html, /After mockups/);
  assert.doesNotMatch(renderer, /After mockups/);
  assert.doesNotMatch(renderer, /syncOverviewNodeAction\(btn, \{ hide: !showInCard, disable: running \}\)/);
});

test('overview squares pin the fill at the top and keep Generate on Pages', () => {
  const owner = refined.slice(refined.indexOf('THE OVERVIEW — PRODUCTION PIPELINE'));
  const meter = owner.match(/\.pipeline-rail-track \.node \.stage-meter \{[^}]+\}/)?.[0] || '';
  assert.match(meter, /position:\s*absolute/);
  assert.match(meter, /top:\s*0/);
  assert.doesNotMatch(owner, /:not\(:has\(\.stage-run-btn:not\(\[hidden\]\)\)\) \.stage-meter/);
  assert.match(owner, /background-color:\s*#3AA0F2/);
  const rail = html.slice(html.indexOf('pipeline-rail-track'), html.indexOf('data-workspace-pane="characters"'));
  assert.match(rail, /<article class="overview-stage-card node"[^>]*>\s*<span class="stage-meter n-bar"/);
  assert.match(rail, /data-action="run-stage" data-stage="interior"[^>]*>Generate</);
  assert.match(rail, /data-action="run-stage" data-stage="interior_artwork"[^>]*>Generate</);
  assert.match(rail, /data-action="regenerate-interior" data-stage="interior_artwork"/);
  assert.match(renderer, /card\.dataset\.percent/);
  assert.match(renderer, /overviewNodeActionLabel\(step/);
});

test('overview uses one page atmosphere, not a nested inner board', () => {
  const owner = refined.slice(refined.indexOf('THE OVERVIEW — PRODUCTION PIPELINE'));
  const board = owner.match(/html body\.ui-redesign\.versa-studio\.pro-suite \.overview-board \{[^}]+\}/)?.[0] || '';
  assert.match(board, /background:\s*transparent/);
  assert.doesNotMatch(board, /#070A12|#050609/);
  assert.match(owner, /#project-standard-view:has\(\[data-workspace-pane="overview"\]\.is-active\)/);
  assert.match(owner, /#workspace-stage:has\(\[data-workspace-pane="overview"\]\.is-active\)[\s\S]{0,400}background:\s*transparent/s);
  assert.match(owner, /\.overview-board::before[\s\S]{0,120}content:\s*none/s);
});

test('stage state is one vocabulary, written as data', () => {
  assert.match(renderer, /card\.dataset\.state = state;/);
  // The card used to carry is-done, a bare done, and pending all at once.
  assert.doesNotMatch(renderer, /card\.classList\.toggle\('pending'/);
  assert.doesNotMatch(renderer, /card\.classList\.toggle\(`is-\$\{name\}`/);
  const refined = readFileSync(join(root, 'renderer/refined.css'), 'utf8');
  assert.match(refined, /\.node\[data-state="live"\]/);
  assert.match(refined, /\.node\[data-state="done"\]/);
});

test('the product ring renders a value instead of hiding', () => {
  assert.match(html, /id="overview-product-ring"/);
  assert.match(html, /id="stat-percent"/);
  const refined = readFileSync(join(root, 'renderer/refined.css'), 'utf8');
  assert.match(refined, /\.product-ring::before[\s\S]*conic-gradient\(var\(--vs-accent\) calc\(var\(--progress, 0\) \* 1%\)/);
  assert.doesNotMatch(readFileSync(join(root, 'renderer/studio.css'), 'utf8'), /#overview-product-ring[^}]*display:\s*none/s);
});

test('workspace panes slide on a track and stage shells stay on screen', () => {
  assert.match(html, /id="workspace-stage"/);
  assert.match(html, /id="workspace-track"/);
  assert.match(html, /id="tpt-thumbnails-review"/);
  assert.match(css, /@keyframes view-enter/);
  assert.match(css, /@keyframes stage-slide-next/);
  assert.match(css, /@keyframes page-fill-breathe/);
  assert.match(css, /@keyframes book-row-in/);
  assert.match(renderer, /stage-slide-next/);
  assert.match(renderer, /function shiftWorkspacePane/);
  assert.match(css, /\.workspace-pane\.is-active\s*\{\s*display:\s*block;/);
  assert.doesNotMatch(css, /\.workspace-pane\s*\{[^}]*visibility:\s*hidden/);
  assert.doesNotMatch(preload, new RegExp(`clear${removedPlatform[0].toUpperCase()}${removedPlatform.slice(1)}Template:`));
  assert.match(preload, /clearJobImage:/);
});

test('overview product progress is separate from interior page completion', () => {
  assert.match(html, /Product progress/);
  assert.match(html, /id="overview-open-stages"/);
  assert.match(html, /product-pipeline\.js/);
  assert.match(html, /data-stage="thumbnails"/);
  assert.doesNotMatch(html, /Overall generation/);
});

test('start and pause stay visible as a transport cluster without a forbidden cursor', () => {
  assert.match(html, /class="hero-transport"/);
  assert.match(html, /id="pause-button"/);
  assert.match(html, /id="live-pause-button"/);
  assert.match(html, /class="hero-utility-row"/);
  assert.match(css, /\.button-pause:not\(:disabled\)/);
  assert.match(css, /\.hero-transport-buttons[\s\S]*cursor:\s*pointer/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /button:disabled \{ opacity: 0.55; cursor: pointer !important; \}/);
  assert.doesNotMatch(css, /\.hero-transport[\s\S]{0,800}not-allowed/);
  assert.match(renderer, /function isPipelineBusy\(\)/);
  assert.match(renderer, /work\.stopping/);
  assert.doesNotMatch(renderer, /element\.hidden = completedForUpload/);
  const midnight = readFileSync(join(root, 'renderer/midnight-theme.css'), 'utf8');
  assert.match(midnight, /html\[data-theme="dark"\] \.button-pause/);
  assert.match(midnight, /#FF3B30|#FF453A|#D70015/);
});

test('workspace exposes Maze Overview and Maze Lab for maze books', () => {
  assert.match(html, /data-workspace-pane="maze"/);
  assert.match(html, /data-workspace-section="maze"/);
  assert.match(html, /data-view-target="maze"/);
  assert.match(html, />Maze Lab</);
  assert.match(html, /id="overview-workspace-tab"/);
  assert.match(html, /name="analysisPipelineChoice" value="maze"/);
  assert.match(html, /id="maze-lab-status"/);
  assert.match(html, /id="maze-keyword"/);
  assert.match(html, /id="maze-age-band"/);
  assert.match(html, /id="maze-difficulty"/);
  assert.match(html, /id="maze-page-count"/);
  assert.match(html, /id="maze-start-asset"/);
  assert.match(html, /id="maze-end-asset"/);
  assert.match(html, /id="maze-seed"/);
  assert.match(html, /data-action="generate-maze"/);
  assert.match(html, /data-action="cancel-maze"/);
  assert.match(html, /data-action="resume-maze"/);
  assert.match(html, /data-action="maze-preview-variant" data-variant="student"/);
  assert.match(html, /data-action="maze-preview-variant" data-variant="solution"/);
  assert.match(html, /data-action="copy-maze-seed"/);
  assert.match(html, /data-action="toggle-maze-seed-lock"/);
  assert.match(html, /data-action="reroll-maze-seed"/);
  assert.match(html, /data-action="regenerate-maze-page"/);
  assert.doesNotMatch(html, /Sample Lab/);
  assert.match(renderer, /setStageVisible\('maze', showMazeStage\)/);
  assert.match(renderer, /setStageVisible\('interior', !showEditableStage && !showMazeStage\)/);
  assert.match(renderer, /const mazeOrder = \['maze', 'thumbnails', 'preview', 'export'\]/);
  assert.match(renderer, /Maze Overview/);
  assert.match(preload, /getMazeProject:/);
  assert.match(preload, /setMazeConfig:/);
  assert.match(preload, /generateMaze:/);
  assert.match(preload, /generateMazeBook:/);
  assert.match(preload, /cancelMaze:/);
  assert.match(preload, /rerollMazeSeed:/);
});

test('workspace exposes the native editable engine, not an external template path', () => {
  assert.match(html, /data-workspace-section="interior_artwork"/);
  assert.match(html, /id="editable-engine-status"/);
  assert.match(html, /id="run-editable-engine-button"/);
  assert.match(html, /data-action="run-editable-engine"/);
  // Editable products run their own pipeline, so each stage is its own card and pane.
  for (const stage of ['interior_artwork', 'interior_text', 'editable_ppt']) {
    assert.match(html, new RegExp(`data-workspace-pane="${stage}"`));
    assert.match(html, new RegExp(`data-stage="${stage}"`));
  }
  assert.match(html, />Pages Lab</);
  assert.match(html, />Text Lab</);
  assert.match(html, />Editable Lab</);
  assert.match(html, />Mockups Lab</);
  assert.match(html, />Preview Lab</);
  assert.doesNotMatch(html, />Thumbnails Lab</);
  assert.doesNotMatch(html, /data-view-target="mockups"/);
  assert.doesNotMatch(html, /data-workspace-pane="mockups"/);
  assert.match(html, /Editable PowerPoint/);
  assert.match(html, /id="editable-artwork-status"/);
  assert.match(html, /id="editable-text-status"/);
  assert.match(html, /id="generate-editable-text-button"/);
  assert.match(html, /data-action="generate-editable-text"/);
  assert.match(renderer, /action === 'generate-editable-text'/);
  assert.match(renderer, /api\.generateEditablePageText/);
  assert.match(html, /data-action="run-stage"/);
  assert.match(html, /data-action="start-full-automation"/);
  assert.match(renderer, /function renderEditableEngineProgress/);
  assert.match(renderer, /action === 'run-editable-engine'/);
  assert.match(renderer, /api\.runEditableGeneration/);
  assert.match(renderer, /action === 'run-stage'/);
  assert.match(renderer, /action === 'start-full-automation'/);
  assert.match(renderer, /function stageStartBlockReason/);
  assert.match(renderer, /function browserBusyReason/);
  assert.doesNotMatch(html, new RegExp(`settings-${removedPlatform}-card`, 'i'));
  assert.doesNotMatch(html, new RegExp(`run-${removedPlatform}-editable`, 'i'));
  assert.doesNotMatch(renderer, new RegExp(`function ${removedPlatform}Locked`, 'i'));
  assert.doesNotMatch(renderer, new RegExp(`settings-manage-${removedPlatform}`, 'i'));
});

test('legacy external editor dashboard is gone from the production renderer', () => {
  assert.doesNotMatch(html, /id="mini-editable-engine-dashboard"/);
  assert.doesNotMatch(html, /data-action="mini-toggle"/);
  assert.doesNotMatch(renderer, /mini-editable-engine-dashboard/);
  const uiCss = readFileSync(join(root, 'renderer/ui.css'), 'utf8');
  assert.doesNotMatch(uiJs, /getElementById\('mini-editable-engine-dashboard'\)/);
  assert.doesNotMatch(uiCss, /#mini-editable-engine-dashboard/);
});

test('native workspace actions are wired through handleAction', () => {
  assert.match(html, /data-workspace-pane="editable_ppt"/);
  for (const action of [
    'run-editable-engine',
    'focus-browser', 'new-project', 'launch-browser', 'start', 'pause'
  ]) {
    assert.match(renderer, new RegExp(`action === '${action}'`));
  }
  for (const action of ['ui-toggle-sidebar', 'ui-focus-search']) {
    assert.match(uiJs, new RegExp(`action === '${action}'`));
  }
  assert.match(html, /data-action="new-project"/);
  assert.doesNotMatch(preload, new RegExp(`resume${removedPlatform[0].toUpperCase()}${removedPlatform.slice(1)}Job:`));
  assert.doesNotMatch(preload, new RegExp(`resolve${removedPlatform[0].toUpperCase()}${removedPlatform.slice(1)}Intervention:`));
});

test('the Gate search is Versa Agent and stays wired to TPT', () => {
  assert.match(html, /id="studio-intro-prompt"/);
  assert.match(html, /id="studio-intro-route"/);
  assert.match(html, /id="studio-intro-typewriter"/);
  assert.match(html, /versa-oled-idle/);
  assert.match(html, /Type a keyword\./);
  assert.match(html, /placeholder="Search keyword"/);
  assert.match(html, /id="studio-intro-generate"[^>]*>\s*Generate/);
  assert.doesNotMatch(html, /Find a book worth making/);
  const intro = html.match(/<section id="studio-intro"[\s\S]*?<\/section>/)?.[0] || '';
  const empty = html.match(/<section id="empty-state"[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(intro, /market-desk/);
  assert.doesNotMatch(intro, /data-market-rail/);
  assert.doesNotMatch(refined, /#f3eee6|#efe8dc|#fffaf3/);
  assert.doesNotMatch(empty, /market-desk/);
  assert.doesNotMatch(empty, /data-market-rail/);
  assert.doesNotMatch(html, /VERSA AGENT scrapes Teachers Pay Teachers for trendy books/);
  assert.doesNotMatch(html, /VERSA AGENT finds trending TPT books/);
  assert.match(uiJs, /startOledTypewriter|studio-intro-typewriter/);
  assert.match(uiJs, /Which book\?/);
  assert.match(uiJs, /Your next book\./);
  assert.match(uiJs, /What next\?/);
  assert.doesNotMatch(uiJs, /Type keyword, versa agent will get a book for you\./);
  assert.match(refined, /#050609/);
  assert.match(refined, /overflow:\s*hidden/);
  assert.match(refined, /rgba\(20,\s*26,\s*36,\s*0\.4\)/);
  assert.match(refined, /rgba\(10,\s*12,\s*17,\s*0\.6\)/);
  assert.match(refined, /translateY\(-2px\)/);
  assert.match(refined, /#ui-sidebar[\s\S]*overflow-y:\s*auto/);
  assert.match(refined, /#workspace-stage[\s\S]*overflow-y:\s*auto/);
  assert.match(renderer, /function startGateIngestion\(rawQuery\)/);
  assert.match(renderer, /function openIncomingMarketplace\(/);
  assert.match(renderer, /async function startAgentAnalysisHandoff[\s\S]*applyIncomingListing\(chosen\)/);
  assert.match(renderer, /incomingMarketBook/);
  assert.doesNotMatch(renderer, /Searching in the background/);
  assert.match(renderer, /data-action="delete-project"/);
  assert.match(renderer, /async function deleteProjectById\(/);
  assert.match(renderer, /api\.scanTrends\(\{ query, marketplace: 'tpt' \}\)/);
  assert.match(renderer, /api\.analyzeProduct\(chosen\)/);
  assert.match(renderer, /async function generateMazeFromMarketplace\(/);
  assert.match(renderer, /await generateMazeFromMarketplace\(project\)/);
  assert.match(renderer, /api\.generateMazeBook\(project\.id/);
  assert.match(renderer, /forceAgeFromListing: true/);
  assert.match(renderer, /listingTitle: project\.tptListing\?\.title/);
  assert.doesNotMatch(renderer, /ageBand: 'kindergarten'/);
  assert.match(renderer, /holdDone/);
  assert.match(renderer, /Listing found \$\{productUrl\}/);
  assert.match(renderer, /markConceptReadyFromAnalysis\(/);
  assert.match(renderer, /Saved locally/);
  assert.match(renderer, /async function finishGateAnalysis[\s\S]*generateMazeFromMarketplace/);
  assert.match(renderer, /async function startAgentAnalysisHandoff[\s\S]*await finishGateAnalysis\(result\)/);
  assert.match(renderer, /localStage === 'extract' && !marketSession\.active/);
  assert.doesNotMatch(renderer, /async function finishGateAnalysis[\s\S]*generatePromptsAndCreateProject/);
  assert.match(html, /data-market-rail/);
  assert.match(html, /data-market-stage="scan"/);
  assert.match(html, /data-market-stage="analyze"/);
  assert.match(html, /data-market-stage="extract"/);
  assert.match(html, /data-market-stage="prompts"/);
  assert.match(html, /data-market-stage="capture"/);
  assert.match(html, /data-market-stage="lab"/);
  assert.match(html, /data-market-stage="assemble"/);
  assert.match(html, /data-market-stage="mockups"/);
  assert.match(html, /data-market-stage="preview"/);
  assert.match(html, /data-market-stage="export"/);
  assert.match(html, /Assembling/);
  assert.match(renderer, /continueMazePipelineFromLab/);
  assert.match(renderer, /api\.continueMazePipeline/);
  assert.match(preload, /continueMazePipeline/);
  assert.doesNotMatch(renderer, /Opened Maze Lab/);
  assert.match(html, /Analyzing/);
  assert.match(html, /Extracting/);
  assert.match(html, /Generating/);
  assert.match(html, /Capturing/);
  assert.match(html, />Lab</);
  assert.match(html, /id="project-concept-view"[^>]*concept-brief/);
  assert.match(renderer, /function setMarketStage\(/);
  assert.match(renderer, /function marketStageFromCheckpoint\(/);
  assert.match(renderer, /function syncMarketRailFromState\(/);
  assert.match(renderer, /function adoptFinishedMarketplaceAnalysis\(/);
  assert.match(renderer, /function findIncomingAnalysisProject\(/);
  assert.match(renderer, /function paintBrowserSupervisor\(/);
  assert.match(renderer, /api\.onAnalysisFinished/);
  assert.match(renderer, /syncMarketRailFromState\(state\)/);
  assert.match(html, /data-browser-supervisor/);
  assert.match(preload, /onAnalysisFinished/);
  assert.match(preload, /analysis:finished/);
  assert.match(renderer, /function seedConceptMarketRail\(/);
  assert.match(renderer, /function applyPromptProgressToRail\(/);
  assert.match(renderer, /function markConceptReadyFromAnalysis\(/);
  assert.match(renderer, /agentPipeline/);
  assert.match(preload, /onPromptProgress/);
  assert.match(preload, /analysis:prompt-progress/);
  assert.doesNotMatch(renderer, /if \(!query\) \{\s*openProjectDialog\(\);/);
  const main = readFileSync(join(root, 'src/main.cjs'), 'utf8');
  assert.match(main, /scrapeSource\(\{ source: 'tpt', query: seed/);
  assert.match(main, /if \(!listing\.productUrl\) assertIdle\(\)/);
  const scout = readFileSync(join(root, 'src/trend-scout.cjs'), 'utf8');
  assert.match(scout, /tptBrowseSearchUrl\(query\)/);
  assert.doesNotMatch(scout, /Browse\/Search:\$\{encodeURIComponent\(query\)\}/);
});

test('the studio mode toggle and kickers say Studio, never Atelier', () => {
  assert.match(html, /id="studio-cockpit-btn"[^>]*>Studio</);
  assert.match(html, /class="studio-scale-page__kicker">Studio</);
  assert.match(html, /id="studio-stage-kicker">Studio</);
  assert.doesNotMatch(html, />Atelier</);
  assert.match(uiJs, /book \|\| 'Studio'/);
  assert.doesNotMatch(uiJs, /'Atelier'/);
});

test('AI profiles use exact ChatGPT / Gemini / Meta AI names with brand logos', () => {
  assert.match(html, /<h4>ChatGPT<\/h4>/);
  assert.match(html, /<h4>Gemini<\/h4>/);
  assert.match(html, /<h4>Meta AI<\/h4>/);
  assert.match(html, /class="engine-toggle-name">ChatGPT</);
  assert.match(html, /class="engine-toggle-name">Gemini</);
  assert.match(html, /class="engine-toggle-name">Meta AI</);
  assert.doesNotMatch(html, /ChatGPT account \(mockups\)/);
  assert.doesNotMatch(html, /Google Gemini \(text/);
  assert.doesNotMatch(html, /Meta \(page images\)/);
  assert.doesNotMatch(html, /Winner Mockups/);
  assert.match(html, /assets\/brand\/chatgpt\.png/);
  assert.match(html, /assets\/brand\/gemini\.png/);
  assert.match(html, /assets\/brand\/meta-ai\.png/);
  assert.match(html, /class="ai-profile-identity"/);
  assert.ok(existsSync(join(root, 'assets/brand/chatgpt.png')));
  assert.ok(existsSync(join(root, 'assets/brand/gemini.png')));
  assert.ok(existsSync(join(root, 'assets/brand/meta-ai.png')));
  assert.doesNotMatch(renderer, /ChatGPT session verified for mockups/);
  assert.doesNotMatch(renderer, /Connect Google Gemini/);
});

test('settings rows keep a four-track grid and name Gems apart from Custom GPTs', () => {
  assert.match(html, /<h4>Gems<\/h4>/);
  assert.match(html, /<h4>Custom GPTs<\/h4>/);
  assert.match(html, /id="settings-gpts-card"/);
  assert.match(html, /id="settings-gpts-list"/);
  assert.match(html, /class="settings-pane"/);
  assert.match(refined, /grid-template-columns:\s*40px minmax\(0,\s*1fr\) 160px 220px/);
  assert.match(refined, /\.settings-dialog \.integration-copy \.settings-status-dot \{[^}]*position:\s*static/s);
  assert.doesNotMatch(css, /\.integration-copy \.settings-status-dot \{ position: absolute/);
  assert.match(renderer, /settingsGptsList/);
  assert.match(renderer, /function renderStudioGroup/);
});

test('STEP 3 skins Settings OLED and restyles the existing toast host', () => {
  assert.match(refined, /STEP 3/);
  assert.match(refined, /#settings-dialog\.settings-dialog[\s\S]*#050609/);
  assert.match(refined, /\.settings-dialog \.settings-content[\s\S]*overflow-y:\s*auto/);
  assert.match(refined, /#4ea9f0/);
  assert.match(refined, /rgba\(30,\s*35,\s*45,\s*0\.5\)/);
  assert.match(refined, /blur\(24px\)/);
  assert.match(refined, /@keyframes versa-notice-in/);
  assert.match(refined, /translateX\(0\)/);
  assert.match(html, /id="toast-host"/);
  assert.match(html, /class="toast-host versa-notice-stack"/);
  assert.match(renderer, /function showRichToast/);
});

test('STEP 4 keeps Text Lab as an image dashboard and static engines off Text Lab', () => {
  assert.match(refined, /STEP 4/);
  assert.match(refined, /#text-page-deck[\s\S]*repeat\(auto-fill,\s*minmax\(168px,\s*1fr\)\)/);
  assert.match(refined, /#text-page-deck[\s\S]*overflow-x:\s*(hidden|clip)/);
  assert.match(refined, /#text-page-deck[\s\S]*touch-action:\s*pan-y/);
  assert.match(refined, /#text-page-deck \.page-card-actions \{[\s\S]*?opacity:\s*0/);
  assert.match(renderer, /function textLabPageIsFlat/);
  assert.match(refined, /cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
  assert.match(refined, /0 8px 32px rgba\(0,\s*0,\s*0,\s*0\.4\)/);
  assert.match(renderer, /setStageVisible\('interior_text', showEditableStage\)/);
  assert.match(renderer, /const staticOrder = \['interior', 'thumbnails', 'preview', 'export'\]/);
  assert.match(renderer, /if \(activeWorkspaceView === 'interior_text'\) return false/);
  assert.match(renderer, /function visibleWorkspacePanes\(\)/);
  assert.doesNotMatch(renderer, /setStageVisible\('interior_text', true\)/);
});

test('STEP 5 uses the signature accent and clips Text Lab sideways', () => {
  assert.match(refined, /STEP 5/);
  assert.match(refined, /#3AA0F2/);
  assert.match(refined, /overflow-x:\s*clip/);
  assert.match(refined, /cubic-bezier\(0\.175,\s*0\.885,\s*0\.32,\s*1\.275\)/);
  assert.match(refined, /prefers-reduced-motion/);
  assert.match(renderer, /setAttribute\('inert'/);
  assert.match(renderer, /tabIndex = -1/);
  assert.match(renderer, /classList\.add\('is-leaving'\)/);
  assert.match(html, /Type a keyword\./);
  assert.match(html, /placeholder="Search keyword"/);
  assert.match(html, /for="canvas-agent-route">Search keyword</);
});
