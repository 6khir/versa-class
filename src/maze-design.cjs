'use strict';

const DESIGN_REVISION = 4;

const SHAPE_RECTANGULAR = 'rectangular';
const SHAPE_CIRCULAR = 'circular';
const SHAPE_RADIAL = 'radial';
const SHAPE_HEXAGON = 'hexagon';
const SHAPE_TRIANGULAR = 'triangular';
const SHAPE_DIAMOND = 'diamond';
const SHAPE_HEART = 'heart';
const SHAPE_STAR = 'star';
const SHAPE_CROSS = 'cross';

const SHAPES = Object.freeze([
  SHAPE_RECTANGULAR,
  SHAPE_CIRCULAR,
  SHAPE_RADIAL,
  SHAPE_HEXAGON,
  SHAPE_TRIANGULAR,
  SHAPE_DIAMOND,
  SHAPE_HEART,
  SHAPE_STAR,
  SHAPE_CROSS
]);

const LATTICE_SQUARE = 'square';
const LATTICE_HEX = 'hex';
const LATTICE_RADIAL = 'radial';
const LATTICES = Object.freeze([LATTICE_SQUARE, LATTICE_HEX, LATTICE_RADIAL]);

const ALGORITHMS = Object.freeze([
  'backtracker',
  'kruskal',
  'prim',
  'hunt_and_kill',
  'recursive_division',
  'growing_tree'
]);

const WALL_STYLES = Object.freeze(['square', 'rounded', 'ink', 'pencil']);
const FRAME_STYLES = Object.freeze(['plain', 'double', 'ornate', 'scalloped', 'ticket']);
const CELL_STYLES = Object.freeze(['square', 'circle', 'hex']);

const PALETTES = Object.freeze({
  classroom: Object.freeze({
    pageFill: '#F3F0E7', frameStroke: '#E4DFD0', panelFill: '#FFFEF9',
    wall: '#1A1F2B', solution: '#9B1C1C', text: '#1A1F2B'
  }),
  august: Object.freeze({
    pageFill: '#F8E4B8', frameStroke: '#D7B56A', panelFill: '#FFF6D8',
    wall: '#1B3A4B', solution: '#9B2C2C', text: '#1B3A4B'
  }),
  september: Object.freeze({
    pageFill: '#F0D3B0', frameStroke: '#C4925C', panelFill: '#FFF1DC',
    wall: '#3B1F14', solution: '#8A1D1D', text: '#3B1F14'
  }),
  october: Object.freeze({
    pageFill: '#E7D4C2', frameStroke: '#B08968', panelFill: '#FFF4E8',
    wall: '#2C1830', solution: '#8B1E1E', text: '#2C1830'
  }),
  november: Object.freeze({
    pageFill: '#E6CFA0', frameStroke: '#B48A3C', panelFill: '#FFF3D2',
    wall: '#3A2416', solution: '#8A2A12', text: '#3A2416'
  }),
  winter: Object.freeze({
    pageFill: '#D5E6F4', frameStroke: '#8AADC8', panelFill: '#F2F8FD',
    wall: '#1C2B3A', solution: '#8B1D2C', text: '#1C2B3A'
  }),
  january: Object.freeze({
    pageFill: '#D9E0E8', frameStroke: '#9AA7B4', panelFill: '#F4F7FA',
    wall: '#1A2330', solution: '#8E2030', text: '#1A2330'
  }),
  february: Object.freeze({
    pageFill: '#F6D4DC', frameStroke: '#D08A9A', panelFill: '#FFF0F3',
    wall: '#4A1C28', solution: '#9B1C3A', text: '#4A1C28'
  }),
  march: Object.freeze({
    pageFill: '#D4EED6', frameStroke: '#7FB086', panelFill: '#F0FBF1',
    wall: '#1E3A24', solution: '#8B2A1A', text: '#1E3A24'
  }),
  spring: Object.freeze({
    pageFill: '#DCEFBE', frameStroke: '#8FB36A', panelFill: '#F4FBE6',
    wall: '#24351F', solution: '#9A2A2A', text: '#24351F'
  }),
  april: Object.freeze({
    pageFill: '#CDE4F6', frameStroke: '#7EA8C8', panelFill: '#EEF7FE',
    wall: '#1A3344', solution: '#8B1E2C', text: '#1A3344'
  }),
  may: Object.freeze({
    pageFill: '#E8D6F0', frameStroke: '#B48CC4', panelFill: '#F8EFFC',
    wall: '#3A2148', solution: '#8B1D2C', text: '#3A2148'
  }),
  june: Object.freeze({
    pageFill: '#F3E48A', frameStroke: '#C4B03A', panelFill: '#FFF7C4',
    wall: '#2A2118', solution: '#9A2A12', text: '#2A2118'
  }),
  space: Object.freeze({
    pageFill: '#D2DAEA', frameStroke: '#8A96B0', panelFill: '#EEF1F8',
    wall: '#1A1F33', solution: '#8B1D2C', text: '#1A1F33'
  }),
  bees: Object.freeze({
    pageFill: '#F4DC7A', frameStroke: '#C4A428', panelFill: '#FFF3B8',
    wall: '#2C2410', solution: '#8A2A12', text: '#2C2410'
  }),
  school: Object.freeze({
    pageFill: '#EFE2C4', frameStroke: '#C4B48A', panelFill: '#FFF8E8',
    wall: '#1A1F2B', solution: '#9B1C1C', text: '#1A1F2B'
  })
});

