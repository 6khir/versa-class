import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/browser-controller.cjs"
with open(filepath, "r") as f:
    content = f.read()

old_launch = """function launchSystemLoginBrowser(executablePath, args, { spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(executablePath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
    } catch (error) {"""

new_launch = """function launchSystemLoginBrowser(executablePath, args, { spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      if (process.platform === 'darwin') {
        const appName = executablePath.toLowerCase().includes('edge') ? 'Microsoft Edge' : 'Google Chrome';
        child = spawnFn('open', ['-a', appName, '--args', ...args], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
      } else {
        child = spawnFn(executablePath, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
      }
    } catch (error) {"""

content = content.replace(old_launch, new_launch)

with open(filepath, "w") as f:
    f.write(content)

print("Patched Mac launch logic.")
