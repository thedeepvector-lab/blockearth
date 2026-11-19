// Entry point: renderer, materials, game loop, and glue between the modules.
import * as THREE from 'three';
import { BASE_Y } from './config.js';
import { B } from './blocks.js';
import { paintAtlas, atlasLayers } from './atlas.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Sky } from './sky.js';
import { UI } from './ui.js';

const canvas = document.getElementById('game');
const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 5000);

// ----- one texture + one tiny shader for the whole world -----
const atlas = paintAtlas();
const layers = atlasLayers(atlas);
const map = new THREE.DataArrayTexture(layers.data, layers.size, layers.size, layers.layers);
map.format = THREE.RGBAFormat;
map.magFilter = THREE.NearestFilter;                 // crisp pixels up close...
map.minFilter = THREE.NearestMipmapLinearFilter;     // ...smooth in the distance
map.generateMipmaps = true;
map.colorSpace = THREE.SRGBColorSpace;
map.needsUpdate = true;

const uniforms = {
  map: { value: map }, uLight: { value: new THREE.Color(1, 1, 1) }, uFog: { value: new THREE.Color() },
  uFogNear: { value: 100 }, uFogFar: { value: 200 }, uNight: { value: 0 },
};
const vertexShader = /* glsl */ `
  attribute vec3 light;                 // x = baked brightness, y = glows at night, z = texture layer
  varying vec2 vUv; varying vec3 vLight; varying float vDist;
  void main() {
    vUv = uv; vLight = light;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDist = length(wp.xz - cameraPosition.xz);      // fog by ground distance, so flying high stays clear
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const fragmentShader = /* glsl */ `
  precision mediump sampler2DArray;
  uniform sampler2DArray map; uniform vec3 uLight; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform float uNight;
  varying vec2 vUv; varying vec3 vLight; varying float vDist;
  void main() {
    vec4 tex = texture(map, vec3(vUv, floor(vLight.z + 0.5)));
    #ifdef CUTOUT
      if (tex.a < 0.5) discard;
      tex.a = 1.0;
    #endif
    float glow = vLight.y * uNight;
    vec3 lit = tex.rgb * vLight.x * uLight;
    vec3 lamp = tex.rgb * vec3(1.5, 1.2, 0.7) + vec3(0.35, 0.24, 0.06);
    vec3 col = mix(lit, lamp, glow);
    col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDist) * (1.0 - glow * 0.5));
    gl_FragColor = vec4(col, mix(tex.a, 0.97, glow));
    #include <colorspace_fragment>
  }`;
const materials = {
  opaque: new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, defines: { CUTOUT: 1 } }),
  trans: new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false }),
};

// ----- the game objects -----
const world = new World(scene, materials);
world.radius = +params.get('r') || 7;
const player = new Player(camera, world, canvas);
const sky = new Sky(scene, camera, uniforms);
if (params.has('t')) sky.hour = +params.get('t');
const app = { world, player, sky, atlas, started: false, goto, resume, view };
// Scripting helper: put the camera at a real coordinate. heading: 0 = north, 90 = east. height in metres above ground.
function view(lat, lon, height = 40, heading = 0, pitch = -15) {
  const [x, z] = world.proj.toLocal(lat, lon);
  player.pos = { x, y: world.groundAt(x, z) + height, z };
  player.vel = { x: 0, y: 0, z: 0 };
  player.yaw = (-heading * Math.PI) / 180; player.pitch = (pitch * Math.PI) / 180; player.fly = true;
  player.applyCamera();
}
const ui = new UI(app);
app.ui = ui;

// Block highlight (the thin outline around the block you are aiming at)
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, fog: false }));
outline.visible = false;
scene.add(outline);

// Bundled map extracts: ?data=demo/utrecht.json or the "offline demo" buttons. Lets the site work without the live map API.
function useData(url) {
  if (!url) { world.offline = null; return; }
  const loading = fetch(url).then((r) => r.json());
  world.offline = async (s, w, n, e) => {
    const all = await loading;
    return {
      elements: all.elements.filter((el) => {
        if (el.type === 'node') return el.lat >= s && el.lat <= n && el.lon >= w && el.lon <= e;
        const b = el.bounds;
        return b && b.maxlat >= s && b.minlat <= n && b.maxlon >= w && b.minlon <= e;
      }),
    };
  };
}
useData(params.get('data'));

let spawning = false;
async function goto(lat, lon, name = '', data) {
  if (data !== undefined) useData(data);         // a demo button passes its file; a normal search passes null
  ui.place(name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  ui.menu(false);
  app.started = true;
  if (!params.has('capture')) player.lock();     // must happen right away, while the click still counts
  const p = await world.setOrigin(lat, lon, +params.get('stage') || 9, params.get('ao') === '0');
  if (!p) return;
  world.status = 'Downloading the neighbourhood…';
  player.pos = { x: p[0] + 0.5, y: BASE_Y + 60, z: p[1] + 0.5 };
  player.vel = { x: 0, y: 0, z: 0 };
  player.fly = true; player.frozen = true; spawning = true;
  history.replaceState(null, '', `${location.pathname}${location.search}#${lat.toFixed(5)},${lon.toFixed(5)}`);
}
function resume() { ui.menu(false); player.lock(); }