const SEASONAL_RECIPES = Object.freeze({
  august: Object.freeze({
    shape: SHAPE_RECTANGULAR, algorithm: 'backtracker', paletteId: 'august',
    frameStyle: 'double', wallStyle: 'square', cellStyle: 'square', braidFactor: 0
  }),
  september: Object.freeze({
    shape: SHAPE_HEXAGON, algorithm: 'prim', paletteId: 'september',
    frameStyle: 'ornate', wallStyle: 'ink', cellStyle: 'hex', braidFactor: 0
  }),
  october: Object.freeze({
    shape: SHAPE_STAR, algorithm: 'kruskal', paletteId: 'october',
    frameStyle: 'scalloped', wallStyle: 'rounded', cellStyle: 'square', braidFactor: 0.12
  }),
  november: Object.freeze({
    shape: SHAPE_DIAMOND, algorithm: 'kruskal', paletteId: 'november',
    frameStyle: 'ticket', wallStyle: 'square', cellStyle: 'square', braidFactor: 0
  }),
  winter: Object.freeze({
    shape: SHAPE_RADIAL, algorithm: 'kruskal', paletteId: 'winter',
    frameStyle: 'double', wallStyle: 'rounded', cellStyle: 'square', braidFactor: 0.08
  }),
  january: Object.freeze({
    shape: SHAPE_CIRCULAR, algorithm: 'hunt_and_kill', paletteId: 'january',
    frameStyle: 'ornate', wallStyle: 'ink', cellStyle: 'square', braidFactor: 0
  }),
  february: Object.freeze({
    shape: SHAPE_HEART, algorithm: 'prim', paletteId: 'february',
    frameStyle: 'scalloped', wallStyle: 'rounded', cellStyle: 'square', braidFactor: 0.1
  }),
  march: Object.freeze({
    shape: SHAPE_TRIANGULAR, algorithm: 'growing_tree', paletteId: 'march',
    frameStyle: 'double', wallStyle: 'square', cellStyle: 'square', braidFactor: 0
  }),
  spring: Object.freeze({
    shape: SHAPE_CIRCULAR, algorithm: 'kruskal', paletteId: 'spring',
    frameStyle: 'ornate', wallStyle: 'rounded', cellStyle: 'square', braidFactor: 0.08
  }),
  april: Object.freeze({
    shape: SHAPE_HEXAGON, algorithm: 'backtracker', paletteId: 'april',
    frameStyle: 'ticket', wallStyle: 'ink', cellStyle: 'hex', braidFactor: 0
  }),
  may: Object.freeze({
    shape: SHAPE_STAR, algorithm: 'hunt_and_kill', paletteId: 'may',
    frameStyle: 'scalloped', wallStyle: 'rounded', cellStyle: 'square', braidFactor: 0
  }),
  june: Object.freeze({
    shape: SHAPE_CROSS, algorithm: 'recursive_division', paletteId: 'june',
    frameStyle: 'double', wallStyle: 'square', cellStyle: 'square', braidFactor: 0.05
  })
});

