'use strict';

const {
  SCHEMA_VERSION,
  ENGINE_TYPE,
  SHAPE_RECTANGULAR,
  SIDES,
  MIN_MAZE_SIZE,
  MAX_MAZE_SIZE,
  DEFAULT_MAZE_PANEL,
  createMazePageId,
  mazeExtent,
  resolveMazeGenerationSpec,
  validateMazeConfig,
  validateMazeResult,
  validateMazeValidationResult,
  defaultMazeDesign,
  coerceTopology
} = require('./maze-contract.cjs');
const {
  LATTICE_SQUARE,
  LATTICE_HEX,
  LATTICE_RADIAL,
  buildShapeMask,
  isActiveCell,
  activeMaskCount,
  planMazePageDesign,
  sanitizeShape,
  sanitizeAlgorithm,
  sanitizeLattice,
  coerceDesign,
  latticeForShape,
  hexOpeningOffset
} = require('./maze-design.cjs');

const DIRS = Object.freeze([
  Object.freeze({ side: 'north', dr: -1, dc: 0 }),
  Object.freeze({ side: 'east', dr: 0, dc: 1 }),
  Object.freeze({ side: 'south', dr: 1, dc: 0 }),
  Object.freeze({ side: 'west', dr: 0, dc: -1 })
]);

function hashSeed(seed) {
  let hash = 2166136261;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRng(seed) {
  let state = hashSeed(seed);
  if (state === 0) state = 0x9E3779B9;
  return function next() {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function resolveMazeSeed(config) {
  const raw = String(config.seed || '');
  if (raw) return raw;
  return [
    'maze',
    config.project.id,
    config.difficultyTier,
    config.ageBand,
    config.keyword,
    config.startAssetId || '',
    config.endAssetId || '',
    config.title
  ].join(':');
}

function attemptSeed(base, attempt) {
  return attempt === 0 ? base : `${base}#${attempt}`;
}

function grid(rows, cols, fill) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

function cloneGrid(value) {
  if (!value) return null;
  return value.map((row) => row.slice());
}

function cellKey(row, col) {
  return `${row},${col}`;
}

function isInside(row, col, rows, cols) {
  return row >= 0 && row < rows && col >= 0 && col < cols;
}

function shuffleInPlace(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const temp = items[index];
    items[index] = items[swap];
    items[swap] = temp;
  }
  return items;
}

function pickItem(items, rng) {
  return items[Math.floor(rng() * items.length)];
}

function closedSquareWalls(rows, cols) {
  return {
    horizontalWalls: grid(rows + 1, cols, true),
    verticalWalls: grid(rows, cols + 1, true)
  };
}

function setExteriorWall(horizontalWalls, verticalWalls, opening, rows, cols, closed) {
  const { row, col, side } = opening;
  if (side === 'north') horizontalWalls[0][col] = closed;
  else if (side === 'south') horizontalWalls[rows][col] = closed;
  else if (side === 'west') verticalWalls[row][0] = closed;
  else verticalWalls[row][cols] = closed;
}

function setOpeningWall(horizontalWalls, verticalWalls, opening, closed) {
  const { row, col, side } = opening;
  if (side === 'north') horizontalWalls[row][col] = closed;
  else if (side === 'south') horizontalWalls[row + 1][col] = closed;
  else if (side === 'west') verticalWalls[row][col] = closed;
  else verticalWalls[row][col + 1] = closed;
}

function carveInternal(horizontalWalls, verticalWalls, from, to) {
  if (from.row === to.row && to.col === from.col + 1) verticalWalls[from.row][from.col + 1] = false;
  else if (from.row === to.row && to.col === from.col - 1) verticalWalls[from.row][from.col] = false;
  else if (from.col === to.col && to.row === from.row + 1) horizontalWalls[from.row + 1][from.col] = false;
  else if (from.col === to.col && to.row === from.row - 1) horizontalWalls[from.row][from.col] = false;
}

function isInternalOpen(horizontalWalls, verticalWalls, row, col, side, rows, cols) {
  if (side === 'north') return row > 0 && !horizontalWalls[row][col];
  if (side === 'south') return row < rows - 1 && !horizontalWalls[row + 1][col];
  if (side === 'west') return col > 0 && !verticalWalls[row][col];
  return col < cols - 1 && !verticalWalls[row][col + 1];
}

function isExteriorOpen(horizontalWalls, verticalWalls, opening, rows, cols) {
  const { row, col, side } = opening;
  if (side === 'north') return row === 0 && !horizontalWalls[0][col];
  if (side === 'south') return row === rows - 1 && !horizontalWalls[rows][col];
  if (side === 'west') return col === 0 && !verticalWalls[row][0];
  return col === cols - 1 && !verticalWalls[row][cols];
}

function isGridEdgeOpening(opening, rows, cols) {
  if (opening.side === 'north') return opening.row === 0;
  if (opening.side === 'south') return opening.row === rows - 1;
  if (opening.side === 'west') return opening.col === 0;
  return opening.col === cols - 1;
}

function neighbors(horizontalWalls, verticalWalls, row, col, rows, cols, mask = null) {
  const next = [];
  for (const dir of DIRS) {
    const nr = row + dir.dr;
    const nc = col + dir.dc;
    if (!isInside(nr, nc, rows, cols) || !isActiveCell(mask, nr, nc)) continue;
    if (isInternalOpen(horizontalWalls, verticalWalls, row, col, dir.side, rows, cols)) {
      next.push({ row: nr, col: nc, side: dir.side });
    }
  }
  return next;
}

function unvisitedSquareNeighbors(current, visited, mask, rows, cols) {
  const choices = [];
  for (const dir of DIRS) {
    const row = current.row + dir.dr;
    const col = current.col + dir.dc;
    if (isInside(row, col, rows, cols) && isActiveCell(mask, row, col) && !visited[row][col]) {
      choices.push({ row, col });
    }
  }
  return choices;
}

function maskPerimeterSlots(mask, rows, cols) {
  const slots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!isActiveCell(mask, row, col)) continue;
      for (const dir of DIRS) {
        const nr = row + dir.dr;
        const nc = col + dir.dc;
        const outside = !isInside(nr, nc, rows, cols) || !isActiveCell(mask, nr, nc);
        if (outside) slots.push({ row, col, side: dir.side });
      }
    }
  }
  return slots;
}

function pickBiasedSlot(slots, rng, bias) {
  if (!slots.length) return null;
  if (bias && bias !== 'random') {
    const preferred = slots.filter((slot) => slot.side === bias);
    if (preferred.length) return pickItem(preferred, rng);
  }
  return pickItem(slots, rng);
}

function carveBacktracker(rows, cols, mask, entrance, rng) {
  const walls = closedSquareWalls(rows, cols);
  const visited = grid(rows, cols, false);
  const stack = [{ row: entrance.row, col: entrance.col }];
  visited[entrance.row][entrance.col] = true;

  while (stack.length) {
    const current = stack[stack.length - 1];
    const choices = unvisitedSquareNeighbors(current, visited, mask, rows, cols);
    if (!choices.length) {
      stack.pop();
      continue;
    }
    const next = pickItem(choices, rng);
    carveInternal(walls.horizontalWalls, walls.verticalWalls, current, next);
    visited[next.row][next.col] = true;
    stack.push(next);
  }
  return walls;
}

