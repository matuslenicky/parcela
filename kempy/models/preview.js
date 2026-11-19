// Rýchly náhľad modelov (.glb) v three.js s rovnakým svetlom ako 3D prehliadka: hárok pohľadov do PNG za pár sekúnd.
//   node kempy/models/preview.js <out.png> <model.glb> [ďalšie.glb …] [--views=front34,side,rear34,front,rear,top] [--cols=3] [--tile=640x420] [--ground=#8f948c] [--bg=#dfe9ee] [--nolabel] [--json=rozmery.json]
// Jeden model = hárok všetkých pohľadov; viac modelov = riadok na model. Spúšťa si vlastný headless Chromium (softvérové WebGL) a sám ho zatvorí.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright'));
const argv = process.argv.slice(2), pos = argv.filter((a) => !a.startsWith('--'));
const flag = (n, d) => { const a = argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
if (pos.length < 2) { console.error('usage: node preview.js <out.png> <model.glb> […] [--views=…] [--cols=N] [--tile=WxH]'); process.exit(2); }
const out = path.resolve(pos[0]), glbs = pos.slice(1).map((p) => path.resolve(p)), root = path.resolve(__dirname, '..', '..');
const views = flag('views', glbs.length > 1 ? 'front34,side,rear34' : 'front34,side,rear34,front,rear,top').split(',');
const cols = +flag('cols', glbs.length > 1 ? views.length : 3), [tw, th] = flag('tile', '640x420').split('x').map(Number);
const tiles = glbs.length * views.length, rows = Math.ceil(tiles / cols);

const PAGE = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff;overflow:hidden}canvas{display:block}
.l{position:absolute;font:600 13px/1 system-ui,sans-serif;color:#1c2420;background:rgba(255,255,255,.82);padding:5px 8px;border-radius:6px}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeEnv } from '/kempy/viewer/env.js';
const C = ${JSON.stringify({ n: glbs.length, names: glbs.map((g) => path.basename(g, '.glb')), views, cols, rows, tw, th, ground: flag('ground', '#8f948c'), bg: flag('bg', '#dfe9ee'), nolabel: argv.includes('--nolabel') })};
const VIEW = { front34: [38, 13, 30], rear34: [142, 13, 30], side: [90, 3, 22], front: [0, 5, 24], rear: [180, 5, 24], top: [90, 89.5, 24], hi34: [42, 32, 30], low34: [28, 5, 32], back34: [215, 16, 30] };
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(C.cols * C.tw, C.rows * C.th);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(C.bg);
const sunDir = new THREE.Vector3(0.35, 0.8, 0.45).normalize();
scene.environment = makeEnv(renderer, { sun: sunDir }); scene.environmentIntensity = 0.85;
scene.add(new THREE.HemisphereLight(0xe6f2fa, 0x6b7466, 0.55));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2.5;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: C.ground, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const models = await Promise.all(Array.from({ length: C.n }, (_, i) => loader.loadAsync('/__glb/' + i)));
const stats = [];
models.forEach((g, i) => {
  let tris = 0, meshes = 0;
  g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  g.scene.visible = false; scene.add(g.scene);
  const b = new THREE.Box3().setFromObject(g.scene), s = b.getSize(new THREE.Vector3());
  stats.push({ name: C.names[i], tris: Math.round(tris), meshes, size: [s.x, s.y, s.z].map((v) => +v.toFixed(3)), box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(3)) });
});
renderer.setScissorTest(true);
let t = 0;
for (let i = 0; i < C.n; i++) {
  const g = models[i].scene; g.visible = true;
  const box = new THREE.Box3().setFromObject(g), ctr = box.getCenter(new THREE.Vector3()), sph = box.getBoundingSphere(new THREE.Sphere());
  sun.position.copy(ctr).addScaledVector(sunDir, sph.radius * 4); sun.target.position.copy(ctr);
  const sc = sun.shadow.camera, r = sph.radius * 1.6; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = sph.radius * 9; sc.updateProjectionMatrix();
  for (const v of C.views) {
    const [az, el, fov] = /^-?[0-9.]+:/.test(v) ? v.split(":").map(Number) : (VIEW[v] || VIEW.front34), a = az * Math.PI / 180, e = el * Math.PI / 180;
    const cam = new THREE.PerspectiveCamera(fov, C.tw / C.th, 0.05, 500), dist = sph.radius / Math.sin(fov * Math.PI / 360) * (v === "top" ? 0.74 : 0.6);
    cam.position.set(ctr.x + Math.cos(a) * Math.cos(e) * dist, ctr.y + Math.sin(e) * dist, ctr.z + Math.sin(a) * Math.cos(e) * dist); cam.lookAt(ctr);
    const cx = (t % C.cols) * C.tw, cy = (C.rows - 1 - Math.floor(t / C.cols)) * C.th;
    renderer.setViewport(cx, cy, C.tw, C.th); renderer.setScissor(cx, cy, C.tw, C.th); renderer.render(scene, cam);
    if (!C.nolabel && (v === C.views[0] || C.n === 1)) { const l = document.createElement('div'); l.className = 'l'; l.textContent = (C.n > 1 || v === C.views[0] ? C.names[i] + ' · ' : '') + v; l.style.left = (t % C.cols) * C.tw + 8 + 'px'; l.style.top = Math.floor(t / C.cols) * C.th + 8 + 'px'; document.body.appendChild(l); }
    t++;
  }
  g.visible = false;
}
window.__stats = stats; window.__done = true;
</script>`;

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
  const m = /^\/__glb\/(\d+)$/.exec(u), f = m ? glbs[+m[1]] : path.join(root, u);
  if (!f || !f.startsWith(m ? f : root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port; let browser, code = 0;
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: cols * tw, height: rows * th }, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page ' + m.type() + '] ' + m.text()); });
    page.on('pageerror', (e) => console.log('[page exception] ' + e.message));
    await page.goto('http://127.0.0.1:' + port + '/');
    await page.waitForFunction('window.__done === true', null, { timeout: 180000 });
    await page.screenshot({ path: out });
    const stats = await page.evaluate('window.__stats'); if (flag('json', '')) fs.writeFileSync(path.resolve(flag('json', '')), JSON.stringify(stats));
    for (const s of stats) if (stats.length < 20) console.log(`${s.name}: ${s.size[0]} × ${s.size[2]} × ${s.size[1]} m (d × š × v), ${s.tris} trojuholníkov, ${s.meshes} sietí`);
    console.log('náhľad: ' + out);
  } catch (e) { console.error(e.message); code = 1; } finally { if (browser) await browser.close(); server.close(); process.exit(code); }
});
