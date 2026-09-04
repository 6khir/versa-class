import re
import os

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/file-manager.cjs"
with open(filepath, "r") as f:
    content = f.read()

# Replace Jimp import with sharp
content = content.replace("const { Jimp, ResizeStrategy } = require('jimp');", "const sharp = require('sharp');")

# Atomic write
atomic_write_sync = """function atomicWrite(filePath, buffer) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.part`;
  writeFileSync(temporaryPath, buffer);
  if (existsSync(filePath)) rmSync(filePath, { force: true });
  renameSync(temporaryPath, filePath);
}"""

atomic_write_async = """async function atomicWrite(filePath, buffer) {
  const fs = require('fs/promises');
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.part`;
  await fs.writeFile(temporaryPath, buffer);
  try { await fs.rm(filePath, { force: true }); } catch {}
  await fs.rename(temporaryPath, filePath);
}"""

content = content.replace(atomic_write_sync, atomic_write_async)

# Refactor normalizePngToPage
normalize_png_old = """async function normalizePngToPage(png, format = 'A4', orientation = 'portrait', zoom = 1.0, offsetX = 0.0, offsetY = 0.0) {
  const setup = resolvePageSetup(format, orientation);
  let image;
  try {
    image = await Jimp.read(png);
  } catch (error) {
    throw Object.assign(new Error(`The image could not be normalized: ${error.message}`), { code: 'IMAGE_NORMALIZE_FAILED' });
  }

  const parsedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1.0;
  const parsedOffsetX = Number.isFinite(offsetX) ? offsetX : 0.0;
  const parsedOffsetY = Number.isFinite(offsetY) ? offsetY : 0.0;

  if (parsedZoom !== 1.0 || parsedOffsetX !== 0.0 || parsedOffsetY !== 0.0) {
    const scale = Math.max(setup.width / image.width, setup.height / image.height) * parsedZoom;
    image.resize({
      w: Math.round(image.width * scale),
      h: Math.round(image.height * scale),
      mode: ResizeStrategy.BICUBIC
    });

    const maxShiftX = image.width - setup.width;
    const maxShiftY = image.height - setup.height;
    const centerX = (image.width - setup.width) / 2;
    const centerY = (image.height - setup.height) / 2;

    const cropX = Math.max(0, Math.min(image.width - setup.width, Math.round(centerX - (parsedOffsetX * maxShiftX / 2))));
    const cropY = Math.max(0, Math.min(image.height - setup.height, Math.round(centerY - (parsedOffsetY * maxShiftY / 2))));

    image.crop({ x: cropX, y: cropY, w: setup.width, h: setup.height });
  } else {
    image.cover({ w: setup.width, h: setup.height, mode: ResizeStrategy.BICUBIC });
  }

  const normalized = addPngResolution(await image.getBuffer('image/png'), 300);
  if (normalized.length < 10_000) {
    throw Object.assign(new Error('The image could not be converted into a valid print-ready PNG.'), { code: 'PNG_CONVERSION_FAILED' });
  }
  return { png: normalized, width: setup.width, height: setup.height, dpi: 300 };
}"""

normalize_png_new = """async function normalizePngToPage(png, format = 'A4', orientation = 'portrait', zoom = 1.0, offsetX = 0.0, offsetY = 0.0) {
  const setup = resolvePageSetup(format, orientation);
  let processor = sharp(png);
  let metadata;
  try {
    metadata = await processor.metadata();
  } catch (error) {
    throw Object.assign(new Error(`The image could not be normalized: ${error.message}`), { code: 'IMAGE_NORMALIZE_FAILED' });
  }

  const parsedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1.0;
  const parsedOffsetX = Number.isFinite(offsetX) ? offsetX : 0.0;
  const parsedOffsetY = Number.isFinite(offsetY) ? offsetY : 0.0;

  if (parsedZoom !== 1.0 || parsedOffsetX !== 0.0 || parsedOffsetY !== 0.0) {
    const scale = Math.max(setup.width / metadata.width, setup.height / metadata.height) * parsedZoom;
    const scaledWidth = Math.round(metadata.width * scale);
    const scaledHeight = Math.round(metadata.height * scale);

    processor = processor.resize(scaledWidth, scaledHeight, { kernel: 'bicubic' });

    const maxShiftX = scaledWidth - setup.width;
    const maxShiftY = scaledHeight - setup.height;
    const centerX = (scaledWidth - setup.width) / 2;
    const centerY = (scaledHeight - setup.height) / 2;

    const cropX = Math.max(0, Math.min(scaledWidth - setup.width, Math.round(centerX - (parsedOffsetX * maxShiftX / 2))));
    const cropY = Math.max(0, Math.min(scaledHeight - setup.height, Math.round(centerY - (parsedOffsetY * maxShiftY / 2))));

    processor = processor.extract({ left: cropX, top: cropY, width: setup.width, height: setup.height });
  } else {
    processor = processor.resize(setup.width, setup.height, { fit: 'cover', kernel: 'bicubic' });
  }

  const rawBuffer = await processor.png().toBuffer();
  const normalized = addPngResolution(rawBuffer, 300);
  if (normalized.length < 10_000) {
    throw Object.assign(new Error('The image could not be converted into a valid print-ready PNG.'), { code: 'PNG_CONVERSION_FAILED' });
  }
  return { png: normalized, width: setup.width, height: setup.height, dpi: 300 };
}"""

