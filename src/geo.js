// Tiny geo toolkit: a local flat projection (metres) + a hash for deterministic randomness.
import { M_PER_LAT } from './config.js';

// Around one origin the Earth is flat enough: x = east in metres, z = south in metres.
export function makeProj(lat0, lon0) {
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    lat0, lon0, mLon,
    toLocal: (lat, lon) => [(lon - lon0) * mLon, (lat0 - lat) * M_PER_LAT],
    toGeo: (x, z) => [lat0 - z / M_PER_LAT, lon0 + x / mLon],
  };
}

// Snap an origin to a fixed grid so the same neighbourhood always yields the same tiles (cache hits).
export function snapOrigin(lat, lon, grid = 2048) {
  const dLat = grid / M_PER_LAT;
  const lat0 = Math.round(lat / dLat) * dLat;
  const dLon = grid / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const lon0 = Math.round(lon / dLon) * dLon;
  return [lat0, lon0];
}

// Integer hash -> [0,1). Same inputs always give the same "random" number.
export function hash(a, b = 0, c = 0, d = 0) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519) + Math.imul(d | 0, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPoly(x, z, f) {
  if (x < f.bbox[0] || x > f.bbox[2] || z < f.bbox[1] || z > f.bbox[3]) return false;
  let inside = false;
  for (const r of f.rings) if (pointInRing(x, z, r)) inside = !inside;
  return inside;
}
