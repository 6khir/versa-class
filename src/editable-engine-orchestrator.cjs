'use strict';
const { generateStructuredLayout, generateTextFreeArtwork } = require('./editable-generation-adapters.cjs');
const { resolveLayout } = require('./editable-layout-resolver.cjs');
const { composeEditablePage } = require('./editable-pdf-composer.cjs');
const { validateEditablePageContract } = require('./editable-page-contract.cjs');
function assertEditableLayoutMatchesContract(contractInput, resolvedLayout) {
  const contract = validateEditablePageContract(contractInput);
  const expected = new Map(contract.elements.map(el => [el.id, el]));
  const seen = new Set();
  for (const el of resolvedLayout.elements) {
    const source = expected.get(el.id);
    if (!source || seen.has(el.id) || el.text !== source.content.text) throw new Error('EDITABLE_LAYOUT_PAIRING');
    seen.add(el.id);
    const region = contract.textRegions.find(r => r.id === source.regionId);
    if (el.x < region.x || el.y < region.y || el.x + el.width > region.x + region.width || el.y + el.height > region.y + region.height) throw new Error('EDITABLE_LAYOUT_BOUNDS');
    if (el.rotation) throw new Error('EDITABLE_LAYOUT_ROTATION');
    if (typeof el.text !== 'string' || !el.text.trim() || !Number.isFinite(el.fontSize) || el.fontSize < 8 || el.fontSize > 120) throw new Error('EDITABLE_LAYOUT_STYLE');
    if (!/^#[0-9A-Fa-f]{6}$/.test(el.color) || !['left','center','right'].includes(el.alignment) || !['top','middle','bottom'].includes(el.verticalAlignment) || typeof el.bold !== 'boolean' || typeof el.italic !== 'boolean') throw new Error('EDITABLE_LAYOUT_STYLE');
  }
  if (seen.size !== expected.size) throw new Error('EDITABLE_LAYOUT_PAIRING');
  return resolvedLayout;
}
async function runEditablePagePipeline(input, provider) {
  const contract = validateEditablePageContract(input);
  if (!provider?.generateImage || !provider?.validateArtwork) throw new Error('ORCHESTRATOR_INVALID_INPUT');
  const { buffer, evidence } = await generateTextFreeArtwork(contract, provider);
  const resolvedLayout = assertEditableLayoutMatchesContract(
    contract,
    resolveLayout(generateStructuredLayout(contract))
  );
  return { backgroundPng: buffer, resolvedLayout, compositedPng: await composeEditablePage(buffer, resolvedLayout, [contract.dimensions.width, contract.dimensions.height]), evidence };
}
module.exports = { runEditablePagePipeline, assertEditableLayoutMatchesContract };
