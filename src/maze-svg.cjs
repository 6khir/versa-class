'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { extname } = require('node:path');
const { PAGE_SETUPS, resolvePageSetup } = require('./file-manager.cjs');
const {
  DEFAULT_MAZE_PANEL,
  mazeExtent,
  validateMazeResult
} = require('./maze-contract.cjs');
const { loadMazeAsset, resolveMazeAssetId } = require('./maze-assets.cjs');
const {
  LATTICE_HEX,
  LATTICE_RADIAL,
  resolvePalette,
  frameMarkup,
  wallStrokeAttrs,
  isActiveCell,
  isHexOpeningWall,
  hexOpeningOffset,
  hexNeighborOffsets
} = require('./maze-design.cjs');

const MAZE_RENDER_COLORS = Object.freeze({
  pageFill: '#F3F0E7',
  frameStroke: '#E4DFD0',
  panelFill: '#FFFEF9',
  wall: '#1A1F2B',
  solution: '#9B1C1C',
  text: '#1A1F2B'
});

const ICON_VIEWBOX = 24;

function failRender(message) {
  throw Object.assign(new Error(message), { code: 'MAZE_RENDER_INVALID' });
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function estimateWordWidth(word, fontSize, weight) {
  const wide = weight === '700' ? 0.66 : 0.63;
  let width = 0;
  for (const char of String(word)) {
    if ("il.,':;!|".includes(char)) width += fontSize * 0.28;
    else if ('mwMW@'.includes(char)) width += fontSize * 0.84;
    else width += fontSize * wide;
  }
  return width;
}

function svgCenteredLine(id, value, x, y, fontSize, weight, fill) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const space = fontSize * (fontSize < 13 ? 0.55 : 0.4);
  const widths = words.map((word) => estimateWordWidth(word, fontSize, weight));
  const total = widths.reduce((sum, item) => sum + item, 0) + (space * Math.max(0, words.length - 1));
  let cursor = x - (total / 2);
  const nodes = words.map((word, index) => {
    const node = `<text${index === 0 ? ` id="${id}"` : ''} x="${fmt(cursor)}" y="${fmt(y)}" text-anchor="start" font-family="Trebuchet MS, Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(word)}</text>`;
    cursor += widths[index] + space;
    return node;
  });
  return `<g data-maze-line="${id}">${nodes.join('')}</g>`;
}

function fitMazeHeading(text, maxChars = 36) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trim()}…`;
}

function fmt(value) {
  if (!Number.isFinite(value)) failRender('Expected a finite drawing coordinate.');
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function hexChannel(hex, index) {
  return parseInt(hex.slice(index, index + 2), 16) / 255;
}

function relativeLuminance(hex) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(value)) failRender('Expected a print-safe hex color.');
  const linear = (channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear(hexChannel(value, 0))
    + 0.7152 * linear(hexChannel(value, 2))
    + 0.0722 * linear(hexChannel(value, 4));
}

function contrastRatio(foreground, background) {
  const left = relativeLuminance(foreground);
  const right = relativeLuminance(background);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function normalizePageFormat(format) {
  const raw = String(format || 'A4').trim();
  const upper = raw.toUpperCase();
  if (upper === 'US LETTER' || upper === 'US-LETTER' || upper === 'LETTER') return 'LETTER';
  if (PAGE_SETUPS[upper]) return upper;
  if (PAGE_SETUPS[raw]) return raw;
  return 'A4';
}

function resolveMazePageSetup(format = 'A4', orientation = 'portrait') {
  const setup = resolvePageSetup(normalizePageFormat(format), orientation === 'landscape' ? 'landscape' : 'portrait');
  return {
    format: setup.format,
    orientation: setup.orientation,
    pixelWidth: setup.width,
    pixelHeight: setup.height,
    width: setup.points[0],
    height: setup.points[1]
  };
}

function box(x, y, width, height, label) {
  if (![x, y, width, height].every(Number.isFinite)) {
    failRender(`${label || 'Box'} has a non-finite coordinate.`);
  }
  if (width <= 0 || height <= 0) failRender(`${label || 'Box'} must be a positive rectangle.`);
  return { x, y, width, height };
}

function containsBox(outer, inner, epsilon = 0.05) {
  return inner.x + epsilon >= outer.x
    && inner.y + epsilon >= outer.y
    && inner.x + inner.width <= outer.x + outer.width + epsilon
    && inner.y + inner.height <= outer.y + outer.height + epsilon;
}

function rectsOverlap(left, right, epsilon = 0.02) {
  return left.x + epsilon < right.x + right.width
    && left.x + left.width > right.x + epsilon
    && left.y + epsilon < right.y + right.height
    && left.y + left.height > right.y + epsilon;
}

function iconHomeCell(icon, topology) {
  if (!topology) return null;
  return icon.kind === 'start' ? topology.entrance : topology.exit;
}

function iconHitsPassage(icon, cell, topology) {
  const home = iconHomeCell(icon, topology);
  if (home && cell.row === home.row && cell.col === home.col) return false;
  if (topology?.lattice === LATTICE_RADIAL || topology?.lattice === LATTICE_HEX) {
    const cx = cell.x + (cell.width / 2);
    const cy = cell.y + (cell.height / 2);
    const cellR = Math.min(cell.width, cell.height) * 0.36;
    const iconR = Math.min(icon.width || 0, icon.height || 0) * 0.32;
    const ix = icon.cx ?? (icon.x + (icon.width / 2));
    const iy = icon.cy ?? (icon.y + (icon.height / 2));
    return Math.hypot(ix - cx, iy - cy) < (cellR + iconR);
  }
  return rectsOverlap(icon, cell);
}

function decorativeFrameHref(raw) {
  if (raw == null || raw === '') return null;
  const value = String(raw);
  if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value;
  if (value.includes('://') || /<svg\b/i.test(value)) return null;
  const ext = extname(value).toLowerCase();
  if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') return null;
  if (!existsSync(value)) return null;
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(value).toString('base64')}`;
}