const ROTATING_RECIPES = Object.freeze([
  Object.freeze({
    shape: SHAPE_RECTANGULAR, algorithm: 'backtracker', wallStyle: 'square',
    frameStyle: 'double', cellStyle: 'square', braidFactor: 0, density: 'standard'
  }),
  Object.freeze({
    shape: SHAPE_CIRCULAR, algorithm: 'kruskal', wallStyle: 'rounded',
    frameStyle: 'ornate', cellStyle: 'square', braidFactor: 0, density: 'roomy'
  }),
  Object.freeze({
    shape: SHAPE_HEXAGON, algorithm: 'prim', wallStyle: 'ink',
    frameStyle: 'ticket', cellStyle: 'hex', braidFactor: 0, density: 'standard'
  }),
  Object.freeze({
    shape: SHAPE_TRIANGULAR, algorithm: 'hunt_and_kill', wallStyle: 'square',
    frameStyle: 'scalloped', cellStyle: 'square', braidFactor: 0, density: 'tight'
  }),
  Object.freeze({
    shape: SHAPE_RADIAL, algorithm: 'kruskal', wallStyle: 'rounded',
    frameStyle: 'double', cellStyle: 'square', braidFactor: 0.1, density: 'standard'
  }),
  Object.freeze({
    shape: SHAPE_DIAMOND, algorithm: 'recursive_division', wallStyle: 'ink',
    frameStyle: 'ornate', cellStyle: 'square', braidFactor: 0, density: 'roomy'
  }),
  Object.freeze({
    shape: SHAPE_HEART, algorithm: 'growing_tree', wallStyle: 'rounded',
    frameStyle: 'scalloped', cellStyle: 'square', braidFactor: 0.1, density: 'standard'
  }),
  Object.freeze({
    shape: SHAPE_STAR, algorithm: 'prim', wallStyle: 'pencil',
    frameStyle: 'ticket', cellStyle: 'square', braidFactor: 0, density: 'tight'
  }),
  Object.freeze({
    shape: SHAPE_CROSS, algorithm: 'backtracker', wallStyle: 'ink',
    frameStyle: 'double', cellStyle: 'square', braidFactor: 0.08, density: 'standard'
  })
]);

const START_BIASES = Object.freeze([
  'random', 'north', 'south', 'west', 'east', 'north', 'east', 'south'
]);

function defaultMazeDesign() {
  return {
    revision: DESIGN_REVISION,
    wallStyle: 'square',
    frameStyle: 'plain',
    paletteId: 'classroom',
    cellStyle: 'square'
  };
}

function latticeForShape(shape) {
  if (shape === SHAPE_HEXAGON) return LATTICE_HEX;
  if (shape === SHAPE_RADIAL) return LATTICE_RADIAL;
  return LATTICE_SQUARE;
}

function resolvePalette(id) {
  return PALETTES[id] || PALETTES.classroom;
}

function paletteForKeyword(keyword, title = '') {
  const text = `${keyword || ''} ${title || ''}`.toLowerCase();
  if (/space|rocket|planet/.test(text)) return 'space';
  if (/\bbees?\b|honey/.test(text)) return 'bees';
  if (/school/.test(text)) return 'school';
  for (const key of Object.keys(SEASONAL_RECIPES)) {
    if (text.includes(key)) return key;
  }
  return 'classroom';
}

function recipeFromTitle(title) {
  const lower = String(title || '').toLowerCase();
  for (const [key, recipe] of Object.entries(SEASONAL_RECIPES)) {
    if (lower.includes(key)) return { ...recipe, season: key };
  }
  return null;
}

function sanitizeShape(value, fallback = SHAPE_RECTANGULAR) {
  return SHAPES.includes(value) ? value : fallback;
}

function sanitizeAlgorithm(value, fallback = 'backtracker') {
  return ALGORITHMS.includes(value) ? value : fallback;
}

function sanitizeLattice(value, fallback = LATTICE_SQUARE) {
  return LATTICES.includes(value) ? value : fallback;
}

function sanitizeWallStyle(value, fallback = 'square') {
  return WALL_STYLES.includes(value) ? value : fallback;
}

function sanitizeFrameStyle(value, fallback = 'plain') {
  return FRAME_STYLES.includes(value) ? value : fallback;
}

function sanitizeCellStyle(value, fallback = 'square') {
  return CELL_STYLES.includes(value) ? value : fallback;
}

