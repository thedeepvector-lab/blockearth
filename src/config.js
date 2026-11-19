// Global constants shared by the main thread and the workers.
export const CHUNK = 32;            // chunk footprint in blocks (1 block = 1 metre)
export const PAD = 1;               // 1-block border so the mesher can see neighbours
export const SIZE = CHUNK + PAD * 2;
export const BASE_Y = 64;           // block height of the ground at the origin
export const MAX_Y = 1024;          // tallest structure we can store
export const TILE_M = 512;          // size of one map-data tile in metres
export const TILE_CHUNKS = TILE_M / CHUNK;
export const TERRAIN_Z = 13;        // zoom level of the elevation tiles
export const M_PER_LAT = 110574;    // metres per degree of latitude

export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
export const NOMINATIM = 'https://nominatim.openstreetmap.org';
export const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const PLACES = [
  ['New York', 40.74844, -73.98566],
  ['Paris', 48.85837, 2.29448],
  ['London', 51.50073, -0.12463],
  ['Tokyo', 35.65950, 139.70055],
  ['Mumbai', 18.92198, 72.83465],
  ['New Delhi', 28.63150, 77.21670],
  ['Dubai', 25.19720, 55.27440],
  ['Rome', 41.89021, 12.49223],
  ['San Francisco', 37.79550, -122.39370],
  ['Sydney', -33.85678, 151.21530],
];

// Small map extracts shipped with the site, so there is always something to explore
// even when the public map servers are busy. [name, lat, lon, file]
export const DEMOS = [
  ['New York · Midtown', 40.74844, -73.98566, 'demo/new-york.json'],
  ['New Delhi · Karol Bagh', 28.64800, 77.19600, 'demo/new-delhi.json'],
  ['Bengaluru · HSR Layout', 12.91160, 77.64120, 'demo/bengaluru.json'],
  ['Helsinki · centre', 60.1699, 24.9414, 'demo/helsinki.json'],
  ['Utrecht · old town', 52.0907, 5.1214, 'demo/utrecht.json'],
];
