// Live 3D view of the Wi-Fi sensing links. Data arrives from server.py over
// Server-Sent Events (/stream) about 15 times per second.
//
// Scene (board positions from layout.json, 1 unit = 1 m):
//   - The TX board and the receivers, with packets flowing along each link
//   - Each link's sensing zone (first Fresnel zone), which turns red and ripples
//     when that link sees movement
//   - A presence core placed at the estimated position of the movement, with an
//     arrow for its direction and a short trail; it swells with the breathing waveform
//   - A CSI "waterfall" terrain: per-subcarrier disturbance over the last 6 s

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const C = {
  bg: 0x03070a, cyan: 0x3ee0ff, green: 0x45e08f, amber: 0xffc24a, red: 0xff5f5a,
  grid: 0x0f3340, label: '#8fb4c2',
};
const CSS = { cyan: '#3ee0ff', green: '#45e08f', amber: '#ffc24a', red: '#ff5f5a', muted: '#7f9aa6', faint: '#3b5260', text: '#e6f3f7' };
const LINK_CSS = ['#3ee0ff', '#b58cff', '#ff8fd0', '#9dff6a'];   // one colour per receiver in the charts
const BOARD_H = 0.9;

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NoToneMapping;   // keep state colours true (red stays red)
const scene = new THREE.Scene();
scene.background = new THREE.Color(C.bg);
scene.fog = new THREE.FogExp2(C.bg, 0.06);

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
const HOME = new THREE.Vector3(1.6, 3.5, 5.3);
const HOME_TARGET = new THREE.Vector3(0, 0.75, -1.0);
camera.position.copy(HOME);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.35;
controls.minDistance = 2.5;
controls.maxDistance = 18;
controls.maxPolarAngle = Math.PI * 0.49;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.5, 0.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- helpers
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture();

function makeLabel(text, { height = 0.13, color = C.label, weight = 500 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${weight} 44px Inter, system-ui, sans-serif`;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 24;
  c.height = 64;
  g.font = font;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 12, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 }));
  s.scale.set(height * c.width / c.height, height, 1);
  return s;
}

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = x => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------- floor
const grid = new THREE.GridHelper(24, 48, C.grid, C.grid);
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

// ---------------------------------------------------------------- boards
function makeBoard(pos, name, sub, color = C.cyan) {
  const g = new THREE.Group();
  g.position.copy(pos);
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.03), new THREE.MeshBasicMaterial({ color: 0x0c2a22 }));
  g.add(pcb);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(pcb.geometry), new THREE.LineBasicMaterial({ color }));
  g.add(edges);
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.035), new THREE.MeshBasicMaterial({ color: 0x9fb8c0 }));
  chip.position.y = 0.06;
  g.add(chip);
  const led = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, blending: THREE.AdditiveBlending, depthWrite: false }));
  led.scale.setScalar(0.35);
  led.position.y = 0.2;
  g.add(led);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, pos.y - 0.17, 8), new THREE.MeshBasicMaterial({ color: 0x1b3a46 }));
  pole.position.y = -(pos.y - 0.17) / 2 - 0.17;
  g.add(pole);
  const base = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -pos.y + 0.01;
  g.add(base);
  const l1 = makeLabel(name, { height: 0.16, color: '#e6f3f7', weight: 700 });
  l1.position.y = 0.42;
  const l2 = makeLabel(sub, { height: 0.09 });
  l2.position.y = 0.31;
  g.add(l1, l2);
  scene.add(g);
  return { group: g, led };
}

// ---------------------------------------------------------------- sensing zone shader
function makeZoneMat() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uMotion: { value: 0 }, uColor: { value: new THREE.Color(C.cyan) }, uIntensity: { value: 1 } },
    vertexShader: `
      uniform float uTime, uMotion; varying vec3 vN; varying vec3 vView;
      void main(){
        vec3 p = position;
        float w = sin(p.x * 7.0 + uTime * 3.1) * sin(p.y * 9.0 + uTime * 2.3) * sin(p.z * 8.0 - uTime * 2.7);
        p += normal * w * 0.12 * uMotion;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uIntensity; varying vec3 vN; varying vec3 vView;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vView)), 2.6);
        gl_FragColor = vec4(uColor * (f * uIntensity + 0.02), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- layout: boards + links
// Room coordinates (x right, y into the room) -> scene (x, height, -y), centred on the boards
let layout = null, center = new THREE.Vector2(), tx = null, links = [];
const toScene = (x, y, h = BOARD_H) => new THREE.Vector3(x - center.x, h, -(y - center.y));
const PACKETS = 60;

function buildLayout(lay) {
  layout = lay;
  const pts = [lay.tx, ...lay.receivers];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  center.set((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
  const txPos = toScene(lay.tx.x, lay.tx.y);
  tx = makeBoard(txPos, lay.tx.name, 'sender');

  links = lay.receivers.map((r, i) => {
    const to = toScene(r.x, r.y), mid = txPos.clone().add(to).multiplyScalar(0.5);
    const len = txPos.distanceTo(to), dir = to.clone().sub(txPos).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const board = makeBoard(to, r.name, 'receiver', new THREE.Color(LINK_CSS[i % LINK_CSS.length]).getHex());

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 8),
      new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.7 }));
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    beam.position.copy(mid);
    scene.add(beam);

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PACKETS * 3), 3));
    const pMat = new THREE.PointsMaterial({ map: GLOW, color: C.cyan, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(pGeo, pMat));

    const zoneMat = makeZoneMat();
    const zoneScale = new THREE.Vector3(len / 2, 0.36, 0.36);
    const zone = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), zoneMat);
    zone.scale.copy(zoneScale); zone.position.copy(mid); zone.quaternion.copy(quat);
    scene.add(zone);
    const wire = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 14),
      new THREE.MeshBasicMaterial({ color: C.cyan, wireframe: true, transparent: true, opacity: 0.06, depthWrite: false }));
    wire.scale.copy(zoneScale); wire.position.copy(mid); wire.quaternion.copy(quat);
    scene.add(wire);

    // Unit vectors across the link, for scattering the packets
    const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    return {
      name: r.name, css: LINK_CSS[i % LINK_CSS.length], from: txPos, to, mid, dir, side, board, beam, pGeo, pMat,
      zoneMat, wire, motion: 0, color: new THREE.Color(C.cyan),
      packets: Array.from({ length: PACKETS }, (_, k) => ({ p: k / PACKETS, seed: Math.random() * 100 })),
    };
  });

  // Frame the camera on the layout
  const zs = [txPos, ...links.map(l => l.to)].map(p => p.z);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 3);
  HOME.set(0.3 * span, 0.95 * span + 1.2, Math.max(...zs) + 1.7 * span);
  HOME_TARGET.set(0, 0.4, Math.min(...zs) * 0.4 - 0.6);
  camera.position.copy(HOME);
  controls.target.copy(HOME_TARGET);
  WF_POS.set(0, 0.02, Math.min(...zs) - WF_D / 2 - 1.2);
  if (wf) wf.group.position.copy(WF_POS);
  focus.copy(toScene(center.x, center.y));
}