function takeFrameImage(input) {
  return decorativeFrameHref(
    input.frameImagePath
    ?? input.page?.render?.frameImagePath
    ?? input.frameHref
    ?? null
  );
}

function requestedPanel(input) {
  const panel = input.mazePanel || input.page?.mazePanel || DEFAULT_MAZE_PANEL;
  if (!panel || typeof panel !== 'object') failRender('Expected a maze panel.');
  return box(panel.x, panel.y, panel.width, panel.height, 'Maze panel');
}

function fitPanelToPage(page, panel) {
  if (panel.x < 0 || panel.y < 0) failRender('Maze panel origin is outside the page.');
  const fits = panel.x + panel.width <= page.width + 0.05
    && panel.y + panel.height <= page.height + 0.05;
  if (fits) return panel;
  const margin = 24;
  const maxWidth = page.width - margin * 2;
  const maxHeight = page.height - margin * 2;
  if (maxWidth <= 0 || maxHeight <= 0) failRender('Page is too small for a maze panel.');
  const scale = Math.min(maxWidth / panel.width, maxHeight / panel.height);
  if (!Number.isFinite(scale) || scale <= 0) failRender('Maze panel cannot be fitted to the page.');
  const width = panel.width * scale;
  const height = panel.height * scale;
  return box((page.width - width) / 2, Math.max(margin, (page.height - height) / 2), width, height, 'Fitted maze panel');
}

function takeTopology(input) {
  const topology = input.topology || input.result?.topology || input.page?.topology;
  if (!topology) failRender('A validated maze topology is required to render.');
  const { rows, cols, cellSize, wallThickness, iconSize, entrance, exit, horizontalWalls, verticalWalls } = topology;
  if (![rows, cols, cellSize, wallThickness, iconSize].every(Number.isFinite)) {
    failRender('Maze metrics must be finite.');
  }
  if (rows < 1 || cols < 1 || cellSize <= 0 || wallThickness <= 0 || iconSize <= 0) {
    failRender('Maze metrics must be positive.');
  }
  if (!entrance || !exit) failRender('Entrance and exit are required.');
  if (!Array.isArray(horizontalWalls) || !Array.isArray(verticalWalls)) {
    failRender('Wall grids are required.');
  }
  return topology;
}

function takeSolutionPath(input, topology) {
  const path = input.solution?.path || input.result?.solution?.path || input.page?.solution?.path;
  if (!Array.isArray(path) || path.length < 2) failRender('A solution path is required.');
  path.forEach((cell, index) => {
    if (!cell || !Number.isFinite(cell.row) || !Number.isFinite(cell.col)) {
      failRender(`Solution cell ${index} is invalid.`);
    }
    if (cell.row < 0 || cell.col < 0 || cell.row >= topology.rows || cell.col >= topology.cols) {
      failRender(`Solution cell ${index} is outside the maze.`);
    }
  });
  return path;
}

function cellAnchor(originX, originY, row, col, cellSize, wallThickness, scale) {
  return {
    x: originX + (col * (cellSize + wallThickness) + wallThickness) * scale,
    y: originY + (row * (cellSize + wallThickness) + wallThickness) * scale
  };
}

function hexSize(topology, scale) {
  return topology.cellSize * scale;
}

