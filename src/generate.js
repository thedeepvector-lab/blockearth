// The heart of the project: map features -> a 3D grid of blocks for one chunk.
// Runs inside a Web Worker. Everything is deterministic, so any chunk can be rebuilt at any time.
import { CHUNK, PAD, SIZE, MAX_Y, TILE_CHUNKS } from './config.js';
import { B } from './blocks.js';
import { hash, pointInRing } from './geo.js';

const GP = 4, GS = CHUNK + GP * 2;              // we rasterise a slightly larger area than we store (trees overhang)
const gy = new Int16Array(GS * GS);             // ground height per column
const surf = new Uint8Array(GS * GS);           // surface block per column
const veg = new Uint8Array(GS * GS);            // vegetation density class
const occ = new Uint8Array(GS * GS);            // 1 = a building stands here
const wl = new Int16Array(GS * GS);             // water level (or -1)
const scratch = new Uint8Array(SIZE * SIZE * MAX_Y);
let maxY = 0, CX = 0, CZ = 0;

function set(lx, y, lz, id) {
  if (lx < -PAD || lx >= CHUNK + PAD || lz < -PAD || lz >= CHUNK + PAD || y < 0 || y >= MAX_Y) return;
  scratch[(y * SIZE + lz + PAD) * SIZE + lx + PAD] = id;
  if (y > maxY) maxY = y;
}
function get(lx, y, lz) {
  if (lx < -PAD || lx >= CHUNK + PAD || lz < -PAD || lz >= CHUNK + PAD || y < 0 || y >= MAX_Y) return 0;
  return scratch[(y * SIZE + lz + PAD) * SIZE + lx + PAD];
}

// ---------- rasterisers ----------
const xs = [];
// Scanline polygon fill (even-odd, so holes just work). Calls cb(columnIndex, ix, iz).
function fillPoly(rings, bbox, X0, Z0, cb) {
  const z0 = Math.max(0, Math.floor(bbox[1] - Z0)), z1 = Math.min(GS - 1, Math.ceil(bbox[3] - Z0));
  for (let iz = z0; iz <= z1; iz++) {
    const z = Z0 + iz + 0.5;
    xs.length = 0;
    for (const r of rings) for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
      const zi = r[i + 1], zj = r[j + 1];
      if ((zi > z) !== (zj > z)) xs.push(r[i] + ((z - zi) / (zj - zi)) * (r[j] - r[i]));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - X0 - 0.5)), b = Math.min(GS - 1, Math.ceil(xs[k + 1] - X0 - 0.5) - 1);
      for (let ix = a; ix <= b; ix++) cb(iz * GS + ix, ix, iz);
    }
  }
}

// Thick line. Calls cb(columnIndex, distanceFromCentre, distanceAlongLine, side).
function stroke(pts, hw, X0, Z0, cb) {
  let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], dx = pts[i + 2] - ax, dz = pts[i + 3] - az, l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) continue;
    const len = Math.sqrt(l2);
    const x0 = Math.max(0, Math.floor(Math.min(ax, ax + dx) - hw - X0)), x1 = Math.min(GS - 1, Math.ceil(Math.max(ax, ax + dx) + hw - X0));
    const z0 = Math.max(0, Math.floor(Math.min(az, az + dz) - hw - Z0)), z1 = Math.min(GS - 1, Math.ceil(Math.max(az, az + dz) + hw - Z0));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const px = X0 + ix + 0.5 - ax, pz = Z0 + iz + 0.5 - az;
      const t = Math.min(1, Math.max(0, (px * dx + pz * dz) / l2));
      const ex = px - dx * t, ez = pz - dz * t, d2 = ex * ex + ez * ez;
      if (d2 <= hw * hw) cb(iz * GS + ix, Math.sqrt(d2), acc + t * len, dx * pz - dz * px >= 0 ? 1 : -1);
    }
    acc += len;
  }
}

