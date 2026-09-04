import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/main.cjs"
with open(filepath, "r") as f:
    content = f.read()

patch = """
// Forcefully intercept console.log to prevent EPIPE crashes
const originalLog = console.log;
console.log = function(...args) {
  try {
    originalLog.apply(console, args);
  } catch (err) {
    if (err.code !== 'EPIPE' && err.code !== 'EOF' && err.code !== 'ERR_STREAM_DESTROYED') {
      throw err;
    }
  }
};
"""

if patch.strip() not in content:
    content = patch + "\n" + content
    with open(filepath, "w") as f:
        f.write(content)
    print("Patched console.log")
else:
    print("Already patched")
