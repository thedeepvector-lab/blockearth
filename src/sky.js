// Day/night cycle: sky colour, sun & moon, stars, blocky clouds, fog — all driven by one number (the hour).
import * as THREE from 'three';
import { BASE_Y } from './config.js';

const C = (h) => new THREE.Color(h);
const KEYS = [ // hour, sky, light on blocks
  [0, C('#070b1c'), C('#3a4468')], [5, C('#0b1230'), C('#3e4870')], [6.5, C('#e89a6a'), C('#c89a86')],
  [8, C('#8ec3f2'), C('#fff4e2')], [12, C('#78b4f0'), C('#ffffff')], [17, C('#8ec3f2'), C('#fff0dc')],
  [18.7, C('#f08a52'), C('#d49478')], [20, C('#0f1738'), C('#46507a')], [24, C('#070b1c'), C('#3a4468')],
];

export class Sky {
  constructor(scene, camera, uniforms) {
    this.scene = scene; this.camera = camera; this.u = uniforms;
    this.hour = 10; this.speed = 0;                 // speed in game-hours per real second
    scene.background = new THREE.Color();

    const sprite = (color, size) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false, transparent: true }));
      m.renderOrder = -2; m.frustumCulled = false; scene.add(m);
      return m;
    };
    this.sun = sprite('#fff3b8', 150);
    this.moon = sprite('#dfe6f5', 110);

    const pts = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pts.set([r * Math.cos(a) * 1800, Math.abs(u) * 1800, r * Math.sin(a) * 1800], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.stars.renderOrder = -3; this.stars.frustumCulled = false; scene.add(this.stars);

    // Clouds: one big plane with a tiny blocky texture, drifting slowly.
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    for (let i = 0; i < 46; i++) { const x = Math.random() * 64, y = Math.random() * 64, w = 3 + Math.random() * 9, h = 2 + Math.random() * 5; for (const ox of [0, -64]) for (const oy of [0, -64]) g.fillRect((x + ox) | 0, (y + oy) | 0, w | 0, h | 0); }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(6, 6);
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.clouds.rotation.x = -Math.PI / 2; this.clouds.position.y = BASE_Y + 260; this.clouds.renderOrder = 2; this.clouds.frustumCulled = false;
    scene.add(this.clouds);
    this.drift = 0;
  }

  update(dt, fogFar) {
    this.hour = (this.hour + this.speed * dt + 24) % 24;
    let i = 0;
    while (KEYS[i + 1][0] < this.hour) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = (this.hour - a[0]) / (b[0] - a[0]);
    const sky = this.scene.background.copy(a[1]).lerp(b[1], t);
    this.u.uLight.value.copy(a[2]).lerp(b[2], t);
    this.u.uFog.value.copy(sky);
    this.u.uFogFar.value = fogFar; this.u.uFogNear.value = fogFar * 0.55;
    const ang = ((this.hour - 6) / 12) * Math.PI, sunUp = Math.sin(ang);
    const night = THREE.MathUtils.clamp(0.5 - sunUp * 3.2, 0, 1);
    this.u.uNight.value = night;

    const cam = this.camera.position;
    this.sun.position.set(cam.x + Math.cos(ang) * 1500, cam.y + sunUp * 1500, cam.z + 300); this.sun.lookAt(cam);
    this.moon.position.set(cam.x - Math.cos(ang) * 1500, cam.y - sunUp * 1500, cam.z - 300); this.moon.lookAt(cam);
    this.stars.position.copy(cam); this.stars.material.opacity = Math.max(0, night * 2 - 1);
    this.drift += dt * 0.0012;
    this.clouds.position.x = cam.x; this.clouds.position.z = cam.z;
    this.clouds.material.map.offset.set(cam.x / 1000 + this.drift, -cam.z / 1000);
    this.clouds.material.color.copy(this.u.uLight.value).lerp(sky, 0.25);
    this.clouds.material.opacity = 0.85 - night * 0.45;
  }
}