function hexCenter(originX, originY, row, col, size) {
  const width = Math.sqrt(3) * size;
  return {
    x: originX + (col * width) + ((row & 1) ? width / 2 : 0) + (width / 2),
    y: originY + (row * size * 1.5) + size
  };
}

function hexCorners(cx, cy, size) {
  const corners = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = ((Math.PI / 180) * ((60 * index) - 30));
    corners.push({ x: cx + (size * Math.cos(angle)), y: cy + (size * Math.sin(angle)) });
  }
  return corners;
}

function radialMetrics(topology, originX, originY, scale) {
  const ringStep = (topology.cellSize + (topology.wallThickness * 0.35)) * scale;
  const radius = topology.rows * ringStep;
  return {
    ringStep,
    radius,
    cx: originX + radius,
    cy: originY + radius,
    rings: topology.rows,
    sectors: topology.cols
  };
}

function radialAngle(sector, sectors) {
  return ((sector * Math.PI * 2) / sectors) - (Math.PI / 2);
}

function radialPoint(cx, cy, radius, angle) {
  return { x: cx + (radius * Math.cos(angle)), y: cy + (radius * Math.sin(angle)) };
}

function appendArcSegments(segments, cx, cy, radius, a0, a1, steps = 6) {
  let prev = radialPoint(cx, cy, radius, a0);
  for (let index = 1; index <= steps; index += 1) {
    const angle = a0 + ((a1 - a0) * (index / steps));
    const next = radialPoint(cx, cy, radius, angle);
    segments.push({ x1: prev.x, y1: prev.y, x2: next.x, y2: next.y });
    prev = next;
  }
}

function cellCenter(originX, originY, row, col, cellSize, wallThickness, scale, topology = null) {
  if (topology?.lattice === LATTICE_HEX) {
    return hexCenter(originX, originY, row, col, hexSize(topology, scale));
  }
  if (topology?.lattice === LATTICE_RADIAL) {
    const radial = radialMetrics(topology, originX, originY, scale);
    const radius = (row + 0.5) * radial.ringStep;
    const angle = radialAngle(col + 0.5, radial.sectors);
    return radialPoint(radial.cx, radial.cy, radius, angle);
  }
  const anchor = cellAnchor(originX, originY, row, col, cellSize, wallThickness, scale);
  return {
    x: anchor.x + (cellSize * scale) / 2,
    y: anchor.y + (cellSize * scale) / 2
  };
}