player.onLock = (locked) => { if (!locked && app.started) ui.menu(true); };
canvas.addEventListener('click', () => { if (!player.locked && app.started) resume(); });

// ----- building & breaking -----
addEventListener('mousedown', (e) => {
  if (!player.locked) return;
  const hit = player.raycast(7);
  if (!hit) return;
  if (e.button === 0) world.setBlock(hit.x, hit.y, hit.z, B.AIR);
  else if (e.button === 2 && !player.overlaps(hit.px, hit.py, hit.pz)) world.setBlock(hit.px, hit.py, hit.pz, ui.block());
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (player.locked) ui.select(ui.slot + Math.sign(e.deltaY)); });
addEventListener('keydown', (e) => {
  if (!player.locked) return;
  if (/^Digit[1-9]$/.test(e.code)) ui.select(+e.code[5] - 1);
  if (e.code === 'KeyT') { const stops = [10, 18.6, 22, 6.6]; sky.hour = stops[(stops.findIndex((h) => Math.abs(h - sky.hour) < 0.3) + 1) % stops.length]; }
  if (e.code === 'KeyM') ui.showMap = !ui.showMap;
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ----- the loop -----
let last = performance.now(), frames = 0, fps = 0, tick = 0;
function step(dt) {
  world.update(player.pos.x, player.pos.z);
  if (spawning) {                              // wait for the first chunk, then hover above the rooftops
    const y = world.surfaceY(Math.floor(player.pos.x), Math.floor(player.pos.z));
    if (y !== null) { player.pos.y = y + 26; spawning = false; world.status = ''; }
  }
  player.update(dt);

  const hit = player.locked ? player.raycast(7) : null;
  outline.visible = !!hit;
  if (hit) outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

  sky.update(dt, Math.max(90, world.radius * 32 - 20));
  if (!app.skipRender) renderer.render(scene, camera);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!app.manual) step(dt);                   // app.manual: an external script drives frames (used to film the trailer)
  else world.update(player.pos.x, player.pos.z);
  frames++; tick += dt;
  if (tick > 0.3) { fps = Math.round(frames / tick); frames = 0; tick = 0; if (!app.manual) ui.hud(fps); }
  requestAnimationFrame(frame);
}
app.step = (dt) => { step(dt); ui.hud(60); };
requestAnimationFrame(frame);

// Deep link: /#48.8584,2.2945 drops you straight into that spot.
const m = /^#(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/.exec(location.hash);
if (m) goto(+m[1], +m[3]);
window.blockearth = app;                       // handy for the console: blockearth.goto(27.1751, 78.0421)