content = content.replace(normalize_png_old, normalize_png_new)

# createSpreadPng
create_spread_old = """async function createSpreadPng({ leftPng, rightPng, format = 'A4', orientation = 'portrait' }) {
  const setup = resolvePageSetup(format, orientation);
  const spreadWidth = setup.width * 2;
  const spreadHeight = setup.height;

  const leftImage = leftPng
    ? await Jimp.read(leftPng)
    : new Jimp({ width: setup.width, height: setup.height, color: 0xFFFFFFFF });

  const rightImage = rightPng
    ? await Jimp.read(rightPng)
    : new Jimp({ width: setup.width, height: setup.height, color: 0xFFFFFFFF });

  const canvas = new Jimp({ width: spreadWidth, height: spreadHeight, color: 0xFFFFFFFF });
  canvas.composite(leftImage, 0, 0);
  canvas.composite(rightImage, setup.width, 0);

  const png = await canvas.getBuffer('image/png');
  return addPngResolution(png, 300);
}"""

create_spread_new = """async function createSpreadPng({ leftPng, rightPng, format = 'A4', orientation = 'portrait' }) {
  const setup = resolvePageSetup(format, orientation);
  const spreadWidth = setup.width * 2;
  const spreadHeight = setup.height;

  const whiteBackground = await sharp({
    create: { width: setup.width, height: setup.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).png().toBuffer();

  const leftImage = leftPng ? leftPng : whiteBackground;
  const rightImage = rightPng ? rightPng : whiteBackground;

  const rawBuffer = await sharp({
    create: { width: spreadWidth, height: spreadHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  })
  .composite([
    { input: leftImage, top: 0, left: 0 },
    { input: rightImage, top: 0, left: setup.width }
  ])
  .png()
  .toBuffer();

  return addPngResolution(rawBuffer, 300);
}"""
content = content.replace(create_spread_old, create_spread_new)

# writePageContactSheet
write_contact_old = """async function writePageContactSheet(pagePaths, destPath) {
  const cellW = 640;
  const cellH = 860;
  const gap = 12;
  const canvas = new Jimp({
    width: cellW * 2 + gap * 3,
    height: cellH * 2 + gap * 3,
    color: 0xFFF7F1E8
  });
  for (let index = 0; index < 4; index += 1) {
    const sourcePath = pagePaths[index];
    if (!sourcePath || !existsSync(sourcePath)) continue;
    const image = await Jimp.read(sourcePath);
    image.cover({ w: cellW, h: cellH, mode: ResizeStrategy.BICUBIC });
    const x = gap + (index % 2) * (cellW + gap);
    const y = gap + Math.floor(index / 2) * (cellH + gap);
    canvas.composite(image, x, y);
  }
  atomicWrite(destPath, await canvas.getBuffer('image/png'));
  return destPath;
}"""

write_contact_new = """async function writePageContactSheet(pagePaths, destPath) {
  const cellW = 640;
  const cellH = 860;
  const gap = 12;
  
  const canvasWidth = cellW * 2 + gap * 3;
  const canvasHeight = cellH * 2 + gap * 3;
  
  const composites = [];
  for (let index = 0; index < 4; index += 1) {
    const sourcePath = pagePaths[index];
    if (!sourcePath || !existsSync(sourcePath)) continue;
    
    const resized = await sharp(sourcePath)
      .resize(cellW, cellH, { fit: 'cover', kernel: 'bicubic' })
      .toBuffer();
      
    const x = gap + (index % 2) * (cellW + gap);
    const y = gap + Math.floor(index / 2) * (cellH + gap);
    
    composites.push({ input: resized, top: y, left: x });
  }
  
  const rawBuffer = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 4, background: { r: 247, g: 241, b: 232, alpha: 1 } }
  })
  .composite(composites)
  .png()
  .toBuffer();
  
  await atomicWrite(destPath, rawBuffer);
  return destPath;
}"""
content = content.replace(write_contact_old, write_contact_new)

# stageThumbnailPageTargets
stage_old = """async function stageThumbnailPageTargets({ pagePaths, destDir, thumbnailIndex = 0 }) {
  const selected = selectThumbnailPagePaths(pagePaths, thumbnailIndex, 4);
  if (!selected.length) {
    throw Object.assign(new Error('No page images are available to attach for this thumbnail.'), {
      code: 'THUMBNAIL_PAGES_MISSING'
    });
  }
  mkdirSync(destDir, { recursive: true });
  const pageFiles = [];
  for (let index = 0; index < selected.length; index += 1) {
    const image = await Jimp.read(selected[index]);
    const destPath = join(destDir, `Thumbnail-${Number(thumbnailIndex) + 1}-page-0${index + 1}.png`);
    atomicWrite(destPath, await image.getBuffer('image/png'));
    pageFiles.push(destPath);
  }
  const contactSheetPath = join(destDir, `Thumbnail-${Number(thumbnailIndex) + 1}-contact-sheet.png`);
  await writePageContactSheet(pageFiles, contactSheetPath);
  return {
    pageFiles,
    contactSheetPath,
    attachmentPaths: [contactSheetPath, ...pageFiles]
  };
}"""

