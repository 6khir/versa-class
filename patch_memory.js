const fs = require('fs');

function patchMemory(filePath) {
  if (!fs.existsSync(filePath)) return;
  let code = fs.readFileSync(filePath, 'utf8');

  // Add browser.close() to the end of the interior step
  code = code.replace(
    /queue\.on\('changed', checkDone\);\n\s*\/\/ Check immediately in case already done\n\s*checkDone\(\)\.catch\(reject\);\n\s*}\);\n\s*},/,
    `queue.on('changed', checkDone);
          // Check immediately in case already done
          checkDone().catch(reject);
        });
        await browser.close().catch(() => {});
      },`
  );

  fs.writeFileSync(filePath, code);
  console.log("Patched memory in", filePath);
}

patchMemory('/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/main.cjs');
patchMemory('/Users/abdelmouiz/Desktop/TPT_SourceCode/src/main.cjs');