function openingPoint(opening, originX, originY, cellSize, wallThickness, scale, topology = null) {
  const center = cellCenter(originX, originY, opening.row, opening.col, cellSize, wallThickness, scale, topology);
  if (topology?.lattice === LATTICE_HEX) {
    const size = hexSize(topology, scale);
    const corners = hexCorners(center.x, center.y, size);
    const picked = hexOpeningOffset(opening, topology.rows, topology.cols, topology.cellMask);
    const face = hexNeighborOffsets(opening.row).find((item) => (
      picked
      && item.dr === picked.dr
      && item.dc === picked.dc
      && item.wall === picked.wall
    ));
    if (face) {
      const a = corners[face.corners[0]];
      const b = corners[face.corners[1]];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    if (opening.side === 'north') return { x: center.x, y: center.y - size };
    if (opening.side === 'south') return { x: center.x, y: center.y + size };
    if (opening.side === 'west') return { x: center.x - size, y: center.y };
    return { x: center.x + size, y: center.y };
  }
  if (topology?.lattice === LATTICE_RADIAL) {
    const radial = radialMetrics(topology, originX, originY, scale);
    if (opening.side === 'north') {
      return radialPoint(
        radial.cx,
        radial.cy,
        Math.max(8 * scale, radial.ringStep * 0.22),
        radialAngle(opening.col + 0.5, radial.sectors)
      );
    }
    return radialPoint(
      radial.cx,
      radial.cy,
      radial.radius + (2 * scale),
      radialAngle(opening.col + 0.5, radial.sectors)
    );
  }
  const halfWall = (wallThickness * scale) / 2;
  if (opening.side === 'north') {
    return { x: center.x, y: originY + (opening.row * (cellSize + wallThickness)) * scale + halfWall };
  }
  if (opening.side === 'south') {
    return { x: center.x, y: originY + ((opening.row + 1) * (cellSize + wallThickness)) * scale + halfWall };
  }
  if (opening.side === 'west') {
    return { x: originX + (opening.col * (cellSize + wallThickness)) * scale + halfWall, y: center.y };
  }
  return { x: originX + ((opening.col + 1) * (cellSize + wallThickness)) * scale + halfWall, y: center.y };
}

function cellBounds(cells, originX, originY, topology, scale) {
  if (cells.length) {
    return {
      minX: Math.min(...cells.map((cell) => cell.x)),
      minY: Math.min(...cells.map((cell) => cell.y)),
      maxX: Math.max(...cells.map((cell) => cell.x + cell.width)),
      maxY: Math.max(...cells.map((cell) => cell.y + cell.height))
    };
  }
  const extent = mazeExtent(
    topology.rows,
    topology.cols,
    topology.cellSize,
    topology.wallThickness,
    topology.lattice
  );
  return {
    minX: originX,
    minY: originY,
    maxX: originX + (extent.width * scale),
    maxY: originY + (extent.height * scale)
  };
}

function iconCenterForOpening(opening, originX, originY, topology, iconDraw, scale, cells = []) {
  const { cellSize, wallThickness } = topology;
  const center = cellCenter(originX, originY, opening.row, opening.col, cellSize, wallThickness, scale, topology);
  const gap = Math.max(2 * scale, 2);
  const half = iconDraw / 2;
  const openPt = openingPoint(opening, originX, originY, cellSize, wallThickness, scale, topology);
  const dx = openPt.x - center.x;
  const dy = openPt.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  void cells;
  return {
    x: openPt.x + (dx / length) * (gap + half),
    y: openPt.y + (dy / length) * (gap + half)
  };
}

function squareWallSegments(topology, originX, originY, scale) {
  const { rows, cols, cellSize, wallThickness, horizontalWalls, verticalWalls, cellMask } = topology;
  const half = (wallThickness * scale) / 2;
  const segments = [];
  const active = (row, col) => (
    row >= 0 && col >= 0 && row < rows && col < cols && isActiveCell(cellMask, row, col)
  );
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!horizontalWalls[row]?.[col]) continue;
      if (!active(row, col) && !active(row - 1, col)) continue;
      const y = originY + (row * (cellSize + wallThickness)) * scale + half;
      const x1 = originX + (col * (cellSize + wallThickness)) * scale + half;
      const x2 = originX + ((col + 1) * (cellSize + wallThickness)) * scale + half;
      segments.push({ x1, y1: y, x2, y2: y });
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      if (!verticalWalls[row]?.[col]) continue;
      if (!active(row, col) && !active(row, col - 1)) continue;
      const x = originX + (col * (cellSize + wallThickness)) * scale + half;
      const y1 = originY + (row * (cellSize + wallThickness)) * scale + half;
      const y2 = originY + ((row + 1) * (cellSize + wallThickness)) * scale + half;
      segments.push({ x1: x, y1, x2: x, y2 });
    }
  }
  return segments;
}

function hexWallClosed(topology, row, col, offset) {
  const nr = row + offset.dr;
  const nc = col + offset.dc;
  if (nr < 0 || nc < 0 || nr >= topology.rows || nc >= topology.cols) return true;
  if (!isActiveCell(topology.cellMask, nr, nc)) return true;
  if (offset.fromSelf) return Boolean(topology.hexWalls?.[offset.wall]?.[row]?.[col]);
  return Boolean(topology.hexWalls?.[offset.wall]?.[nr]?.[nc]);
}

