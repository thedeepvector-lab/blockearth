// Web Worker: builds chunks off the main thread so the game never stutters.
import { BASE_Y, TILE_CHUNKS } from './config.js';
import { makeProj } from './geo.js';
import { Elevation } from './elevation.js';
import { prepareTile, generateChunk } from './generate.js';
import { meshChunk } from './mesher.js';

let proj = null, env = null, epoch = 0;
const elev = new Elevation();
const tiles = new Map();

onmessage = ({ data: m }) => {
  if (m.type === 'init') {                       // a new origin: forget everything
    epoch = m.epoch;
    proj = makeProj(m.lat0, m.lon0);
    tiles.clear();
    const e0 = m.e0;
    const raw = (x, z) => { const g = proj.toGeo(x, z); return elev.sample(g[0], g[1]); };
    env = {
      lat: m.lat0,
      noAO: !!m.noAO,
      stage: m.stage || 9,          // 1 terrain, 2 +ground paint, 3 +buildings, 9 everything (for the tutorial)
      seaY: BASE_Y + Math.round(-e0),
      ground: (x, z) => { const e = raw(x, z); return e === e ? Math.min(800, Math.max(6, BASE_Y + Math.round(e - e0))) : BASE_Y; },
      sea: (x, z) => raw(x, z) <= 0,
    };
  } else if (m.type === 'elev') {
    elev.add(m.x, m.y, m.data);
  } else if (m.type === 'tile') {
    if (m.epoch !== epoch) return;
    const tile = { tx: m.tx, tz: m.tz, feats: m.feats, coast: m.coast };
    prepareTile(tile, env);
    tiles.set(m.tx + ',' + m.tz, tile);
  } else if (m.type === 'drop') {
    tiles.delete(m.key);
  } else if (m.type === 'gen') {
    const tile = tiles.get(Math.floor(m.cx / TILE_CHUNKS) + ',' + Math.floor(m.cz / TILE_CHUNKS));
    if (m.epoch !== epoch || !tile) return postMessage({ type: 'skip', job: m.job });
    const { vox, H } = generateChunk(tile, m.cx, m.cz, m.detail, m.edits, env);
    const { opaque, trans } = meshChunk(vox, H, env.noAO);
    const transfer = [vox.buffer];
    for (const g of [opaque, trans]) transfer.push(g.pos.buffer, g.uv.buffer, g.light.buffer, g.idx.buffer);
    postMessage({ type: 'chunk', job: m.job, epoch: m.epoch, cx: m.cx, cz: m.cz, detail: m.detail, version: m.version, vox, H, opaque, trans }, transfer);
  }
};
