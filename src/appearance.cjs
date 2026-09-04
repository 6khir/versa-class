'use strict';

const APPEARANCE_VALUES = new Set(['light', 'dark', 'system']);

function normalizeAppearance(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'midnight' || raw === 'night') return 'dark';
  if (raw === 'day') return 'light';
  if (raw === 'auto') return 'system';
  return APPEARANCE_VALUES.has(raw) ? raw : 'light';
}

function resolveAppearance(preference, systemDark) {
  const pref = normalizeAppearance(preference);
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

function windowBackground(resolved) {
  return resolved === 'dark' ? '#061428' : '#F4F8FF';
}

function splashBackground(resolved) {
  return resolved === 'dark' ? '#061428' : '#EAF6FC';
}

module.exports = {
  APPEARANCE_VALUES,
  normalizeAppearance,
  resolveAppearance,
  windowBackground,
  splashBackground
};