function hexWallSegments(topology, originX, originY, scale) {
  const size = hexSize(topology, scale);
  const segments = [];
  for (let row = 0; row < topology.rows; row += 1) {
    for (let col = 0; col < topology.cols; col += 1) {
      if (!isActiveCell(topology.cellMask, row, col)) continue;
      const center = hexCenter(originX, originY, row, col, size);
      const corners = hexCorners(center.x, center.y, size);
      for (const offset of hexNeighborOffsets(row)) {
        const nr = row + offset.dr;
        const nc = col + offset.dc;
        const outside = nr < 0 || nc < 0 || nr >= topology.rows || nc >= topology.cols
          || !isActiveCell(topology.cellMask, nr, nc);
        if (!outside && !offset.fromSelf) continue;
        if (isHexOpeningWall(topology, row, col, offset)) continue;
        if (!hexWallClosed(topology, row, col, offset)) continue;
        const a = corners[offset.corners[0]];
        const b = corners[offset.corners[1]];
        segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
  }
  return segments;
}

function radialWallSegments(topology, originX, originY, scale) {
  const radial = radialMetrics(topology, originX, originY, scale);
  const segments = [];
  const { ring, spoke } = topology.radialWalls || {};
  if (!ring || !spoke) return segments;
  for (let ringIndex = 0; ringIndex <= radial.rings; ringIndex += 1) {
    for (let sector = 0; sector < radial.sectors; sector += 1) {
      if (!ring[ringIndex]?.[sector]) continue;
      const radius = ringIndex * radial.ringStep;
      appendArcSegments(
        segments,
        radial.cx,
        radial.cy,
        radius,
        radialAngle(sector, radial.sectors),
        radialAngle(sector + 1, radial.sectors)
      );
    }
  }
  for (let ringIndex = 0; ringIndex < radial.rings; ringIndex += 1) {
    for (let sector = 0; sector < radial.sectors; sector += 1) {
      if (!spoke[ringIndex]?.[sector]) continue;
      const angle = radialAngle(sector + 1, radial.sectors);
      const inner = radialPoint(radial.cx, radial.cy, ringIndex * radial.ringStep, angle);
      const outer = radialPoint(radial.cx, radial.cy, (ringIndex + 1) * radial.ringStep, angle);
      segments.push({ x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y });
    }
  }
  return segments;
}

function circleCellSegments(topology, originX, originY, scale) {
  const { rows, cols, cellSize, wallThickness, cellMask } = topology;
  const radius = (cellSize * scale) * 0.46;
  const segments = [];
  const gap = Math.PI / 5.2;
  const sideAngle = { north: -Math.PI / 2, east: 0, south: Math.PI / 2, west: Math.PI };
  for (let row = 0; row < rows; row += 1) {
    if (cellMask && !cellMask[row]) continue;
    for (let col = 0; col < cols; col += 1) {
      if (!isActiveCell(cellMask, row, col)) continue;
      const center = cellCenter(originX, originY, row, col, cellSize, wallThickness, scale, topology);
      const open = new Set();
      for (const [side, dr, dc] of [['north', -1, 0], ['south', 1, 0], ['west', 0, -1], ['east', 0, 1]]) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || !isActiveCell(cellMask, nr, nc)) continue;
        const closed = side === 'north'
          ? topology.horizontalWalls[row][col]
          : side === 'south'
            ? topology.horizontalWalls[row + 1][col]
            : side === 'west'
              ? topology.verticalWalls[row][col]
              : topology.verticalWalls[row][col + 1];
        if (!closed) open.add(side);
      }
      for (let step = 0; step < 24; step += 1) {
        const a0 = (step / 24) * Math.PI * 2;
        const a1 = ((step + 1) / 24) * Math.PI * 2;
        const mid = (a0 + a1) / 2;
        const blocked = [...open].some((side) => Math.abs(Math.atan2(Math.sin(mid - sideAngle[side]), Math.cos(mid - sideAngle[side]))) < gap);
        if (blocked) continue;
        const p0 = { x: center.x + (radius * Math.cos(a0)), y: center.y + (radius * Math.sin(a0)) };
        const p1 = { x: center.x + (radius * Math.cos(a1)), y: center.y + (radius * Math.sin(a1)) };
        segments.push({ x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
      }
    }
  }
  return segments;
}

function wallSegments(topology, originX, originY, scale) {
  if (topology.lattice === LATTICE_HEX && topology.hexWalls) {
    return hexWallSegments(topology, originX, originY, scale);
  }
  if (topology.lattice === LATTICE_RADIAL && topology.radialWalls) {
    return radialWallSegments(topology, originX, originY, scale);
  }
  return squareWallSegments(topology, originX, originY, scale);
}

function cellInteriors(topology, originX, originY, scale) {
  const { rows, cols, cellSize, wallThickness, cellMask } = topology;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!isActiveCell(cellMask, row, col)) continue;
      const center = cellCenter(originX, originY, row, col, cellSize, wallThickness, scale, topology);
      const size = topology.lattice === LATTICE_RADIAL
        ? Math.max(6, topology.cellSize * scale * 0.45)
        : topology.lattice === LATTICE_HEX
          ? hexSize(topology, scale)
          : cellSize * scale;
      cells.push({
        ...box(center.x - (size / 2), center.y - (size / 2), size, size, `Cell ${row},${col}`),
        row,
        col
      });
    }
  }
  return cells;
}

