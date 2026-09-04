import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/main.cjs"
with open(filepath, "r") as f:
    content = f.read()

content = content.replace("await fileManager.exportZip(project);\n        store.appendEvent({ projectId, level: 'success', message: '[Automation] PDF and ZIP exported.' });", 
"await fileManager.exportZip(project);\n        await fileManager.exportPptx(project);\n        store.appendEvent({ projectId, level: 'success', message: '[Automation] PDF, ZIP, and PPTX exported.' });")

with open(filepath, "w") as f:
    f.write(content)