function carveGrowingTree(rows, cols, mask, entrance, rng) {
  const walls = closedSquareWalls(rows, cols);
  const visited = grid(rows, cols, false);
  const cells = [{ row: entrance.row, col: entrance.col }];
  visited[entrance.row][entrance.col] = true;
  while (cells.length) {
    const index = rng() < 0.72 ? cells.length - 1 : Math.floor(rng() * cells.length);
    const current = cells[index];
    const choices = unvisitedSquareNeighbors(current, visited, mask, rows, cols);
    if (!choices.length) {
      cells.splice(index, 1);
      continue;
    }
    const next = pickItem(choices, rng);
    carveInternal(walls.horizontalWalls, walls.verticalWalls, current, next);
    visited[next.row][next.col] = true;
    cells.push(next);
  }
  return walls;
}

function carveHuntAndKill(rows, cols, mask, entrance, rng) {
  const walls = closedSquareWalls(rows, cols);
  const visited = grid(rows, cols, false);
  let current = { row: entrance.row, col: entrance.col };
  visited[current.row][current.col] = true;
  const remaining = () => {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (isActiveCell(mask, row, col) && !visited[row][col]) return true;
      }
    }
    return false;
  };
  while (remaining()) {
    const choices = unvisitedSquareNeighbors(current, visited, mask, rows, cols);
    if (choices.length) {
      const next = pickItem(choices, rng);
      carveInternal(walls.horizontalWalls, walls.verticalWalls, current, next);
      visited[next.row][next.col] = true;
      current = next;
      continue;
    }
    let hunted = null;
    for (let row = 0; row < rows && !hunted; row += 1) {
      for (let col = 0; col < cols && !hunted; col += 1) {
        if (!isActiveCell(mask, row, col) || visited[row][col]) continue;
        const visitedNeighbors = DIRS
          .map((dir) => ({ row: row + dir.dr, col: col + dir.dc }))
          .filter((cell) => isInside(cell.row, cell.col, rows, cols)
            && isActiveCell(mask, cell.row, cell.col)
            && visited[cell.row][cell.col]);
        if (!visitedNeighbors.length) continue;
        const from = pickItem(visitedNeighbors, rng);
        carveInternal(walls.horizontalWalls, walls.verticalWalls, from, { row, col });
        visited[row][col] = true;
        hunted = { row, col };
      }
    }
    if (!hunted) break;
    current = hunted;
  }
  return walls;
}

function carveKruskal(rows, cols, mask, rng) {
  const walls = closedSquareWalls(rows, cols);
  const parent = new Map();
  const find = (key) => {
    let current = key;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const edges = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!isActiveCell(mask, row, col)) continue;
      const key = cellKey(row, col);
      parent.set(key, key);
      if (col + 1 < cols && isActiveCell(mask, row, col + 1)) {
        edges.push({ from: { row, col }, to: { row, col: col + 1 } });
      }
      if (row + 1 < rows && isActiveCell(mask, row + 1, col)) {
        edges.push({ from: { row, col }, to: { row: row + 1, col } });
      }
    }
  }
  shuffleInPlace(edges, rng);
  for (const edge of edges) {
    const left = find(cellKey(edge.from.row, edge.from.col));
    const right = find(cellKey(edge.to.row, edge.to.col));
    if (left === right) continue;
    parent.set(left, right);
    carveInternal(walls.horizontalWalls, walls.verticalWalls, edge.from, edge.to);
  }
  return walls;
}

function carvePrim(rows, cols, mask, entrance, rng) {
  const walls = closedSquareWalls(rows, cols);
  const visited = grid(rows, cols, false);
  visited[entrance.row][entrance.col] = true;
  const frontier = [];
  const addFrontier = (cell) => {
    for (const next of unvisitedSquareNeighbors(cell, visited, mask, rows, cols)) {
      frontier.push({ from: cell, to: next });
    }
  };
  addFrontier(entrance);
  while (frontier.length) {
    const index = Math.floor(rng() * frontier.length);
    const edge = frontier.splice(index, 1)[0];
    if (visited[edge.to.row][edge.to.col]) continue;
    carveInternal(walls.horizontalWalls, walls.verticalWalls, edge.from, edge.to);
    visited[edge.to.row][edge.to.col] = true;
    addFrontier(edge.to);
  }
  return walls;
}

function carveRecursiveDivision(rows, cols, mask, rng) {
  const horizontalWalls = grid(rows + 1, cols, false);
  const verticalWalls = grid(rows, cols + 1, false);
  for (let col = 0; col < cols; col += 1) {
    horizontalWalls[0][col] = true;
    horizontalWalls[rows][col] = true;
  }
  for (let row = 0; row < rows; row += 1) {
    verticalWalls[row][0] = true;
    verticalWalls[row][cols] = true;
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (isActiveCell(mask, row, col)) {
        for (const dir of DIRS) {
          const nr = row + dir.dr;
          const nc = col + dir.dc;
          if (isInside(nr, nc, rows, cols) && isActiveCell(mask, nr, nc)) continue;
          if (dir.side === 'north') horizontalWalls[row][col] = true;
          else if (dir.side === 'south') horizontalWalls[row + 1][col] = true;
          else if (dir.side === 'west') verticalWalls[row][col] = true;
          else verticalWalls[row][col + 1] = true;
        }
      } else {
        horizontalWalls[row][col] = true;
        horizontalWalls[row + 1][col] = true;
        verticalWalls[row][col] = true;
        verticalWalls[row][col + 1] = true;
      }
    }
  }
  const divide = (r1, c1, r2, c2) => {
    const height = r2 - r1;
    const width = c2 - c1;
    if (height < 2 || width < 2) return;
    const horizontal = height > width || (height === width && rng() >= 0.5);
    if (horizontal) {
      const wallRow = r1 + 1 + Math.floor(rng() * (height - 1));
      const gapCol = c1 + Math.floor(rng() * width);
      for (let col = c1; col < c2; col += 1) {
        if (col === gapCol) continue;
        if (isActiveCell(mask, wallRow - 1, col) && isActiveCell(mask, wallRow, col)) {
          horizontalWalls[wallRow][col] = true;
        }
      }
      divide(r1, c1, wallRow, c2);
      divide(wallRow, c1, r2, c2);
      return;
    }
    const wallCol = c1 + 1 + Math.floor(rng() * (width - 1));
    const gapRow = r1 + Math.floor(rng() * height);
    for (let row = r1; row < r2; row += 1) {
      if (row === gapRow) continue;
      if (isActiveCell(mask, row, wallCol - 1) && isActiveCell(mask, row, wallCol)) {
        verticalWalls[row][wallCol] = true;
      }
    }
    divide(r1, c1, r2, wallCol);
    divide(r1, wallCol, r2, c2);
  };
  divide(0, 0, rows, cols);
  return { horizontalWalls, verticalWalls };
}

