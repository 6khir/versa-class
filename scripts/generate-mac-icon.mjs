import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'assets', 'brand', 'versa-class-logo.png');
const pngPath = join(root, 'assets', 'icon.png');
const icnsPath = join(root, 'assets', 'icon.icns');
const SIZE = 1024;
const SKY = 0x5ec8f0ff;
const INSET = Math.round(SIZE * 0.045);
const RADIUS_N = 5;

function squircleCoverage(x, y, size, n = RADIUS_N) {
  const a = (size / 2) - 0.5;
  const nx = (x - a) / a;
  const ny = (y - a) / a;
  const value = Math.abs(nx) ** n + Math.abs(ny) ** n;
  if (value <= 0.985) return 1;
  if (value >= 1.02) return 0;
  return Math.max(0, Math.min(1, (1.02 - value) / 0.035));
}

function floodKnockoutWhite(img) {
  const w = img.width;
  const h = img.height;
  const data = img.bitmap.data;
  const seen = new Uint8Array(w * h);
  const queue = [];

  const isBackground = (idx) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    return min > 205 && max - min < 28;
  };

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (seen[i]) return;
    if (!isBackground(i * 4)) return;
    seen[i] = 1;
    queue.push(i);
  };

  for (let x = 0; x < w; x += 1) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  for (let qi = 0; qi < queue.length; qi += 1) {
    const i = queue[qi];
    data[i * 4 + 3] = 0;
    const x = i % w;
    const y = (i / w) | 0;
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] === 0) continue;
        const min = Math.min(data[idx], data[idx + 1], data[idx + 2]);
        if (min < 180) continue;
        let nearClear = false;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (data[(ny * w + nx) * 4 + 3] === 0) {
            nearClear = true;
            break;
          }
        }
        if (nearClear) {
          const t = Math.min(1, (min - 180) / 75);
          data[idx + 3] = Math.round(data[idx + 3] * (1 - t));
        }
      }
    }
  }
}

const logo = await Jimp.read(sourcePath);
floodKnockoutWhite(logo);
logo.resize({ w: SIZE - INSET * 2, h: SIZE - INSET * 2 });

const canvas = new Jimp({ width: SIZE, height: SIZE, color: SKY });
canvas.composite(logo, INSET, INSET);

const fullPng = join(tmpdir(), 'versa-class-icon-full.png');
await canvas.write(fullPng);

const squircle = canvas.clone();
squircle.scan((x, y, idx) => {
  const coverage = squircleCoverage(x, y, SIZE);
  squircle.bitmap.data[idx + 3] = Math.round(squircle.bitmap.data[idx + 3] * coverage);
});
await squircle.write(pngPath);

const iconset = join(tmpdir(), 'versa-class-mac.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

const specs = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
];

for (const [name, size] of specs) {
  execFileSync('sips', ['-z', String(size), String(size), fullPng, '--out', join(iconset, name)], {
    stdio: 'pipe'
  });
}

const tmpIcns = join(tmpdir(), 'versa-class-mac.icns');
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', tmpIcns]);
copyFileSync(tmpIcns, icnsPath);
rmSync(iconset, { recursive: true, force: true });
console.log(`Wrote ${pngPath} and ${icnsPath}`);
