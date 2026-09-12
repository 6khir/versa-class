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

/**
 * Copy the freshly packed app into the Applications folders.
 *
 * This is opt-in. It used to run on every build, which meant packaging silently
 * rm -rf'd whatever was installed and left two more copies behind — so "build a
 * DMG so I can install it" produced three installs, and the count grew every
 * time. Packaging should produce an artifact and change nothing else on the
 * machine.
 *
 * Set VERSA_INSTALL_AFTER_PACK=1 to get the old behaviour back for a local
 * build you want on the Dock immediately.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.VERSA_INSTALL_AFTER_PACK !== '1') {
    console.log('afterPack: not installing (set VERSA_INSTALL_AFTER_PACK=1 to install into /Applications)');
    return;
  }
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
