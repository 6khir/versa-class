'use strict';

const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function unzipTo(pptxPath) {
  const dir = mkdtempSync(join(tmpdir(), 'versa-pptx-'));
  execFileSync('unzip', ['-qq', '-o', pptxPath, '-d', dir], { timeout: 30_000 });
  return dir;
}

function slideTexts(slideXml) {
  const texts = [];
  const pattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match;
  while ((match = pattern.exec(slideXml))) {
    texts.push(String(match[1] || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  return texts;
}

function nativeTextBoxCount(slideXml) {
  return (slideXml.match(/<p:sp[\s>]/g) || []).length;
}

function validateRebuildDeck({ outputPath, records }) {
  if (!outputPath || !existsSync(outputPath)) {
    return { ok: false, code: 'PPTX_MISSING', issues: ['Deck file is missing.'] };
  }
  const ordered = [...(records || [])].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const dir = unzipTo(outputPath);
  const issues = [];
  try {
    const rels = readFileSync(join(dir, 'ppt', '_rels', 'presentation.xml.rels'), 'utf8');
    const slideTargets = [...rels.matchAll(/Target="slides\/(slide\d+\.xml)"/g)].map((item) => item[1]);
    if (slideTargets.length !== ordered.length) {
      issues.push(`Expected ${ordered.length} slides, found ${slideTargets.length}.`);
    }
    slideTargets.forEach((file, index) => {
      const record = ordered[index];
      if (!record) return;
      const xml = readFileSync(join(dir, 'ppt', 'slides', file), 'utf8');
      const texts = slideTexts(xml);
      const expected = ['title', 'instruction', 'body', 'footer']
        .map((role) => String(record.plannedCopy?.[role] || '').trim())
        .filter(Boolean);
      for (const text of expected) {
        if (!texts.includes(text)) {
          issues.push(`Slide ${record.sequenceIndex} is missing exact copy: ${text.slice(0, 48)}`);
        }
      }
      if (nativeTextBoxCount(xml) < expected.length) {
        issues.push(`Slide ${record.sequenceIndex} is missing native text boxes.`);
      }
      if (record.pageRole === 'front-cover' && record.sequenceIndex !== 1) {
        issues.push('Front cover is not first.');
      }
      if (record.pageRole === 'back-cover' && record.sequenceIndex !== ordered.length && ordered.length > 1) {
        issues.push('Back cover is not last.');
      }
      if (record.pageRole === 'interior' && (record.sequenceIndex === 1 || record.sequenceIndex === ordered.length) && ordered.length > 2) {
        issues.push(`Interior page ${record.sequenceIndex} is in a cover position.`);
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return {
    ok: issues.length === 0,
    code: issues.length ? 'PPTX_VALIDATION_FAILED' : null,
    issues,
  };
}

module.exports = { validateRebuildDeck, slideTexts, nativeTextBoxCount };