function coerceDesign(value) {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    revision: Number.isSafeInteger(incoming.revision) ? incoming.revision : DESIGN_REVISION,
    wallStyle: sanitizeWallStyle(incoming.wallStyle),
    frameStyle: sanitizeFrameStyle(incoming.frameStyle),
    paletteId: Object.hasOwn(PALETTES, incoming.paletteId) ? incoming.paletteId : 'classroom',
    cellStyle: sanitizeCellStyle(incoming.cellStyle)
  };
}

function planMazePageDesign(input = {}) {
  const sequenceIndex = Number.isSafeInteger(input.sequenceIndex) && input.sequenceIndex > 0
    ? input.sequenceIndex
    : 1;
  const rotating = ROTATING_RECIPES[(sequenceIndex - 1) % ROTATING_RECIPES.length];
  const seasonal = recipeFromTitle(input.title);
  const keyword = String(input.keyword || '').toLowerCase();
  const honorShape = SHAPES.includes(input.shape) && input.shape !== SHAPE_RECTANGULAR
    ? input.shape
    : null;
  const picked = seasonal || rotating;
  const shape = honorShape || picked.shape;
  const algorithm = sanitizeAlgorithm(input.algorithm || picked.algorithm);
  const paletteIds = Object.keys(PALETTES);
  const themed = paletteForKeyword(keyword, input.title);
  const themeIndex = Math.max(0, paletteIds.indexOf(themed));
  const rotatedPalette = paletteIds[(themeIndex + sequenceIndex - 1) % paletteIds.length];
  const paletteId = input.paletteId || (seasonal ? seasonal.paletteId : rotatedPalette);
  const braidFactor = Number.isFinite(input.braidFactor)
    ? Math.max(0, Math.min(0.35, input.braidFactor))
    : (picked.braidFactor || 0);
  const wallStyle = sanitizeWallStyle(input.wallStyle || picked.wallStyle);
  const frameStyle = sanitizeFrameStyle(input.frameStyle || picked.frameStyle);
  const cellStyle = shape === SHAPE_HEXAGON
    ? 'hex'
    : sanitizeCellStyle(input.cellStyle || picked.cellStyle);
  const density = input.density || picked.density || 'standard';
  const startBias = input.startBias || START_BIASES[(sequenceIndex - 1) % START_BIASES.length];
  const lattice = sanitizeLattice(input.lattice || latticeForShape(shape));
  return {
    shape,
    lattice,
    algorithm,
    braidFactor,
    density,
    startBias,
    wallScale: density === 'tight' ? 0.82 : density === 'roomy' ? 1.18 : 1,
    design: {
      revision: DESIGN_REVISION,
      wallStyle,
      frameStyle,
      paletteId,
      cellStyle
    }
  };
}

function pageNeedsDesignRefresh(page) {
  if (!page || page.generationStatus !== 'ready' || !page.topology) return true;
  return page.topology.design?.revision !== DESIGN_REVISION;
}

function mazePagesLookDiverse(pages) {
  const interiors = (Array.isArray(pages) ? pages : [])
    .filter((page) => page && page.topology);
  if (interiors.length < 2) return interiors.length < 2;
  const shapes = new Set(interiors.map((page) => page.topology.shape || page.shape));
  const algorithms = new Set(interiors.map((page) => page.topology.algorithm || 'backtracker'));
  const lattices = new Set(interiors.map((page) => page.topology.lattice || LATTICE_SQUARE));
  return shapes.size > 1 || algorithms.size > 1 || lattices.size > 1;
}

function designFingerprint(topology) {
  if (!topology) return '';
  return [
    topology.shape,
    topology.lattice,
    topology.algorithm,
    topology.design?.wallStyle,
    topology.design?.frameStyle,
    topology.design?.paletteId,
    topology.design?.cellStyle,
    topology.rows,
    topology.cols,
    topology.stats?.solutionLength,
    topology.stats?.deadEndCount,
    topology.entrance?.side,
    topology.exit?.side
  ].join('|');
}

function activeMaskCount(mask) {
  if (!mask) return 0;
  let count = 0;
  for (const row of mask) {
    for (const cell of row) {
      if (cell) count += 1;
    }
  }
  return count;
}

