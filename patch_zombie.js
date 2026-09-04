const fs = require('fs');

function patchZombie(filePath) {
  if (!fs.existsSync(filePath)) return;
  let code = fs.readFileSync(filePath, 'utf8');

  // In launchInternal, if the profile lock is held and attempt === 1, kill the zombie!
  code = code.replace(
    /const lock = clearStaleProfileLocks\(this\.profileDir\);\n\s*if \(lock\.ownerPid\) {/,
    `const lock = clearStaleProfileLocks(this.profileDir);
            if (lock.ownerPid) {
              try { process.kill(lock.ownerPid, 'SIGKILL'); } catch {}
              await new Promise(r => setTimeout(r, 1000));
            }
            const lock2 = clearStaleProfileLocks(this.profileDir);
            if (lock2.ownerPid) {`
  );

  fs.writeFileSync(filePath, code);
  console.log("Patched zombie killer in", filePath);
}

patchZombie('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/browser-controller.cjs');
patchZombie('/Users/abdelmouiz/Desktop/TPT_SourceCode/src/browser-controller.cjs');
