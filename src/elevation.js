// Real-world terrain heights from open "Terrarium" tiles (height encoded in the RGB of a PNG).
import { TERRAIN_Z, TERRAIN_URL } from './config.js';

export class Elevation {
  constructor() { this.tiles = new Map(); this.n = 2 ** TERRAIN_Z; }
  key(x, y) { return x * 65536 + y; }
  add(x, y, data) { this.tiles.set(this.key(x, y), data); }

  // Global pixel coordinates (Web Mercator) of a lat/lon at our zoom level.
  pixel(lat, lon) {
    const s = Math.sin((lat * Math.PI) / 180);
    const x = ((lon + 180) / 360) * this.n * 256;
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * this.n * 256;
    return [x, y];
  }
  px(xi, yi) {
    const t = this.tiles.get(this.key(xi >> 8, yi >> 8));
    return t ? t[(yi & 255) * 256 + (xi & 255)] : NaN;
  }
  // Bilinear sample in metres above sea level. NaN when the tile is not loaded.
  sample(lat, lon) {
    const [X, Y] = this.pixel(lat, lon);
    const x = X - 0.5, y = Y - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a = this.px(x0, y0), b = this.px(x0 + 1, y0), c = this.px(x0, y0 + 1), d = this.px(x0 + 1, y0 + 1);
    if (a !== a) return NaN;
    const B = b === b ? b : a, C = c === c ? c : a, D = d === d ? d : a;
    return (a * (1 - fx) + B * fx) * (1 - fy) + (C * (1 - fx) + D * fx) * fy;
  }
}

// Main thread only: download + decode one tile. Resolves to a Float32Array (or null if offline).
export function loadTerrainTile(x, y) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(65536);
        for (let i = 0; i < 65536; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        resolve(out);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = TERRAIN_URL.replace('{z}', TERRAIN_Z).replace('{x}', x).replace('{y}', y);
  });
}
