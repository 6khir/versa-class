const fs = require('fs');
const os = require('os');
const path = require('path');
function installedBrowserCandidates() {
  const result = [];
  if (process.platform === 'darwin') {
    result.push(
      {
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        label: 'Google Chrome',
        userDataDir: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
      }
    );
  }
  return result;
}

const candidates = installedBrowserCandidates();
console.log(candidates.map(c => ({
  ...c,
  dirExists: fs.existsSync(c.userDataDir),
  localStateExists: fs.existsSync(path.join(c.userDataDir, 'Local State'))
})));