stage_new = """async function stageThumbnailPageTargets({ pagePaths, destDir, thumbnailIndex = 0 }) {
  const selected = selectThumbnailPagePaths(pagePaths, thumbnailIndex, 4);
  if (!selected.length) {
    throw Object.assign(new Error('No page images are available to attach for this thumbnail.'), {
      code: 'THUMBNAIL_PAGES_MISSING'
    });
  }
  const fs = require('fs/promises');
  await fs.mkdir(destDir, { recursive: true });
  const pageFiles = [];
  for (let index = 0; index < selected.length; index += 1) {
    const rawBuffer = await sharp(selected[index]).png().toBuffer();
    const destPath = join(destDir, `Thumbnail-${Number(thumbnailIndex) + 1}-page-0${index + 1}.png`);
    await atomicWrite(destPath, rawBuffer);
    pageFiles.push(destPath);
  }
  const contactSheetPath = join(destDir, `Thumbnail-${Number(thumbnailIndex) + 1}-contact-sheet.png`);
  await writePageContactSheet(pageFiles, contactSheetPath);
  return {
    pageFiles,
    contactSheetPath,
    attachmentPaths: [contactSheetPath, ...pageFiles]
  };
}"""
content = content.replace(stage_old, stage_new)

# saveGeneratedThumbnail
thumb_old = """  async saveGeneratedThumbnail({ buffer, fileName, outputDir }) {
    const png = this.validateSource(buffer);
    let payload = png;
    let safeFileName = fileName;
    if (payload.length > TPT_THUMBNAIL_MAX_BYTES) {
      const source = this.nativeImage.createFromBuffer(png);
      const size = source.getSize();
      const scale = Math.min(1, 1600 / size.width, 1200 / size.height);
      const resized = source.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'best'
      });
      for (const quality of [90, 82, 74, 66]) {
        payload = resized.toJPEG(quality);
        if (payload.length <= TPT_THUMBNAIL_MAX_BYTES) break;
      }
      safeFileName = String(fileName).replace(/\.[^.]+$/, '') + '.jpg';
    }
    if (payload.length > TPT_THUMBNAIL_MAX_BYTES) {
      throw Object.assign(new Error('The generated thumbnail could not be reduced below TPT\\'s 4 MB limit.'), { code: 'TPT_THUMBNAIL_TOO_LARGE' });
    }
    const outputPath = join(outputDir, 'tpt-thumbnails', safeFileName);
    atomicWrite(outputPath, payload);
    return outputPath;
  }"""

thumb_new = """  async saveGeneratedThumbnail({ buffer, fileName, outputDir }) {
    const png = this.validateSource(buffer);
    let payload = png;
    let safeFileName = fileName;
    if (payload.length > TPT_THUMBNAIL_MAX_BYTES) {
      let image = sharp(png);
      const metadata = await image.metadata();
      const scale = Math.min(1, 1600 / metadata.width, 1200 / metadata.height);
      const newWidth = Math.max(1, Math.round(metadata.width * scale));
      const newHeight = Math.max(1, Math.round(metadata.height * scale));
      
      const resized = await image.resize(newWidth, newHeight).toBuffer();
      
      for (const quality of [90, 82, 74, 66]) {
        payload = await sharp(resized).jpeg({ quality }).toBuffer();
        if (payload.length <= TPT_THUMBNAIL_MAX_BYTES) break;
      }
      safeFileName = String(fileName).replace(/\.[^.]+$/, '') + '.jpg';
    }
    if (payload.length > TPT_THUMBNAIL_MAX_BYTES) {
      throw Object.assign(new Error('The generated thumbnail could not be reduced below TPT\\'s 4 MB limit.'), { code: 'TPT_THUMBNAIL_TOO_LARGE' });
    }
    const outputPath = join(outputDir, 'tpt-thumbnails', safeFileName);
    await atomicWrite(outputPath, payload);
    return outputPath;
  }"""
content = content.replace(thumb_old, thumb_new)

# other occurrences of atomicWrite
content = content.replace("atomicWrite(outputPath, result.png);", "await atomicWrite(outputPath, result.png);")
content = content.replace("atomicWrite(rawPath, buffer);", "await atomicWrite(rawPath, buffer);")
content = content.replace("atomicWrite(outputPath, Buffer.from(await pdf.save()));", "await atomicWrite(outputPath, Buffer.from(await pdf.save()));")

with open(filepath, "w") as f:
    f.write(content)
