// Paints every block texture into one 128x128 canvas (an 8x8 grid of 16px tiles).
import { TILE_NAMES } from './blocks.js';

let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const jit = (c, v) => { const n = (rnd() - 0.5) * 2 * v; return [c[0] + n, c[1] + n, c[2] + n, c[3] ?? 1]; };

const noisy = (c, v = 9) => () => jit(c, v);
const bricks = (c, mortar, v = 10) => (x, y) => {
  const off = ((y >> 2) & 1) * 4;
  return y % 4 === 3 || (x + off) % 8 === 7 ? jit(mortar, 5) : jit(c, v);
};
const planks = (c) => (x, y) => (y % 4 === 3 ? jit([c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], 4) : jit(c, 7 + ((y >> 2) % 2) * 4));
const slabs = (c, line) => (x, y) => (x % 8 === 0 || y % 8 === 0 ? jit(line, 4) : jit(c, 6));
const glass = (c, a) => (x, y) => {
  if (x === 0 || y === 0 || x === 15 || y === 15) return [c[0] * 0.55, c[1] * 0.6, c[2] * 0.65, 0.95];
  if ((x + y === 7 || x + y === 8) && x < 7 && x > 1) return [255, 255, 255, Math.min(1, a + 0.3)];
  return [c[0], c[1], c[2], a];
};
const leaves = (c) => () => (rnd() < 0.22 ? null : jit(c, 22));
const tiles = (c) => (x, y) => (y % 4 === 0 ? jit([c[0] * 0.65, c[1] * 0.65, c[2] * 0.65], 4) : (x + (y >> 2) * 3) % 6 === 0 ? jit([c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], 4) : jit(c, 8));

const PAINT = {
  grass_top: noisy([104, 168, 66], 14),
  grass_side: (x, y) => (y < 3 + ((x * 7) % 3) ? jit([104, 168, 66], 12) : jit([134, 96, 67], 10)),
  dirt: noisy([134, 96, 67], 12),
  stone: noisy([128, 128, 128], 12),
  sand: noisy([222, 207, 160], 8),
  water: (x, y) => ((x + y * 3) % 9 === 0 ? [120, 180, 240, 0.72] : [52, 110 + rnd() * 12, 215, 0.72]),
  asphalt: noisy([58, 60, 64], 6),
  line_white: (x) => (x > 5 && x < 10 ? jit([235, 235, 228], 5) : jit([58, 60, 64], 6)),
  line_yellow: (x) => (x > 5 && x < 10 ? jit([232, 190, 60], 5) : jit([58, 60, 64], 6)),
  parking: (x, y) => (x === 0 ? jit([220, 220, 215], 5) : jit([72, 74, 78], 6)),
  sidewalk: slabs([176, 174, 168], [146, 144, 138]),
  path: noisy([168, 150, 120], 14),
  cobble: (x, y) => ((x + ((y >> 2) & 1) * 2) % 4 === 3 || y % 4 === 3 ? jit([108, 104, 100], 5) : jit([150, 146, 140], 10)),
  brick: bricks([156, 74, 58], [196, 188, 176]),
  brick_yellow: bricks([196, 160, 104], [214, 206, 190]),
  concrete_white: noisy([226, 226, 222], 5),
  concrete: noisy([166, 168, 170], 6),
  concrete_dark: noisy([84, 88, 94], 6),
  sandstone: (x, y) => (y % 5 === 4 ? jit([196, 178, 132], 5) : jit([218, 202, 158], 7)),
  stucco_cream: noisy([236, 222, 188], 5),
  stucco_terra: noisy([208, 138, 100], 6),
  stucco_blue: noisy([150, 176, 196], 6),
  planks: planks([178, 138, 84]),
  glass: glass([176, 216, 240], 0.3),
  glass_blue: glass([58, 118, 168], 0.78),
  roof_red: tiles([170, 72, 52]),
  roof_slate: tiles([78, 84, 96]),
  roof_green: tiles([96, 150, 128]),
  log_side: (x) => (x % 4 === 0 ? jit([74, 54, 34], 5) : jit([104, 78, 48], 8)),
  log_top: (x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return d > 6.6 ? jit([74, 54, 34], 4) : jit(Math.floor(d) % 2 ? [188, 152, 98] : [164, 128, 80], 5); },
  leaves: leaves([58, 132, 48]),
  leaves_dark: leaves([34, 92, 52]),
  bed: (x, y) => (y < 2 ? jit([120, 30, 30], 5) : jit([176, 46, 46], 8)),
  pillow: noisy([238, 238, 238], 6),
  bookshelf: (x, y) => {
    if (y % 8 === 0 || y % 8 === 7 || x === 0 || x === 15) return jit([150, 112, 66], 6);
    const cols = [[168, 52, 48], [52, 96, 160], [60, 140, 80], [200, 170, 70], [120, 70, 140]];
    return jit(cols[(x * 3 + (y >> 3) * 2) % 5], 12);
  },
  lamp: (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? jit([196, 150, 60], 6) : jit([255, 232, 150], 14)),
  table_top: planks([150, 104, 60]),
  table_side: (x, y) => (y < 4 ? jit([150, 104, 60], 6) : x < 3 || x > 12 ? jit([120, 82, 46], 6) : jit([44, 34, 28], 4)),
  rail: (x, y) => (x === 3 || x === 12 ? jit([190, 190, 196], 6) : y % 4 === 1 ? jit([92, 66, 44], 6) : jit([140, 132, 122], 12)),
  pitch: (x, y) => ((y >> 2) % 2 ? jit([74, 160, 72], 5) : jit([86, 174, 80], 5)),
  forest_floor: noisy([74, 112, 52], 16),
  farmland: (x) => (x % 4 === 0 ? jit([92, 62, 40], 6) : jit([138, 104, 62], 9)),
  door: (x, y) => (x === 0 || x === 15 || y === 0 ? jit([70, 48, 30], 4) : x === 12 && y > 6 && y < 10 ? [226, 196, 90] : jit([112, 78, 46], 7)),
  iron: noisy([92, 96, 104], 6),
  stove_side: (x, y) => (y > 5 && y < 13 && x > 2 && x < 13 ? jit([36, 36, 40], 4) : jit([200, 202, 206], 6)),
  stove_top: (x, y) => { const d = Math.hypot((x % 8) - 3.5, (y % 8) - 3.5); return d < 2.6 && d > 1.4 ? jit([40, 40, 44], 4) : jit([200, 202, 206], 6); },
  tv: (x, y) => (x < 1 || x > 14 || y < 2 || y > 12 ? jit([30, 30, 34], 4) : [60 + x * 8, 120 + y * 6, 220 - x * 5]),
  sofa: (x, y) => (y % 8 === 0 ? jit([40, 66, 120], 4) : jit([62, 98, 168], 8)),
  ladder: (x, y) => (x === 2 || x === 3 || x === 12 || x === 13 || y % 4 === 1 ? jit([150, 110, 62], 8) : null),
  counter_top: noisy([214, 214, 220], 10),
};