function largestMaskComponent(mask, orthogonal = true) {
  const rows = mask.length;
  const cols = mask[0]?.length || 0;
  const seen = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const deltas = orthogonal
    ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
    : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  let best = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!mask[row][col] || seen[row][col]) continue;
      const stack = [[row, col]];
      const cells = [];
      seen[row][col] = true;
      while (stack.length) {
        const [r, c] = stack.pop();
        cells.push([r, c]);
        for (const [dr, dc] of deltas) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (!mask[nr][nc] || seen[nr][nc]) continue;
          seen[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
      if (cells.length > best.length) best = cells;
    }
  }
  const next = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  for (const [row, col] of best) next[row][col] = true;
  return next;
}

function bridgeDiagonalMask(mask) {
  const rows = mask.length;
  const cols = mask[0]?.length || 0;
  const next = mask.map((row) => row.slice());
  const cy = (rows - 1) / 2;
  const cx = (cols - 1) / 2;
  const closer = (rowA, colA, rowB, colB) => {
    const da = Math.abs(rowA - cy) + Math.abs(colA - cx);
    const db = Math.abs(rowB - cy) + Math.abs(colB - cx);
    return da <= db ? [rowA, colA] : [rowB, colB];
  };
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = next[row][col];
      const b = next[row + 1][col + 1];
      const c = next[row][col + 1];
      const d = next[row + 1][col];
      if (a && b && !c && !d) {
        const [br, bc] = closer(row, col + 1, row + 1, col);
        next[br][bc] = true;
      }
      if (c && d && !a && !b) {
        const [br, bc] = closer(row, col, row + 1, col + 1);
        next[br][bc] = true;
      }
    }
  }
  return next;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, prev = points.length - 1; index < points.length; prev = index, index += 1) {
    const xi = points[index][0];
    const yi = points[index][1];
    const xj = points[prev][0];
    const yj = points[prev][1];
    const denom = (yj - yi) || 1e-12;
    const crosses = ((yi > y) !== (yj > y)) && (x < (((xj - xi) * (y - yi)) / denom) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

const STAR_VERTICES = Object.freeze((() => {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? 1.06 : 0.40;
    const angle = (index * Math.PI / 5) - (Math.PI / 2);
    points.push(Object.freeze([radius * Math.cos(angle), radius * Math.sin(angle)]));
  }
  return points;
})());

function shapeContains(shape, x, y) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (shape === SHAPE_CIRCULAR) return (x * x) + (y * y) <= 1.08;
  if (shape === SHAPE_DIAMOND) return ax + ay <= 1.08;
  if (shape === SHAPE_TRIANGULAR) {
    return y <= 1.02 && y >= -1.05 && y >= ((1.85 * ax) - 1.02);
  }
  if (shape === SHAPE_CROSS) return (ax <= 0.38 && ay <= 1.05) || (ay <= 0.38 && ax <= 1.05);
  if (shape === SHAPE_HEART) {
    const hx = x * 1.2;
    const hy = -y * 1.15 + 0.18;
    const n = (hx * hx) + (hy * hy) - 1;
    return (n * n * n) - (hx * hx * hy * hy * hy) <= 0;
  }
  if (shape === SHAPE_STAR) {
    return pointInPolygon(x, y, STAR_VERTICES);
  }
  if (shape === SHAPE_HEXAGON) {
    return ay <= 1.02 && ax <= 1.02 && ((ax * 0.577) + ay) <= 1.02;
  }
  return true;
}

function buildShapeMask(shape, rows, cols) {
  const mask = Array.from({ length: rows }, () => Array.from({ length: cols }, () => true));
  if (!shape || shape === SHAPE_RECTANGULAR || shape === SHAPE_RADIAL) {
    return mask;
  }
  const cy = (rows - 1) / 2;
  const cx = (cols - 1) / 2;
  const ry = Math.max(rows / 2, 0.5);
  const rx = Math.max(cols / 2, 0.5);
  const sample = shape === SHAPE_STAR || shape === SHAPE_HEART
    ? [[0, 0], [-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32], [0, -0.36], [0, 0.36]]
    : [[0, 0]];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const y = (row - cy) / ry;
      const x = (col - cx) / rx;
      mask[row][col] = sample.some(([dx, dy]) => shapeContains(shape, x + (dx / rx), y + (dy / ry)));
    }
  }
  const linked = shape === SHAPE_STAR || shape === SHAPE_HEART
    ? largestMaskComponent(bridgeDiagonalMask(largestMaskComponent(mask, false)))
    : largestMaskComponent(mask);
  const active = activeMaskCount(linked);
  const minimum = Math.max(8, Math.floor(rows * cols * (shape === SHAPE_STAR ? 0.18 : 0.28)));
  if (active >= minimum) return linked;
  if (shape !== SHAPE_CIRCULAR) return buildShapeMask(SHAPE_CIRCULAR, rows, cols);
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => true));
}

