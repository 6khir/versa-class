import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/browser-controller.cjs"
with open(filepath, "r") as f:
    content = f.read()

# Replace candidates source
old_str = """  async getSystemProfiles() {
    const profiles = [];
    const candidates = browserCandidates();"""

new_str = """  async getSystemProfiles() {
    const profiles = [];
    const candidates = installedBrowserCandidates();"""

content = content.replace(old_str, new_str)

with open(filepath, "w") as f:
    f.write(content)

print("Patched getSystemProfiles to use installedBrowserCandidates.")
