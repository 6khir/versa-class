'use strict';

const CANVA_UNAVAILABLE_CODE = 'CANVA_UNAVAILABLE';
const CANVA_COMING_SOON_MESSAGE = 'Canva Magic Layer is coming soon on Windows. ChatGPT, Gemini, Meta AI, listing, mockups, and TPT still work.';

function isCanvaAvailable(platform = process.platform) {
  return String(platform || '') !== 'win32';
}

function canvaUnavailableError() {
  return Object.assign(new Error(CANVA_COMING_SOON_MESSAGE), { code: CANVA_UNAVAILABLE_CODE });
}

function assertCanvaAvailable(platform = process.platform) {
  if (!isCanvaAvailable(platform)) throw canvaUnavailableError();
}

module.exports = {
  CANVA_UNAVAILABLE_CODE,
  CANVA_COMING_SOON_MESSAGE,
  isCanvaAvailable,
  canvaUnavailableError,
  assertCanvaAvailable
};
