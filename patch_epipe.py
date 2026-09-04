import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/main.cjs"
with open(filepath, "r") as f:
    content = f.read()

patch = """
// Prevent EPIPE errors from crashing the main process when stdout/stderr is closed
['stdout', 'stderr'].forEach((streamName) => {
  if (process[streamName]) {
    process[streamName].on('error', (err) => {
      if (err.code === 'EPIPE' || err.code === 'EOF' || err.code === 'ERR_STREAM_DESTROYED') {
        return; // Ignore closed pipes safely
      }
      console.error(err);
    });
  }
});
"""

# Find an injection point after the requires
injection_point = "const { AutomationManager, PIPELINE_STEPS } = require('./automation-manager.cjs');"

if patch.strip() not in content:
    content = content.replace(injection_point, injection_point + "\n" + patch)
    with open(filepath, "w") as f:
        f.write(content)
    print("Patched EPIPE error handling in main.cjs")
else:
    print("Already patched")
