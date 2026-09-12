'use strict';

const ENGINE_TYPES = Object.freeze({
  NORMAL: 'normal',
  NATIVE_TEXT_EDITABLE: 'native-text-editable',
  MAZE: 'maze'
});
const PRODUCT_FORMATS = Object.freeze(['static', 'editable', 'maze']);
const boundaries = new Map(Object.values(ENGINE_TYPES).map((type) => [type, Object.freeze({ type })]));

function getEngineBoundary(type) {
  if (!boundaries.has(type)) {
    throw Object.assign(new Error('Unsupported product engine type.'), { code: 'PRODUCT_ENGINE_INVALID' });
  }
  return boundaries.get(type);
}

function normalizeProductFormat(value) {
  const selected = String(value || 'static').trim().toLowerCase();
  if (!PRODUCT_FORMATS.includes(selected)) {
    throw Object.assign(new Error('Invalid product classification.'), { code: 'PRODUCT_ENGINE_INVALID' });
  }
  return selected;
}

function engineTypeForFormat(productFormat) {
  const selected = normalizeProductFormat(productFormat);
  if (selected === 'editable') return ENGINE_TYPES.NATIVE_TEXT_EDITABLE;
  if (selected === 'maze') return ENGINE_TYPES.MAZE;
  return ENGINE_TYPES.NORMAL;
}

function detectProductEngine(project) {
  const type = engineTypeForFormat(project?.productFormat || 'static');
  if (project?.productEngine && project.productEngine !== type) throw Object.assign(new Error('Product engine is locked for this project.'), { code: 'PRODUCT_ENGINE_LOCKED' });
  return type;
}

module.exports = {
  ENGINE_TYPES,
  PRODUCT_FORMATS,
  getEngineBoundary,
  normalizeProductFormat,
  engineTypeForFormat,
  detectProductEngine
};
