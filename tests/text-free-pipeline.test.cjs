'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareTextFreeManifests, isTextFreeProject } = require('../src/text-free-pipeline.cjs');

test('text-free prep writes manifests from quoted prompt copy and never needs vision', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'versa-text-free-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'jobs'));
  const imagePath = path.join(dir, 'jobs', 'j2.png');
  fs.writeFileSync(imagePath, 'png');
  const settings = new Map();
  const store = {
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => settings.set(key, value),
  };
  const project = {
    id: 'p1',
    theme: 'washable-marker',
    generationMode: 'editable',
    jobs: [{
      id: 'j2',
      pageNumber: 2,
      kind: 'interior',
      prompt: 'Draw a worksheet. The image must contain ONLY the following text: "Name Tracing" "Trace each letter."',
    }],
    outputDir: dir,
  };
  assert.equal(isTextFreeProject(store, project), true);
  const prepared = prepareTextFreeManifests({ store, project });
  assert.equal(prepared.pages, 1);
  assert.ok(prepared.zones >= 2);
  assert.equal(prepared.detail[0].reused, false);
  const again = prepareTextFreeManifests({ store, project });
  assert.equal(again.detail[0].reused, true);
});
