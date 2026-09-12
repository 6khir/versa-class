// tests/editable-pdf-composer.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { composeEditablePage } = require('../src/editable-pdf-composer.cjs');

test('PDF Composer - Rejects missing parameters', async () => {
    await assert.rejects(
        () => composeEditablePage(null, {}, [100, 100]),
        /EDITABLE_COMPOSE_INVALID/
    );
});

test('PDF Composer - Successfully composites text onto image', async () => {
    const dummyPng = await sharp({
        create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
    }).png().toBuffer();

    const mockLayout = {
        elements: [
            { text: 'Hello', x: 10, y: 10, width: 50, height: 20, font: 'Nunito', fontSize: 14 }
        ]
    };

    const result = await composeEditablePage(dummyPng, mockLayout, [100, 100]);
    
    assert.ok(Buffer.isBuffer(result));
    const meta = await sharp(result).metadata();
    assert.strictEqual(meta.width, 100);
    assert.strictEqual(meta.height, 100);
    assert.strictEqual(meta.format, 'png');
});
