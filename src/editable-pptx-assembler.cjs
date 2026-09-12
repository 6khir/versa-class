// src/editable-pptx-assembler.cjs
const { assembleEditablePptx } = require('./pptx-assembler.cjs');

/**
 * Assembles the editable PPTX buffer.
 * @param {Object} contract The page contract meta.
 * @param {Array} pages Array of { pageNumber, backgroundPng, layout }
 */
async function assembleEditableEnginePptx(contract, pages) {
    if (!contract || !contract.format || !contract.orientation) {
        throw new Error('EDITABLE_PPTX_MISSING_META: Missing format or orientation');
    }

    if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error('EDITABLE_PPTX_MISSING_PAGES: Missing pages array');
    }

    const prototypePages = pages.map(p => {
        if (!p.layout || !Array.isArray(p.layout.elements) || !p.backgroundPng) {
            throw new Error(`EDITABLE_PPTX_INVALID_PAGE: Missing layout or backgroundPng on page ${p.pageNumber}`);
        }

        const textBoxes = p.layout.elements.map(el => {
            return {
                text: el.text || '',
                x: el.x / 72,
                y: el.y / 72,
                w: el.width / 72,
                h: el.height / 72,
                fontFace: el.font,
                fontSize: el.fontSize || 14,
                color: (el.color || '#000000').replace('#', ''),
                align: el.alignment || 'left',
                valign: el.verticalAlignment || 'top',
                bold: el.bold || false,
                italic: el.italic || false,
                objectName: el.id,
                isTextBox: true,
                margin: 0,
                paraSpaceBefore: 0,
                paraSpaceAfter: 0,
                fit: 'none',
                // Boxes are sized for wrapped text, so PowerPoint must reflow after edits.
                wrap: true
            };
        });

        return {
            pageNumber: p.pageNumber,
            backgroundPng: p.backgroundPng,
            backgroundPath: 'dummy.png', // Fallback for error messages in pptx-assembler
            textBoxes
        };
    });

    const projectMeta = {
        name: 'Editable Engine Product',
        format: contract.format,
        orientation: contract.orientation
    };

    return assembleEditablePptx(projectMeta, { prototypePages });
}

module.exports = {
    assembleEditableEnginePptx
};
