'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-controller.cjs'), 'utf8');

// Bounded by the next method, not by the first closing brace at that indent: a
// nested block ends the slice early and the assertions then run against half a
// function.
function body(signature) {
  const start = source.indexOf(signature);
  assert.ok(start > -1, `${signature} should exist`);
  const end = source.indexOf('\n  async ', start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

// Every wait loop in the controller calls detectBlocker once per tick. On a Gemini
// page one call costs a full-DOM text scan plus a sign-in probe, so during a single
// analysis it ran a hundred times and dominated the wall clock.

test('detectBlocker reuses a recent result instead of rescanning every tick', () => {
  const fn = body('async detectBlocker(page = null');
  assert.match(fn, /maxAgeMs = 2_500/);
  assert.match(fn, /this\.blockerCache\.get\(page\)/);
  assert.match(fn, /this\.blockerCache\.set\(page, \{ at: Date\.now\(\), url/);
  // Keyed on the URL as well, so a navigation cannot serve a stale verdict.
  assert.match(fn, /cached\.url === url/);
  assert.match(source, /this\.blockerCache = new WeakMap\(\)/);
});

// The sign-in sweep at the top of detectBlocker computed three auth verdicts and
// discarded all of them — the AUTH_REQUIRED returns they fed were removed in an
// earlier refactor and the detection was left behind, running once a second for
// the whole of every analysis.

test('the discarded sign-in sweep is gone from the poll path', () => {
  const fn = body('async detectBlocker(page = null');
  for (const name of ['chatgptAuth', 'geminiAuth', 'metaAuth', 'authMessageVisible']) {
    assert.ok(!fn.includes(name), `detectBlocker still computes ${name} without using it`);
  }
  assert.doesNotMatch(fn, /getByText\(AUTH_TEXT_PATTERN\)/);
  assert.doesNotMatch(fn, /#geminiLooksSignedIn/);
  assert.doesNotMatch(fn, /#hasVisibleLoginControl/);
});

test('the session is still checked, just not on every tick', () => {
  // Removing the sweep must not remove the guarantee: assertAuthenticated runs
  // before work starts and is the thing that reports a dead session.
  assert.match(source, /async assertAuthenticated\(page = null\)/);
  assert.match(body('async assertAuthenticated(page = null'), /code: 'AUTH_REQUIRED'/);
});

// Waiting is measured against what the page is doing, not against a fixed number of
// slow ticks.

test('the public text wait delegates to the strong draft observer', () => {
  const fn = body('async waitForAssistantTextResponse(');
  assert.match(fn, /#waitForAssistantTextObservation/);
  assert.doesNotMatch(fn, /stableCount/);
});

test('the text wait classifies drafting instead of a fixed settle window', () => {
  const fn = body('async #waitForAssistantTextObservation(');
  assert.match(fn, /classifyGeminiTextObservation/);
  assert.match(fn, /decideGeminiTextAction/);
  assert.match(fn, /text watch/);
  assert.match(fn, /BLOCKER_CHECK_MS/);
  assert.match(fn, /shouldReadFullGeminiTranscript/);
  assert.match(fn, /#sampleGeminiDraft/);
  assert.match(fn, /maxDraftMs/);
  assert.doesNotMatch(fn, /stableCount/);
});

test('Gemini, ChatGPT, and Meta AI sample length and suffix instead of re-parsing the full transcript every poll', () => {
  assert.match(source, /estimatePromptProgressFromSample/);
  assert.match(source, /#persistLoginStateThrottled/);
  assert.match(source, /fullText: Boolean\(wantFull\)/);
  assert.match(source, /#assistantDraftConfig/);
  assert.match(source, /CHATGPT_BUSY_SELECTORS/);
  const sample = body('async #sampleGeminiDraft(');
  assert.match(sample, /collapsedRootSelector/);
  assert.match(sample, /messages\.slice\(Math\.max\(0, baselineCount\)\)/);
  assert.doesNotMatch(sample, /#newAssistantText/);
  const wait = body('async #waitForAssistantTextObservation(');
  assert.match(wait, /analysisDraftUsable/);
  assert.match(wait, /analysisReady/);
  assert.match(wait, /#serviceName\(page\)\} text watch/);
  assert.match(wait, /persistEngine === 'chatgpt'/);
  assert.match(wait, /persistEngine === 'meta'/);
});

test('prompt batches continue or shrink instead of stopping around 21 pages', () => {
  assert.match(source, /Content Gem prompt batch: pages/);
  assert.match(source, /reuseCurrentPage: round > 0/);
  assert.match(source, /buildPromptsContinuationRequest/);
  assert.match(source, /Gemini lagged on a/);
  assert.match(source, /maxDraftMs: 10 \* 60_000/);
  assert.match(source, /#waitForAssistantTextObservation/);
});

test('the controller reuses a signed-in Gemini tab and one-click restores the saved Google profile', () => {
  assert.match(source, /pickPreferredGeminiPage/);
  assert.match(source, /shouldOneClickGeminiSignIn/);
  assert.match(source, /#clickVisibleGeminiSignIn/);
  assert.match(source, /#clickSavedGoogleAccount/);
  assert.match(source, /setVerifiedAccounts/);
  assert.match(source, /fresh: false, url: conversationUrl/);
});

test('attachment chips stop polling once the count has settled', () => {
  const fn = body('async #waitForComposerUploads(page, expectedCount)');
  // The old loop polled once a second and burned the full 20s ceiling on every
  // partial attach — twice, because mustHaveAll clears and retries.
  assert.match(fn, /await sleep\(250\)/);
  assert.match(fn, /stableFor >= 4/);
  // The ceiling itself is unchanged: nothing that used to succeed gives up sooner.
  assert.match(fn, /Date\.now\(\) - startedAt < 20_000/);
});

test('per-submission fixed sleeps are not the dominant cost', () => {
  assert.match(body('async #captureImageBaseline(page)'), /await sleep\(250\)/);
  assert.match(source, /pollIntervalMs = 250/);
  // The blanket 800ms after every attachment strategy is gone.
  assert.doesNotMatch(body('async attachImages(page, filePaths'), /await sleep\(800\)/);
});

test('image wait heartbeats carry the observer generating flag as soon as it changes', () => {
  const fn = body('async waitForNewImage(baseline = [], timeoutMs = 600_000, {');
  assert.match(fn, /IMAGE_GENERATION_OBSERVE_MS/);
  assert.match(fn, /emitImageWaitHeartbeat/);
  assert.match(fn, /generating: extra\.generating/);
  assert.match(fn, /phase: 'image_ready'/);
  assert.match(fn, /phase: 'failed'/);
  assert.match(source, /IMAGE_WAIT_HEARTBEAT_MS = 1_000/);
  // The old 5s payload omitted generating, so Pages Lab stayed idle or stuck.
  assert.doesNotMatch(fn, /lastHeartbeat >= 5_000/);
});

test('marketplace scratch browser can use an installed Chrome', () => {
  const start = source.indexOf('function playwrightChromiumPath');
  const end = source.indexOf('\nclass BrowserController');
  const fn = source.slice(start, end);
  assert.match(fn, /headless: !headed/);
  assert.match(fn, /function scratchBrowserCandidates/);
  assert.match(fn, /async function launchHeadlessScratchBrowser/);
  assert.match(fn, /PLAYWRIGHT_BROWSER_MISSING/);
});

test('listing mockup capture stays off the Gemini tab', () => {
  const fn = body('async scrapeTptListingMockups(productUrl, destDir)');
  assert.match(fn, /withVisibleMarketContext/);
  assert.match(fn, /extractTptListingFacts/);
  assert.match(fn, /MARKET_NAV_STALLED/);
  assert.doesNotMatch(fn, /this\.page\.goto/);
  assert.doesNotMatch(fn, /forceBrowser: true/);
});

test('analysis closes leftover marketplace tabs and watches the tab it submitted on', () => {
  assert.match(source, /#closeManagedMarketplaceTabs/);
  assert.match(source, /isMarketplacePageUrl/);
  assert.match(source, /MARKET_TAB_HIJACK/);
  const launch = body('async #launchForPromptWork(');
  assert.match(launch, /#closeManagedMarketplaceTabs/);
  const analyze = body('async analyzeProductWithGpt(input = {})');
  assert.match(analyze, /submission\.page/);
  assert.match(analyze, /STAGE\.GEMINI_ANALYSIS/);
  const submit = body('async submitPrompt(prompt, {');
  assert.match(submit, /conversationUrl: page\.url\(\),\s*page/);
  assert.match(submit, /#openFreshGeminiStudioTab/);
  const fresh = body('async #openFreshGeminiStudioTab(gptUrl, stalePage = null)');
  assert.match(fresh, /STAGE_LAG_MS/);
});

test('analysis stays on the submitted Gemini tab until the brief is ready', () => {
  const analyze = body('async analyzeProductWithGpt(input = {})');
  const apply = body('async #applySupervisorDecision(decision, {');
  assert.match(analyze, /this\.supervisor\.beginJob/);
  assert.match(analyze, /script-stay-until-result/);
  assert.match(analyze, /#applySupervisorDecision/);
  assert.match(analyze, /skipAttachments: this\.supervisor\.checkpoint\.recoveryCount > 0/);
  assert.match(analyze, /#disarmGeminiImageGeneration/);
  assert.match(apply, /stalePage && !stalePage\.isClosed/);
  assert.match(source, /isGeminiChromeNoise/);
  assert.match(source, /currentGem !== targetGem/);
  assert.match(source, /#closeExtraGeminiTabs/);
  assert.match(source, /BrowserSupervisor/);
});

test('analysis does not wait ten minutes on a stuck Gemini stop button', () => {
  const submit = body('async submitPrompt(prompt, {');
  assert.match(submit, /analysisTurn \? STAGE_LAG_MS : 600_000/);
  assert.match(submit, /#openFreshGeminiStudioTab/);
  assert.match(submit, /attachWithBudget/);
  assert.match(submit, /#closeManagedMarketplaceTabs/);
  const idle = body('async waitUntilIdle(timeoutMs = 600_000, page = null)');
  assert.match(idle, /#idleStopSelectors/);
  assert.match(source, /aria-label="Stop response"/);
});