// Distance from a point to the nearest wall of a building (+ which wall, and how far along it).
let eI = 0, eT = 0, eL = 0;
function edgeDist(E, x, z) {
  let best = 1e18;
  for (let i = 0; i < E.length; i += 4) {
    const ax = E[i], az = E[i + 1], dx = E[i + 2] - ax, dz = E[i + 3] - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const ex = x - ax - dx * t, ez = z - az - dz * t, d2 = ex * ex + ez * ez;
    if (d2 < best) { best = d2; eI = i >> 2; eL = Math.sqrt(l2); eT = t * eL; }
  }
  return Math.sqrt(best);
}
const inside = (b, x, z) => { let s = false; for (const r of b.rings) if (pointInRing(x, z, r)) s = !s; return s; };

// ---------- one-time preparation of a freshly downloaded tile ----------
export function prepareTile(tile, env) {
  const index = new Map();
  const c0x = tile.tx * TILE_CHUNKS, c0z = tile.tz * TILE_CHUNKS;
  tile.feats.forEach((f, i) => {
    if (f.k === 'b') prepBuilding(f, env);
    else if (f.k === 'p') f.bbox = [f.x - 4, f.z - 4, f.x + 4, f.z + 4];
    else if (f.k === 'a' && f.block === B.WATER && !f.river && f.bbox[2] - f.bbox[0] < 1500) {
      let lvl = 1e9;                                    // a lake is flat: use its lowest shore point
      const r = f.rings[0], stepN = Math.max(2, Math.floor(r.length / 60) * 2);
      for (let k = 0; k < r.length; k += stepN) lvl = Math.min(lvl, env.ground(r[k], r[k + 1]));
      f.level = lvl;
    }
    // Spatial index: remember which chunks each feature touches, so chunk generation is fast.
    const b = f.bbox;
    const x0 = Math.max(c0x, Math.floor((b[0] - GP) / CHUNK)), x1 = Math.min(c0x + TILE_CHUNKS - 1, Math.floor((b[2] + GP) / CHUNK));
    const z0 = Math.max(c0z, Math.floor((b[1] - GP) / CHUNK)), z1 = Math.min(c0z + TILE_CHUNKS - 1, Math.floor((b[3] + GP) / CHUNK));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const key = cx + ',' + cz;
      let list = index.get(key);
      if (!list) index.set(key, (list = []));
      list.push(i);
    }
  });
  tile.index = index;
}

function prepBuilding(b, env) {
  b.base = env.ground(b.ax, b.az);
  b.y0 = b.base + Math.round(b.minH);
  const wallH = Math.max(3, Math.round(b.h - b.minH) - b.roofH);
  b.top = b.y0 + wallH;
  b.lastFloor = Math.max(0, Math.floor((wallH - 3) / b.step));
  // Flatten all rings into one edge list [x1,z1,x2,z2,...]
  let n = 0;
  for (const r of b.rings) n += r.length / 2;
  const E = (b.E = new Float32Array(n * 4));
  let k = 0, longest = 0;
  b.rings.forEach((r, ri) => {
    for (let i = 0, m = r.length, j = m - 2; i < m; j = i, i += 2) {
      E[k] = r[j]; E[k + 1] = r[j + 1]; E[k + 2] = r[i]; E[k + 3] = r[i + 1];
      const len = Math.hypot(r[i] - r[j], r[i + 1] - r[j + 1]);
      if (ri === 0 && len > longest) { longest = len; b.doorE = k >> 2; b.doorT = len / 2; }   // front door: middle of the longest wall
      k += 4;
    }
  });
  // A ladder shaft at the most "interior" point connects all the floors.
  b.ladder = 0;
  if (b.lastFloor > 0) {
    const [x0, z0, x1, z1] = b.bbox, st = Math.max(1, Math.ceil(Math.max(x1 - x0, z1 - z0) / 24));
    let best = 0;
    for (let z = Math.floor(z0); z <= z1; z += st) for (let x = Math.floor(x0); x <= x1; x += st) {
      if (!inside(b, x + 0.5, z + 0.5)) continue;
      const d = edgeDist(E, x + 0.5, z + 0.5);
      if (d > best) { best = d; b.lx = x; b.lz = z; }
    }
    b.ladder = best >= 2.4 ? 1 : 0;
  }
}

