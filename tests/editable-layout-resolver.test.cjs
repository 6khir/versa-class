// tests/editable-layout-resolver.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { resolveLayout } = require('../src/editable-layout-resolver.cjs');

test('Layout Resolver - Accepts valid layout and allowed fonts', () => {
    const validLayout = {
        elements: [
            { id: 'title1', font: 'Nunito', x: 10, y: 20, width: 100, height: 50 }
        ]
    };
    const result = resolveLayout(validLayout);
    assert.strictEqual(result.elements[0].font, 'Nunito');
});

test('Layout Resolver - Rejects unknown fonts', () => {
    const invalidLayout = {
        elements: [
            { id: 'title1', font: 'ComicSans', x: 10, y: 20, width: 100, height: 50 }
        ]
    };
    assert.throws(() => resolveLayout(invalidLayout), /EDITABLE_FONT_REJECTED/);
});

test('Layout Resolver - Rejects negative or zero dimensions', () => {
    const negativeLayout = {
        elements: [
            { id: 'title1', font: 'Geist', x: -5, y: 20, width: 100, height: 50 }
        ]
    };
    assert.throws(() => resolveLayout(negativeLayout), /EDITABLE_GEOMETRY_INVALID/);

    const zeroWidthLayout = {
        elements: [
            { id: 'title2', font: 'Geist', x: 10, y: 20, width: 0, height: 50 }
        ]
    };
    assert.throws(() => resolveLayout(zeroWidthLayout), /EDITABLE_GEOMETRY_INVALID/);
});
