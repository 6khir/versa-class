import re
import os

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/file-manager.cjs"
with open(filepath, "r") as f:
    content = f.read()

content = content.replace("readFileSync(leftJob.outputPath)", "await require('fs/promises').readFile(leftJob.outputPath)")
content = content.replace("readFileSync(rightJob.outputPath)", "await require('fs/promises').readFile(rightJob.outputPath)")
content = content.replace("readFileSync(job.outputPath)", "await require('fs/promises').readFile(job.outputPath)")
content = content.replace("readFileSync(sourcePath)", "await require('fs/promises').readFile(sourcePath)")

with open(filepath, "w") as f:
    f.write(content)