// ---------- furniture ----------
// Each room type is a little floor plan: "x,z" inside the room cell -> [block at floor level, block above]
const plan = (o) => new Map(Object.entries(o));
const ROOMS = [
  plan({ '1,1': [B.PILLOW], '2,1': [B.BED], '5,1': [B.BOOKSHELF, B.BOOKSHELF], '1,5': [B.TABLE], '5,5': [B.SOFA] }),                                  // bedroom
  plan({ '2,1': [B.SOFA], '3,1': [B.SOFA], '4,1': [B.SOFA], '3,3': [B.TABLE], '3,5': [B.TV], '1,5': [B.BOOKSHELF, B.BOOKSHELF] }),                    // living room
  plan({ '1,1': [B.STOVE], '2,1': [B.COUNTER], '3,1': [B.COUNTER], '5,1': [B.BOOKSHELF, B.BOOKSHELF], '3,4': [B.TABLE], '4,4': [B.TABLE] }),          // kitchen
  plan({ '1,1': [B.BOOKSHELF, B.BOOKSHELF], '2,1': [B.BOOKSHELF, B.BOOKSHELF], '3,1': [B.BOOKSHELF, B.BOOKSHELF], '2,3': [B.TABLE], '5,5': [B.SOFA], '5,2': [B.TV] }), // study
  plan({ '2,2': [B.TABLE], '3,2': [B.TABLE], '6,2': [B.TABLE], '7,2': [B.TABLE], '2,6': [B.TABLE], '3,6': [B.TABLE], '6,6': [B.TABLE], '7,6': [B.TABLE], '1,4': [B.BOOKSHELF, B.BOOKSHELF], '5,4': [B.SOFA] }), // office
];

function furnish(b, wx, wz, fl, rr, d, ground) {
  const cell = b.home ? 7 : 9;
  const mx = ((wx % cell) + cell) % cell, mz = ((wz % cell) + cell) % cell;
  if (b.area > 110 && (mx === 0 || mz === 0)) {                       // interior walls every `cell` blocks...
    const gap = (mx === 0 && (mz === 3 || mz === 4)) || (mz === 0 && (mx === 3 || mx === 4));
    return gap && rr <= 2 ? 0 : b.home ? B.STUCCO_CREAM : B.CONCRETE_WHITE;   // ...with doorways
  }
  if (rr > 2 || d < 1.6) return 0;
  if (ground && fl === 0 && eI === b.doorE && Math.abs(eT - b.doorT) < 2.5 && d < 4) return 0;   // keep the entrance clear
  if (b.ladder && Math.abs(wx - b.lx) <= 1 && Math.abs(wz - b.lz) <= 1) return 0;
  const room = b.home ? Math.floor(hash(b.id, Math.floor(wx / cell), Math.floor(wz / cell), fl) * 4) : 4;
  const item = ROOMS[room].get(mx + ',' + mz);
  return item ? item[rr - 1] || 0 : 0;
}

// ---------- structures ----------
function tree(lx, lz, g, seed, conifer) {
  const h = 4 + Math.floor(hash(seed, 1) * 3) + (conifer ? 2 : 0);
  if (conifer) {
    for (let y = g + 3; y <= g + h + 2; y++) {
      const r = Math.max(0, Math.round((g + h + 2 - y) * 0.42));
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dz * dz <= r * r + 1 && !get(lx + dx, y, lz + dz)) set(lx + dx, y, lz + dz, B.LEAVES_DARK);
    }
  } else {
    const R = 5.2 + hash(seed, 2) * 2;
    for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
      if (dx * dx + dz * dz + dy * dy * 1.4 <= R && !get(lx + dx, g + h + dy, lz + dz)) set(lx + dx, g + h + dy, lz + dz, B.LEAVES);
  }
  for (let y = g + 1; y <= g + h; y++) set(lx, y, lz, B.LOG);
}

