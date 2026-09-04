import { Jimp, rgbaToInt } from 'jimp';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = join(root, 'assets', 'brand');
const assetsDir = join(root, 'assets');

mkdirSync(brandDir, { recursive: true });

function rgba(r, g, b, a = 255) {
  return rgbaToInt(r, g, b, a);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function setGradientPixel(img, x, y, width, height) {
  const t = (x / width + y / height) / 2;
  const r = Math.round(lerp(6, 16, t));
  const g = Math.round(lerp(14, 185, t));
  const b = Math.round(lerp(16, 129, t));
  img.setPixelColor(rgba(r, g, b), x, y);
}

async function createBackground(width, height, outputPath) {
  const img = new Jimp({ width, height, color: rgba(6, 14, 16) });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) setGradientPixel(img, x, y, width, height);
  }
  await img.write(outputPath);
}

await createBackground(1920, 1080, join(brandDir, 'versa-icon-background.png'));
console.log('Versa AI brand background updated.');
