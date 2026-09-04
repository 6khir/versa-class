import re
import os

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/browser-controller.cjs"
with open(filepath, "r") as f:
    content = f.read()

content = content.replace("const buffer = await require('node:fs/promises').readFile(sourcePath);", "const buffer = readFileSync(sourcePath);")
content = content.replace("const buffer = await require('node:fs/promises').readFile(filePath);", "const buffer = readFileSync(filePath);")

with open(filepath, "w") as f:
    f.write(content)