// ---------------------------------------------------------------- presence core
const focus = new THREE.Vector3(0, BOARD_H, 0);        // where the core is drawn (smoothed)
const coreMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uColor: { value: new THREE.Color(C.green) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `
    uniform float uTime; varying vec3 vN; varying vec3 vView;
    void main(){
      vec3 p = position * (1.0 + 0.04 * sin(position.y * 18.0 + uTime * 4.0));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vView;
    void main(){
      float f = pow(1.0 - abs(dot(vN, vView)), 1.6);
      gl_FragColor = vec4(uColor * (0.2 + 0.9 * f) * uAlpha, 1.0);
    }`,
});
const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 6), coreMat);
scene.add(core);
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: C.green, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
halo.scale.setScalar(1.3);
scene.add(halo);
const coreLabel = makeLabel('approximate position', { height: 0.085 });
coreLabel.material.opacity = 0;
scene.add(coreLabel);
// Floor marker under the core, so the position reads in the top-down sense
const spot = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 48),
  new THREE.MeshBasicMaterial({ color: C.red, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
spot.rotation.x = -Math.PI / 2;
scene.add(spot);

// Direction arrow and trail
const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.0, C.red, 0.3, 0.2);
arrow.visible = false;
scene.add(arrow);
const TRAIL = 60;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(trail);
const trailPts = [];

// Breath shells: one expanding shell per detected breath peak
const shells = [];
function emitShell(color) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.position.copy(focus);
  m.userData.age = 0;
  scene.add(m);
  shells.push(m);
}