function carveSquare(algorithm, rows, cols, mask, entrance, rng) {
  const fullMask = !mask || activeMaskCount(mask) === rows * cols;
  const resolved = algorithm === 'recursive_division' && !fullMask ? 'kruskal' : algorithm;
  if (resolved === 'kruskal') return carveKruskal(rows, cols, mask, rng);
  if (resolved === 'prim') return carvePrim(rows, cols, mask, entrance, rng);
  if (resolved === 'hunt_and_kill') return carveHuntAndKill(rows, cols, mask, entrance, rng);
  if (resolved === 'recursive_division') return carveRecursiveDivision(rows, cols, mask, rng);
  if (resolved === 'growing_tree') return carveGrowingTree(rows, cols, mask, entrance, rng);
  return carveBacktracker(rows, cols, mask, entrance, rng);
}

function braidSquare(walls, mask, rows, cols, entrance, exit, factor, rng) {
  if (factor <= 0) return;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!isActiveCell(mask, row, col)) continue;
      if (row === entrance.row && col === entrance.col) continue;
      if (row === exit.row && col === exit.col) continue;
      if (neighbors(walls.horizontalWalls, walls.verticalWalls, row, col, rows, cols, mask).length !== 1) continue;
      if (rng() > factor) continue;
      const blocked = [];
      for (const dir of DIRS) {
        const nr = row + dir.dr;
        const nc = col + dir.dc;
        if (!isInside(nr, nc, rows, cols) || !isActiveCell(mask, nr, nc)) continue;
        if (!isInternalOpen(walls.horizontalWalls, walls.verticalWalls, row, col, dir.side, rows, cols)) {
          blocked.push({ row: nr, col: nc });
        }
      }
      if (blocked.length) carveInternal(walls.horizontalWalls, walls.verticalWalls, { row, col }, pickItem(blocked, rng));
    }
  }
}

function bfs(horizontalWalls, verticalWalls, start, rows, cols, mask = null) {
  const dist = grid(rows, cols, -1);
  const parent = grid(rows, cols, null);
  const queue = [{ row: start.row, col: start.col }];
  dist[start.row][start.col] = 0;
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const next of neighbors(horizontalWalls, verticalWalls, current.row, current.col, rows, cols, mask)) {
      if (dist[next.row][next.col] >= 0) continue;
      dist[next.row][next.col] = dist[current.row][current.col] + 1;
      parent[next.row][next.col] = current;
      queue.push({ row: next.row, col: next.col });
    }
  }
  return { dist, parent, visitedCount: queue.length };
}

function reconstructPath(parent, start, end) {
  const path = [];
  let current = { row: end.row, col: end.col };
  while (current) {
    path.push({ row: current.row, col: current.col });
    if (current.row === start.row && current.col === start.col) break;
    current = parent[current.row][current.col];
  }
  path.reverse();
  if (!path.length || path[0].row !== start.row || path[0].col !== start.col) return [];
  return path;
}

function manhattan(left, right) {
  return Math.abs(left.row - right.row) + Math.abs(left.col - right.col);
}

function compareSlots(left, right) {
  return left.row - right.row
    || left.col - right.col
    || SIDES.indexOf(left.side) - SIDES.indexOf(right.side);
}

function pickDistantExit(dist, entrance, slots, minDistance, distanceFn) {
  const reachable = slots.filter((slot) => (
    !(slot.row === entrance.row && slot.col === entrance.col)
    && dist[slot.row][slot.col] >= 0
  ));
  const measure = distanceFn || manhattan;
  const farEnough = reachable.filter((slot) => measure(slot, entrance) >= minDistance);
  const pool = farEnough.length ? farEnough : reachable;
  let bestDist = -1;
  const candidates = [];
  for (const slot of pool) {
    const distance = dist[slot.row][slot.col];
    if (distance > bestDist) {
      bestDist = distance;
      candidates.length = 0;
      candidates.push(slot);
    } else if (distance === bestDist) {
      candidates.push(slot);
    }
  }
  candidates.sort(compareSlots);
  return candidates[0] || null;
}

function countPassages(horizontalWalls, verticalWalls, rows, cols, mask = null) {
  let count = 0;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!horizontalWalls[row][col]) {
        if (isActiveCell(mask, row, col) && isActiveCell(mask, row - 1, col)) count += 1;
      }
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (!verticalWalls[row][col]) {
        if (isActiveCell(mask, row, col) && isActiveCell(mask, row, col - 1)) count += 1;
      }
    }
  }
  return count;
}

function internalDegree(horizontalWalls, verticalWalls, row, col, rows, cols, mask = null) {
  return neighbors(horizontalWalls, verticalWalls, row, col, rows, cols, mask).length;
}

function countDeadEnds(horizontalWalls, verticalWalls, rows, cols, entrance, exit, mask = null) {
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!isActiveCell(mask, row, col)) continue;
      if (row === entrance.row && col === entrance.col) continue;
      if (row === exit.row && col === exit.col) continue;
      if (internalDegree(horizontalWalls, verticalWalls, row, col, rows, cols, mask) === 1) count += 1;
    }
  }
  return count;
}

function turnCount(path) {
  let turns = 0;
  for (let index = 1; index < path.length - 1; index += 1) {
    const inRow = path[index].row - path[index - 1].row;
    const inCol = path[index].col - path[index - 1].col;
    const outRow = path[index + 1].row - path[index].row;
    const outCol = path[index + 1].col - path[index].col;
    if (inRow !== outRow || inCol !== outCol) turns += 1;
  }
  return turns;
}

function hasCycle(horizontalWalls, verticalWalls, start, rows, cols, mask = null) {
  const seen = grid(rows, cols, false);
  const stack = [{ row: start.row, col: start.col, parent: null }];
  seen[start.row][start.col] = true;
  while (stack.length) {
    const current = stack.pop();
    for (const next of neighbors(horizontalWalls, verticalWalls, current.row, current.col, rows, cols, mask)) {
      if (current.parent && next.row === current.parent.row && next.col === current.parent.col) continue;
      if (seen[next.row][next.col]) return true;
      seen[next.row][next.col] = true;
      stack.push({ row: next.row, col: next.col, parent: current });
    }
  }
  return false;
}

function countSimplePaths(horizontalWalls, verticalWalls, start, end, rows, cols, mask = null) {
  let count = 0;
  const stack = [{ row: start.row, col: start.col, seen: new Set([cellKey(start.row, start.col)]) }];
  while (stack.length && count < 2) {
    const current = stack.pop();
    if (current.row === end.row && current.col === end.col) {
      count += 1;
      continue;
    }
    for (const next of neighbors(horizontalWalls, verticalWalls, current.row, current.col, rows, cols, mask)) {
      const key = cellKey(next.row, next.col);
      if (current.seen.has(key)) continue;
      const seen = new Set(current.seen);
      seen.add(key);
      stack.push({ row: next.row, col: next.col, seen });
    }
  }
  return count;
}

function pathIsOpen(walkNeighbors, path) {
  if (path.length < 2) return false;
  for (let index = 1; index < path.length; index += 1) {
    const prev = path[index - 1];
    const next = path[index];
    const step = walkNeighbors(prev.row, prev.col)
      .some((item) => item.row === next.row && item.col === next.col);
    if (!step) return false;
  }
  return true;
}

