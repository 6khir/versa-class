'use strict';

const { signAsync } = require('@electron/osx-sign');
const { join } = require('node:path');

const appPath = process.argv[2];
if (!appPath) {
  console.error('Usage: node scripts/sign-mac-app.cjs /path/to/VERSA CLASS.app');
  process.exit(1);
}

const entitlements = join(__dirname, 'entitlements.mac.plist');

signAsync({
  app: appPath,
  identity: '-',
  platform: 'darwin',
  hardenedRuntime: false,
  optionsForFile: () => ({
    entitlements,
    hardenedRuntime: false
  })
}).then(() => {
  console.log('signed', appPath);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
