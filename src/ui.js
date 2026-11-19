// Everything 2D: the menu, address search, HUD text, hotbar and the minimap.
import { NOMINATIM, PLACES, DEMOS, TILE_M } from './config.js';
import { B, TILES, NAMES, HOTBAR } from './blocks.js';
import { tileRect } from './atlas.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(app) {
    this.app = app;
    this.slot = 0;
    this.showMap = true;

    // --- hotbar ---
    HOTBAR.forEach((id, i) => {
      const c = document.createElement('canvas');
      c.width = c.height = 16; c.title = NAMES[id];
      const [x, y, w, h] = tileRect(TILES[id * 3 + 1]);
      c.getContext('2d').drawImage(app.atlas, x, y, w, h, 0, 0, 16, 16);
      $('hotbar').appendChild(c);
    });
    this.select(0);

    // --- menu ---
    for (const [name, lat, lon] of PLACES) {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = () => app.goto(lat, lon, name, null);
      $('places').appendChild(b);
    }
    for (const [name, lat, lon, file] of DEMOS) {
      const b = document.createElement('button');
      b.textContent = name + ' · offline demo'; b.className = 'demo';
      b.onclick = () => app.goto(lat, lon, name, file);
      $('places').appendChild(b);
    }
    $('search').onsubmit = (e) => { e.preventDefault(); this.search($('q').value.trim()); };
    $('home').onclick = () => {
      this.message('Asking your browser for your location…');
      navigator.geolocation.getCurrentPosition(
        (p) => app.goto(p.coords.latitude, p.coords.longitude, 'Your neighbourhood', null),
        () => this.message('Location permission was denied — search for your address instead.'),
      );
    };
    $('resume').onclick = () => app.resume();
    $('radius').oninput = (e) => { app.world.radius = +e.target.value; $('rv').textContent = app.world.radius * 32 + ' m'; };
    $('time').oninput = (e) => { app.sky.hour = +e.target.value % 24; this.timeLabel(); };
    $('radius').value = app.world.radius; $('rv').textContent = app.world.radius * 32 + ' m';
    $('time').value = app.sky.hour; this.timeLabel();
  }

  timeLabel() { const h = this.app.sky.hour; $('tv').textContent = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0'); }
  message(text) { $('results').innerHTML = ''; const d = document.createElement('div'); d.className = 'msg'; d.textContent = text; $('results').appendChild(d); }
  select(i) { this.slot = (i + HOTBAR.length) % HOTBAR.length; [...$('hotbar').children].forEach((c, k) => c.classList.toggle('on', k === this.slot)); }
  block() { return HOTBAR[this.slot]; }
  menu(show) { $('menu').classList.toggle('hidden', !show); $('resume').hidden = !this.app.started; if (show) { $('time').value = this.app.sky.hour; this.timeLabel(); } }
  place(name) { $('place').textContent = name; }

  // "lat, lon" works directly; anything else goes to the free Nominatim geocoder.
  async search(q) {
    if (!q) return;
    const m = /^\s*(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)\s*$/.exec(q);
    if (m) return this.app.goto(+m[1], +m[3], q, null);
    this.message('Searching…');
    try {
      const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`);
      const list = await res.json();
      if (!list.length) return this.message('Nothing found. Try a city or a full address.');
      $('results').innerHTML = '';
      for (const r of list) {
        const b = document.createElement('button');
        b.textContent = r.display_name;
        b.onclick = () => this.app.goto(+r.lat, +r.lon, r.display_name.split(',').slice(0, 2).join(','), null);
        $('results').appendChild(b);
      }
    } catch { this.message('Search is unavailable right now. You can also paste coordinates: 48.8584, 2.2945'); }
  }

  // --- HUD text, refreshed a few times per second ---
  hud(fps) {
    const { player, world, sky } = this.app, p = player.pos;
    if (!world.proj) return;
    const [lat, lon] = world.proj.toGeo(p.x, p.z);
    const dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((-player.yaw * 180) / Math.PI) % 360 + 360) % 360 / 45) % 8];
    $('coords').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}   facing ${dir}\nheight ${Math.round(p.y - world.groundAt(p.x, p.z) - 1)} m   ${fps} fps`;
    const hit = player.raycast(260);
    const b = hit && world.buildingAt(hit.x + 0.5, hit.z + 0.5);
    if (b) {
      const i = b.info, title = i.name || i.addr || (i.type || i.use ? '' : 'Building');
      const bits = [i.name && i.addr, i.use || i.type, `${i.h} m tall`, i.levels ? `${i.levels} floors` : ''].filter(Boolean);
      $('look').innerHTML = '';
      const t = document.createElement('b'); t.textContent = title; $('look').append('▸ ', t, (title ? ' · ' : '') + bits.join(' · '));
    } else $('look').textContent = '';
    $('status').textContent = world.status || (world.loading > 6 ? `Building the world… ${world.loading} chunks to go` : '');
    $('mode').textContent = `${player.fly ? 'Flying' : 'Walking'}  ·  ${String(Math.floor(sky.hour)).padStart(2, '0')}:${String(Math.floor((sky.hour % 1) * 60)).padStart(2, '0')}`;
    $('minimap').style.display = this.showMap ? '' : 'none';
    if (this.showMap) this.minimap();
  }

  minimap() {
    const cv = $('minimap'), g = cv.getContext('2d'), { player, world } = this.app, S = cv.width, SH = cv.height, sc = this.mapScale || 0.55, p = player.pos;
    const half = S / 2 / sc;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#dfe8d6'; g.fillRect(0, 0, S, SH);
    g.setTransform(sc, 0, 0, sc, S / 2 - p.x * sc, SH / 2 - p.z * sc);
    const AREA = { [B.WATER]: '#6aa9e0', [B.FOREST_FLOOR]: '#7fb86f', [B.GRASS]: '#b2d99a', [B.SAND]: '#eadfae', [B.PITCH]: '#8fd08a', [B.PARKING]: '#c9ccd2', [B.FARMLAND]: '#d6c79a', [B.SIDEWALK]: '#d9d6cf', [B.COBBLE]: '#d2cec6', [B.STONE]: '#bdbdbd', [B.PLANKS]: '#c8a878', [B.PATH]: '#d8ccb4' };
    const poly = (f) => { g.beginPath(); for (const r of f.rings) { g.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1]); g.closePath(); } };
    const ptx = Math.floor(p.x / TILE_M), ptz = Math.floor(p.z / TILE_M);
    for (let pass = 0; pass < 3; pass++) for (const t of world.tiles.values()) {
      if (t.state !== 'ready' || Math.abs(t.tx - ptx) > 1 || Math.abs(t.tz - ptz) > 1) continue;
      for (const f of t.feats) {
        const bb = f.bbox;
        if (!bb || bb[2] < p.x - half || bb[0] > p.x + half || bb[3] < p.z - half || bb[1] > p.z + half) continue;
        if (pass === 0 && f.k === 'a') { poly(f); g.fillStyle = AREA[f.block] || '#b2d99a'; g.fill('evenodd'); }
        else if (pass === 1 && f.k === 'r') {
          g.beginPath(); g.moveTo(f.pts[0], f.pts[1]);
          for (let i = 2; i < f.pts.length; i += 2) g.lineTo(f.pts[i], f.pts[i + 1]);
          g.strokeStyle = f.block === B.WATER ? '#6aa9e0' : f.rail ? '#8a8a96' : f.foot ? '#f6efe0' : '#ffffff';
          g.lineWidth = Math.max(f.hw * 2, 2.2); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
        } else if (pass === 2 && f.k === 'b') { poly(f); g.fillStyle = '#c8b59a'; g.fill('evenodd'); g.strokeStyle = '#9c8a70'; g.lineWidth = 1; g.stroke(); }
      }
    }
    // the player arrow
    g.setTransform(1, 0, 0, 1, S / 2, SH / 2);
    g.rotate(-player.yaw);
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath();
    g.fillStyle = '#e8413a'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#333'; g.font = 'bold 11px monospace'; g.fillText('N', S / 2 - 3, 12);
  }
}