export function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  TILE_NAMES.forEach((name, i) => {
    const fn = PAINT[name], ox = (i % 8) * 16, oy = (i >> 3) * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const p = fn(x, y);
      if (!p) continue;
      g.fillStyle = `rgba(${p[0] | 0},${p[1] | 0},${p[2] | 0},${p[3] ?? 1})`;
      g.fillRect(ox + x, oy + y, 1, 1);
    }
  });
  return c;
}

// Where a tile sits in the canvas — used by the hotbar icons.
export function tileRect(i) { return [(i % 8) * 16, (i >> 3) * 16, 16, 16]; }

// Slice the canvas into one texture layer per tile. Layers never bleed into each other,
// so the GPU can build clean mipmaps and far-away bricks don't shimmer.
export function atlasLayers(canvas) {
  const g = canvas.getContext('2d'), n = TILE_NAMES.length, data = new Uint8Array(n * 16 * 16 * 4);
  for (let i = 0; i < n; i++) {
    const [x, y] = tileRect(i), px = g.getImageData(x, y, 16, 16).data;
    let r = 0, gr = 0, b = 0, c = 0;
    for (let k = 0; k < px.length; k += 4) if (px[k + 3] > 0) { r += px[k]; gr += px[k + 1]; b += px[k + 2]; c++; }
    for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
      const src = (row * 16 + col) * 4, dst = (i * 256 + (15 - row) * 16 + col) * 4;   // flip rows: textures start at the bottom
      const hole = px[src + 3] === 0;                                                // holes take the average colour (no dark fringes)
      data[dst] = hole ? r / c : px[src]; data[dst + 1] = hole ? gr / c : px[src + 1]; data[dst + 2] = hole ? b / c : px[src + 2]; data[dst + 3] = px[src + 3];
    }
  }
  return { data, size: 16, layers: n };
}