function hexNeighborOffsets(row) {
  const odd = row & 1;
  return [
    { dr: 0, dc: 1, wall: 'east', fromSelf: true },
    { dr: 0, dc: -1, wall: 'east', fromSelf: false },
    { dr: -1, dc: odd ? 1 : 0, wall: 'northEast', fromSelf: true },
    { dr: -1, dc: odd ? 0 : -1, wall: 'northWest', fromSelf: true },
    { dr: 1, dc: odd ? 1 : 0, wall: 'northWest', fromSelf: false },
    { dr: 1, dc: odd ? 0 : -1, wall: 'northEast', fromSelf: false }
  ];
}

function createHexWalls(rows, cols) {
  return {
    east: grid(rows, cols, true),
    northEast: grid(rows, cols, true),
    northWest: grid(rows, cols, true)
  };
}

function hexLink(from, to) {
  return hexNeighborOffsets(from.row).find((item) => (
    from.row + item.dr === to.row && from.col + item.dc === to.col
  )) || null;
}

function openHexWall(hexWalls, from, to) {
  const link = hexLink(from, to);
  if (!link) return;
  if (link.fromSelf) hexWalls[link.wall][from.row][from.col] = false;
  else hexWalls[link.wall][to.row][to.col] = false;
}

function hexWallIsOpen(hexWalls, from, to) {
  const link = hexLink(from, to);
  if (!link) return false;
  return link.fromSelf ? !hexWalls[link.wall][from.row][from.col] : !hexWalls[link.wall][to.row][to.col];
}

function hexGraphNeighbors(hexWalls, row, col, rows, cols, mask = null) {
  const next = [];
  for (const offset of hexNeighborOffsets(row)) {
    const nr = row + offset.dr;
    const nc = col + offset.dc;
    if (!isInside(nr, nc, rows, cols) || !isActiveCell(mask, nr, nc)) continue;
    if (hexWallIsOpen(hexWalls, { row, col }, { row: nr, col: nc })) {
      next.push({ row: nr, col: nc });
    }
  }
  return next;
}

function hexUnvisited(current, visited, rows, cols, mask = null) {
  const next = [];
  for (const offset of hexNeighborOffsets(current.row)) {
    const row = current.row + offset.dr;
    const col = current.col + offset.dc;
    if (isInside(row, col, rows, cols) && isActiveCell(mask, row, col) && !visited[row][col]) {
      next.push({ row, col });
    }
  }
  return next;
}

function hexPerimeterSlots(rows, cols, mask = null) {
  const slots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!isActiveCell(mask, row, col)) continue;
      const outside = hexNeighborOffsets(row).some((offset) => {
        const nr = row + offset.dr;
        const nc = col + offset.dc;
        return !isInside(nr, nc, rows, cols) || !isActiveCell(mask, nr, nc);
      });
      if (!outside) continue;
      const side = row === 0 ? 'north' : row === rows - 1 ? 'south' : col === 0 ? 'west' : 'east';
      slots.push({ row, col, side });
    }
  }
  return slots;
}

function oddrToCube(row, col) {
  const x = col - ((row - (row & 1)) / 2);
  const z = row;
  return { x, y: -x - z, z };
}

function hexDistance(left, right) {
  const a = oddrToCube(left.row, left.col);
  const b = oddrToCube(right.row, right.col);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

function carveHex(algorithm, rows, cols, entrance, rng, mask = null) {
  const hexWalls = createHexWalls(rows, cols);
  const visited = grid(rows, cols, false);
  const carveEdge = (from, to) => {
    openHexWall(hexWalls, from, to);
    visited[to.row][to.col] = true;
  };
  if (algorithm === 'kruskal') {
    const parent = new Map();
    const find = (key) => {
      let current = key;
      while (parent.get(current) !== current) current = parent.get(current);
      return current;
    };
    const edges = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (!isActiveCell(mask, row, col)) continue;
        parent.set(cellKey(row, col), cellKey(row, col));
        for (const offset of hexNeighborOffsets(row)) {
          if (!offset.fromSelf) continue;
          const nr = row + offset.dr;
          const nc = col + offset.dc;
          if (!isInside(nr, nc, rows, cols) || !isActiveCell(mask, nr, nc)) continue;
          edges.push({ from: { row, col }, to: { row: nr, col: nc } });
        }
      }
    }
    shuffleInPlace(edges, rng);
    for (const edge of edges) {
      const left = find(cellKey(edge.from.row, edge.from.col));
      const right = find(cellKey(edge.to.row, edge.to.col));
      if (left === right) continue;
      parent.set(left, right);
      openHexWall(hexWalls, edge.from, edge.to);
    }
    return hexWalls;
  }
  visited[entrance.row][entrance.col] = true;
  if (algorithm === 'prim') {
    const frontier = [];
    const add = (cell) => {
      for (const next of hexUnvisited(cell, visited, rows, cols, mask)) frontier.push({ from: cell, to: next });
    };
    add(entrance);
    while (frontier.length) {
      const edge = frontier.splice(Math.floor(rng() * frontier.length), 1)[0];
      if (visited[edge.to.row][edge.to.col]) continue;
      carveEdge(edge.from, edge.to);
      add(edge.to);
    }
    return hexWalls;
  }
  const stack = [{ row: entrance.row, col: entrance.col }];
  const preferLast = algorithm !== 'growing_tree';
  while (stack.length) {
    const index = preferLast || rng() < 0.7 ? stack.length - 1 : Math.floor(rng() * stack.length);
    const current = stack[index];
    const choices = hexUnvisited(current, visited, rows, cols, mask);
    if (!choices.length) {
      stack.splice(index, 1);
      continue;
    }
    const next = pickItem(choices, rng);
    carveEdge(current, next);
    stack.push(next);
  }
  return hexWalls;
}

function genericBfs(start, rows, cols, walk) {
  const dist = grid(rows, cols, -1);
  const parent = grid(rows, cols, null);
  const queue = [{ row: start.row, col: start.col }];
  dist[start.row][start.col] = 0;
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const next of walk(current.row, current.col)) {
      if (dist[next.row][next.col] >= 0) continue;
      dist[next.row][next.col] = dist[current.row][current.col] + 1;
      parent[next.row][next.col] = current;
      queue.push({ row: next.row, col: next.col });
    }
  }
  return { dist, parent, visitedCount: queue.length };
}

function genericHasCycle(start, rows, cols, walk) {
  const seen = grid(rows, cols, false);
  const stack = [{ row: start.row, col: start.col, parent: null }];
  seen[start.row][start.col] = true;
  while (stack.length) {
    const current = stack.pop();
    for (const next of walk(current.row, current.col)) {
      if (current.parent && next.row === current.parent.row && next.col === current.parent.col) continue;
      if (seen[next.row][next.col]) return true;
      seen[next.row][next.col] = true;
      stack.push({ row: next.row, col: next.col, parent: current });
    }
  }
  return false;
}

