import re
import os

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/browser-controller.cjs"
with open(filepath, "r") as f:
    content = f.read()

content = content.replace("JSON.parse(readFileSync(filePath, 'utf8'))", "JSON.parse(await require('node:fs/promises').readFile(filePath, 'utf8'))")
content = content.replace("const buffer = readFileSync(sourcePath);", "const buffer = await require('node:fs/promises').readFile(sourcePath);")
content = content.replace("const buffer = readFileSync(filePath);", "const buffer = await require('node:fs/promises').readFile(filePath);")

with open(filepath, "w") as f:
    f.write(content)
