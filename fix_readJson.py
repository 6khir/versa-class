import re
import os

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/browser-controller.cjs"
with open(filepath, "r") as f:
    content = f.read()

content = content.replace("JSON.parse(await require('node:fs/promises').readFile(filePath, 'utf8'))", "JSON.parse(readFileSync(filePath, 'utf8'))")

with open(filepath, "w") as f:
    f.write(content)