function genericPathCount(start, end, walk) {
  let count = 0;
  const stack = [{ row: start.row, col: start.col, seen: new Set([cellKey(start.row, start.col)]) }];
  while (stack.length && count < 2) {
    const current = stack.pop();
    if (current.row === end.row && current.col === end.col) {
      count += 1;
      continue;
    }
    for (const next of walk(current.row, current.col)) {
      const key = cellKey(next.row, next.col);
      if (current.seen.has(key)) continue;
      const seen = new Set(current.seen);
      seen.add(key);
      stack.push({ row: next.row, col: next.col, seen });
    }
  }
  return count;
}

function countGraphDeadEnds(rows, cols, entrance, exit, walk, active = null) {
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (active && !active(row, col)) continue;
      if (row === entrance.row && col === entrance.col) continue;
      if (row === exit.row && col === exit.col) continue;
      if (walk(row, col).length === 1) count += 1;
    }
  }
  return count;
}

function countGraphPassages(rows, cols, walk, active = null) {
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (active && !active(row, col)) continue;
      for (const next of walk(row, col)) {
        if (next.row > row || (next.row === row && next.col > col)) count += 1;
      }
    }
  }
  return count;
}

function createRadialWalls(rings, sectors) {
  return {
    ring: grid(rings + 1, sectors, true),
    spoke: grid(rings, sectors, true)
  };
}

function openRadialWall(walls, from, to, sectors) {
  if (from.row === to.row) {
    const diff = Math.abs(from.col - to.col);
    if (diff === 1) walls.spoke[from.row][Math.min(from.col, to.col)] = false;
    else if (diff === sectors - 1) walls.spoke[from.row][sectors - 1] = false;
    return;
  }
  if (from.col === to.col) {
    walls.ring[Math.max(from.row, to.row)][from.col] = false;
  }
}

function radialGraphNeighbors(walls, ring, sector, rings, sectors) {
  const next = [];
  if (ring > 0 && !walls.ring[ring][sector]) next.push({ row: ring - 1, col: sector });
  if (ring < rings - 1 && !walls.ring[ring + 1][sector]) next.push({ row: ring + 1, col: sector });
  const cw = (sector + 1) % sectors;
  const ccw = (sector - 1 + sectors) % sectors;
  if (!walls.spoke[ring][sector]) next.push({ row: ring, col: cw });
  if (!walls.spoke[ring][ccw]) next.push({ row: ring, col: ccw });
  return next;
}

function radialCandidateNeighbors(ring, sector, rings, sectors) {
  const next = [{ row: ring, col: (sector + 1) % sectors }, { row: ring, col: (sector - 1 + sectors) % sectors }];
  if (ring > 0) next.push({ row: ring - 1, col: sector });
  if (ring < rings - 1) next.push({ row: ring + 1, col: sector });
  return next;
}

function radialDistance(left, right, sectors) {
  const ring = Math.abs(left.row - right.row);
  const delta = Math.abs(left.col - right.col);
  return ring + Math.min(delta, sectors - delta);
}

function radialPerimeterSlots(rings, sectors) {
  const slots = [];
  for (let col = 0; col < sectors; col += 1) {
    slots.push({ row: rings - 1, col, side: 'south' });
    slots.push({ row: 0, col, side: 'north' });
  }
  return slots;
}

function carveRadial(algorithm, rings, sectors, entrance, rng) {
  const walls = createRadialWalls(rings, sectors);
  const visited = grid(rings, sectors, false);
  const carveEdge = (from, to) => {
    openRadialWall(walls, from, to, sectors);
    visited[to.row][to.col] = true;
  };
  if (algorithm === 'kruskal') {
    const parent = new Map();
    const find = (key) => {
      let current = key;
      while (parent.get(current) !== current) current = parent.get(current);
      return current;
    };
    const edges = [];
    for (let row = 0; row < rings; row += 1) {
      for (let col = 0; col < sectors; col += 1) {
        parent.set(cellKey(row, col), cellKey(row, col));
        edges.push({ from: { row, col }, to: { row, col: (col + 1) % sectors } });
        if (row + 1 < rings) edges.push({ from: { row, col }, to: { row: row + 1, col } });
      }
    }
    shuffleInPlace(edges, rng);
    for (const edge of edges) {
      const left = find(cellKey(edge.from.row, edge.from.col));
      const right = find(cellKey(edge.to.row, edge.to.col));
      if (left === right) continue;
      parent.set(left, right);
      openRadialWall(walls, edge.from, edge.to, sectors);
    }
    return walls;
  }
  visited[entrance.row][entrance.col] = true;
  const stack = [{ row: entrance.row, col: entrance.col }];
  const preferLast = algorithm !== 'prim' && algorithm !== 'growing_tree';
  while (stack.length) {
    const index = algorithm === 'prim'
      ? Math.floor(rng() * stack.length)
      : (preferLast || rng() < 0.7 ? stack.length - 1 : Math.floor(rng() * stack.length));
    const current = stack[index];
    const choices = radialCandidateNeighbors(current.row, current.col, rings, sectors)
      .filter((cell) => !visited[cell.row][cell.col]);
    if (!choices.length) {
      stack.splice(index, 1);
      continue;
    }
    const next = pickItem(choices, rng);
    carveEdge(current, next);
    stack.push(next);
  }
  return walls;
}

function acceptedValidation() {
  return validateMazeValidationResult({
    schemaVersion: SCHEMA_VERSION,
    valid: true,
    code: null,
    messages: []
  });
}

function failedValidation(code, messages) {
  return validateMazeValidationResult({
    schemaVersion: SCHEMA_VERSION,
    valid: false,
    code,
    messages
  });
}

function scaleConstraints(spec, activeCount, fullCount) {
  const ratio = Math.max(0.28, activeCount / Math.max(1, fullCount));
  return {
    ...spec,
    minSolutionLength: Math.max(3, Math.floor(spec.minSolutionLength * ratio * 0.75)),
    minTurnCount: Math.max(1, Math.floor(spec.minTurnCount * ratio * 0.55)),
    minDeadEndCount: Math.max(1, Math.floor(spec.minDeadEndCount * ratio * 0.55)),
    minEntranceExitDistance: Math.max(2, Math.floor(spec.minEntranceExitDistance * ratio * 0.65))
  };
}

function fitSpecToPanel(spec) {
  const panel = spec.mazePanel || DEFAULT_MAZE_PANEL;
  const pad = 88;
  const maxWidth = Math.max(80, panel.width - pad);
  const maxHeight = Math.max(80, panel.height - pad);
  const extent = mazeExtent(spec.rows, spec.cols, spec.cellSize, spec.wallThickness, spec.lattice);
  if (extent.width <= maxWidth && extent.height <= maxHeight) return spec;
  const scale = Math.min(maxWidth / extent.width, maxHeight / extent.height);
  if (!Number.isFinite(scale) || scale >= 1) return spec;
  return {
    ...spec,
    cellSize: Math.max(8, spec.cellSize * scale),
    wallThickness: Math.max(1.4, spec.wallThickness * scale),
    iconSize: Math.min(spec.iconSize, Math.max(8, spec.cellSize * scale * 0.85))
  };
}