// Orbiting sparks while the person is moving
const SPARKS = 70;
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
const sparkMat = new THREE.PointsMaterial({ map: GLOW, color: C.red, size: 0.07, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
scene.add(new THREE.Points(sparkGeo, sparkMat));
const sparks = Array.from({ length: SPARKS }, () => ({
  r: 0.25 + Math.random() * 0.45, speed: 0.6 + Math.random() * 1.6, phase: Math.random() * 6.28,
  tilt: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0),
}));

// ---------------------------------------------------------------- CSI waterfall
const WF_ROWS = 90, WF_W = 4.6, WF_D = 3.0, WF_H = 1.1;
const WF_POS = new THREE.Vector3(0, 0.02, -3.8);
let wf = null;
function buildWaterfall(cols) {
  if (wf) { scene.remove(wf.group); wf.geo.dispose(); }
  const geo = new THREE.PlaneGeometry(WF_W, WF_D, cols - 1, WF_ROWS - 1);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols * WF_ROWS * 3), 3));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
  group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: true, transparent: true, opacity: 0.4, depthWrite: false })));
  group.position.copy(WF_POS);
  const l1 = makeLabel('live Wi-Fi pattern (all receivers) · spikes = movement', { height: 0.12, color: '#b9d6df' });
  l1.position.set(0, WF_H + 0.3, -WF_D / 2);
  const l2 = makeLabel('← frequencies →', { height: 0.09 });
  l2.position.set(0, 0.08, WF_D / 2 + 0.25);
  const l3 = makeLabel('now', { height: 0.09 });
  l3.position.set(WF_W / 2 + 0.25, 0.08, WF_D / 2);
  const l4 = makeLabel('6 s ago', { height: 0.09 });
  l4.position.set(WF_W / 2 + 0.35, 0.08, -WF_D / 2);
  group.add(l1, l2, l3, l4);
  scene.add(group);
  wf = { geo, cols, heights: new Float32Array(cols * WF_ROWS), group };
}
const cLow = new THREE.Color(0x0a4a5a), cMid = new THREE.Color(C.cyan), cHigh = new THREE.Color(C.red), tmp = new THREE.Color();
function pushWaterfall(dist) {
  if (!wf || wf.cols !== dist.length) buildWaterfall(dist.length);
  const { heights, cols, geo } = wf;
  heights.copyWithin(0, cols);                      // rows move one step back in time
  const last = (WF_ROWS - 1) * cols;
  for (let i = 0; i < cols; i++) heights[last + i] = clamp01(Math.log10(Math.max(dist[i], 1)) / 1.5);
  const pos = geo.attributes.position.array, col = geo.attributes.color.array;
  for (let r = 0; r < WF_ROWS; r++) {
    for (let i = 0; i < cols; i++) {
      const h = heights[r * cols + i], v = r * cols + i;   // plane row 0 is far (old), last row near (now)
      pos[v * 3 + 1] = h * WF_H;
      if (h < 0.35) tmp.copy(cLow).lerp(cMid, h / 0.35); else tmp.copy(cMid).lerp(cHigh, (h - 0.35) / 0.65);
      const age = 0.35 + 0.65 * (r / (WF_ROWS - 1));
      col[v * 3] = tmp.r * age; col[v * 3 + 1] = tmp.g * age; col[v * 3 + 2] = tmp.b * age;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- ambient dust
const DUST = 500;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 18;
  dustPos[i * 3 + 1] = Math.random() * 5;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 18;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: GLOW, color: 0x2a6b80, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(dust);

// ---------------------------------------------------------------- live data
let data = null, connected = false;
const es = new EventSource('/stream');
es.onmessage = e => {
  data = JSON.parse(e.data);
  connected = true;
  if (!layout && data.layout) buildLayout(data.layout);
  if (data.disturbance) pushWaterfall(data.disturbance);
  updateHud(data);
};
es.onerror = () => {
  connected = false;
  setHero('idle', 'NOT CONNECTED', 'The sensing program is not running or was stopped.', 'Start it with: python server.py');
};

const $ = id => document.getElementById(id);
function showBanner(text) { $('banner').hidden = !text; $('banner').textContent = text || ''; }
function ago(s) {
  if (s == null) return null;
  s = Math.floor(s);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
function setHero(tone, title, sub, tip = '') {
  $('hero').dataset.tone = tone;
  $('heroTitle').textContent = title;
  $('heroSub').textContent = sub;
  $('heroTip').textContent = tip;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// [headline, tone] per state; the explanation lines are built in updateHud
const STATES = {
  nodata: ['NO DATA', 'idle'],
  warming: ['STARTING UP', 'warn'],
  calib_countdown: ['CALIBRATING', 'warn'],
  calibrating: ['CALIBRATING', 'warn'],
  empty: ['NOBODY DETECTED', 'ok'],
  moving: ['SOMEONE IS MOVING', 'alert'],
  still_breathing: ['SOMEONE IS HERE', 'alive'],
  maybe: ['SOMEONE MAY BE HERE', 'warn'],
};
const stateTone = st => (STATES[st] || [])[1] || 'idle';

// Plain-language direction: the board it heads for, else the main axis on the map
function directionText(dir) {
  if (!dir) return null;
  if (dir.toward) return `towards ${dir.toward}`;
  const txName = layout?.tx?.name || 'TX';
  if (Math.abs(dir.dx) > Math.abs(dir.dy)) return dir.dx > 0 ? 'to the right (on the map)' : 'to the left (on the map)';
  return dir.dy > 0 ? `away from ${txName}` : `towards ${txName}`;
}

function updateHud(d) {
  const b = d.breathing || {}, m = d.motion || {}, loc = d.location || {};
  const lastAgo = ago(m.last_ago);
  const where = loc.active && loc.near ? `the ${layout?.tx?.name || 'TX'}–${loc.near} link` : null;
  const dirText = directionText(loc.direction);

  // The big answer
  const bpmText = b.bpm != null ? `${Math.round(b.bpm)} breaths per minute` : '';
  const hero = {
    nodata: ['No data from any receiver.', 'Check that the sender (TX) is powered and the receivers are plugged in.'],
    warming: ['Learning what the quiet room looks like...', 'This takes a few seconds.'],
    calib_countdown: ['Leave the area around the boards now.', ''],
    calibrating: ['Measuring the empty room. Stay away from the boards.', ''],
    empty: ['No movement or breathing near the boards.', 'To test it: walk across the room between the boards.'],
    moving: [where ? `Movement near ${where}${dirText ? `, moving ${dirText}` : ''}.` : 'Movement detected near the boards.',
      'To measure breathing: sit still close to one of the links for about 20 s.'],
    still_breathing: [`Not moving, but breathing is detected: ${bpmText}${b.link ? ` (clearest on ${b.link})` : ''}.`, ''],
    maybe: [`Movement was detected ${lastAgo}, now everything is still.`, 'No breathing found yet. Sitting still close to one of the links helps it find breathing.'],
  }[d.state] || ['', ''];
  setHero(stateTone(d.state), STATES[d.state]?.[0] || '-', hero[0], hero[1]);

  const silent = (d.links || []).filter(l => !l.rate).map(l => l.name);
  showBanner(d.error ? `Problem: ${d.error}` :
    silent.length && silent.length < (d.links || []).length ? `No data from ${silent.join(', ')}. Check that it is plugged in (the others keep working).` :
    d.calib_warning || '');

  // Overlay for warming up / calibration
  const ov = d.state === 'warming' ? ['Starting up', 'Learning the room\'s quiet level', d.warmup_left, 8] :
    d.state === 'calib_countdown' ? ['Leave the area now', 'Measuring starts in', d.calib.left, d.calib.total] :
    d.state === 'calibrating' ? ['Measuring the empty room', 'Stay away from the boards', d.calib.left, d.calib.total] : null;
  $('overlay').hidden = !ov;
  if (ov) {
    $('ovTitle').textContent = ov[0];
    $('ovSub').textContent = ov[1];
    $('ovBar').style.width = `${100 * (1 - (ov[2] ?? ov[3]) / ov[3])}%`;
    $('ovLeft').textContent = ov[2] == null ? '' : `${Math.ceil(ov[2])} s`;
  }

  // Movement card: meter on a log scale, detection line at ratio 1 (the most disturbed link)
  const levelName = { none: ['None', 'ok'], small: ['Small', 'warn'], large: ['Large', 'alert'] }[m.level] || ['-', 'idle'];
  $('movePill').textContent = levelName[0];
  $('movePill').dataset.tone = levelName[1];
  const pos = r => clamp01(Math.log10(Math.max(r, 0.1) / 0.1) / Math.log10(60));   // 0.1x .. 6x of the line
  $('moveFill').style.width = `${100 * pos(m.ratio ?? 0.1)}%`;
  $('moveFill').style.setProperty('--tone', `var(--${m.level === 'large' ? 'red' : m.level === 'small' ? 'amber' : 'cyan'})`);
  $('moveLine').style.left = `${100 * pos(1)}%`;
  $('lastMove').textContent = lastAgo ? `Last movement: ${lastAgo}` : 'No movement yet';
  $('where').textContent = where ? `near ${where}` :
    d.state === 'still_breathing' && b.link ? `still, near the ${b.link} link` : '-';
  $('direction').textContent = dirText ? `moving ${dirText}` : loc.active ? 'no clear direction yet' : '-';
  $('sequence').textContent = loc.sequence?.length >= 2 ?
    `Crossed links in this order: ${loc.sequence.join(' → ')} (${ago(loc.sequence_ago)})` : '';

  // Breathing card
  const detected = b.status === 'detected';
  const bState = detected ? ['Found', 'alive'] : b.status === 'motion' ? ['Paused', 'warn'] :
    b.status === 'calibrating' ? ['Paused', 'warn'] : ['Not found', 'idle'];
  $('breathPill').textContent = bState[0];
  $('breathPill').dataset.tone = bState[1];
  $('bpm').textContent = detected && b.bpm != null ? Math.round(b.bpm) : '-';
  $('bpmUnit').textContent = detected ? `breaths per minute${b.link ? ` · seen by ${b.link}` : ''}` : '';
  $('breathHint').textContent = detected ? 'The wave below is the breathing measured from the Wi-Fi signal.' :
    b.status === 'motion' ? 'Can\'t measure breathing while someone is moving.' :
    b.status === 'calibrating' ? 'Paused while calibrating.' :
    d.state === 'empty' ? 'Nobody detected. Breathing is measured when someone sits still close to one of the links.' :
    'Looking for breathing... sit still with your chest close to one of the lines between TX and a receiver.';
  $('waveCanvas').hidden = !detected;
  if (detected) drawWave(b);
  const clarity = b.strength ?? 0;
  $('clarityVal').textContent = b.status === 'motion' || b.status === 'calibrating' ? '-' : `${Math.round(clarity * 100)}%`;
  $('clarityFill').style.width = `${100 * clarity}%`;
  $('clarityFill').style.setProperty('--tone', clarity >= 1 ? 'var(--green)' : 'var(--amber)');
  const cv = b.interval_cv;
  $('rhythm').textContent = detected && cv != null ? `Rhythm: ${cv < 0.15 ? 'regular' : cv < 0.3 ? 'slightly irregular' : 'irregular'}` : '';

  // System card: one row per receiver
  const sig = rssi => rssi == null ? '' : rssi > -60 ? ' · strong signal' : rssi > -75 ? ' · good signal' : ' · <span class="warn-text">weak signal</span>';
  $('receivers').innerHTML = (d.links || []).map(l => {
    const st = l.rate >= 50 ? '<span class="ok-text">Connected ✓</span>' :
      l.rate > 0 ? '<span class="warn-text">Unstable</span>' : '<span class="bad-text">No data ✗</span>';
    return `<div><dt><span class="rx-name" style="--c:${linkCss(l.name)}"><i></i>${esc(l.name)}</span></dt><dd>${st}${l.rate ? sig(l.rssi) : ''}</dd></div>`;
  }).join('');
  $('calibState').textContent = d.state === 'calib_countdown' || d.state === 'calibrating' ? 'in progress...' :
    d.calibrated_ago != null ? `done ${ago(d.calibrated_ago)}` : 'not done (optional)';
  $('btnCalib').disabled = d.state === 'calib_countdown' || d.state === 'calibrating';
  $('sensVal').textContent = `${(d.sensitivity ?? 1).toFixed(1)}×`;

  // Technical details
  const f = (v, n = 1) => v == null ? '-' : v.toFixed(n);
  $('tScore').textContent = `${f(m.score)} / ${f(m.threshold)}`;
  $('tFloor').textContent = f(m.floor);
  $('tLink').textContent = m.link ?? '-';
  $('tPos').textContent = loc.x == null ? '-' : `${loc.x.toFixed(1)}, ${loc.y.toFixed(1)}${loc.active ? '' : ' (last)'}`;
  $('tRate').textContent = (d.links || []).map(l => `${l.name} ${l.rate}`).join(' · ');
  $('tRssi').textContent = (d.links || []).map(l => `${l.name} ${l.rssi ?? '-'}`).join(' · ');
  $('tSubc').textContent = d.link?.subcarriers ?? '-';
  $('tPeak').textContent = b.peak_fraction == null ? '-' : `${Math.round(b.peak_fraction * 100)}%`;
  $('tPower').textContent = b.power_ratio == null ? 'needs calibration' : `×${b.power_ratio.toFixed(1)}`;
  $('tCount').textContent = b.bpm_count == null ? '-' : `${b.bpm_count.toFixed(0)} /min`;
  if ($('motionCanvas').closest('details').open) { drawMotion(d); drawSpectrum(b); }
  drawMap(d);
  updateTest(d.test);
}
const linkCss = name => links.find(l => l.name === name)?.css ?? LINK_CSS[0];

// Guided movement test: countdown -> still / move steps -> result
function updateMotionTest(t) {
  $('testBarWrap').hidden = t.phase === 'done';
  $('testForm').hidden = true;
  $('btnTestCancel').textContent = t.phase === 'done' ? 'Close' : 'Cancel';
  $('testBar').style.width = t.left != null ? `${100 * (1 - t.left / t.total)}%` : '100%';
  const moveNow = t.phase === 'running' && t.step === 'move';
  $('test').dataset.tone = t.phase === 'running' ? (moveNow ? 'alert' : 'ok') : 'alive';
  const pct = v => v == null ? '-' : `${Math.round(v * 100)}%`;
  const sec = v => v == null ? '-' : `${v.toFixed(1)} s`;
  const nextText = t.next ? `Next: ${t.next === 'move' ? 'move' : 'keep still'} in ${Math.ceil(t.step_left)} s` : `Ends in ${Math.ceil(t.step_left ?? 0)} s`;
  const [title, sub, step, big] = {
    countdown: ['Movement test', 'Sit or stand where you are. The screen will tell you when to keep completely still (hands off the keyboard and mouse) and when to move (wave your arms, lean, stand up and sit down).', '', `${Math.ceil(t.left)} s`],
    running: [moveNow ? 'Move now' : 'Keep completely still', moveNow ? 'Wave your arms, lean, stand up and sit down.' : 'Hands off the keyboard and mouse. Don\'t talk.', moveNow ? 'MOVE' : 'STILL', ''],
    done: ['Result',
      `While you were still, it wrongly said "moving" ${pct(t.false_alarm)} of the time. While you moved, it said "moving" ${pct(t.detected)} of the time` +
      `${t.missed_moves ? ` and missed ${t.missed_moves} movement part(s) completely` : ''}. It noticed movement after ${sec(t.onset_s)} and noticed you stopped after ${sec(t.release_s)}. Saved as ${t.name}.`, '', ''],
  }[t.phase] || ['', '', '', ''];
  $('testTitle').textContent = title;
  $('testSub').textContent = t.phase === 'running' ? `${sub} ${nextText}` : sub;
  $('testStep').textContent = step;
  $('testBig').textContent = big;
}

// Guided breathing test: countdown -> 60 s of counting -> enter the count -> result
function updateTest(t) {
  $('test').hidden = !t;
  $('btnTest').disabled = !!t;
  $('btnMTest').disabled = !!t;
  if (!t) return;
  if (t.kind === 'motion') return updateMotionTest(t);
  delete $('test').dataset.tone;
  $('testStep').textContent = '';
  const bar = t.left != null ? 100 * (1 - t.left / t.total) : 100;
  $('testBar').style.width = `${bar}%`;
  $('testBarWrap').hidden = t.phase === 'ask' || t.phase === 'done';
  $('testForm').hidden = t.phase !== 'ask';
  $('btnTestCancel').textContent = t.phase === 'done' ? 'Close' : 'Cancel';
  const [title, sub, big] = {
    countdown: ['Get ready', 'Sit down with your chest close to one of the lines between TX and a receiver. Sit still and breathe normally. When the timer ends, start counting your breaths (count each breath in).', `${Math.ceil(t.left)} s`],
    recording: ['Count your breaths now', 'Keep still and breathe normally. Count every breath in until the timer ends.', `${Math.ceil(t.left)} s`],
    ask: ['Done. Stop counting', 'Type in how many breaths you counted during the minute.', ''],
    done: ['Result', t.measured == null
      ? `You counted ${Math.round(t.true_bpm)} breaths per minute. The system did not find a breathing pattern. The recording is saved so the detector can be tuned.`
      : `You counted ${Math.round(t.true_bpm)} per minute. The system measured ${Math.round(t.measured)} per minute (difference ${Math.abs(Math.round(t.measured - t.true_bpm))}). It found breathing ${Math.round(t.detected_share * 100)}% of the time.`, ''],
  }[t.phase] || ['', '', ''];
  $('testTitle').textContent = title;
  $('testSub').textContent = sub;
  $('testBig').textContent = big;
  if (t.phase === 'ask' && document.activeElement !== $('testCount')) $('testCount').focus();
}

// ---------------------------------------------------------------- 2D charts
function prepCanvas(id) {
  const c = $(id), dpr = Math.min(devicePixelRatio, 2);
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = '10px Inter, system-ui, sans-serif';
  return [g, w, h];
}
function empty(g, w, h, text) {
  g.fillStyle = CSS.faint;
  g.textAlign = 'center';
  g.fillText(text, w / 2, h / 2 + 3);
  g.textAlign = 'left';
}

// Top-down room map: boards, links (red when they see movement), position, direction, trail
const mapTrail = [];
function drawMap(d) {
  const [g, w, h] = prepCanvas('mapCanvas');
  if (!layout) return empty(g, w, h, 'waiting for data');
  const pts = [layout.tx, ...layout.receivers];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 26, sc = Math.min((w - 2 * pad) / Math.max(x1 - x0, 0.5), (h - 2 * pad) / Math.max(y1 - y0, 0.5));
  const ox = w / 2 - sc * (x0 + x1) / 2, oy = h / 2 + sc * (y0 + y1) / 2;
  const X = x => ox + sc * x, Y = y => oy - sc * y;
  const loc = d.location || {};

  (d.links || []).forEach(l => {
    const hot = clamp01(((l.smooth_ratio ?? 0) - 0.6) / 1.4);
    g.strokeStyle = hot > 0.3 ? CSS.red : linkCss(l.name);
    g.globalAlpha = l.rate ? 0.35 + 0.65 * Math.max(hot, 0.3) : 0.15;
    g.lineWidth = 1.5 + 4 * hot;
    g.setLineDash(l.rate ? [] : [4, 4]);
    g.beginPath(); g.moveTo(X(layout.tx.x), Y(layout.tx.y)); g.lineTo(X(l.x), Y(l.y)); g.stroke();
  });
  g.setLineDash([]); g.globalAlpha = 1; g.lineWidth = 1;

  const board = (p, color, label) => {
    g.fillStyle = color;
    g.beginPath(); g.arc(X(p.x), Y(p.y), 5, 0, 7); g.fill();
    g.fillStyle = CSS.text; g.font = '600 11px Inter, system-ui, sans-serif';
    const tw = g.measureText(label).width;
    g.fillText(label, Math.min(Math.max(X(p.x) - tw / 2, 2), w - tw - 2), Y(p.y) + (Y(p.y) > h - 20 ? -9 : 17));
  };
  board(layout.tx, CSS.text, layout.tx.name);
  layout.receivers.forEach(r => board(r, linkCss(r.name), r.name));

  // Trail of the last positions (kept here, 4 s)
  const now = performance.now() / 1000;
  if (loc.active && loc.x != null) mapTrail.push([now, loc.x, loc.y]);
  while (mapTrail.length && now - mapTrail[0][0] > 4) mapTrail.shift();
  if (mapTrail.length > 1) {
    g.strokeStyle = CSS.red; g.lineWidth = 2;
    for (let i = 1; i < mapTrail.length; i++) {
      g.globalAlpha = 0.6 * (1 - (now - mapTrail[i][0]) / 4);
      g.beginPath(); g.moveTo(X(mapTrail[i - 1][1]), Y(mapTrail[i - 1][2])); g.lineTo(X(mapTrail[i][1]), Y(mapTrail[i][2])); g.stroke();
    }
    g.globalAlpha = 1; g.lineWidth = 1;
  }

  if (loc.x != null && (loc.active || d.state === 'maybe')) {
    const px = X(loc.x), py = Y(loc.y), c = loc.active ? CSS.red : CSS.amber;
    g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 14;
    g.beginPath(); g.arc(px, py, 7, 0, 7); g.fill(); g.shadowBlur = 0;
    g.strokeStyle = c; g.globalAlpha = 0.35;
    g.beginPath(); g.arc(px, py, 0.5 * sc, 0, 7); g.stroke(); g.globalAlpha = 1;   // ~0.5 m uncertainty ring
    const dir = loc.direction;
    if (dir) {
      const L = 34, ex = px + dir.dx * L, ey = py - dir.dy * L, a = Math.atan2(ey - py, ex - px);
      g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 3;
      g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();
      g.beginPath(); g.moveTo(ex + 8 * Math.cos(a), ey + 8 * Math.sin(a));
      g.lineTo(ex + 8 * Math.cos(a + 2.4), ey + 8 * Math.sin(a + 2.4));
      g.lineTo(ex + 8 * Math.cos(a - 2.4), ey + 8 * Math.sin(a - 2.4)); g.fill();
      g.lineWidth = 1;
    }
  }
  g.fillStyle = CSS.faint; g.font = '10px Inter, system-ui, sans-serif';
  g.fillText('1 m', 8, h - 8);
  g.strokeStyle = CSS.faint; g.beginPath(); g.moveTo(28, h - 11); g.lineTo(28 + sc, h - 11); g.stroke();
}

function drawWave(b) {
  const [g, w, h] = prepCanvas('waveCanvas');
  if (!b.wave || !b.wave.length) return;
  const n = b.wave.length, peak = Math.max(1e-6, ...b.wave.map(Math.abs));
  g.lineWidth = 2;
  g.strokeStyle = CSS.green;
  g.shadowColor = CSS.green; g.shadowBlur = 8;
  g.beginPath();
  b.wave.forEach((v, i) => {
    const x = (i / (n - 1)) * w, y = h / 2 - (v / peak) * (h / 2 - 6);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = CSS.muted;
  g.fillText('20 s ago', 4, h - 5);
  g.fillText('now', w - 22, h - 5);
}

function drawSpectrum(b) {
  const [g, w, h] = prepCanvas('specCanvas');
  if (!b.spectrum || !b.spectrum.length) return empty(g, w, h, 'no data yet');
  const maxHz = b.spectrum_max_hz, n = b.spectrum.length, x0 = 0.05;
  const xOf = hz => ((hz - x0) / (maxHz - x0)) * w;
  g.fillStyle = 'rgba(69,224,143,0.07)';                          // breathing band 8-42 /min
  g.fillRect(xOf(0.13), 0, xOf(0.7) - xOf(0.13), h);
  const bw = w / n;
  b.spectrum.forEach((v, i) => {
    const bh = v * (h - 18);
    g.fillStyle = b.status === 'detected' ? CSS.green : CSS.cyan;
    g.globalAlpha = 0.35 + 0.65 * v;
    g.fillRect(i * bw + 0.5, h - 14 - bh, Math.max(1, bw - 1), bh);
  });
  g.globalAlpha = 1;
  if (b.bpm_raw != null) {
    const x = xOf(b.bpm_raw / 60);
    g.strokeStyle = CSS.text; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(x, 2); g.lineTo(x, h - 14); g.stroke(); g.setLineDash([]);
    g.fillStyle = CSS.text;
    const label = `${b.bpm_raw.toFixed(0)} /min`;
    g.fillText(label, Math.min(x + 4, w - g.measureText(label).width - 2), 11);
  }
  g.fillStyle = CSS.muted;
  [10, 20, 30, 40, 50].forEach(bpm => { const x = xOf(bpm / 60); g.fillText(bpm, x - 6, h - 2); });
}

// Movement of each receiver relative to its own detection line (1 = line)
function drawMotion(d) {
  const [g, w, h] = prepCanvas('motionCanvas');
  const ls = (d.links || []).filter(l => l.history && l.history.length >= 2);
  if (!ls.length) return empty(g, w, h, 'no data yet');
  const ymax = Math.max(4, ...ls.flatMap(l => l.history.map(p => p[1]))) * 1.05;
  const xOf = t => w + (t / 60) * w, yOf = v => h - 12 - (Math.min(v, ymax) / ymax) * (h - 16);
  [[1, CSS.amber, 'detection line'], [3, CSS.red, 'large']].forEach(([v, c, name]) => {
    g.strokeStyle = c; g.globalAlpha = 0.7; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(0, yOf(v)); g.lineTo(w, yOf(v)); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    g.fillStyle = CSS.muted; g.fillText(name, 4, yOf(v) - 3);
  });
  g.lineWidth = 1.6;
  ls.forEach(l => {
    g.strokeStyle = linkCss(l.name);
    g.beginPath();
    l.history.forEach(([t, v], i) => i ? g.lineTo(xOf(t), yOf(v)) : g.moveTo(xOf(t), yOf(v)));
    g.stroke();
  });
  g.fillStyle = CSS.muted;
  g.fillText('60 s ago', 4, h - 2);
  g.fillText('now', w - 22, h - 2);
  ls.forEach((l, i) => { g.fillStyle = linkCss(l.name); g.fillText(l.name, w - 34 - 34 * (ls.length - 1 - i), 10); });
}

// ---------------------------------------------------------------- controls
$('btnCalib').onclick = () => fetch('/recalibrate', { method: 'POST' });
const SENS = [0.5, 0.7, 1.0, 1.4, 2.0, 3.0];
function stepSensitivity(dir) {
  const cur = data?.sensitivity ?? 1;
  const i = SENS.reduce((best, v, k) => Math.abs(v - cur) < Math.abs(SENS[best] - cur) ? k : best, 0);
  const next = SENS[Math.max(0, Math.min(SENS.length - 1, i + dir))];
  fetch(`/sensitivity?value=${next}`, { method: 'POST' });
}
$('btnSensDown').onclick = () => stepSensitivity(-1);
$('btnSensUp').onclick = () => stepSensitivity(1);
$('btnRotate').onclick = () => {
  controls.autoRotate = !controls.autoRotate;
  $('btnRotate').setAttribute('aria-pressed', controls.autoRotate);
};
$('btnView').onclick = () => { camera.position.copy(HOME); controls.target.copy(HOME_TARGET); };
$('btnHelp').onclick = () => { $('help').hidden = false; };
$('btnTest').onclick = () => fetch('/test/start', { method: 'POST' });
$('btnTestCancel').onclick = () => fetch(data?.test?.kind === 'motion' ? '/mtest/cancel' : '/test/cancel', { method: 'POST' });
$('btnMTest').onclick = () => fetch('/mtest/start', { method: 'POST' });
$('testForm').onsubmit = e => {
  e.preventDefault();
  fetch(`/test/label?count=${encodeURIComponent($('testCount').value)}`, { method: 'POST' });
  $('testCount').value = '';
};
$('btnHelpClose').onclick = () => { $('help').hidden = true; };
$('help').onclick = e => { if (e.target === $('help')) $('help').hidden = true; };
addEventListener('keydown', e => {
  if (e.key === 'Escape') $('help').hidden = true;
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); $('btnRotate').click(); }
});

// ---------------------------------------------------------------- animation
const BREATH_DELAY = 1.5;   // seconds; the band-passed waveform settles a little after the fact
const s = { motion: 0, present: 0, breath: 0, color: new THREE.Color(C.cyan), prevB: 0, rising: false, active: 0, dir: 0 };
const toneColor = { alive: C.green, alert: C.red, warn: C.amber, ok: C.cyan, idle: C.cyan };
const clock = new THREE.Clock();
const target = new THREE.Vector3(), red = new THREE.Color(C.red), base = new THREE.Color(), v3 = new THREE.Vector3();

function breathValue(b, now) {
  // Play back the measured waveform with a short delay, interpolated
  if (!b || !b.wave || b.wave.length < 2 || b.status !== 'detected') return 0;
  const idx = (now - BREATH_DELAY - b.wave_end) * b.wave_fs + (b.wave.length - 1);
  const i = Math.max(0, Math.min(b.wave.length - 2, Math.floor(idx)));
  const f = clamp01(idx - i);
  const peak = Math.max(1e-6, ...b.wave.map(Math.abs));
  return lerp(b.wave[i], b.wave[i + 1], f) / peak;
}

// Where the presence core should be: the located movement, else the link that sees the breathing
function coreTarget(d) {
  const loc = d?.location;
  if (loc?.active && loc.x != null) return target.copy(toScene(loc.x, loc.y));
  if (d?.state === 'still_breathing' && d.breathing?.link) {
    const l = links.find(k => k.name === d.breathing.link);
    if (l) return target.copy(l.mid);
  }
  if (loc?.x != null && d?.presence?.present) return target.copy(toScene(loc.x, loc.y));   // last seen
  return null;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime, now = Date.now() / 1000;
  const d = data;
  const ratio = d?.motion?.ratio ?? 0;
  const tone = connected && d ? stateTone(d.state) : 'idle';
  const k6 = 1 - Math.exp(-dt * 6), k4 = 1 - Math.exp(-dt * 4);
  s.motion = lerp(s.motion, clamp01((ratio - 0.6) / 2.4), k6);
  s.present = lerp(s.present, d?.presence?.present ? 1 : 0, 1 - Math.exp(-dt * 3));
  s.active = lerp(s.active, d?.location?.active ? 1 : 0, k4);
  s.color.lerp(new THREE.Color(toneColor[tone] ?? C.cyan), k4);
  const bv = breathValue(d?.breathing, now);
  s.breath = lerp(s.breath, bv, 1 - Math.exp(-dt * 10));

  // Presence core follows the estimated position
  const tgt = coreTarget(d);
  if (tgt) focus.lerp(tgt, 1 - Math.exp(-dt * 5));

  // Breath peak -> shell
  if (s.breath > s.prevB) s.rising = true;
  else if (s.rising && s.breath < s.prevB && s.breath > 0.3) { emitShell(C.green); s.rising = false; }
  s.prevB = s.breath;

  // Links: each turns red and ripples with its own movement
  base.copy(tone === 'alert' ? new THREE.Color(C.cyan) : s.color);
  const byName = Object.fromEntries((d?.links || []).map(l => [l.name, l]));
  links.forEach(l => {
    const info = byName[l.name] || {};
    const rate = clamp01((info.rate ?? 0) / 100);
    l.motion = lerp(l.motion, clamp01(((info.smooth_ratio ?? 0) - 0.6) / 2.4), k6);
    l.rate = lerp(l.rate ?? 0, rate, k4);
    l.color.copy(base).lerp(red, clamp01(l.motion * 2.5));
    l.zoneMat.uniforms.uTime.value = t;
    l.zoneMat.uniforms.uMotion.value = l.motion;
    l.zoneMat.uniforms.uColor.value.copy(l.color);
    l.zoneMat.uniforms.uIntensity.value = (0.3 + l.motion * 0.9 + s.present * 0.1) * (0.3 + 0.7 * l.rate);
    l.wire.material.color.copy(l.color);
    l.wire.material.opacity = 0.04 + l.motion * 0.12;
    l.beam.material.color.copy(l.color);
    l.beam.material.opacity = 0.2 + 0.5 * l.rate;
    l.pMat.color.copy(l.color);
    l.pMat.opacity = 0.2 + 0.8 * l.rate;
    const pp = l.pGeo.attributes.position.array;
    l.packets.forEach((k, i) => {
      k.p = (k.p + dt * (0.15 + 0.5 * l.rate)) % 1;
      const j = l.motion * 0.4 * Math.sin(Math.PI * k.p);
      v3.copy(l.from).lerp(l.to, k.p)
        .addScaledVector(l.side, Math.cos(t * 5.3 + k.seed * 1.7) * j);
      pp[i * 3] = v3.x; pp[i * 3 + 1] = v3.y + Math.sin(t * 7 + k.seed) * j; pp[i * 3 + 2] = v3.z;
    });
    l.pGeo.attributes.position.needsUpdate = true;
    l.board.led.material.color.copy(l.color);
  });
  if (tx) tx.led.material.opacity = 0.4 + 0.6 * (Math.sin(t * 20) > 0 ? 1 : 0.2);

  coreMat.uniforms.uTime.value = t;
  coreMat.uniforms.uColor.value.copy(s.color);
  coreMat.uniforms.uAlpha.value = s.present;
  core.position.copy(focus);
  core.scale.setScalar(1 + s.breath * 0.35 + s.motion * 0.25 * Math.sin(t * 9));
  core.rotation.y += dt * 0.4;
  halo.position.copy(focus);
  halo.material.color.copy(s.color);
  halo.material.opacity = s.present * (0.22 + 0.15 * s.breath);
  halo.scale.setScalar(0.8 + s.breath * 0.3);
  coreLabel.position.set(focus.x, focus.y - 0.42, focus.z);
  coreLabel.material.opacity = s.present * 0.85;
  spot.position.set(focus.x, 0.015, focus.z);
  spot.material.color.copy(s.color);
  spot.material.opacity = s.present * 0.5;

  // Direction arrow from the core, flat on the core's height
  const dir = d?.location?.direction;
  s.dir = lerp(s.dir, dir ? 1 : 0, k4);
  arrow.visible = s.dir > 0.05;
  if (dir) arrow.setDirection(v3.set(dir.dx, 0, -dir.dy).normalize());
  arrow.position.copy(focus);
  arrow.setLength(0.35 + 0.8 * s.dir, 0.3 * s.dir + 0.01, 0.2 * s.dir + 0.01);

  // Trail: recent core positions while movement is located
  if (s.active > 0.5) trailPts.push(focus.clone());
  else if (trailPts.length) trailPts.shift();
  while (trailPts.length > TRAIL) trailPts.shift();
  const tp = trailGeo.attributes.position.array, tc = trailGeo.attributes.color.array;
  for (let i = 0; i < TRAIL; i++) {
    const p = trailPts[Math.min(i, trailPts.length - 1)] || focus, a = trailPts.length ? i / TRAIL : 0;
    tp[i * 3] = p.x; tp[i * 3 + 1] = 0.05; tp[i * 3 + 2] = p.z;
    tc[i * 3] = red.r * a; tc[i * 3 + 1] = red.g * a; tc[i * 3 + 2] = red.b * a;
  }
  trailGeo.setDrawRange(0, Math.max(trailPts.length, 0));
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;

  // Motion sparks around the core
  const sp = sparkGeo.attributes.position.array;
  sparks.forEach((k, i) => {
    const a = k.phase + t * k.speed * (0.5 + s.motion);
    v3.set(Math.cos(a) * k.r, Math.sin(a * 1.3) * k.r * 0.5, Math.sin(a) * k.r).applyEuler(k.tilt);
    sp[i * 3] = focus.x + v3.x; sp[i * 3 + 1] = focus.y + v3.y; sp[i * 3 + 2] = focus.z + v3.z;
  });
  sparkGeo.attributes.position.needsUpdate = true;
  sparkMat.opacity = s.motion * s.present;

  // Breath shells
  for (let i = shells.length - 1; i >= 0; i--) {
    const m = shells[i];
    m.userData.age += dt;
    const a = m.userData.age / 2.6;
    m.scale.setScalar(0.2 + a * 0.75);
    m.material.opacity = 0.3 * (1 - a);
    if (a >= 1) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); shells.splice(i, 1); }
  }

  dust.rotation.y += dt * 0.01;
  controls.update();
  composer.render();
  requestAnimationFrame(animate);
}
animate();
