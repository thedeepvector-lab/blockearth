// The streaming world: downloads map tiles around the player, asks workers for chunks, owns the meshes.
import * as THREE from 'three';
import { CHUNK, SIZE, PAD, TILE_M, TILE_CHUNKS, M_PER_LAT, BASE_Y } from './config.js';
import { B, SOLID } from './blocks.js';
import { makeProj, snapOrigin, pointInPoly } from './geo.js';
import { Elevation, loadTerrainTile } from './elevation.js';
import { fetchOSM, parseOSM } from './osm.js';
import { cacheGet, cachePut } from './cache.js';

const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

export class World {
  constructor(scene, materials) {
    this.scene = scene;
    this.mat = materials;
    this.radius = 7;
    this.chunks = new Map();
    this.tiles = new Map();
    this.edits = new Map();                // chunk key -> Map("x,y,z" -> [x,y,z,id])
    this.elev = new Elevation();
    this.terrainTiles = new Map();
    this.epoch = 0;
    this.status = '';
    this.ready = false;
    this.offline = null;                   // optional: function(bbox) -> Overpass JSON (used for bundled demo data)
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => this.onWorker(w, e.data);
      this.workers.push(w);
    }
    this.pending = new Set();
    this.job = 0;
  }

  post(msg) { for (const w of this.workers) w.postMessage(msg); }

  // ----- origin -----
  async setOrigin(lat, lon, stage = 9, noAO = false) {
    const epoch = ++this.epoch;
    this.ready = false;
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear(); this.tiles.clear(); this.edits.clear(); this.pending.clear();
    const [lat0, lon0] = snapOrigin(lat, lon);
    this.proj = makeProj(lat0, lon0);
    this.status = 'Reading terrain…';
    const [px, py] = this.elev.pixel(lat, lon);
    await this.terrain(px >> 8, py >> 8);
    if (epoch !== this.epoch) return null;
    const e = this.elev.sample(lat, lon);
    this.e0 = e === e ? e : 0;
    this.post({ type: 'init', epoch, lat0, lon0, e0: this.e0, stage, noAO });
    this.ready = true;
    return this.proj.toLocal(lat, lon);      // where the player should appear
  }

  terrain(x, y) {
    const k = x * 65536 + y;
    if (!this.terrainTiles.has(k)) this.terrainTiles.set(k, loadTerrainTile(x, y).then((data) => {
      if (data) { this.elev.add(x, y, data); this.post({ type: 'elev', x, y, data }); }
    }));
    return this.terrainTiles.get(k);
  }

  // ----- map data tiles (512 m squares) -----
  async loadTile(tx, tz) {
    const key = tx + ',' + tz, epoch = this.epoch, p = this.proj;
    const tile = { tx, tz, state: 'loading', feats: [] };
    this.tiles.set(key, tile);
    try {
      const m = 24;                           // small margin so roads on the border are complete
      const [n, w] = p.toGeo(tx * TILE_M - m, tz * TILE_M - m), [s, e] = p.toGeo((tx + 1) * TILE_M + m, (tz + 1) * TILE_M + m);
      const id = `v2/${p.lat0.toFixed(6)}/${p.lon0.toFixed(6)}/${key}`;
      let raw = this.offline ? await this.offline(s, w, n, e) : await cacheGet(id);
      if (!raw) { raw = await fetchOSM(s, w, n, e); cachePut(id, raw); }
      // terrain under the whole tile (+ margin for big buildings)
      const [x0, y0] = this.elev.pixel(n + 300 / M_PER_LAT, w - 300 / p.mLon), [x1, y1] = this.elev.pixel(s - 300 / M_PER_LAT, e + 300 / p.mLon);
      const jobs = [];
      for (let y = y0 >> 8; y <= y1 >> 8; y++) for (let x = x0 >> 8; x <= x1 >> 8; x++) jobs.push(this.terrain(x, y));
      await Promise.all(jobs);
      if (epoch !== this.epoch) return;
      const { feats, coast } = parseOSM(raw.elements || [], p);
      tile.feats = feats;
      tile.buildings = feats.filter((f) => f.k === 'b');
      this.post({ type: 'tile', epoch, tx, tz, feats, coast });
      tile.state = 'ready';
    } catch (err) {
      console.warn('tile failed', key, err);
      tile.state = 'error';
      tile.retryAt = performance.now() + 8000;
    }
  }

  // ----- every frame -----
  update(px, pz) {
    if (!this.ready) return;
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK), R = this.radius;
    this.pcx = pcx; this.pcz = pcz;
    let loading = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R + R) continue;
      const cx = pcx + dx, cz = pcz + dz, k = ckey(cx, cz);
      const tx = Math.floor(cx / TILE_CHUNKS), tz = Math.floor(cz / TILE_CHUNKS);
      let tile = this.tiles.get(tx + ',' + tz);
      if (!tile || (tile.state === 'error' && performance.now() > tile.retryAt)) { this.loadTile(tx, tz); tile = this.tiles.get(tx + ',' + tz); }
      if (tile.state !== 'ready') { loading++; continue; }
      let c = this.chunks.get(k);
      if (!c) this.chunks.set(k, (c = { cx, cz, k, detail: -1, version: 0, built: -1, vox: null, H: 0, meshes: [] }));
      // Level of detail: interiors only exist close to the player.
      const want = d2 <= 5 ? 1 : c.detail === 1 && d2 <= 13 ? 1 : 0;
      if (c.detail !== want) { c.detail = want; c.version++; }
      if (c.built !== c.version) { this.pending.add(k); loading++; }
    }
    // forget far-away chunks and tiles
    for (const c of this.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (R + 3) * (R + 3)) { this.disposeChunk(c); this.chunks.delete(c.k); this.pending.delete(c.k); }
    }
    const ptx = Math.floor(px / TILE_M), ptz = Math.floor(pz / TILE_M);
    for (const [key, t] of this.tiles) {
      if (t.state !== 'loading' && Math.max(Math.abs(t.tx - ptx), Math.abs(t.tz - ptz)) > 2 + Math.ceil((R * CHUNK) / TILE_M)) { this.tiles.delete(key); this.post({ type: 'drop', key }); }
    }
    this.loading = loading;
    this.dispatch();
  }

  // Give each idle worker the most urgent chunk (closest to the player first).
  dispatch() {
    for (const w of this.workers) {
      if (w.busy || !this.pending.size) continue;
      let best = null, bestD = Infinity;
      for (const k of this.pending) {
        const c = this.chunks.get(k);
        if (!c) { this.pending.delete(k); continue; }
        const d = (c.cx - this.pcx) ** 2 + (c.cz - this.pcz) ** 2 - (c.urgent ? 1e6 : 0) + (c.vox ? 40 : 0);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best) return;
      this.pending.delete(best.k);
      best.urgent = false;
      w.busy = true;
      w.postMessage({ type: 'gen', job: ++this.job, epoch: this.epoch, cx: best.cx, cz: best.cz, detail: best.detail, version: best.version, edits: this.editsAround(best.cx, best.cz) });
    }
  }

  onWorker(w, m) {
    w.busy = false;
    if (m.type === 'chunk' && m.epoch === this.epoch) {
      const c = this.chunks.get(ckey(m.cx, m.cz));
      if (c) {
        this.disposeChunk(c);
        c.vox = m.vox; c.H = m.H; c.built = m.version;
        for (const [geo, mat, order] of [[m.opaque, this.mat.opaque, 0], [m.trans, this.mat.trans, 1]]) {
          if (!geo.idx.length) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(geo.pos, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(geo.uv, 2));
          g.setAttribute('light', new THREE.BufferAttribute(geo.light, 3));
          g.setIndex(new THREE.BufferAttribute(geo.idx, 1));
          g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK / 2, m.H / 2, CHUNK / 2), Math.hypot(CHUNK * 0.75, m.H / 2));
          const mesh = new THREE.Mesh(g, mat);
          mesh.position.set(m.cx * CHUNK, 0, m.cz * CHUNK);
          mesh.renderOrder = order;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          this.scene.add(mesh);
          c.meshes.push(mesh);
        }
        if (c.built !== c.version) this.pending.add(c.k);
      }
    }
    this.dispatch();
  }

  disposeChunk(c) {
    for (const m of c.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    c.meshes = [];
  }

  // ----- block access (used by physics, ray casting, editing) -----
  getBlock(x, y, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(ckey(cx, cz));
    if (!c || !c.vox) return -1;                                   // not loaded yet
    if (y < 0) return B.STONE;
    if (y >= c.H) return 0;
    return c.vox[(y * SIZE + (z - cz * CHUNK) + PAD) * SIZE + (x - cx * CHUNK) + PAD];
  }
  solid(x, y, z) { const id = this.getBlock(x, y, z); return id > 0 && SOLID[id] === 1; }

  setBlock(x, y, z, id) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), k = ckey(cx, cz);
    if (!this.edits.has(k)) this.edits.set(k, new Map());
    this.edits.get(k).set(x + ',' + y + ',' + z, [x, y, z, id]);
    const c = this.chunks.get(k);
    if (c && c.vox && y < c.H) c.vox[(y * SIZE + (z - cz * CHUNK) + PAD) * SIZE + (x - cx * CHUNK) + PAD] = id;   // instant feedback for physics
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx === -1 && lx > 0) || (dx === 1 && lx < CHUNK - 1) || (dz === -1 && lz > 0) || (dz === 1 && lz < CHUNK - 1)) continue;
      const n = this.chunks.get(ckey(cx + dx, cz + dz));
      if (n) { n.version++; n.urgent = true; this.pending.add(n.k); }
    }
    this.dispatch();
  }

  editsAround(cx, cz) {
    let out = null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const m = this.edits.get(ckey(cx + dx, cz + dz));
      if (m) for (const e of m.values()) (out ||= []).push(e[0], e[1], e[2], e[3]);
    }
    return out;
  }

  // Terrain height (block Y) at any spot, straight from the elevation data.
  groundAt(x, z) {
    const g = this.proj.toGeo(x, z), e = this.elev.sample(g[0], g[1]);
    return e === e ? Math.min(800, Math.max(6, BASE_Y + Math.round(e - this.e0))) : BASE_Y;
  }

  // Highest solid block at a column (for spawning).
  surfaceY(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), c = this.chunks.get(ckey(cx, cz));
    if (!c || !c.vox) return null;
    for (let y = c.H - 1; y >= 0; y--) if (this.getBlock(x, y, z) > 0) return y;
    return 0;
  }

  // Which real building is at this spot? (for the "Looking at" label)
  buildingAt(x, z) {
    const t = this.tiles.get(Math.floor(x / TILE_M) + ',' + Math.floor(z / TILE_M));
    if (!t || !t.buildings) return null;
    let best = null;
    for (const b of t.buildings) if (pointInPoly(x, z, b) && (!best || b.info.name)) best = b;
    return best;
  }

  stats() {
    let tris = 0;
    for (const c of this.chunks.values()) for (const m of c.meshes) tris += m.geometry.index.count / 3;
    return { chunks: this.chunks.size, tris, pending: this.pending.size };
  }
}