function classicPlan(config, options = {}) {
  const shape = sanitizeShape(options.shape || config.shape);
  return {
    shape,
    lattice: sanitizeLattice(options.lattice || latticeForShape(shape)),
    algorithm: sanitizeAlgorithm(options.algorithm || 'backtracker'),
    braidFactor: Number.isFinite(options.braidFactor) ? Math.max(0, Math.min(0.35, options.braidFactor)) : 0,
    density: 'standard',
    startBias: options.startBias || 'random',
    wallScale: 1,
    design: coerceDesign(options.design || defaultMazeDesign())
  };
}

function resolveGenerationPlan(config, options = {}) {
  const variety = options.variety === true
    || (Number(options.sequenceTotal) > 1)
    || (sanitizeShape(options.shape || config.shape) !== SHAPE_RECTANGULAR);
  if (!variety) return classicPlan(config, options);
  return planMazePageDesign({
    shape: options.shape || config.shape,
    title: options.title || config.title,
    keyword: options.keyword || config.keyword,
    sequenceIndex: options.sequenceIndex || 1,
    algorithm: options.algorithm,
    braidFactor: options.braidFactor,
    lattice: options.lattice,
    wallStyle: options.design?.wallStyle,
    frameStyle: options.design?.frameStyle,
    paletteId: options.design?.paletteId,
    cellStyle: options.design?.cellStyle,
    startBias: options.startBias
  });
}

function applyPlanToSpec(spec, plan, variety) {
  let next = {
    ...spec,
    shape: plan.shape,
    lattice: plan.lattice,
    algorithm: plan.algorithm,
    braidFactor: plan.braidFactor,
    startBias: plan.startBias,
    design: plan.design
  };
  if (variety || plan.lattice !== LATTICE_SQUARE || plan.shape !== SHAPE_RECTANGULAR) {
    if (plan.density === 'tight') {
      next.rows = Math.min(MAX_MAZE_SIZE, spec.rows + 1);
      next.cols = Math.min(MAX_MAZE_SIZE, spec.cols + 1);
      next.cellSize = Math.max(12, spec.cellSize * 0.88);
    } else if (plan.density === 'roomy') {
      next.rows = Math.max(MIN_MAZE_SIZE, spec.rows - (spec.rows > 8 ? 1 : 0));
      next.cols = Math.max(MIN_MAZE_SIZE, spec.cols - (spec.cols > 8 ? 1 : 0));
      next.cellSize = spec.cellSize * 1.06;
    }
    next.wallThickness = Math.max(1.5, spec.wallThickness * (plan.wallScale || 1));
    if (plan.lattice === LATTICE_HEX) {
      next.rows = Math.max(4, spec.rows - 1);
      next.cols = Math.max(4, spec.cols - 1);
      next.cellSize = spec.cellSize * 0.7;
    }
    if (plan.lattice === LATTICE_RADIAL) {
      next.rows = Math.max(5, Math.round(spec.rows * 0.7));
      next.cols = Math.max(12, spec.cols + 4);
      next.cellSize = spec.cellSize * 0.62;
    }
    if (['heart', 'cross', 'triangular', 'diamond'].includes(plan.shape)) {
      next.rows = Math.max(next.rows, 10);
      next.cols = Math.max(next.cols, 10);
      next.cellSize = Math.min(next.cellSize, spec.cellSize * 0.9);
    }
    if (plan.shape === 'star') {
      next.rows = Math.max(next.rows, 14);
      next.cols = Math.max(next.cols, 14);
      next.cellSize = Math.min(next.cellSize, spec.cellSize * 0.78);
    }
    if (plan.algorithm === 'recursive_division') {
      next.minTurnCount = Math.max(1, Math.floor(spec.minTurnCount * 0.5));
    }
    next.iconSize = Math.min(next.iconSize, next.cellSize * 0.88);
    next = fitSpecToPanel(next);
  }
  return next;
}

function generateSquareAttempt(spec, seed, generationSeed, rng) {
  const mask = spec.cellMask || buildShapeMask(spec.shape, spec.rows, spec.cols);
  const slots = maskPerimeterSlots(mask, spec.rows, spec.cols);
  const entrance = pickBiasedSlot(slots, rng, spec.startBias);
  if (!entrance) return { ok: false, reason: 'No valid mask entrance.' };
  const carved = carveSquare(spec.algorithm, spec.rows, spec.cols, mask, entrance, rng);
  const search = bfs(carved.horizontalWalls, carved.verticalWalls, entrance, spec.rows, spec.cols, mask);
  const exit = pickDistantExit(search.dist, entrance, slots, spec.minEntranceExitDistance, manhattan);
  if (!exit) return { ok: false, reason: 'No valid mask exit.' };
  braidSquare(carved, mask, spec.rows, spec.cols, entrance, exit, spec.braidFactor, rng);
  setOpeningWall(carved.horizontalWalls, carved.verticalWalls, entrance, false);
  setOpeningWall(carved.horizontalWalls, carved.verticalWalls, exit, false);
  const solved = bfs(carved.horizontalWalls, carved.verticalWalls, entrance, spec.rows, spec.cols, mask);
  const path = reconstructPath(solved.parent, entrance, exit);
  return {
    ok: true,
    lattice: LATTICE_SQUARE,
    entrance,
    exit,
    horizontalWalls: carved.horizontalWalls,
    verticalWalls: carved.verticalWalls,
    hexWalls: null,
    radialWalls: null,
    cellMask: mask,
    path,
    seed,
    generationSeed
  };
}

function generateHexAttempt(spec, seed, generationSeed, rng) {
  const mask = spec.cellMask || buildShapeMask(spec.shape, spec.rows, spec.cols);
  const slots = hexPerimeterSlots(spec.rows, spec.cols, mask);
  const entrance = pickBiasedSlot(slots, rng, spec.startBias);
  if (!entrance) return { ok: false, reason: 'No valid hex entrance.' };
  const hexWalls = carveHex(spec.algorithm, spec.rows, spec.cols, entrance, rng, mask);
  const walk = (row, col) => hexGraphNeighbors(hexWalls, row, col, spec.rows, spec.cols, mask);
  const search = genericBfs(entrance, spec.rows, spec.cols, walk);
  const exit = pickDistantExit(search.dist, entrance, slots, spec.minEntranceExitDistance, hexDistance);
  if (!exit) return { ok: false, reason: 'No valid hex exit.' };
  const path = reconstructPath(search.parent, entrance, exit);
  const dummy = closedSquareWalls(spec.rows, spec.cols);
  return {
    ok: true,
    lattice: LATTICE_HEX,
    entrance,
    exit,
    horizontalWalls: dummy.horizontalWalls,
    verticalWalls: dummy.verticalWalls,
    hexWalls,
    radialWalls: null,
    cellMask: mask,
    path,
    seed,
    generationSeed
  };
}

