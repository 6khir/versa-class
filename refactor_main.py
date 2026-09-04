import re
import os

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/main.cjs"
with open(filepath, "r") as f:
    content = f.read()

content = content.replace("require('node:fs').readFileSync(rawPath)", "await require('node:fs/promises').readFile(rawPath)")

with open(filepath, "w") as f:
    f.write(content)
