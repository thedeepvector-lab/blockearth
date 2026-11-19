// First-person player: mouse look, walking / flying, collisions, and the block ray cast.
import { B } from './blocks.js';

const HALF = 0.3, HEIGHT = 1.8, EYE = 1.62;

export class Player {
  constructor(camera, world, dom) {
    this.camera = camera; this.world = world; this.dom = dom;
    this.pos = { x: 0, y: 200, z: 0 };       // feet position
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = -0.25;
    this.fly = true; this.onGround = false; this.stepLift = 0;
    this.keys = new Set();
    this.locked = false;
    this.frozen = true;                       // until the ground under us exists
    let lastSpace = 0;

    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; this.keys.clear(); this.onLock?.(this.locked); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.0022));
    });
    addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (e.code === 'Space' && !e.repeat) { const now = performance.now(); if (now - lastSpace < 280) this.toggleFly(); lastSpace = now; }
      if (e.code === 'KeyF' && !e.repeat) this.toggleFly();
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  toggleFly() { this.fly = !this.fly; this.vel.y = 0; }
  lock() { try { const r = this.dom.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* browser refused: click the world to try again */ } }

  // Is the player's box touching any solid block at this position?
  hits(x, y, z) {
    const w = this.world;
    for (let by = Math.floor(y); by <= Math.floor(y + HEIGHT); by++)
      for (let bz = Math.floor(z - HALF); bz <= Math.floor(z + HALF); bz++)
        for (let bx = Math.floor(x - HALF); bx <= Math.floor(x + HALF); bx++)
          if (w.solid(bx, by, bz)) return true;
    return false;
  }
  blockAtFeet(dy = 0.1) { return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + dy), Math.floor(this.pos.z)); }

  update(dt) {
    const k = this.keys, p = this.pos, v = this.vel;
    const here = this.blockAtFeet();
    if (here === -1) this.frozen = true; else if (this.frozen) { this.frozen = false; }
    if (this.frozen && !this.fly) { this.applyCamera(); return; }

    // --- input -> wanted horizontal velocity ---
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    const inWater = here === B.WATER, onLadder = here === B.LADDER || this.blockAtFeet(1) === B.LADDER;
    let speed = this.fly ? (fast ? 60 : 14) : fast ? 7.5 : 4.4;
    if (inWater && !this.fly) speed *= 0.55;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw), len = Math.hypot(f, s) || 1;
    const wx = ((-sin * f + cos * s) / len) * speed, wz = ((-cos * f - sin * s) / len) * speed;
    const grip = this.fly ? 8 : this.onGround ? 14 : 3;
    v.x += (wx - v.x) * Math.min(1, grip * dt);
    v.z += (wz - v.z) * Math.min(1, grip * dt);

    // --- vertical ---
    if (this.fly) {
      const up = (k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0);
      v.y += (up * speed * 0.8 - v.y) * Math.min(1, 8 * dt);
    } else if (onLadder) {
      v.y = k.has('Space') || f > 0 ? 4 : k.has('KeyQ') || f < 0 ? -4 : 0;
    } else if (inWater) {
      v.y = Math.max(-2.5, v.y - 8 * dt);
      if (k.has('Space')) v.y = 3.2;
    } else {
      v.y = Math.max(-55, v.y - 28 * dt);
      if (k.has('Space') && this.onGround) v.y = 8.6;
    }

    // --- move one axis at a time, in small steps, snapping against blocks ---
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt) / 0.4));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      let nx = p.x + v.x * h;
      if (this.hits(nx, p.y, p.z)) {
        if (this.onGround && !this.fly && !this.hits(nx, p.y + 1.02, p.z) && !this.hits(p.x, p.y + 1.02, p.z)) { p.y += 1.02; this.stepLift = -1; }   // auto step-up
        else { nx = p.x; v.x = 0; }
      }
      p.x = nx;
      let nz = p.z + v.z * h;
      if (this.hits(p.x, p.y, nz)) {
        if (this.onGround && !this.fly && !this.hits(p.x, p.y + 1.02, nz) && !this.hits(p.x, p.y + 1.02, p.z)) { p.y += 1.02; this.stepLift = -1; }
        else { nz = p.z; v.z = 0; }
      }
      p.z = nz;
      const ny = p.y + v.y * h;
      if (this.hits(p.x, ny, p.z)) {
        if (v.y < 0) { p.y = Math.floor(ny) + 1.001; this.onGround = true; }
        else p.y = Math.floor(ny + HEIGHT) - HEIGHT - 0.001;
        if (this.hits(p.x, p.y, p.z)) p.y = Math.floor(p.y) + 1.001;      // never get stuck inside a block
        v.y = 0;
      } else { p.y = ny; if (v.y !== 0) this.onGround = false; }
    }
    if (!this.fly && !this.onGround && v.y === 0) this.onGround = this.hits(p.x, p.y - 0.05, p.z);
    if (p.y < -20) p.y = 300;
    this.stepLift *= Math.max(0, 1 - 12 * dt);
    this.applyCamera();
  }

  applyCamera() {
    this.camera.position.set(this.pos.x, this.pos.y + EYE + this.stepLift, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  forward() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  // Walk a ray through the block grid one cell at a time (DDA). Returns the first block hit.
  raycast(maxDist = 7) {
    const o = this.camera.position, d = this.forward(), w = this.world;
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const step = [Math.sign(d[0]), Math.sign(d[1]), Math.sign(d[2])];
    const tDelta = d.map((c) => (c ? Math.abs(1 / c) : Infinity));
    const frac = (v, s) => (s > 0 ? 1 - (v - Math.floor(v)) : v - Math.floor(v));
    const tMax = [frac(o.x, step[0]) * tDelta[0], frac(o.y, step[1]) * tDelta[1], frac(o.z, step[2]) * tDelta[2]];
    let px = x, py = y, pz = z, t = 0;
    while (t <= maxDist) {
      const id = w.getBlock(x, y, z);
      if (id > 0 && id !== B.WATER) return { x, y, z, px, py, pz, id, t };
      px = x; py = y; pz = z;
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      t = tMax[a]; tMax[a] += tDelta[a];
      if (a === 0) x += step[0]; else if (a === 1) y += step[1]; else z += step[2];
    }
    return null;
  }

  overlaps(bx, by, bz) {
    const p = this.pos;
    return bx + 1 > p.x - HALF && bx < p.x + HALF && by + 1 > p.y && by < p.y + HEIGHT && bz + 1 > p.z - HALF && bz < p.z + HALF;
  }
}