function generateRadialAttempt(spec, seed, generationSeed, rng) {
  const slots = radialPerimeterSlots(spec.rows, spec.cols);
  const entrance = pickBiasedSlot(slots.filter((slot) => slot.row === spec.rows - 1), rng, spec.startBias)
    || pickBiasedSlot(slots, rng, spec.startBias);
  if (!entrance) return { ok: false, reason: 'No valid radial entrance.' };
  const radialWalls = carveRadial(spec.algorithm, spec.rows, spec.cols, entrance, rng);
  const walk = (row, col) => radialGraphNeighbors(radialWalls, row, col, spec.rows, spec.cols);
  const search = genericBfs(entrance, spec.rows, spec.cols, walk);
  const exit = pickDistantExit(
    search.dist,
    entrance,
    slots,
    spec.minEntranceExitDistance,
    (left, right) => radialDistance(left, right, spec.cols)
  );
  if (!exit) return { ok: false, reason: 'No valid radial exit.' };
  openRadialOpening(radialWalls, entrance, spec.rows);
  openRadialOpening(radialWalls, exit, spec.rows);
  const path = reconstructPath(search.parent, entrance, exit);
  const dummy = closedSquareWalls(spec.rows, spec.cols);
  return {
    ok: true,
    lattice: LATTICE_RADIAL,
    entrance,
    exit,
    horizontalWalls: dummy.horizontalWalls,
    verticalWalls: dummy.verticalWalls,
    hexWalls: null,
    radialWalls,
    cellMask: null,
    path,
    seed,
    generationSeed
  };
}

function generateAttempt(spec, seed, generationSeed, rng) {
  if (spec.lattice === LATTICE_HEX) return generateHexAttempt(spec, seed, generationSeed, rng);
  if (spec.lattice === LATTICE_RADIAL) return generateRadialAttempt(spec, seed, generationSeed, rng);
  return generateSquareAttempt(spec, seed, generationSeed, rng);
}

function walkerFor(topology) {
  const { rows, cols, lattice, horizontalWalls, verticalWalls, hexWalls, radialWalls, cellMask } = topology;
  if (lattice === LATTICE_HEX && hexWalls) {
    return (row, col) => hexGraphNeighbors(hexWalls, row, col, rows, cols, cellMask);
  }
  if (lattice === LATTICE_RADIAL && radialWalls) {
    return (row, col) => radialGraphNeighbors(radialWalls, row, col, rows, cols);
  }
  return (row, col) => neighbors(horizontalWalls, verticalWalls, row, col, rows, cols, cellMask);
}

function openRadialOpening(walls, opening, rings) {
  if (!walls || !opening) return;
  if (opening.side === 'north') walls.ring[0][opening.col] = false;
  else walls.ring[rings][opening.col] = false;
}

function squareOpeningOpen(topology, opening) {
  const { row, col, side } = opening;
  if (side === 'north') return topology.horizontalWalls[row]?.[col] === false;
  if (side === 'south') return topology.horizontalWalls[row + 1]?.[col] === false;
  if (side === 'west') return topology.verticalWalls[row]?.[col] === false;
  return topology.verticalWalls[row]?.[col + 1] === false;
}

function radialOpeningOpen(topology, opening) {
  if (!topology.radialWalls) return false;
  if (opening.side === 'north') return topology.radialWalls.ring[0]?.[opening.col] === false;
  return topology.radialWalls.ring[topology.rows]?.[opening.col] === false;
}

function openingPassageOpen(topology, opening) {
  if (!topology || !opening) return false;
  if (topology.lattice === LATTICE_HEX) {
    return Boolean(hexOpeningOffset(opening, topology.rows, topology.cols, topology.cellMask));
  }
  if (topology.lattice === LATTICE_RADIAL) return radialOpeningOpen(topology, opening);
  return squareOpeningOpen(topology, opening);
}

function openingLooksValid(topology) {
  const { rows, cols, lattice, entrance, exit, cellMask } = topology;
  if (entrance.row === exit.row && entrance.col === exit.col) return false;
  if (lattice === LATTICE_HEX || lattice === LATTICE_RADIAL) {
    return openingPassageOpen(topology, entrance) && openingPassageOpen(topology, exit);
  }
  const maskSlots = maskPerimeterSlots(cellMask, rows, cols);
  const isSlot = (opening) => maskSlots.some((slot) => (
    slot.row === opening.row && slot.col === opening.col && slot.side === opening.side
  ));
  if (!isSlot(entrance) || !isSlot(exit)) return false;
  return openingPassageOpen(topology, entrance) && openingPassageOpen(topology, exit);
}

function validateGeneratedMaze(topology, path, spec, config) {
  const messages = [];
  const { rows, cols, cellSize, wallThickness, iconSize, mazePanel } = spec;
  const { entrance, exit, lattice, cellMask } = topology;
  const walk = walkerFor(topology);
  const activeCount = cellMask
    ? activeMaskCount(cellMask)
    : rows * cols;
  const cellCount = activeCount;

  if (rows < MIN_MAZE_SIZE || cols < MIN_MAZE_SIZE || rows > MAX_MAZE_SIZE || cols > MAX_MAZE_SIZE) {
    messages.push('Grid dimensions are outside the supported range.');
  }
  if (cellSize <= 0 || wallThickness <= 0) {
    messages.push('Zero-width or overlapping walls are not allowed.');
  }
  if (entrance.row === exit.row && entrance.col === exit.col) {
    messages.push('Start and finish must be different cells.');
  }
  if (!openingLooksValid(topology)) {
    messages.push('Entrance and exit must sit on the maze outline.');
  }

  const search = genericBfs(entrance, rows, cols, walk);
  if (search.visitedCount !== cellCount) {
    messages.push('Every cell must be reachable from the entrance.');
  }
  if (search.dist[exit.row][exit.col] < 0) {
    messages.push('Start must reach finish.');
  }

  const braided = (topology.braidFactor || 0) > 0;
  if (!braided && genericHasCycle(entrance, rows, cols, walk)) {
    messages.push('A perfect maze cannot contain cycles.');
  }

  const passages = lattice === LATTICE_SQUARE
    ? countPassages(topology.horizontalWalls, topology.verticalWalls, rows, cols, cellMask)
    : countGraphPassages(rows, cols, walk);
  if (!braided && passages !== cellCount - 1) {
    messages.push(`Passage count must equal cell count minus one (${cellCount - 1}).`);
  }
  if (braided && passages < cellCount - 1) {
    messages.push('A braided maze still needs a connected spanning set of passages.');
  }

  const uniquePaths = genericPathCount(entrance, exit, walk);
  if (!braided && uniquePaths !== 1) {
    messages.push('A perfect maze must have exactly one start-to-finish solution.');
  }
  if (braided && uniquePaths < 1) {
    messages.push('A braided maze must stay solvable.');
  }
  if (!pathIsOpen(walk, path)
    || path[0].row !== entrance.row || path[0].col !== entrance.col
    || path[path.length - 1].row !== exit.row || path[path.length - 1].col !== exit.col) {
    messages.push('Saved solution path must follow open passages from start to finish.');
  }

  const solutionLength = path.length;
  const turns = turnCount(path);
  const deadEnds = lattice === LATTICE_SQUARE
    ? countDeadEnds(topology.horizontalWalls, topology.verticalWalls, rows, cols, entrance, exit, cellMask)
    : countGraphDeadEnds(rows, cols, entrance, exit, walk);
  const entranceExitDistance = lattice === LATTICE_HEX
    ? hexDistance(entrance, exit)
    : lattice === LATTICE_RADIAL
      ? radialDistance(entrance, exit, cols)
      : manhattan(entrance, exit);

  if (solutionLength < spec.minSolutionLength) {
    messages.push(`Solution length ${solutionLength} is below the configured minimum ${spec.minSolutionLength}.`);
  }
  if (turns < spec.minTurnCount) {
    messages.push(`Turn count ${turns} is below the configured minimum ${spec.minTurnCount}.`);
  }
  if (deadEnds < spec.minDeadEndCount) {
    messages.push(`Dead-end count ${deadEnds} is below the configured minimum ${spec.minDeadEndCount}.`);
  }
  if (entranceExitDistance < spec.minEntranceExitDistance) {
    messages.push(`Entrance/exit distance ${entranceExitDistance} is below the configured minimum ${spec.minEntranceExitDistance}.`);
  }

  const extent = mazeExtent(rows, cols, cellSize, wallThickness, lattice);
  const panel = mazePanel || null;
  if (panel && (extent.width > panel.width || extent.height > panel.height)) {
    messages.push('Maze walls do not fit inside the maze panel.');
  }

  const iconsExist = Boolean(config.startAssetId || config.endAssetId);
  if (iconsExist && iconSize > cellSize) {
    messages.push('Start/end icons are larger than a passage and would block the path.');
  }

  const stats = {
    passageCount: passages,
    solutionLength,
    turnCount: turns,
    deadEndCount: deadEnds,
    entranceExitDistance
  };

  if (messages.length) {
    return {
      validation: failedValidation(messages[0].includes('minimum') ? 'MAZE_CONSTRAINT_FAILED' : 'MAZE_INVALID', messages),
      stats
    };
  }
  return { validation: acceptedValidation(), stats };
}

