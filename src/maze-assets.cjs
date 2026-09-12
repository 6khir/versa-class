'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { ASSET_IDS } = require('./maze-contract.cjs');

const DEFAULT_ASSET_ID = 'marker';
const ASSET_DIR = join(__dirname, '..', 'assets', 'maze');
const ALLOWED_ASSET_IDS = Object.freeze([...ASSET_IDS, DEFAULT_ASSET_ID]);
const FALLBACK_INNER = Object.freeze({
  [DEFAULT_ASSET_ID]: '<circle cx="12" cy="12" r="8.2" fill="#F7FBFF" stroke="#1A1F2B" stroke-width="1.4"/><circle cx="12" cy="12" r="3.1" fill="#1A1F2B"/>'
});

function resolveMazeAssetId(id) {
  if (typeof id === 'string' && ASSET_IDS.includes(id)) return id;
  return DEFAULT_ASSET_ID;
}

function mazeAssetPath(id) {
  const safe = resolveMazeAssetId(id);
  return join(ASSET_DIR, `${safe}.svg`);
}

function extractSvgInner(raw) {
  const text = String(raw || '');
  if (/<script\b/i.test(text) || /\b(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/)/i.test(text)) {
    return FALLBACK_INNER[DEFAULT_ASSET_ID];
  }
  const match = text.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);
  return match ? match[1].trim() : '';
}

function loadMazeAsset(id) {
  const safe = resolveMazeAssetId(id);
  const filePath = mazeAssetPath(safe);
  if (existsSync(filePath)) {
    const inner = extractSvgInner(readFileSync(filePath, 'utf8'));
    if (inner) {
      return { id: safe, path: filePath, viewBox: '0 0 24 24', inner };
    }
  }
  return {
    id: DEFAULT_ASSET_ID,
    path: join(ASSET_DIR, `${DEFAULT_ASSET_ID}.svg`),
    viewBox: '0 0 24 24',
    inner: FALLBACK_INNER[DEFAULT_ASSET_ID]
  };
}

module.exports = {
  ASSET_DIR,
  ALLOWED_ASSET_IDS,
  DEFAULT_ASSET_ID,
  resolveMazeAssetId,
  mazeAssetPath,
  loadMazeAsset
};
