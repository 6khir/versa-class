'use strict';

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function manifestKey(projectId, jobId) {
  return `editable-manifest:${projectId}:${jobId}`;
}

function extractCanonicalLines(prompt) {
  const source = String(prompt || '');
  const marked = source.match(/ONLY the following text:\s*([\s\S]*)$/i);
  const blob = marked ? marked[1] : source;
  const lines = [];
  const quote = /"([^"]{1,160})"/g;
  let match = quote.exec(blob);
  while (match) {
    const text = String(match[1] || '').trim();
    if (text && !text.startsWith('@') && !/^do not/i.test(text)) {
      lines.push(text);
    }
    match = quote.exec(blob);
  }
  return [...new Set(lines)];
}

function copyByZoneFromLines(template, lines) {
  const zones = template?.zones || [];
  const map = {};
  if (!lines.length || !zones.length) return map;
  const heading = zones.find((zone) => zone.role === 'heading' || zone.id === 'title');
  const instruction = zones.find((zone) => zone.id === 'instruction');
  const footer = zones.find((zone) => zone.role === 'caption' || zone.id === 'footer');
  const body = zones.find((zone) => zone.role === 'activity' || zone.id === 'body');
  const unused = lines.slice();
  if (heading && unused[0]) map[heading.id] = unused.shift();
  if (instruction && unused[0]) map[instruction.id] = unused.shift();
  if (footer && unused.length > 1) map[footer.id] = unused.pop();
  if (body && unused.length) map[body.id] = unused.join('\n');
  return map;
}

function copyFromJob(job, template) {
  if (job?.manifest?.zones) return null;
  const fromOverlays = Object.fromEntries(
    (job?.textOverlays || [])
      .map((item) => [item.zone_id || item.id || item.role, item.text || item.placeholderText])
      .filter((entry) => entry[0] && entry[1])
  );
  if (Object.keys(fromOverlays).length) return fromOverlays;
  const lines = extractCanonicalLines([job?.prompt, job?.imagePrompt, job?.storyText].filter(Boolean).join('\n'));
  const mapped = copyByZoneFromLines(template, lines);
  if (!Object.keys(mapped).length && job?.title) {
    const heading = (template?.zones || []).find((zone) => zone.role === 'heading' || zone.id === 'title');
    if (heading) mapped[heading.id] = job.title;
  }
  return mapped;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('EDITABLE_MANIFEST_INVALID', 'Manifest must be an object.');
  }
  if (!manifest.page_id || !manifest.theme_id) {
    fail('EDITABLE_MANIFEST_INVALID', 'Manifest requires page_id and theme_id.');
  }
  if (!Array.isArray(manifest.zones) || !manifest.zones.length) {
    fail('EDITABLE_MANIFEST_INVALID', 'Manifest requires at least one zone.');
  }
  for (const zone of manifest.zones) {
    const box = zone.bbox_px;
    if (!Array.isArray(box) || box.length !== 4 || box.some((value) => !Number.isFinite(Number(value)))) {
      fail('EDITABLE_MANIFEST_INVALID', `Zone ${zone.zone_id || '?'} is missing bbox_px.`);
    }
    if (box[2] <= box[0] || box[3] <= box[1]) {
      fail('EDITABLE_MANIFEST_INVALID', `Zone ${zone.zone_id} has an empty bbox.`);
    }
    if (typeof zone.text !== 'string' || !zone.text.trim()) {
      fail('EDITABLE_MANIFEST_INVALID', `Zone ${zone.zone_id} has no text.`);
    }
  }
  return manifest;
}

function buildManifest({ pageId, themeId, template, copyByZone = {}, defaults = {} }) {
  if (!template?.zones?.length) fail('LAYOUT_TEMPLATE_MISSING', 'A layout template is required.');
  const zones = template.zones.map((zone) => ({
    zone_id: zone.id,
    bbox_px: zone.bbox.slice(),
    text: String(copyByZone[zone.id] || defaults[zone.role] || defaults[zone.id] || '').trim(),
    font_family_hint: defaults.font_family_hint || 'hand-lettered / marker',
    font_size_pt: Number(defaults.font_size_pt) || (zone.role === 'heading' ? 36 : 18),
    color_hex: defaults.color_hex || '#2B2B2B',
    align: zone.align || 'left',
    rotation_deg: 0,
    role: zone.role || 'body',
  })).filter((zone) => zone.text);
  return validateManifest({
    page_id: pageId,
    theme_id: themeId || template.theme_id,
    canvas: template.canvas,
    fromDefault: Boolean(template.fromDefault),
    zones,
  });
}

function bboxToSlideBox(bbox, pageW, pageH, slideW, slideH) {
  const [x0, y0, x1, y1] = bbox.map(Number);
  const toX = (value) => Math.round((value / pageW) * slideW);
  const toY = (value) => Math.round((value / pageH) * slideH);
  return {
    left: toX(x0),
    top: toY(y0),
    width: Math.max(1, toX(x1) - toX(x0)),
    height: Math.max(1, toY(y1) - toY(y0)),
  };
}

module.exports = {
  validateManifest,
  buildManifest,
  bboxToSlideBox,
  manifestKey,
  extractCanonicalLines,
  copyByZoneFromLines,
  copyFromJob,
};
