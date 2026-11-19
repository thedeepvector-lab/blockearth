// Voxels -> triangles. Only faces that touch air/glass/water are emitted, with baked ambient occlusion.
import { SIZE } from './config.js';
import { TILES, SEE_THROUGH, TRANSLUCENT, GLOW, B } from './blocks.js';

// For each of the 6 faces: outward direction, the 4 corners (bottom-left, bottom-right, top-right, top-left
// as seen from outside), and a fixed "sun" shade — top faces brightest, like Minecraft.
const FACES = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.72, tile: 1 },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.72, tile: 1 },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, tile: 0 },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, tile: 2 },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.86, tile: 1 },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.86, tile: 1 },
];
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

class Buffer {
  constructor() { this.cap = 1 << 14; this.pos = new Float32Array(this.cap * 3); this.uv = new Float32Array(this.cap * 2); this.light = new Float32Array(this.cap * 3); this.idx = new Uint32Array(this.cap * 1.5); this.n = 0; this.ni = 0; }
  grow() {
    this.cap *= 2;
    const g = (a, T, k) => { const b = new T(this.cap * k); b.set(a); return b; };
    this.pos = g(this.pos, Float32Array, 3); this.uv = g(this.uv, Float32Array, 2); this.light = g(this.light, Float32Array, 3); this.idx = g(this.idx, Uint32Array, 1.5);
  }
  take() {
    const out = { pos: this.pos.slice(0, this.n * 3), uv: this.uv.slice(0, this.n * 2), light: this.light.slice(0, this.n * 3), idx: this.idx.slice(0, this.ni) };
    this.n = this.ni = 0;
    return out;
  }
}
const opaque = new Buffer(), trans = new Buffer();
const ao = [0, 0, 0, 0];

export function meshChunk(vox, H, flatLight = false) {
  const S = SIZE, SS = S * S;
  const at = (x, y, z) => (y < 0 ? B.STONE : y >= H ? 0 : vox[(y * S + z) * S + x]);

  for (let y = 0; y < H; y++) for (let z = 1; z < S - 1; z++) for (let x = 1; x < S - 1; x++) {
    const id = vox[y * SS + z * S + x];
    if (!id) continue;
    const buf = TRANSLUCENT[id] ? trans : opaque;
    const lowTop = id === B.WATER && at(x, y + 1, z) !== B.WATER ? 0.88 : 1;

    for (let f = 0; f < 6; f++) {
      const F = FACES[f], d = F.d;
      const nb = at(x + d[0], y + d[1], z + d[2]);
      if (!SEE_THROUGH[nb] || nb === id) continue;          // hidden face: skip it
      if (y === 0 && f === 3) continue;

      if (buf.n + 4 > buf.cap) buf.grow();
      const tile = TILES[id * 3 + F.tile];
      const glow = GLOW[id];
      for (let i = 0; i < 4; i++) {
        const c = F.c[i];
        // Ambient occlusion: count solid blocks touching this corner (2 edges + 1 diagonal).
        let s1, s2, cr;
        const ox = c[0] * 2 - 1, oy = c[1] * 2 - 1, oz = c[2] * 2 - 1;
        const bx = x + d[0], by = y + d[1], bz = z + d[2];
        if (d[0]) { s1 = at(bx, by + oy, bz); s2 = at(bx, by, bz + oz); cr = at(bx, by + oy, bz + oz); }
        else if (d[1]) { s1 = at(bx + ox, by, bz); s2 = at(bx, by, bz + oz); cr = at(bx + ox, by, bz + oz); }
        else { s1 = at(bx + ox, by, bz); s2 = at(bx, by + oy, bz); cr = at(bx + ox, by + oy, bz); }
        s1 = SEE_THROUGH[s1] ? 0 : 1; s2 = SEE_THROUGH[s2] ? 0 : 1; cr = SEE_THROUGH[cr] ? 0 : 1;
        ao[i] = flatLight ? 3 : s1 && s2 ? 0 : 3 - s1 - s2 - cr;   // flatLight: tutorial switch to show the world without AO

        const n = buf.n + i;
        buf.pos[n * 3] = x - 1 + c[0];
        buf.pos[n * 3 + 1] = y + (c[1] ? lowTop : 0);
        buf.pos[n * 3 + 2] = z - 1 + c[2];
        buf.uv[n * 2] = UV[i][0];
        buf.uv[n * 2 + 1] = UV[i][1];
        buf.light[n * 3] = F.shade * (0.5 + ao[i] * 0.1667);   // baked brightness
        buf.light[n * 3 + 1] = glow;                             // glows at night?
        buf.light[n * 3 + 2] = tile;                             // which texture layer
      }
      // Two triangles per face; flip the diagonal so the AO gradient looks symmetric.
      const n = buf.n, k = buf.ni;
      if (ao[0] + ao[2] >= ao[1] + ao[3]) { buf.idx[k] = n; buf.idx[k + 1] = n + 1; buf.idx[k + 2] = n + 2; buf.idx[k + 3] = n; buf.idx[k + 4] = n + 2; buf.idx[k + 5] = n + 3; }
      else { buf.idx[k] = n + 1; buf.idx[k + 1] = n + 2; buf.idx[k + 2] = n + 3; buf.idx[k + 3] = n + 1; buf.idx[k + 4] = n + 3; buf.idx[k + 5] = n; }
      buf.n += 4; buf.ni += 6;
    }
  }
  return { opaque: opaque.take(), trans: trans.take() };
}
