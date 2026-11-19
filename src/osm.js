// OpenStreetMap -> simple "features" (buildings, roads, areas, points) in local metres.
import { OVERPASS } from './config.js';
import { B } from './blocks.js';
import { hash, pointInRing } from './geo.js';

// ---------- 1. Download ----------
export function overpassQuery(s, w, n, e) {
  const bb = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`;
  return `[out:json][timeout:30];(
  way["building"]${bb};relation["building"]${bb};
  way["building:part"]${bb};relation["building:part"]${bb};
  way["highway"]${bb};way["railway"~"^(rail|tram|light_rail|subway|narrow_gauge)$"]${bb};
  way["waterway"]${bb};way["natural"]${bb};relation["natural"]${bb};
  way["landuse"]${bb};relation["landuse"]${bb};
  way["leisure"]${bb};relation["leisure"]${bb};
  way["amenity"="parking"]${bb};way["man_made"="pier"]${bb};
  way["barrier"~"^(wall|fence|hedge|city_wall|retaining_wall)$"]${bb};
  node["natural"="tree"]${bb};
);out geom;`;
}

let active = 0;
const waiting = [];
const slot = () => new Promise((ok) => { if (active < 2) { active++; ok(); } else waiting.push(ok); });
const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

// Overpass is a free shared service: max 2 requests at a time, retry politely on other mirrors.
export async function fetchOSM(s, w, n, e) {
  await slot();
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(OVERPASS[attempt % OVERPASS.length], {
          method: 'POST',
          body: 'data=' + encodeURIComponent(overpassQuery(s, w, n, e)),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (res.ok) return await res.json();
      } catch { /* network hiccup: fall through to retry */ }
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
    throw new Error('Map data service is busy');
  } finally { release(); }
}

// ---------- 2. Tag helpers ----------
const num = (v) => {
  if (v == null) return NaN;
  const m = /-?\d+(\.\d+)?/.exec(String(v).replace(',', '.'));
  if (!m) return NaN;
  return parseFloat(m[0]) * (/ft|'/.test(v) ? 0.3048 : 1);
};

const CSS = { white: 'ffffff', black: '222222', grey: '888888', gray: '888888', red: 'b03030', brown: '7a5230', yellow: 'e0c050', beige: 'e8dcb8', orange: 'd08040', green: '4a9060', blue: '5080b0', silver: 'c0c0c8', tan: 'd2b48c', cream: 'f0e6c8', pink: 'e0a0a0', maroon: '7a2a2a' };
function rgb(v) {
  if (!v) return null;
  let s = String(v).toLowerCase().trim();
  s = CSS[s] || s.replace('#', '');
  if (/^[0-9a-f]{3}$/.test(s)) s = s.replace(/./g, '$&$&');
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
const nearest = (c, pal) => pal.reduce((best, p) => {
  const d = (p[1] - c[0]) ** 2 + (p[2] - c[1]) ** 2 + (p[3] - c[2]) ** 2;
  return d < best[1] ? [p[0], d] : best;
}, [pal[0][0], Infinity])[0];

const WALLS = [
  [B.BRICK, 156, 74, 58], [B.BRICK_YELLOW, 196, 160, 104], [B.CONCRETE_WHITE, 226, 226, 222], [B.CONCRETE, 166, 168, 170],
  [B.CONCRETE_DARK, 84, 88, 94], [B.SANDSTONE, 218, 202, 158], [B.STUCCO_CREAM, 236, 222, 188], [B.STUCCO_TERRA, 208, 138, 100],
  [B.STUCCO_BLUE, 150, 176, 196], [B.PLANKS, 178, 138, 84],
];
const ROOFS = [[B.ROOF_RED, 170, 72, 52], [B.ROOF_SLATE, 78, 84, 96], [B.ROOF_GREEN, 96, 150, 128], [B.CONCRETE, 166, 168, 170], [B.CONCRETE_WHITE, 226, 226, 222], [B.CONCRETE_DARK, 60, 60, 64], [B.SANDSTONE, 218, 202, 158]];
const MATERIAL = { brick: B.BRICK, glass: B.GLASS_BLUE, concrete: B.CONCRETE, wood: B.PLANKS, stone: B.SANDSTONE, sandstone: B.SANDSTONE, plaster: B.STUCCO_CREAM, metal: B.CONCRETE_DARK, limestone: B.SANDSTONE };
const RES_WALLS = [B.BRICK, B.BRICK_YELLOW, B.STUCCO_CREAM, B.STUCCO_TERRA, B.SANDSTONE, B.CONCRETE_WHITE, B.STUCCO_BLUE, B.BRICK];
const OFFICE_WALLS = [B.CONCRETE, B.CONCRETE_WHITE, B.SANDSTONE, B.BRICK, B.CONCRETE_DARK, B.BRICK_YELLOW];
const OLD = new Set(['church', 'cathedral', 'chapel', 'tower', 'castle', 'mosque', 'temple', 'synagogue', 'monastery', 'ruins', 'bell_tower', 'shrine', 'palace', 'fort']);
const OLD_WALLS = [B.SANDSTONE, B.SANDSTONE, B.BRICK, B.CONCRETE, B.BRICK_YELLOW];
const HOMES = new Set(['house', 'detached', 'residential', 'apartments', 'terrace', 'semidetached_house', 'bungalow', 'dormitory', 'hotel', 'farm', 'cabin', 'hut', 'static_caravan', 'houseboat']);
const LEVELS = { house: 2, detached: 2, semidetached_house: 2, terrace: 2, bungalow: 1, residential: 3, apartments: 5, dormitory: 4, hotel: 6, commercial: 4, office: 6, retail: 2, industrial: 2, warehouse: 2, garage: 1, garages: 1, shed: 1, hut: 1, cabin: 1, roof: 1, kiosk: 1, school: 3, university: 4, hospital: 6, church: 4, cathedral: 8, mosque: 4, temple: 4, train_station: 3, civic: 3, public: 3, stadium: 6, supermarket: 2 };
const PITCHED = new Set(['gabled', 'hipped', 'pyramidal', 'half-hipped', 'gambrel', 'mansard', 'dome', 'onion', 'round', 'saltbox', 'cone']);

// ---------- 3. Geometry helpers ----------
function ring(points, proj, keepAll = false) {
  const n = points.length - (!keepAll && points.length > 1 && points[0].lat === points[points.length - 1].lat && points[0].lon === points[points.length - 1].lon ? 1 : 0);
  const r = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const p = proj.toLocal(points[i].lat, points[i].lon); r[i * 2] = p[0]; r[i * 2 + 1] = p[1]; }
  return r;
}
const same = (a, b) => a.lat === b.lat && a.lon === b.lon;

// A multipolygon relation arrives as loose way segments: stitch them into closed rings.
function stitch(members, role) {
  const segs = members.filter((m) => m.type === 'way' && m.geometry && (m.role === role || (role === 'outer' && !m.role)))
    .map((m) => m.geometry.filter(Boolean));
  const rings = [];
  while (segs.length) {
    let cur = segs.pop().slice();
    for (let guard = 0; guard < 5000 && !same(cur[0], cur[cur.length - 1]); guard++) {
      const end = cur[cur.length - 1];
      const i = segs.findIndex((s) => same(s[0], end) || same(s[s.length - 1], end));
      if (i < 0) break;
      const s = segs.splice(i, 1)[0];
      cur = cur.concat(same(s[0], end) ? s.slice(1) : s.slice(0, -1).reverse());
    }
    if (cur.length >= 4) rings.push(cur);
  }
  return rings;
}

function bboxOf(arrs, pad = 0) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of arrs) for (let i = 0; i < r.length; i += 2) {
    if (r[i] < a) a = r[i]; if (r[i] > c) c = r[i];
    if (r[i + 1] < b) b = r[i + 1]; if (r[i + 1] > d) d = r[i + 1];
  }
  return [a - pad, b - pad, c + pad, d + pad];
}
function areaOf(r) {
  let s = 0;
  for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) s += r[j] * r[i + 1] - r[i] * r[j + 1];
  return Math.abs(s) / 2;
}

// ---------- 4. Classification ----------
function building(t, id, part) {
  const type = (part ? t['building:part'] : t.building) || 'yes';
  const seed = id % 2147483647;
  let h = num(t.height), levels = num(t['building:levels']);
  const minH = Math.max(0, num(t.min_height) || (num(t['building:min_level']) || 0) * 3.2 || 0);
  const tagged = h === h || levels === levels;
  if (h !== h) {
    if (levels !== levels) levels = (LEVELS[type] ?? 2) + (type === 'yes' || type === 'apartments' || type === 'commercial' ? Math.floor(hash(seed, 3) * 3) : 0);
    h = levels * 3.2 + (num(t['roof:levels']) || 0) * 3;
  }
  h = Math.max(3, h);
  return { k: 'b', id: seed, part, type, h, minH, tagged, tags: t };
}

function finishBuilding(b) {
  const t = b.tags, area = areaOf(b.rings[0]), seed = b.id;
  const home = HOMES.has(b.type) || (b.type === 'yes' && b.h < 40 && (area < 260 ? true : hash(seed, 5) < 0.5 && b.h < 18));
  b.home = home ? 1 : 0;
  b.area = area;
  b.ax = (b.bbox[0] + b.bbox[2]) / 2; b.az = (b.bbox[1] + b.bbox[3]) / 2;   // where we read the ground height
  b.step = home && b.h < 30 ? 3 : 4;                               // blocks per storey
  const old = OLD.has(b.type) || t.historic || t.amenity === 'place_of_worship' || t.man_made === 'tower';   // churches, towers, castles...
  b.glassy = t['building:material'] === 'glass' || (!home && !old && (b.h >= 45 || ((b.type === 'office' || b.type === 'commercial') && b.h >= 24))) ? 1 : 0;
  const col = rgb(t['building:colour'] || t['building:color']);
  const pal = old ? OLD_WALLS : home ? RES_WALLS : OFFICE_WALLS;
  b.wall = MATERIAL[t['building:material']] ?? (col ? nearest(col, WALLS) : pal[Math.floor(hash(seed, 1) * pal.length)]);
  if (b.wall === B.GLASS_BLUE) b.wall = B.CONCRETE;
  const shape = t['roof:shape'];
  const pitched = shape ? PITCHED.has(shape) : (home && b.h <= 11 && area < 420) || (old && area < 2500);
  b.roofH = pitched ? Math.round(Math.min(num(t['roof:height']) || (old ? 7 : 4), b.h * 0.5, 14)) : 0;
  const rcol = rgb(t['roof:colour'] || t['roof:color']);
  b.roof = rcol ? nearest(rcol, ROOFS) : pitched ? (hash(seed, 2) < 0.6 ? B.ROOF_RED : B.ROOF_SLATE) : hash(seed, 2) < 0.7 ? B.CONCRETE : B.CONCRETE_DARK;
  b.info = {
    name: t.name || '', type: b.type === 'yes' ? '' : b.type.replace(/_/g, ' '),
    addr: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
    use: (t.amenity || t.shop || t.tourism || t.office || '').replace(/_/g, ' '),
    h: Math.round(b.h), levels: num(t['building:levels']) || 0,
  };
  delete b.tags;
  return b;
}

const ROAD = { // half-width, sidewalks, centre line (1 white, 2 yellow), street lamps
  motorway: [7, 0, 1, 0], trunk: [6.5, 0, 1, 1], primary: [6, 1, 2, 1], secondary: [5, 1, 2, 1], tertiary: [4.5, 1, 1, 1],
  residential: [3.5, 1, 0, 1], unclassified: [3.5, 1, 0, 0], living_street: [3, 1, 0, 1], service: [2, 0, 0, 0],
  motorway_link: [3.5, 0, 0, 0], trunk_link: [3.5, 0, 0, 0], primary_link: [3.5, 0, 0, 0], secondary_link: [3, 0, 0, 0], tertiary_link: [3, 0, 0, 0],
  pedestrian: [3, 0, 0, 1], track: [1.5, 0, 0, 0], busway: [3.5, 0, 0, 0], road: [3, 0, 0, 0],
};
const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway']);
const PAVED = new Set(['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'concrete:plates']);

function road(t, pts) {
  if ((t.tunnel && t.tunnel !== 'no') || t.covered === 'yes' || t.indoor === 'yes' || (t.layer && num(t.layer) < 0)) return null;
  const hw = t.highway;
  if (FOOT.has(hw)) {
    const cross = t.footway === 'crossing' || t.highway === 'crossing' ? 1 : 0;
    const paved = cross || t.footway === 'sidewalk' || PAVED.has(t.surface);
    return { k: 'r', pts, hw: 1, block: paved ? B.SIDEWALK : B.PATH, sw: 0, line: 0, lamp: 0, foot: 1, cross };
  }
  const d = ROAD[hw];
  if (!d) return null;
  let half = d[0];
  const lanes = num(t.lanes), width = num(t.width);
  if (width === width && width > 1 && width < 40) half = width / 2;
  else if (lanes === lanes && lanes > 0 && lanes < 12) half = Math.max(half * 0.6, lanes * 1.7);
  const block = hw === 'pedestrian' ? B.COBBLE : hw === 'track' ? B.PATH : B.ASPHALT;
  return { k: 'r', pts, hw: half, block, sw: d[1] && t.sidewalk !== 'no' ? 1 : 0, line: t.oneway === 'yes' && d[2] === 2 ? 1 : d[2], lamp: d[3], foot: 0, cross: 0, name: t.name || '' };
}

// Surface painted on the ground: [block, vegetation(0 none,1 park,2 forest,3 scrub), priority]
function area(t) {
  const n = t.natural, l = t.landuse, le = t.leisure;
  if (n === 'water' || t.waterway === 'riverbank' || l === 'reservoir' || l === 'basin' || le === 'swimming_pool' || n === 'bay') return [B.WATER, 0, 9, t.water === 'river' || t.waterway === 'riverbank' || t.water === 'canal' ? 1 : 0];
  if (n === 'wood' || l === 'forest') return [B.FOREST_FLOOR, 2, 4];
  if (n === 'scrub' || n === 'heath') return [B.GRASS, 3, 3];
  if (n === 'beach' || n === 'sand') return [B.SAND, 0, 5];
  if (n === 'bare_rock' || n === 'scree') return [B.STONE, 0, 5];
  if (le === 'pitch' || le === 'track') return [B.PITCH, 0, 7];
  if (t.amenity === 'parking') return [B.PARKING, 0, 6];
  if (t.highway && t.area === 'yes') return [t.highway === 'pedestrian' ? B.COBBLE : B.SIDEWALK, 0, 8];
  if (t.man_made === 'pier') return [B.PLANKS, 0, 10];
  if (le === 'park' || le === 'garden' || le === 'playground' || le === 'golf_course' || le === 'dog_park' || l === 'grass' || l === 'meadow' || l === 'recreation_ground' || l === 'village_green' || l === 'cemetery' || n === 'grassland') return [B.GRASS, 1, 3];
  if (l === 'farmland' || l === 'farmyard' || l === 'orchard' || l === 'vineyard' || l === 'allotments') return [B.FARMLAND, l === 'orchard' ? 1 : 0, 2];
  if (l === 'commercial' || l === 'retail' || l === 'industrial' || l === 'construction') return [B.SIDEWALK, 0, 1];
  if (l === 'railway') return [B.PATH, 0, 1];
  return null;
}

// ---------- 5. Parse everything ----------
export function parseOSM(elements, proj) {
  const feats = [];
  let coast = 0;
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node') {
      if (t.natural === 'tree') { const p = proj.toLocal(el.lat, el.lon); feats.push({ k: 'p', t: 0, x: p[0], z: p[1], pr: 20 }); }
      continue;
    }
    // polygons: one {rings:[outer, ...holes]} per outer ring
    let polys = null, line = null;
    if (el.type === 'way') {
      const g = el.geometry;
      if (!g || g.length < 2) continue;
      const closed = g.length > 3 && same(g[0], g[g.length - 1]);
      if (closed) polys = [[ring(g, proj)]];
      line = ring(g, proj, true);
    } else if (el.type === 'relation' && el.members) {
      const inners = stitch(el.members, 'inner').map((r) => ring(r, proj));
      polys = stitch(el.members, 'outer').map((o) => {
        const outer = ring(o, proj);
        return [outer, ...inners.filter((h) => pointInRing(h[0], h[1], outer))];
      });
    } else continue;

    const isB = t.building && t.building !== 'no', isP = t['building:part'] && t['building:part'] !== 'no';
    if ((isB || isP) && polys) {
      if (t.location === 'underground' || t.building === 'roof') continue;
      for (const rings of polys) {
        if (rings[0].length < 6) continue;
        feats.push(finishBuilding({ ...building(t, el.id, isP && !isB ? 1 : 0), rings, bbox: bboxOf([rings[0]]), pr: 30 }));
      }
      continue;
    }
    if (t.natural === 'coastline') { coast = 1; continue; }
    const a = polys && area(t);
    if (a) {
      for (const rings of polys) feats.push({ k: 'a', rings, bbox: bboxOf([rings[0]]), block: a[0], veg: a[1], pr: a[2], river: a[3] || 0 });
      continue;
    }
    if (el.type !== 'way') continue;
    if (t.highway) {
      const r = road(t, line);
      if (r) { r.bbox = bboxOf([line], r.hw + 4); r.pr = r.foot ? 11 : 12; feats.push(r); }
    } else if (t.railway) {
      if ((t.tunnel && t.tunnel !== 'no') || (t.layer && num(t.layer) < 0)) continue;
      feats.push({ k: 'r', pts: line, hw: 1.6, block: B.PATH, rail: 1, sw: 0, line: 0, lamp: 0, foot: 0, cross: 0, bbox: bboxOf([line], 4), pr: 13 });
    } else if (t.waterway && !t.tunnel) {
      const w = { river: 7, canal: 4, stream: 1.5, drain: 1, ditch: 1 }[t.waterway];
      if (w) feats.push({ k: 'r', pts: line, hw: w, block: B.WATER, sw: 0, line: 0, lamp: 0, foot: 0, cross: 0, bbox: bboxOf([line], w + 2), pr: 10 });
    } else if (t.man_made === 'pier') {
      feats.push({ k: 'r', pts: line, hw: 1.5, block: B.PLANKS, sw: 0, line: 0, lamp: 0, foot: 1, cross: 0, bbox: bboxOf([line], 4), pr: 11 });
    } else if (t.barrier) {
      const hedge = t.barrier === 'hedge', fence = t.barrier === 'fence';
      feats.push({ k: 'w', pts: line, block: hedge ? B.LEAVES : fence ? B.PLANKS : B.STONE, height: fence ? 1 : 2, bbox: bboxOf([line], 2), pr: 25 });
    } else if (t.natural === 'tree_row') {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const dx = line[i + 2] - line[i], dz = line[i + 3] - line[i + 1], len = Math.hypot(dx, dz);
        for (let s = 0; s < len; s += 7) feats.push({ k: 'p', t: 0, x: line[i] + (dx * s) / len, z: line[i + 1] + (dz * s) / len, pr: 20 });
      }
    }
  }

  // Detailed "building:part" pieces replace the plain outline they sit inside.
  const parts = feats.filter((f) => f.k === 'b' && f.part);
  if (parts.length) for (const b of feats) {
    if (b.k !== 'b' || b.part) continue;
    for (const p of parts) {
      if (p.bbox[0] > b.bbox[2] || p.bbox[2] < b.bbox[0] || p.bbox[1] > b.bbox[3] || p.bbox[3] < b.bbox[1]) continue;
      const cx = (p.bbox[0] + p.bbox[2]) / 2, cz = (p.bbox[1] + p.bbox[3]) / 2;
      if (pointInRing(cx, cz, b.rings[0]) || pointInRing(p.rings[0][0], p.rings[0][1], b.rings[0])) {
        b.skip = 1; p.ax = b.ax; p.az = b.az;             // all parts of one building share a ground level
        if (!p.info.name) p.info = { ...b.info, h: p.info.h };
      }
    }
  }

  // Street lamps along lit roads.
  const lamps = [];
  for (const r of feats) {
    if (r.k !== 'r' || !r.lamp) continue;
    let travelled = 14, side = 1;
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      while (travelled < len) {
        const off = (r.hw + 1.5) * side;
        lamps.push({ k: 'p', t: 1, x: p[i] + (dx * travelled) / len - (dz / len) * off, z: p[i + 1] + (dz * travelled) / len + (dx / len) * off, pr: 21 });
        travelled += 28; side = -side;
      }
      travelled -= len;
    }
  }
  for (const l of lamps) feats.push(l);

  feats.sort((a, b) => a.pr - b.pr);        // draw order: ground first, buildings last
  return { feats: feats.filter((f) => !f.skip), coast };
}