function buildColumn(b, lx, lz, d, detail) {
  const { y0, top, step, wall, roofH, glassy, home } = b;
  const wx = CX * CHUNK + lx, wz = CZ * CHUNK + lz;
  const ground = b.minH === 0, isWall = d <= 1.0, floorB = home ? B.PLANKS : B.CONCRETE;
  const tt = Math.floor(eT), corner = eT < 1 || eT > eL - 1, wI = eI, wT = eT;
  const cell = home ? 7 : 9, lampCol = (((wx % cell) + cell) % cell) === (home ? 3 : 4) && (((wz % cell) + cell) % cell) === (home ? 3 : 4);
  const ladderCol = b.ladder && wx === b.lx && wz === b.lz;

  for (let y = y0 + (ground ? 1 : 0); y <= top; y++) {
    const rel = y - y0, fl = Math.min(Math.floor(rel / step), b.lastFloor), rr = rel - fl * step;
    let id;
    if (y === top) id = isWall ? wall : b.roof;
    else if (isWall) {
      id = wall;
      if (ground && wI === b.doorE && Math.abs(wT - b.doorT) <= 0.8 && (rel === 1 || rel === 2)) id = detail ? 0 : B.DOOR;
      else if (!corner && rr !== 0) {
        const win = glassy ? tt % 4 !== 0 : home ? (rr === 2 || (step === 4 && rr === 3)) && (tt % 4 === 1 || tt % 4 === 2) : (rr === 2 || rr === 3) && tt % 3 !== 0;
        if (win) {
          const lit = hash(b.id, fl, Math.floor(tt / (glassy || home ? 4 : 3)), wI) < 0.38;   // some windows glow at night
          id = glassy ? (lit ? B.GLASS_BLUE_LIT : B.GLASS_BLUE) : lit ? B.GLASS_LIT : B.GLASS;
        }
      }
    } else if (!detail) id = B.CONCRETE_DARK;                       // far away: solid inside = far fewer triangles
    else if (ladderCol) id = B.LADDER;
    else if (rr === 0) id = lampCol ? B.LAMP : floorB;               // floor slab (with ceiling lights for the storey below)
    else if (y === top - 1 && lampCol && rr > 1) id = B.LAMP;
    else { eI = wI; eT = wT; id = furnish(b, wx, wz, fl, rr, d, ground); }
    set(lx, y, lz, id);
  }
  if (roofH) {                                                       // pitched roof: higher the further we are from the walls
    const rise = Math.min(roofH, Math.floor(d * 0.8));
    for (let y = top; y <= top + rise; y++) set(lx, y, lz, b.roof);
  } else if (isWall && b.lastFloor >= 2) set(lx, top + 1, lz, wall); // parapet on bigger flat roofs
}

