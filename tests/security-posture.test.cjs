'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('every window runs isolated, sandboxed and without Node', () => {
  // The renderer handles model output and page content it did not author, so it must
  // never be able to reach Node directly.
  const windows = [...main.matchAll(/webPreferences:\s*\{([\s\S]{0,400}?)\}/g)].map((m) => m[1]);
  assert.ok(windows.length >= 1, 'at least one window should be configured');
  for (const config of windows) {
    assert.match(config, /contextIsolation:\s*true/);
    assert.match(config, /nodeIntegration:\s*false/);
    assert.match(config, /sandbox:\s*true/);
  }
});

test('the renderer runs under a restrictive content policy', () => {
  const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  assert.ok(csp, 'a CSP meta tag should be present');
  assert.match(csp, /default-src 'self'/);
  // No remote code, and no eval.
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /script-src[^;]*https?:/);
});

test('navigation and new windows cannot be redirected by page content', () => {
  assert.match(main, /setWindowOpenHandler/);
  // Everything is denied; an https link is handed to the OS browser instead of opening
  // a window inside the app.
  assert.match(main, /return \{ action: 'deny' \}/);
  assert.match(main, /on\('will-navigate'[\s\S]{0,200}event\.preventDefault\(\)/);
});

test('the packaged app is archived and carries no development artefacts', () => {
  assert.equal(pkg.build.asar, true, 'asar must be on; false ships browsable source');
  const files = pkg.build.files;
  for (const pattern of ['!tests/**/*', '!**/*.test.cjs', '!python/.venv*/**', '!.git/**']) {
    assert.ok(files.includes(pattern), `${pattern} should be excluded from the bundle`);
  }
  // The vision worker is product code and must ship, unlike its 1.2GB venv.
  assert.ok(files.includes('python/*.py'), 'the vision worker must ship');
  assert.ok(files.includes('python/requirements.txt'));
});

test('native modules stay unpacked so they can still load', () => {
  // sharp and playwright load .node binaries and resolve browser paths on disk, which
  // does not work from inside an asar archive.
  const unpack = pkg.build.asarUnpack.join(' ');
  assert.match(unpack, /sharp/);
  assert.match(unpack, /playwright-core/);
  assert.match(unpack, /\*\*\/\*\.node/);
});

test('no credential is committed to the repository', () => {
  const patterns = [/sk-[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  const roots = ['src', 'renderer', 'scripts'];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full);
    return /\.(cjs|js|json|html|css)$/.test(entry.name) ? [full] : [];
  });
  for (const dir of roots) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of walk(full)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        assert.doesNotMatch(text, pattern, `${path.relative(root, file)} appears to contain a credential`);
      }
    }
  }
});

test('.env is ignored and never tracked', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env$/m);
});
