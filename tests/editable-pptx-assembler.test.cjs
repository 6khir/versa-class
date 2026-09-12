// tests/editable-pptx-assembler.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { assembleEditableEnginePptx } = require('../src/editable-pptx-assembler.cjs');

test('PPTX Assembler - Rejects missing meta', async () => {
    await assert.rejects(
        () => assembleEditableEnginePptx(null, []),
        /EDITABLE_PPTX_MISSING_META/
    );
});

test('PPTX Assembler - Rejects missing pages', async () => {
    await assert.rejects(
        () => assembleEditableEnginePptx({ format: 'A4', orientation: 'portrait' }, []),
        /EDITABLE_PPTX_MISSING_PAGES/
    );
});

test('PPTX Assembler - Rejects invalid page layout', async () => {
    await assert.rejects(
        () => assembleEditableEnginePptx(
            { format: 'A4', orientation: 'portrait' },
            [{ pageNumber: 1, backgroundPng: Buffer.from('dummy'), layout: null }]
        ),
        /EDITABLE_PPTX_INVALID_PAGE/
    );
});