// ---------- generate one chunk ----------
export function generateChunk(tile, cx, cz, detail, edits, env) {
  CX = cx; CZ = cz; maxY = 0;
  const X0 = cx * CHUNK - GP, Z0 = cz * CHUNK - GP;
  const all = tile.index.get(cx + ',' + cz) || [], st = env.stage;
  const list = st >= 2 ? all : [];
  const F = tile.feats;

  // 1. Bare terrain
  for (let iz = 0; iz < GS; iz++) for (let ix = 0; ix < GS; ix++) {
    const ci = iz * GS + ix, x = X0 + ix + 0.5, z = Z0 + iz + 0.5;
    let g = env.ground(x, z);
    surf[ci] = B.GRASS; veg[ci] = 4; occ[ci] = 0; wl[ci] = -1;
    if (tile.coast && env.sea(x, z)) { surf[ci] = B.WATER; veg[ci] = 0; wl[ci] = env.seaY; g = Math.min(g, env.seaY - 2); }
    gy[ci] = g;
  }

  // 2. Paint the ground: land use, water, then roads on top
  for (const i of list) {
    const f = F[i];
    if (f.k === 'a') fillPoly(f.rings, f.bbox, X0, Z0, (ci) => { surf[ci] = f.block; veg[ci] = f.veg; wl[ci] = f.block === B.WATER && f.level != null ? f.level : -1; });
  }
  for (const i of list) {                                             // sidewalks, footpaths, streams
    const f = F[i];
    if (f.k !== 'r') continue;
    if (f.sw) stroke(f.pts, f.hw + 2, X0, Z0, (ci) => { surf[ci] = B.SIDEWALK; veg[ci] = 0; });
    else if (f.block === B.WATER) stroke(f.pts, f.hw, X0, Z0, (ci) => { surf[ci] = B.WATER; veg[ci] = 0; wl[ci] = -1; });
    else if (f.foot && !f.cross) stroke(f.pts, f.hw, X0, Z0, (ci) => { if (surf[ci] !== B.WATER || f.block === B.PLANKS) { surf[ci] = f.block; veg[ci] = 0; } });
  }
  for (const i of list) {                                             // road surfaces
    const f = F[i];
    if (f.k !== 'r' || f.foot || f.block === B.WATER) continue;
    stroke(f.pts, f.hw, X0, Z0, (ci, d) => { surf[ci] = f.rail && d < 0.9 ? B.RAIL : f.block; veg[ci] = 0; });
  }
  for (const i of list) {                                             // lane markings + zebra crossings
    const f = F[i];
    if (f.k !== 'r') continue;
    if (f.line) stroke(f.pts, 0.5, X0, Z0, (ci, d, along) => { if (surf[ci] === B.ASPHALT && along % 8 < 4) surf[ci] = f.line === 2 ? B.LINE_YELLOW : B.LINE_WHITE; });
    if (f.cross) stroke(f.pts, 2, X0, Z0, (ci, d, along, side) => { if ((surf[ci] === B.ASPHALT || surf[ci] === B.LINE_YELLOW) && Math.floor(d * side + 64) % 2 === 0) surf[ci] = B.LINE_WHITE; });
  }

  // 3. Building footprints: flatten the ground and remember every column for step 5
  const cols = [];
  for (const i of list) {
    const b = F[i];
    if (b.k !== 'b' || st < 3) continue;
    const start = cols.length;
    fillPoly(b.rings, b.bbox, X0, Z0, (ci, ix, iz) => {
      const d = edgeDist(b.E, X0 + ix + 0.5, Z0 + iz + 0.5);
      cols.push(ix, iz, d, eI, eT, eL);
      occ[ci] = 1;
      if (b.minH === 0) { gy[ci] = b.base; surf[ci] = b.home ? B.PLANKS : B.CONCRETE; veg[ci] = 0; wl[ci] = -1; }
    });
    cols.push(-1, i, start, 0, 0, 0);                                 // marker: "the columns since `start` belong to building i"
  }

  // 4. Fill the terrain volume
  for (let vz = 0; vz < SIZE; vz++) for (let vx = 0; vx < SIZE; vx++) {
    const ci = (vz + GP - PAD) * GS + vx + GP - PAD, lx = vx - PAD, lz = vz - PAD, s = surf[ci];
    let g = gy[ci];
    if (s === B.WATER) {
      const level = wl[ci] >= 0 ? wl[ci] : g, bot = Math.min(g, level) - 2;
      for (let y = 0; y < bot; y++) set(lx, y, lz, y < bot - 3 ? B.STONE : B.DIRT);
      set(lx, bot, lz, B.SAND);
      for (let y = bot + 1; y <= level; y++) set(lx, y, lz, B.WATER);
    } else {
      const sub = occ[ci] ? B.STONE : s === B.SAND ? B.SAND : B.DIRT;   // stone foundations under buildings
      for (let y = 0; y < g; y++) set(lx, y, lz, y < g - 3 ? B.STONE : sub);
      set(lx, g, lz, s);
    }
  }

  // 5. Raise the buildings
  for (let k = 0, start = 0; k < cols.length; k += 6) {
    if (cols[k] !== -1) continue;
    const b = F[cols[k + 1]];
    for (let j = start; j < k; j += 6) {
      const lx = cols[j] - GP, lz = cols[j + 1] - GP;
      if (lx < -PAD || lx >= CHUNK + PAD || lz < -PAD || lz >= CHUNK + PAD) continue;
      eI = cols[j + 3]; eT = cols[j + 4]; eL = cols[j + 5];
      buildColumn(b, lx, lz, cols[j + 2], detail);
    }
    start = k + 6;
  }

  // 6. Garden walls, street lamps, trees
  const free = (ci) => !occ[ci] && (surf[ci] === B.GRASS || surf[ci] === B.FOREST_FLOOR || surf[ci] === B.FARMLAND || surf[ci] === B.SIDEWALK || surf[ci] === B.PATH || surf[ci] === B.SAND);
  for (const i of st >= 4 ? list : []) {
    const f = F[i];
    if (f.k === 'w') stroke(f.pts, 0.55, X0, Z0, (ci) => {
      if (!free(ci)) return;
      const lx = (ci % GS) - GP, lz = Math.floor(ci / GS) - GP;
      for (let h = 1; h <= f.height; h++) set(lx, gy[ci] + h, lz, f.block);
    });
    else if (f.k === 'p') {
      const ix = Math.floor(f.x - X0), iz = Math.floor(f.z - Z0);
      if (ix < 0 || iz < 0 || ix >= GS || iz >= GS) continue;
      const ci = iz * GS + ix, g = gy[ci], lx = ix - GP, lz = iz - GP;
      if (!free(ci)) continue;
      if (f.t === 1) { for (let h = 1; h <= 4; h++) set(lx, g + h, lz, B.IRON); set(lx, g + 5, lz, B.LAMP); }
      else tree(lx, lz, g, ix + X0 * 31 + (iz + Z0) * 17, false);
    }
  }
  const pine = Math.abs(env.lat) > 52 ? 0.5 : 0.12;
  const DENSITY = [0, 0.008, 0.035, 0.012, 0.0012];                    // none, park, forest, scrub, everywhere else
  for (let iz = 0; iz < GS; iz++) for (let ix = 0; ix < GS; ix++) {
    const ci = iz * GS + ix, v = veg[ci];
    if (st < 4 || !v || occ[ci] || (surf[ci] !== B.GRASS && surf[ci] !== B.FOREST_FLOOR && surf[ci] !== B.FARMLAND)) continue;
    const wx = X0 + ix, wz = Z0 + iz;
    if (hash(wx, wz, 77) >= DENSITY[v]) continue;
    if (v === 3 && hash(wx, wz, 5) < 0.6) set(ix - GP, gy[ci] + 1, iz - GP, B.LEAVES);   // a bush
    else tree(ix - GP, iz - GP, gy[ci], wx * 7919 + wz, hash(wx, wz, 9) < pine);
  }

  // 7. Blocks the player has placed or broken
  if (edits) for (let i = 0; i < edits.length; i += 4) {
    const lx = edits[i] - cx * CHUNK, lz = edits[i + 2] - cz * CHUNK;
    set(lx, edits[i + 1], lz, edits[i + 3]);
    if (edits[i + 1] > maxY) maxY = Math.min(MAX_Y - 1, edits[i + 1]);
  }

  const H = Math.min(MAX_Y, maxY + 2);
  const vox = scratch.slice(0, SIZE * SIZE * H);
  scratch.fill(0, 0, SIZE * SIZE * H);
  return { vox, H };
}
