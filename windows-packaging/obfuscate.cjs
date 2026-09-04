'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function collectFiles(root, extensions) {
  const results = [];
  if (!fs.existsSync(root)) return results;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
      continue;
    }
    if (extensions.includes(path.extname(entry.name))) results.push(fullPath);
  }
  return results;
}

function xorBuffer(buffer, key) {
  const out = Buffer.from(buffer);
  for (let i = 0; i < out.length; i += 1) {
    out[i] ^= key[i % key.length];
  }
  return out;
}

function packCommonJs(source) {
  const key = crypto.randomBytes(16);
  const payload = xorBuffer(Buffer.from(source, 'utf8'), key).toString('base64');
  const keyLiteral = Array.from(key).join(',');
  return `'use strict';
(function (require, module, exports, __dirname, __filename) {
  const _k = [${keyLiteral}];
  const _p = Buffer.from(${JSON.stringify(payload)}, 'base64');
  for (let _i = 0; _i < _p.length; _i += 1) _p[_i] ^= _k[_i % _k.length];
  eval(_p.toString('utf8'));
})(require, module, exports, __dirname, __filename);
`;
}

function packBrowser(source) {
  const key = crypto.randomBytes(16);
  const payload = xorBuffer(Buffer.from(source, 'utf8'), key).toString('base64');
  const keyLiteral = Array.from(key).join(',');
  return `(function () {
  var _k = [${keyLiteral}];
  var _b64 = ${JSON.stringify(payload)};
  var _raw = (typeof Buffer !== 'undefined')
    ? Buffer.from(_b64, 'base64')
    : Uint8Array.from(atob(_b64), function (c) { return c.charCodeAt(0); });
  var _out = new Uint8Array(_raw.length);
  for (var _i = 0; _i < _raw.length; _i += 1) _out[_i] = _raw[_i] ^ _k[_i % _k.length];
  var _code = (typeof Buffer !== 'undefined')
    ? Buffer.from(_out).toString('utf8')
    : new TextDecoder('utf-8').decode(_out);
  eval(_code);
})();
`;
}

function obfuscateFile(filePath, kind) {
  const source = fs.readFileSync(filePath, 'utf8');
  const packed = kind === 'browser' ? packBrowser(source) : packCommonJs(source);
  fs.writeFileSync(filePath, packed);
}

function obfuscateTree(stagingRoot) {
  const srcFiles = collectFiles(path.join(stagingRoot, 'src'), ['.cjs', '.js']);
  const rendererFiles = collectFiles(path.join(stagingRoot, 'renderer'), ['.js']);

  for (const filePath of srcFiles) {
    process.stdout.write(`Obfuscating ${path.relative(stagingRoot, filePath)}\n`);
    obfuscateFile(filePath, 'node');
  }
  for (const filePath of rendererFiles) {
    process.stdout.write(`Obfuscating ${path.relative(stagingRoot, filePath)}\n`);
    obfuscateFile(filePath, 'browser');
  }

  return { srcFiles: srcFiles.length, rendererFiles: rendererFiles.length };
}

function loadPackedCommonJs(filePath) {
  const resolved = require.resolve(filePath);
  delete require.cache[resolved];
  return require(resolved);
}

if (require.main === module) {
  const staging = process.argv[2] || path.join(__dirname, 'staging');
  const counts = obfuscateTree(staging);
  process.stdout.write(`Obfuscated ${counts.srcFiles} main files and ${counts.rendererFiles} renderer files\n`);
}

module.exports = {
  loadPackedCommonJs,
  obfuscateFile,
  obfuscateTree,
  packCommonJs,
  packBrowser,
  xorBuffer
};
