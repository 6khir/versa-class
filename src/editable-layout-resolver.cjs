// src/editable-layout-resolver.cjs
const ALLOWED_FONTS = ['Nunito', 'Geist'];

function resolveLayout(layoutJson) {
    if (!layoutJson || !Array.isArray(layoutJson.elements)) {
        throw new Error('EDITABLE_LAYOUT_INVALID: Missing elements array');
    }

    const resolvedElements = layoutJson.elements.map(el => {
        if (!ALLOWED_FONTS.includes(el.font)) {
            throw new Error(`EDITABLE_FONT_REJECTED: Unknown font '${el.font}'`);
        }

        if (!Number.isFinite(el.x) || el.x < 0 ||
            !Number.isFinite(el.y) || el.y < 0 ||
            !Number.isFinite(el.width) || el.width <= 0 ||
            !Number.isFinite(el.height) || el.height <= 0) {
            throw new Error('EDITABLE_GEOMETRY_INVALID: Dimensions must be positive numbers');
        }

        return { ...el };
    });

    return {
        ...layoutJson,
        elements: resolvedElements
    };
}

module.exports = {
    resolveLayout
};