function layoutIcons(input, topology, originX, originY, iconDraw, scale, panel, cells = []) {
  const startId = input.startAssetId ?? input.page?.startAssetId ?? input.result?.startAssetId ?? null;
  const endId = input.endAssetId ?? input.page?.endAssetId ?? input.result?.endAssetId ?? null;
  const icons = [];
  const place = (kind, assetId, opening) => {
    if (!assetId) return;
    const seed = iconCenterForOpening(opening, originX, originY, topology, iconDraw, scale, cells);
    const cellAt = cellCenter(
      originX,
      originY,
      opening.row,
      opening.col,
      topology.cellSize,
      topology.wallThickness,
      scale,
      topology
    );
    const radialX = seed.x - cellAt.x;
    const radialY = seed.y - cellAt.y;
    const radialLen = Math.hypot(radialX, radialY) || 1;
    const dir = { x: radialX / radialLen, y: radialY / radialLen };
    const step = Math.max(2 * scale, 2);
    let center = { ...seed };
    let icon = null;
    for (let attempt = 0; attempt < 18; attempt += 1) {
      icon = {
        kind,
        assetId: resolveMazeAssetId(assetId),
        requestedId: assetId,
        x: center.x - iconDraw / 2,
        y: center.y - iconDraw / 2,
        width: iconDraw,
        height: iconDraw,
        cx: center.x,
        cy: center.y
      };
      const blocked = cells.some((cell) => iconHitsPassage(icon, cell, topology));
      if (!blocked && containsBox(panel, icon, 0.08)) {
        icons.push(icon);
        return;
      }
      center = { x: center.x + (dir.x * step), y: center.y + (dir.y * step) };
    }
    if (!icon || !containsBox(panel, icon, 0.08)) {
      failRender(`${kind} icon leaves the maze panel.`);
    }
    icons.push(icon);
  };
  place('start', startId, topology.entrance);
  place('end', endId, topology.exit);
  return icons;
}

function assertIconsClear(icons, cells, topology) {
  for (const icon of icons) {
    for (const cell of cells) {
      if (iconHitsPassage(icon, cell, topology)) {
        failRender('Start/end icons obstruct a maze passage.');
      }
    }
  }
}

function buildMazeRenderLayout(input = {}) {
  if (input.result) validateMazeResult(input.result);
  const page = resolveMazePageSetup(input.format, input.orientation);
  const pageBox = box(0, 0, page.width, page.height, 'Page');
  const panel = fitPanelToPage(page, requestedPanel(input));
  if (!containsBox(pageBox, panel, 0.05)) failRender('Maze panel must stay inside the page.');

  const topology = takeTopology(input);
  const path = takeSolutionPath(input, topology);
  const extent = mazeExtent(
    topology.rows,
    topology.cols,
    topology.cellSize,
    topology.wallThickness,
    topology.lattice
  );
  if (![extent.width, extent.height].every(Number.isFinite) || extent.width <= 0 || extent.height <= 0) {
    failRender('Maze extent is invalid.');
  }

  const iconSize = topology.iconSize;
  const pads = { north: 2, east: 2, south: 2, west: 2 };
  pads[topology.entrance.side] = Math.max(pads[topology.entrance.side], iconSize + 2);
  pads[topology.exit.side] = Math.max(pads[topology.exit.side], iconSize + 2);
  const neededWidth = extent.width + pads.west + pads.east;
  const neededHeight = extent.height + pads.north + pads.south;
  const scale = Math.min(1, panel.width / neededWidth, panel.height / neededHeight);
  if (!Number.isFinite(scale) || scale <= 0) failRender('Maze cannot be scaled into the panel.');

  const drawWidth = neededWidth * scale;
  const drawHeight = neededHeight * scale;
  const originX = panel.x + (panel.width - drawWidth) / 2 + pads.west * scale;
  const originY = panel.y + (panel.height - drawHeight) / 2 + pads.north * scale;
  const iconDraw = iconSize * scale;
  const walls = wallSegments(topology, originX, originY, scale);
  const cells = cellInteriors(topology, originX, originY, scale);
  const icons = layoutIcons(input, topology, originX, originY, iconDraw, scale, panel, cells);
  assertIconsClear(icons, cells, topology);

  const mazeBox = box(
    originX,
    originY,
    extent.width * scale,
    extent.height * scale,
    'Maze'
  );
  if (!containsBox(panel, mazeBox, 0.08)) failRender('Maze walls leave the maze panel.');

  const points = [
    { x: originX, y: originY },
    { x: originX + mazeBox.width, y: originY + mazeBox.height },
    openingPoint(topology.entrance, originX, originY, topology.cellSize, topology.wallThickness, scale, topology),
    openingPoint(topology.exit, originX, originY, topology.cellSize, topology.wallThickness, scale, topology),
    ...path.map((cell) => cellCenter(originX, originY, cell.row, cell.col, topology.cellSize, topology.wallThickness, scale, topology)),
    ...walls.flatMap((segment) => [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }]),
    ...icons.map((icon) => ({ x: icon.cx, y: icon.cy }))
  ];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) failRender('A drawing point is not finite.');
    if (point.x < pageBox.x - 0.05 || point.y < pageBox.y - 0.05
      || point.x > pageBox.x + pageBox.width + 0.05
      || point.y > pageBox.y + pageBox.height + 0.05) {
      failRender('A drawing point leaves the page.');
    }
  }

  const title = input.title ?? input.page?.title ?? '';
  const instruction = input.instruction ?? input.page?.instruction ?? '';
  const palette = resolvePalette(topology.design?.paletteId);
  const strokeAttrs = wallStrokeAttrs(topology.design?.wallStyle);
  const wallStroke = topology.wallThickness * scale * strokeAttrs.scale;
  const solutionStroke = Math.min(
    Math.max(topology.cellSize * scale * 0.22, 1.25),
    Math.max(2, topology.cellSize * scale * 0.38)
  );

  return {
    page,
    pageBox,
    panel,
    topology,
    path,
    originX,
    originY,
    scale,
    iconDraw,
    walls,
    cells,
    icons,
    mazeBox,
    title,
    instruction,
    wallStroke,
    wallLinecap: strokeAttrs.linecap,
    wallLinejoin: strokeAttrs.linejoin,
    solutionStroke,
    colors: palette,
    startAssetId: input.startAssetId ?? input.page?.startAssetId ?? null,
    endAssetId: input.endAssetId ?? input.page?.endAssetId ?? null,
    frameImageHref: takeFrameImage(input)
  };
}

