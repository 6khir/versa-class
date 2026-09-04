import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/main.cjs"
with open(filepath, "r") as f:
    content = f.read()

patch = """
const originalWarn = console.warn;
console.warn = function(...args) {
  try { originalWarn.apply(console, args); } catch (err) { if (err.code !== 'EPIPE' && err.code !== 'EOF') throw err; }
};
const originalError = console.error;
console.error = function(...args) {
  try { originalError.apply(console, args); } catch (err) { if (err.code !== 'EPIPE' && err.code !== 'EOF') throw err; }
};
"""

content = content.replace("const originalLog = console.log;", patch + "\nconst originalLog = console.log;")
with open(filepath, "w") as f:
    f.write(content)
print("Patched warn and error")
