'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('production modules contain no development-agent instrumentation', () => {
  const files = [
    'automation-manager.cjs',
    'browser-controller.cjs',
    'main.cjs',
    'queue-engine.cjs'
  ];
  const forbidden = [
    /#region agent log/,
    /127\.0\.0\.1:(?:7482|7583|7896)/,
    /\/Users\/abdelmouiz/,
    /\.cursor\/debug-[\w-]+\.log/
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} contains development-only instrumentation`);
    }
  }
});