function wallPath(layout) {
  return layout.walls.map((segment) => (
    `M ${fmt(segment.x1)} ${fmt(segment.y1)} L ${fmt(segment.x2)} ${fmt(segment.y2)}`
  )).join(' ');
}

function hexPassagePoint(from, to, originX, originY, topology, scale) {
  const size = hexSize(topology, scale);
  const center = hexCenter(originX, originY, from.row, from.col, size);
  const corners = hexCorners(center.x, center.y, size);
  const offset = hexNeighborOffsets(from.row).find((item) => (
    from.row + item.dr === to.row && from.col + item.dc === to.col
  ));
  if (!offset?.corners) return null;
  const left = corners[offset.corners[0]];
  const right = corners[offset.corners[1]];
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function radialCorridorPoints(from, to, originX, originY, topology, scale) {
  const radial = radialMetrics(topology, originX, originY, scale);
  const dest = cellCenter(originX, originY, to.row, to.col, topology.cellSize, topology.wallThickness, scale, topology);
  if (from.row !== to.row) return [dest];
  const start = cellCenter(originX, originY, from.row, from.col, topology.cellSize, topology.wallThickness, scale, topology);
  let delta = Math.atan2(dest.y - radial.cy, dest.x - radial.cx) - Math.atan2(start.y - radial.cy, start.x - radial.cx);
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const radius = (from.row + 0.5) * radial.ringStep;
  const startAngle = Math.atan2(start.y - radial.cy, start.x - radial.cx);
  const steps = Math.max(2, Math.ceil((Math.abs(delta) * 12) / Math.PI));
  const points = [];
  for (let index = 1; index <= steps; index += 1) {
    points.push(radialPoint(radial.cx, radial.cy, radius, startAngle + (delta * (index / steps))));
  }
  return points;
}

function solutionPath(layout) {
  const { topology, originX, originY, scale, path } = layout;
  const points = [
    openingPoint(topology.entrance, originX, originY, topology.cellSize, topology.wallThickness, scale, topology)
  ];
  path.forEach((cell, index) => {
    const prev = index > 0 ? path[index - 1] : null;
    if (prev && topology.lattice === LATTICE_HEX) {
      const door = hexPassagePoint(prev, cell, originX, originY, topology, scale);
      if (door) points.push(door);
    }
    if (prev && topology.lattice === LATTICE_RADIAL) {
      points.push(...radialCorridorPoints(prev, cell, originX, originY, topology, scale));
      return;
    }
    points.push(cellCenter(originX, originY, cell.row, cell.col, topology.cellSize, topology.wallThickness, scale, topology));
  });
  points.push(openingPoint(topology.exit, originX, originY, topology.cellSize, topology.wallThickness, scale, topology));
  return points.map((point, index) => (
    `${index === 0 ? 'M' : 'L'} ${fmt(point.x)} ${fmt(point.y)}`
  )).join(' ');
}

function iconMarkup(icon) {
  const asset = loadMazeAsset(icon.assetId);
  const scale = icon.width / ICON_VIEWBOX;
  return [
    `<g id="maze-${icon.kind}-icon" data-asset="${escapeXml(asset.id)}" data-requested-asset="${escapeXml(icon.requestedId)}"`,
    ` transform="translate(${fmt(icon.x)} ${fmt(icon.y)}) scale(${fmt(scale)})">`,
    asset.inner,
    '</g>'
  ].join('');
}

function serializeMazeSvg(layout, variant = 'student') {
  if (variant !== 'student' && variant !== 'solution') failRender('Unknown maze render variant.');
  const { page, panel, colors } = layout;
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(page.width)}" height="${fmt(page.height)}" viewBox="0 0 ${fmt(page.width)} ${fmt(page.height)}" data-maze-variant="${variant}" data-maze-shape="${escapeXml(layout.topology.shape || 'rectangular')}" data-maze-algorithm="${escapeXml(layout.topology.algorithm || 'backtracker')}" data-maze-lattice="${escapeXml(layout.topology.lattice || 'square')}" data-maze-palette="${escapeXml(layout.topology.design?.paletteId || 'classroom')}" data-page-format="${escapeXml(page.format)}" data-page-orientation="${escapeXml(page.orientation)}" data-page-pixel-width="${page.pixelWidth}" data-page-pixel-height="${page.pixelHeight}">`,
    layout.frameImageHref
      ? `<g id="maze-frame" data-slot="decorative-background"><rect x="0" y="0" width="${fmt(page.width)}" height="${fmt(page.height)}" fill="${colors.pageFill}"/><image href="${escapeXml(layout.frameImageHref)}" x="0" y="0" width="${fmt(page.width)}" height="${fmt(page.height)}" preserveAspectRatio="xMidYMid slice" data-role="decorative-frame"/></g>`
      : `<g id="maze-frame" data-slot="decorative-background"><rect x="0" y="0" width="${fmt(page.width)}" height="${fmt(page.height)}" fill="${colors.pageFill}"/>${frameMarkup(layout.topology.design?.frameStyle || 'plain', page, colors)}</g>`,
    `<rect id="maze-panel" data-role="maze-panel" x="${fmt(panel.x)}" y="${fmt(panel.y)}" width="${fmt(panel.width)}" height="${fmt(panel.height)}" fill="${colors.panelFill}"/>`
  ];

  if (layout.title || layout.instruction) {
    parts.push('<g id="maze-text">');
    if (layout.title) {
      parts.push(svgCenteredLine(
        'maze-title',
        fitMazeHeading(layout.title),
        page.width / 2,
        Math.max(28, panel.y - 28),
        16,
        '700',
        colors.text
      ));
    }
    if (layout.instruction) {
      parts.push(svgCenteredLine(
        'maze-instruction',
        layout.instruction,
        page.width / 2,
        Math.max(46, panel.y - 10),
        11,
        '400',
        colors.text
      ));
    }
    parts.push('</g>');
  }

  parts.push(`<path id="maze-walls" fill="none" stroke="${colors.wall}" stroke-width="${fmt(layout.wallStroke)}" stroke-linecap="${layout.wallLinecap || 'square'}" stroke-linejoin="${layout.wallLinejoin || 'miter'}" d="${wallPath(layout)}"/>`);
  const openingMarks = [];
  const markOpening = (kind, opening) => {
    if (layout.icons.some((icon) => icon.kind === kind)) return;
    const point = iconCenterForOpening(
      opening, layout.originX, layout.originY, layout.topology, Math.max(6, layout.iconDraw), layout.scale
    );
    openingMarks.push(`<circle data-opening="${kind}" cx="${fmt(point.x)}" cy="${fmt(point.y)}" r="${fmt(Math.max(2.5, layout.wallStroke))}" fill="${colors.wall}"/>`);
  };
  markOpening('start', layout.topology.entrance);
  markOpening('end', layout.topology.exit);
  if (openingMarks.length) parts.push(`<g id="maze-openings">${openingMarks.join('')}</g>`);

  if (variant === 'solution') {
    parts.push(`<path id="maze-solution" fill="none" stroke="${colors.solution}" stroke-width="${fmt(layout.solutionStroke)}" stroke-linecap="round" stroke-linejoin="round" d="${solutionPath(layout)}"/>`);
  }

  if (layout.icons.length) {
    parts.push(`<g id="maze-icons">${layout.icons.map(iconMarkup).join('')}</g>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

function renderMazePageDocuments(input = {}) {
  const layout = buildMazeRenderLayout(input);
  return {
    studentSvg: serializeMazeSvg(layout, 'student'),
    solutionSvg: serializeMazeSvg(layout, 'solution'),
    layout
  };
}

function renderMazeSvg(input = {}) {
  const layout = buildMazeRenderLayout(input);
  return serializeMazeSvg(layout, input.variant === 'solution' ? 'solution' : 'student');
}

function iconsObstructPassages(layout) {
  return layout.icons.some((icon) => (
    layout.cells.some((cell) => iconHitsPassage(icon, cell, layout.topology))
  ));
}

module.exports = {
  MAZE_RENDER_COLORS,
  normalizePageFormat,
  resolveMazePageSetup,
  contrastRatio,
  relativeLuminance,
  fitMazeHeading,
  buildMazeRenderLayout,
  renderMazePageDocuments,
  renderMazeSvg,
  iconsObstructPassages,
  containsBox,
  rectsOverlap
};
