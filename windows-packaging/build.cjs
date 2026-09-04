'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const STAGING = path.join(__dirname, 'staging');
const DIST_WINDOWS = path.join(ROOT, 'dist_windows');
const LICENSE_GATE_SRC = path.join(__dirname, 'src', 'license-gate.cjs');
const POLICY_SRC = path.join(__dirname, 'remote', 'versa-class-policy.json');
const BUILDER_CONFIG = path.join(__dirname, 'electron-builder.win.json');

function log(message) {
  process.stdout.write(`[win-build] ${message}\n`);
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function rimraf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

function electronBuilderBin() {
  const local = path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
  if (exists(local)) return local;
  throw new Error('electron-builder is not installed in the Mac project. Leave the Mac app as-is and install it only in the existing node_modules tree.');
}

function prepareStaging() {
  log('Preparing isolated staging copy (Mac src/ is not modified)');
  rimraf(STAGING);
  ensureDir(STAGING);

  copyDir(path.join(ROOT, 'src'), path.join(STAGING, 'src'));
  copyDir(path.join(ROOT, 'renderer'), path.join(STAGING, 'renderer'));
  copyDir(path.join(ROOT, 'assets'), path.join(STAGING, 'assets'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(STAGING, 'package.json'));
  if (exists(path.join(ROOT, 'package-lock.json'))) {
    fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(STAGING, 'package-lock.json'));
  }

  fs.copyFileSync(LICENSE_GATE_SRC, path.join(STAGING, 'src', 'license-gate.cjs'));
  ensureDir(path.join(STAGING, 'remote'));
  fs.copyFileSync(POLICY_SRC, path.join(STAGING, 'remote', 'versa-class-policy.json'));

  const pkg = JSON.parse(fs.readFileSync(path.join(STAGING, 'package.json'), 'utf8'));
  delete pkg.build;
  delete pkg.scripts;
  pkg.scripts = { start: 'electron .' };
  fs.writeFileSync(path.join(STAGING, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

function injectAndObfuscate() {
  const { injectLicenseGate } = require('./inject-license-gate.cjs');
  injectLicenseGate(path.join(STAGING, 'src', 'main.cjs'));
  log('License gate injected into staging main process');

  const { obfuscateTree } = require('./obfuscate.cjs');
  const counts = obfuscateTree(STAGING);
  log(`Obfuscated ${counts.srcFiles} main files and ${counts.rendererFiles} renderer files`);
}

function installStagingDependencies() {
  log('Linking production node_modules into staging');
  const rootModules = path.join(ROOT, 'node_modules');
  const stagingModules = path.join(STAGING, 'node_modules');
  if (!exists(rootModules)) {
    throw new Error('Project node_modules is missing. The Mac app setup was not changed; install dependencies there first.');
  }

  ensureDir(stagingModules);
  execFileSync('rsync', [
    '-a',
    '--delete',
    '--exclude', 'electron-builder',
    '--exclude', 'app-builder-bin',
    '--exclude', 'app-builder-lib',
    '--exclude', '.cache',
    `${rootModules}/`,
    `${stagingModules}/`
  ], { stdio: 'inherit' });

  try {
    log('Fetching Windows sharp binary into staging');
    const tarball = path.join(os.tmpdir(), 'sharp-win32-x64-0.35.4.tgz');
    execFileSync('curl', [
      '-fsSL',
      '-o', tarball,
      'https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-0.35.4.tgz'
    ], { stdio: 'inherit' });
    const dest = path.join(stagingModules, '@img', 'sharp-win32-x64');
    ensureDir(dest);
    execFileSync('tar', ['-xzf', tarball, '-C', dest, '--strip-components=1'], { stdio: 'inherit' });
  } catch (error) {
    log(`Windows sharp optional install skipped: ${error.message || error}`);
  }
}

function listOutputFiles(dir) {
  if (!exists(dir)) return [];
  const results = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(full);
    }
  };
  walk(dir);
  return results;
}

function runBuilder(winTargets = [], extraFlags = []) {
  const bin = electronBuilderBin();
  const commandArgs = ['--win', ...winTargets, '--x64', `--config=${BUILDER_CONFIG}`, ...extraFlags];
  log(`Running electron-builder ${commandArgs.join(' ')}`);
  execFileSync(bin, commandArgs, {
    cwd: __dirname,
    stdio: 'inherit',
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      SKIP_NOTARIZATION: 'true'
    }
  });
}

function findWindowsExe() {
  const files = listOutputFiles(DIST_WINDOWS).filter((file) => file.toLowerCase().endsWith('.exe'));
  files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return files;
}

function fallbackUnpackedCopy() {
  const unpacked = path.join(DIST_WINDOWS, 'win-unpacked');
  if (!exists(unpacked)) return [];
  const exes = fs.readdirSync(unpacked).filter((name) => name.toLowerCase().endsWith('.exe'));
  return exes.map((name) => path.join(unpacked, name));
}

function build() {
  if (os.platform() === 'darwin') {
    log('Cross-compiling a Windows Electron binary from macOS. The Mac app in dist/mac-arm64 is not rebuilt.');
  }

  prepareStaging();
  injectAndObfuscate();
  installStagingDependencies();

  ensureDir(DIST_WINDOWS);
  for (const entry of fs.readdirSync(DIST_WINDOWS)) {
    if (entry === '.gitkeep') continue;
    rimraf(path.join(DIST_WINDOWS, entry));
  }

  const attempts = [
    { winTargets: ['portable'], extraFlags: [] },
    { winTargets: ['nsis'], extraFlags: [] },
    { winTargets: [], extraFlags: ['--dir'] }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      runBuilder(attempt.winTargets, attempt.extraFlags);
      const exes = findWindowsExe();
      if (exes.length > 0) {
        log(`Windows executable ready: ${exes[0]}`);
        return exes;
      }
      const unpacked = fallbackUnpackedCopy();
      if (unpacked.length > 0) {
        log(`Windows unpacked executable ready: ${unpacked[0]}`);
        return unpacked;
      }
      lastError = new Error(`electron-builder ${attempt.winTargets.join(',') || attempt.extraFlags.join(' ')} produced no .exe`);
    } catch (error) {
      lastError = error;
      log(`Target ${attempt.winTargets.join(',') || attempt.extraFlags.join(' ')} failed: ${error.message || error}`);
    }
  }

  throw lastError || new Error('Windows build failed');
}

if (require.main === module) {
  try {
    const outputs = build();
    process.stdout.write(`\nWindows build complete:\n${outputs.join('\n')}\n`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { build };
