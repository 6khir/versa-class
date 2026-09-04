'use strict';

const fs = require('node:fs');
const path = require('node:path');

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Could not inject license gate: missing ${label}`);
  }
  const next = source.replace(search, replacement);
  if (next === source) {
    throw new Error(`Could not inject license gate: ${label} replacement produced no change`);
  }
  return next;
}

function injectLicenseGate(mainPath) {
  let source = fs.readFileSync(mainPath, 'utf8');

  source = replaceOnce(
    source,
    'if (singleInstanceAcquired) app.whenReady().then(() => {',
    'if (singleInstanceAcquired) app.whenReady().then(async () => {',
    'whenReady callback'
  );

  source = replaceOnce(
    source,
    '  store.recoverInterrupted();\n  protocol.handle(\'tpt-image\', async (request) => {',
    `  store.recoverInterrupted();

  {
    const licenseGate = require('./license-gate.cjs');
    const licenseAllowed = await licenseGate.enforceRemotePolicy({
      app,
      dialog,
      shell,
      currentVersion: app.getVersion(),
      userDataPath: app.getPath('userData')
    });
    if (!licenseAllowed) {
      try { splashWindow?.close(); } catch {}
      app.exit(1);
      return;
    }
    licenseGate.startLicenseWatch({
      app,
      dialog,
      shell,
      currentVersion: app.getVersion(),
      userDataPath: app.getPath('userData')
    });
  }

  protocol.handle('tpt-image', async (request) => {`,
    'startup license check'
  );

  fs.writeFileSync(mainPath, source);
  return mainPath;
}

if (require.main === module) {
  const target = process.argv[2] || path.join(__dirname, 'staging', 'src', 'main.cjs');
  injectLicenseGate(target);
  process.stdout.write(`Injected license gate into ${target}\n`);
}

module.exports = { injectLicenseGate };