function cloneHexWalls(value) {
  if (!value) return null;
  return {
    east: cloneGrid(value.east),
    northEast: cloneGrid(value.northEast),
    northWest: cloneGrid(value.northWest)
  };
}

function cloneRadialWalls(value) {
  if (!value) return null;
  return {
    ring: cloneGrid(value.ring),
    spoke: cloneGrid(value.spoke)
  };
}

function buildTopology(spec, seed, generationSeed, retryCount, generated, stats) {
  return coerceTopology({
    schemaVersion: SCHEMA_VERSION,
    shape: spec.shape || SHAPE_RECTANGULAR,
    rows: spec.rows,
    cols: spec.cols,
    cellSize: spec.cellSize,
    wallThickness: spec.wallThickness,
    iconSize: spec.iconSize,
    seed,
    generationSeed,
    retryCount,
    entrance: { row: generated.entrance.row, col: generated.entrance.col, side: generated.entrance.side },
    exit: { row: generated.exit.row, col: generated.exit.col, side: generated.exit.side },
    horizontalWalls: cloneGrid(generated.horizontalWalls),
    verticalWalls: cloneGrid(generated.verticalWalls),
    stats,
    algorithm: spec.algorithm || 'backtracker',
    braidFactor: spec.braidFactor || 0,
    lattice: generated.lattice || spec.lattice || LATTICE_SQUARE,
    cellMask: generated.cellMask ? cloneGrid(generated.cellMask) : null,
    design: spec.design || defaultMazeDesign(),
    hexWalls: cloneHexWalls(generated.hexWalls),
    radialWalls: cloneRadialWalls(generated.radialWalls)
  });
}

function generateMazeTopology(configInput, options = {}) {
  const config = validateMazeConfig(configInput);
  const baseSpec = resolveMazeGenerationSpec(config, options);
  const variety = options.variety === true
    || (Number(options.sequenceTotal) > 1)
    || (sanitizeShape(options.shape || config.shape) !== SHAPE_RECTANGULAR);
  const plan = options.plan || resolveGenerationPlan(config, options);
  let spec = applyPlanToSpec(baseSpec, plan, variety);
  if (spec.shape !== SHAPE_RECTANGULAR && spec.lattice !== LATTICE_RADIAL) {
    spec.cellMask = buildShapeMask(spec.shape, spec.rows, spec.cols);
    spec = scaleConstraints(spec, activeMaskCount(spec.cellMask), spec.rows * spec.cols);
  } else if (spec.lattice !== LATTICE_SQUARE) {
    spec = scaleConstraints(spec, spec.rows * spec.cols, baseSpec.rows * baseSpec.cols);
  }
  spec = fitSpecToPanel(spec);
  const pageId = options.pageId || createMazePageId(1);
  const seed = resolveMazeSeed(config);
  const metrics = {
    generationMs: 0,
    validationMs: 0,
    retryCount: 0,
    attempts: 0
  };
  let lastValidation = failedValidation('MAZE_GENERATION_FAILED', ['Maze generation did not produce an accepted maze.']);

  for (let attempt = 0; attempt <= spec.maxRetries; attempt += 1) {
    const generationSeed = attemptSeed(seed, attempt);
    const rng = createSeededRng(generationSeed);
    const started = performance.now();
    const generated = generateAttempt(spec, seed, generationSeed, rng);
    const generatedAt = performance.now();
    metrics.generationMs += generatedAt - started;
    metrics.attempts += 1;
    metrics.retryCount = attempt;

    if (!generated.ok) {
      lastValidation = failedValidation('MAZE_INVALID', [generated.reason]);
      metrics.validationMs += performance.now() - generatedAt;
      continue;
    }

    const draft = buildTopology(spec, seed, generationSeed, attempt, generated, {
      passageCount: 0,
      solutionLength: generated.path.length,
      turnCount: 0,
      deadEndCount: 0,
      entranceExitDistance: 0
    });
    const checked = validateGeneratedMaze(draft, generated.path, spec, config);
    metrics.validationMs += performance.now() - generatedAt;
    lastValidation = checked.validation;
    if (!checked.validation.valid) continue;

    const topology = buildTopology(spec, seed, generationSeed, attempt, generated, checked.stats);
    const result = validateMazeResult({
      schemaVersion: SCHEMA_VERSION,
      engineType: ENGINE_TYPE,
      project: { id: config.project.id, revision: config.project.revision },
      pageId,
      topology,
      solution: {
        schemaVersion: SCHEMA_VERSION,
        engineType: ENGINE_TYPE,
        project: { id: config.project.id, revision: config.project.revision },
        pageId,
        path: generated.path.map((cell) => ({ row: cell.row, col: cell.col }))
      },
      validationResult: checked.validation
    });
    return { result, metrics, spec };
  }

  throw Object.assign(new Error('Maze generation failed validation.'), {
    code: 'MAZE_GENERATION_FAILED',
    validationResult: lastValidation,
    metrics
  });
}

module.exports = {
  createSeededRng,
  hashSeed,
  resolveMazeSeed,
  generateMazeTopology,
  validateGeneratedMaze,
  resolveGenerationPlan,
  openingPassageOpen
};
