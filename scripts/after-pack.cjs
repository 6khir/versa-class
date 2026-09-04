'use strict';

const { execFileSync } = require('node:child_process');
const { homedir } = require('node:os');
const { join } = require('node:path');

function installApp(appPath, destDir, appFile) {
  const dest = join(destDir, appFile);
  execFileSync('mkdir', ['-p', destDir]);
  execFileSync('rm', ['-rf', dest]);
  execFileSync('ditto', ['--norsrc', '--noextattr', '--noacl', appPath, dest]);
  console.log(`installed ${dest}`);
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appFile = `${appName}.app`;
  const appPath = join(context.appOutDir, appFile);
  installApp(appPath, join(homedir(), 'Applications'), appFile);
  try {
    installApp(appPath, '/Applications', appFile);
  } catch (error) {
    console.warn(`could not install /Applications/${appFile}: ${error.message}`);
  }
};