function isActiveCell(mask, row, col) {
  if (!mask) return true;
  return Boolean(mask[row]?.[col]);
}

function hexNeighborOffsets(row) {
  const odd = row & 1;
  return [
    { dr: 0, dc: 1, wall: 'east', fromSelf: true, corners: [0, 1] },
    { dr: 0, dc: -1, wall: 'east', fromSelf: false, corners: [3, 4] },
    { dr: -1, dc: odd ? 1 : 0, wall: 'northEast', fromSelf: true, corners: [5, 0] },
    { dr: -1, dc: odd ? 0 : -1, wall: 'northWest', fromSelf: true, corners: [4, 5] },
    { dr: 1, dc: odd ? 1 : 0, wall: 'northWest', fromSelf: false, corners: [1, 2] },
    { dr: 1, dc: odd ? 0 : -1, wall: 'northEast', fromSelf: false, corners: [2, 3] }
  ];
}

function hexOpeningOffset(opening, rows, cols, mask) {
  if (!opening || !Number.isInteger(opening.row) || !Number.isInteger(opening.col)) return null;
  const offsets = hexNeighborOffsets(opening.row);
  const outside = offsets.filter((offset) => {
    const nr = opening.row + offset.dr;
    const nc = opening.col + offset.dc;
    return nr < 0 || nc < 0 || nr >= rows || nc >= cols || !isActiveCell(mask, nr, nc);
  });
  if (!outside.length) return null;
  const preferred = outside.filter((offset) => {
    if (opening.side === 'north') return offset.dr < 0;
    if (opening.side === 'south') return offset.dr > 0;
    if (opening.side === 'west') return offset.dc < 0;
    if (opening.side === 'east') return offset.dc > 0;
    return false;
  });
  return preferred[0] || outside[0];
}

function isHexOpeningWall(topology, row, col, offset) {
  const openings = [topology?.entrance, topology?.exit];
  return openings.some((opening) => {
    if (!opening || opening.row !== row || opening.col !== col) return false;
    const picked = hexOpeningOffset(opening, topology.rows, topology.cols, topology.cellMask);
    return Boolean(
      picked
      && picked.dr === offset.dr
      && picked.dc === offset.dc
      && picked.wall === offset.wall
    );
  });
}

