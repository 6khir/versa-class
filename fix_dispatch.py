import re
import os

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/browser-controller.cjs"
with open(filepath, "r") as f:
    content = f.read()

dispatch_old = """      const filesData = filePaths.map((filePath) => {
        const ext = extname(filePath).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.gif') mimeType = 'image/gif';
        const buffer = readFileSync(filePath);
        return {
          name: basename(filePath),
          mimeType,
          base64: buffer.toString('base64')
        };
      });"""

dispatch_new = """      const filesData = await Promise.all(filePaths.map(async (filePath) => {
        const ext = extname(filePath).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.gif') mimeType = 'image/gif';
        const buffer = await require('node:fs/promises').readFile(filePath);
        return {
          name: basename(filePath),
          mimeType,
          base64: buffer.toString('base64')
        };
      }));"""
content = content.replace(dispatch_old, dispatch_new)

with open(filepath, "w") as f:
    f.write(content)
