// Every block type in the world. Textures are painted procedurally in atlas.js (no image files).
export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'water', 'asphalt', 'line_white',
  'sidewalk', 'path', 'brick', 'brick_yellow', 'concrete_white', 'concrete', 'concrete_dark', 'sandstone',
  'stucco_cream', 'stucco_terra', 'stucco_blue', 'planks', 'glass', 'glass_blue', 'roof_red', 'roof_slate',
  'log_side', 'log_top', 'leaves', 'bed', 'bookshelf', 'lamp', 'pillow', 'table_top',
  'table_side', 'rail', 'pitch', 'forest_floor', 'farmland', 'door', 'iron', 'line_yellow',
  'stove_side', 'stove_top', 'tv', 'sofa', 'ladder', 'cobble', 'roof_green', 'counter_top',
  'leaves_dark', 'parking',
];
const T = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]));

// [name, top, side, bottom, flags]  flags: t=see-through, p=translucent pass, g=glows at night, ns=walk-through
const DEFS = [
  ['AIR', null, null, null, { t: 1, ns: 1 }],
  ['GRASS', 'grass_top', 'grass_side', 'dirt'],
  ['DIRT', 'dirt'], ['STONE', 'stone'], ['SAND', 'sand'],
  ['WATER', 'water', 'water', 'water', { t: 1, p: 1, ns: 1 }],
  ['ASPHALT', 'asphalt'], ['LINE_WHITE', 'line_white', 'asphalt', 'asphalt'],
  ['SIDEWALK', 'sidewalk'], ['PATH', 'path'],
  ['BRICK', 'brick'], ['BRICK_YELLOW', 'brick_yellow'],
  ['CONCRETE_WHITE', 'concrete_white'], ['CONCRETE', 'concrete'], ['CONCRETE_DARK', 'concrete_dark'],
  ['SANDSTONE', 'sandstone'], ['STUCCO_CREAM', 'stucco_cream'], ['STUCCO_TERRA', 'stucco_terra'], ['STUCCO_BLUE', 'stucco_blue'],
  ['PLANKS', 'planks'],
  ['GLASS', 'glass', 'glass', 'glass', { t: 1, p: 1 }],
  ['GLASS_LIT', 'glass', 'glass', 'glass', { t: 1, p: 1, g: 1 }],
  ['GLASS_BLUE', 'glass_blue', 'glass_blue', 'glass_blue', { t: 1, p: 1 }],
  ['GLASS_BLUE_LIT', 'glass_blue', 'glass_blue', 'glass_blue', { t: 1, p: 1, g: 1 }],
  ['ROOF_RED', 'roof_red'], ['ROOF_SLATE', 'roof_slate'], ['ROOF_GREEN', 'roof_green'],
  ['LOG', 'log_top', 'log_side', 'log_top'],
  ['LEAVES', 'leaves', 'leaves', 'leaves', { t: 1 }],
  ['LEAVES_DARK', 'leaves_dark', 'leaves_dark', 'leaves_dark', { t: 1 }],
  ['BED', 'bed', 'bed', 'planks'], ['PILLOW', 'pillow', 'pillow', 'planks'],
  ['BOOKSHELF', 'planks', 'bookshelf', 'planks'],
  ['LAMP', 'lamp', 'lamp', 'lamp', { g: 1 }],
  ['TABLE', 'table_top', 'table_side', 'planks'],
  ['RAIL', 'rail', 'path', 'path'], ['PITCH', 'pitch', 'dirt', 'dirt'],
  ['FOREST_FLOOR', 'forest_floor', 'dirt', 'dirt'], ['FARMLAND', 'farmland', 'dirt', 'dirt'],
  ['DOOR', 'planks', 'door', 'planks'], ['IRON', 'iron'],
  ['LINE_YELLOW', 'line_yellow', 'asphalt', 'asphalt'],
  ['STOVE', 'stove_top', 'stove_side', 'iron'], ['TV', 'iron', 'tv', 'iron', { g: 1 }],
  ['SOFA', 'sofa'], ['LADDER', 'ladder', 'ladder', 'ladder', { t: 1, ns: 1 }],
  ['COBBLE', 'cobble'], ['COUNTER', 'counter_top', 'planks', 'planks'],
  ['PARKING', 'parking', 'asphalt', 'asphalt'],
];

export const B = {};
export const NAMES = [];
export const TILES = new Uint8Array(DEFS.length * 3);   // top, side, bottom tile per block
export const SEE_THROUGH = new Uint8Array(256);
export const TRANSLUCENT = new Uint8Array(256);
export const GLOW = new Uint8Array(256);
export const SOLID = new Uint8Array(256);

DEFS.forEach(([name, top, side, bottom, f = {}], id) => {
  B[name] = id;
  NAMES[id] = name;
  if (top) {
    TILES[id * 3] = T[top];
    TILES[id * 3 + 1] = T[side ?? top];
    TILES[id * 3 + 2] = T[bottom ?? top];
  }
  SEE_THROUGH[id] = f.t ? 1 : 0;
  TRANSLUCENT[id] = f.p ? 1 : 0;
  GLOW[id] = f.g ? 1 : 0;
  SOLID[id] = f.ns ? 0 : 1;
});

// Blocks the player can place with keys 1-9.
export const HOTBAR = [B.BRICK, B.PLANKS, B.CONCRETE_WHITE, B.GLASS, B.STONE, B.LAMP, B.GRASS, B.ROOF_RED, B.LEAVES];
