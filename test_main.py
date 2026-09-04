import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/main.cjs"
with open(filepath, "r") as f:
    content = f.read()

# find ipcMain.handle('profiles:get-rotation'
old_str = """  ipcMain.handle('profiles:get-rotation', async () => {
    const systemProfiles = await browser.getSystemProfiles().catch(() => []);"""

new_str = """  ipcMain.handle('profiles:get-rotation', async () => {
    let systemProfiles = [];
    try {
      systemProfiles = await browser.getSystemProfiles();
      require('fs').writeFileSync('/tmp/tpt_profiles_debug.log', JSON.stringify(systemProfiles, null, 2));
    } catch (e) {
      require('fs').writeFileSync('/tmp/tpt_profiles_debug.log', "ERROR: " + String(e) + "\\n" + String(e.stack));
    }"""

content = content.replace(old_str, new_str)
with open(filepath, "w") as f:
    f.write(content)

print("Injected debug logger.")