function fmt(value) {
  const rounded = Number(Number(value).toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function frameMarkup(style, page, colors) {
  const width = page.width;
  const height = page.height;
  const stroke = colors.frameStroke;
  const ink = colors.wall;
  if (style === 'double') {
    return [
      `<rect x="12" y="12" width="${fmt(width - 24)}" height="${fmt(height - 24)}" fill="none" stroke="${stroke}" stroke-width="2" rx="10"/>`,
      `<rect x="20" y="20" width="${fmt(width - 40)}" height="${fmt(height - 40)}" fill="none" stroke="${stroke}" stroke-width="1.25" rx="6"/>`
    ].join('');
  }
  if (style === 'ornate') {
    const corners = [
      [18, 18, 1, 1],
      [width - 18, 18, -1, 1],
      [18, height - 18, 1, -1],
      [width - 18, height - 18, -1, -1]
    ];
    const flourishes = corners.map(([x, y, sx, sy]) => (
      `<path fill="none" stroke="${ink}" stroke-width="1.4" d="M ${fmt(x)} ${fmt(y + (28 * sy))} L ${fmt(x)} ${fmt(y)} L ${fmt(x + (28 * sx))} ${fmt(y)}"/>`
    )).join('');
    return [
      `<rect x="12" y="12" width="${fmt(width - 24)}" height="${fmt(height - 24)}" fill="none" stroke="${stroke}" stroke-width="2" rx="4"/>`,
      `<rect x="22" y="22" width="${fmt(width - 44)}" height="${fmt(height - 44)}" fill="none" stroke="${stroke}" stroke-width="1" rx="2"/>`,
      flourishes
    ].join('');
  }
  if (style === 'scalloped') {
    const arcs = [];
    const step = 18;
    for (let x = 24; x < width - 24; x += step) {
      arcs.push(`M ${fmt(x)} 16 A 8 8 0 0 1 ${fmt(Math.min(width - 24, x + step))} 16`);
      arcs.push(`M ${fmt(x)} ${fmt(height - 16)} A 8 8 0 0 0 ${fmt(Math.min(width - 24, x + step))} ${fmt(height - 16)}`);
    }
    for (let y = 24; y < height - 24; y += step) {
      arcs.push(`M 16 ${fmt(y)} A 8 8 0 0 0 16 ${fmt(Math.min(height - 24, y + step))}`);
      arcs.push(`M ${fmt(width - 16)} ${fmt(y)} A 8 8 0 0 1 ${fmt(width - 16)} ${fmt(Math.min(height - 24, y + step))}`);
    }
    return [
      `<rect x="10" y="10" width="${fmt(width - 20)}" height="${fmt(height - 20)}" fill="none" stroke="${stroke}" stroke-width="1.5" rx="14"/>`,
      `<path fill="none" stroke="${stroke}" stroke-width="1.2" d="${arcs.join(' ')}"/>`
    ].join('');
  }
  if (style === 'ticket') {
    return [
      `<rect x="14" y="14" width="${fmt(width - 28)}" height="${fmt(height - 28)}" fill="none" stroke="${stroke}" stroke-width="2" rx="3" stroke-dasharray="7 5"/>`,
      `<circle cx="14" cy="${fmt(height / 2)}" r="7" fill="${colors.pageFill}" stroke="${stroke}" stroke-width="1.5"/>`,
      `<circle cx="${fmt(width - 14)}" cy="${fmt(height / 2)}" r="7" fill="${colors.pageFill}" stroke="${stroke}" stroke-width="1.5"/>`
    ].join('');
  }
  return `<rect x="12" y="12" width="${fmt(width - 24)}" height="${fmt(height - 24)}" fill="none" stroke="${stroke}" stroke-width="2" rx="8"/>`;
}

function wallStrokeAttrs(style) {
  if (style === 'rounded' || style === 'ink') {
    return { linecap: 'round', linejoin: 'round', scale: style === 'ink' ? 1.28 : 1 };
  }
  if (style === 'pencil') {
    return { linecap: 'butt', linejoin: 'miter', scale: 0.72 };
  }
  return { linecap: 'square', linejoin: 'miter', scale: 1 };
}

function designLabel(page) {
  const shape = page?.topology?.shape || page?.shape || '';
  const algorithm = page?.topology?.algorithm || '';
  const parts = [];
  if (shape) parts.push(String(shape).replace(/_/g, ' '));
  if (algorithm) parts.push(String(algorithm).replace(/_/g, ' '));
  return parts.join(' · ');
}

module.exports = {
  DESIGN_REVISION,
  SHAPE_RECTANGULAR,
  SHAPE_CIRCULAR,
  SHAPE_RADIAL,
  SHAPE_HEXAGON,
  SHAPE_TRIANGULAR,
  SHAPE_DIAMOND,
  SHAPE_HEART,
  SHAPE_STAR,
  SHAPE_CROSS,
  SHAPES,
  LATTICE_SQUARE,
  LATTICE_HEX,
  LATTICE_RADIAL,
  LATTICES,
  ALGORITHMS,
  WALL_STYLES,
  FRAME_STYLES,
  CELL_STYLES,
  PALETTES,
  SEASONAL_RECIPES,
  ROTATING_RECIPES,
  defaultMazeDesign,
  latticeForShape,
  resolvePalette,
  paletteForKeyword,
  recipeFromTitle,
  sanitizeShape,
  sanitizeAlgorithm,
  sanitizeLattice,
  coerceDesign,
  planMazePageDesign,
  pageNeedsDesignRefresh,
  mazePagesLookDiverse,
  designFingerprint,
  activeMaskCount,
  buildShapeMask,
  isActiveCell,
  frameMarkup,
  wallStrokeAttrs,
  designLabel,
  hexNeighborOffsets,
  hexOpeningOffset,
  isHexOpeningWall
};
