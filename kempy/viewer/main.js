/* 3D prehliadka kempu pre ukážkové stránky (kempy/<slug>/index.html).
   kempy/build-viewer.js ju zbalí s three.js, modelom z Blendera (camp.glb) a camp.json do kempy/<slug>/camp3d.js.
   Stránka ju načíta až po kliknutí na „Prejsť sa po kempe v 3D“ a volá window.Camp3D.mount(host, api):
     api.units()  -> [{id, taken, fit, sel}]     stav jednotiek pre zvolený termín a voľbu hosťa
     api.info(id) -> {title, chip, ok, facts: [], total}   texty pre kartu (rovnaké ako v paneli stránky)
     api.select(id)   vyberie jednotku na stránke          api.book(id)   zavrie prehliadku a ukáže panel s cenou
     api.kit(names)   (nepovinné) zostava, ktorú si hosť poskladal v izbe parcely (room.js)
   Jednotky: metre, x východ, z juh, y hore (Blender exportuje glTF s osou Y nahor). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeEnv } from './env.js';
import { createRoom, registerModel } from './room.js';
import { texturize, buildTrees, buildBuildings, waterize, waterTick, fadeTrees } from './look.js';
import CAMP from 'camp-json';
import GLB from 'camp-glb';

const EYE = 1.7, WALK = 5.5, S = CAMP.pxPerM, OX = CAMP.origin[0], OY = CAMP.origin[1];
const W = (p) => [(p[0] - OX) / S, (p[1] - OY) / S];                    // px plánu -> metre (x, z)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = {
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9.5 21l2.2-6.2L14 17v4M11.7 14.8l.8-5.3-3 1.6-1.3 3M12.5 9.5l2.6 2.7 2.9.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>', play: '<path d="M7 5l12 7-12 7z"/>',
};
const ico = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[n] + '</svg>';

function rectPts(c, w, h, ang) {      // rohy obdĺžnika v px plánu (ang v stupňoch, v smere hodinových ručičiek ako na obrázku)
  const a = ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map((d) => [c[0] + d[0] * ca - d[1] * sa, c[1] + d[0] * sa + d[1] * ca]);
}
function inPoly(x, z, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
function segDist(x, z, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); }
function polyGeo(pts, y) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1]))));
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0); return g;
}
function ringGeo(pts, w, y) {          // uzavretý pás okolo mnohouholníka
  const n = pts.length, pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    pos.push(p[0] - dz * w, y, p[1] + dx * w, p[0] + dz * w, y, p[1] - dx * w);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
function skyTexture(top, horizon) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(.55, horizon); gr.addColorStop(1, horizon); g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function mount(host, api) {
  const touch = matchMedia('(pointer: coarse)').matches, still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const unitWord = (u) => (u.unit === 'cabin' ? 'Chatka' : u.unit === 'zone' ? 'Plocha' : 'Parcela');
  host.classList.add('c3');
  host.innerHTML =
    '<div class="c3-stage"></div>'
    + '<div class="c3-top"><div class="c3-go"><select aria-label="Prejsť na miesto"><option value="">Prejsť na miesto…</option></select></div></div>'
    + '<div class="c3-ctl">'
    + '<div class="c3-seg" role="group" aria-label="Režim pohľadu"><button type="button" data-mode="map" aria-pressed="true">' + ico('map') + '<span>Prehľad</span></button><button type="button" data-mode="walk" aria-pressed="false">' + ico('walk') + '<span>Prechádzka</span></button>' + (CAMP.tour ? '<button type="button" data-mode="fly" aria-pressed="false">' + ico('play') + '<span>Prelet</span></button>' : '') + '</div>'
    + '<div class="c3-stack c3-zoom"><button type="button" class="c3-zin" aria-label="Priblížiť">' + ico('plus') + '</button><button type="button" class="c3-zout" aria-label="Oddialiť">' + ico('minus') + '</button></div>'
    + '<button type="button" class="c3-fwd" aria-label="Ísť dopredu" hidden>' + ico('up') + '</button>'
    + '</div>'
    + '<div class="c3-card" hidden role="group" aria-label="Vybrané miesto"><button type="button" class="c3-x" aria-label="Zavrieť kartu">' + ico('close') + '</button><div class="c3-tip"></div><button type="button" class="btn btn-sign c3-fit">Zariadiť parcelu</button><button type="button" class="btn btn-line c3-book">Pokračovať k rezervácii</button></div>'
    + '<div class="c3-sun" role="group" aria-label="Denná doba a slnko"><button type="button" data-h="8">Ráno</button><button type="button" data-h="13" aria-pressed="true">Poludnie</button><button type="button" data-h="19">Večer</button><input type="range" min="5" max="21" step="0.25" value="13" aria-label="Hodina dňa"><output>13:00</output></div>'
    + '<p class="c3-hint"></p><p class="sr c3-say" role="status"></p><div class="c3-load" role="status">Načítavam 3D model kempu…</div>';
  const $ = (s) => host.querySelector(s);
  const stage = $('.c3-stage'), card = $('.c3-card'), hint = $('.c3-hint'), pick = $('.c3-go select'), fwd = $('.c3-fwd');

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
  catch (e) {                              // bez WebGL ostane len hláška: ovládanie by bolo pod ňou neviditeľné, ale dosiahnuteľné tabulátorom
    host.innerHTML = '<div class="c3-load" role="alert">Tento prehliadač nevie zobraziť 3D grafiku (WebGL). Použite mapu vyššie.</div>';
    return { ok: false, update() {}, pause() {}, resume() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;       // scéna stojí: tiene sa prepočítajú len po načítaní modelu a pri otvorení prehliadky
  renderer.domElement.setAttribute('aria-hidden', 'true'); renderer.domElement.style.touchAction = 'none';
  stage.appendChild(renderer.domElement);

  /* rozmery kempu v metroch */
  const ex = CAMP.extent, [x0, z0] = W([ex[0], ex[1]]), [x1, z1] = W([ex[2], ex[3]]);
  const bnd = CAMP.boundary.map(W), bx = bnd.map((p) => p[0]), bz = bnd.map((p) => p[1]);
  const CENTER = new THREE.Vector3((Math.min(...bx) + Math.max(...bx)) / 2, 0, (Math.min(...bz) + Math.max(...bz)) / 2);
  const SPAN = Math.max(Math.max(...bx) - Math.min(...bx), Math.max(...bz) - Math.min(...bz));
  const LIM = { x0: x0 - 10, x1: x1 + 10, z0: z0 - 10, z1: z1 + 10 };

  const scene = new THREE.Scene(), SKY = new THREE.Color(0xcfe6f2);
  scene.fog = new THREE.Fog(SKY, SPAN * 1.2, SPAN * 4.5);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.3, SPAN * 8);
  const hemi = new THREE.HemisphereLight(0xe6f2fa, 0x4f6f5c, 1.3); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4); sun.position.set(CENTER.x + SPAN * .35, SPAN * .8, CENTER.z + SPAN * .45); sun.target.position.copy(CENTER); sun.castShadow = true;
  const sc = sun.shadow.camera, half = SPAN * .75; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 5; sc.far = SPAN * 2.6;
  sun.shadow.mapSize.set(touch ? 2048 : 4096, touch ? 2048 : 4096); sun.shadow.bias = -0.0012; sun.shadow.normalBias = touch ? 2.4 : 1.2; sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  /* slnko podľa skutočnej dráhy: zemepisná poloha kempu, deň pobytu a hodina miestneho letného času (camp.json: sun) */
  const SUNC = Object.assign({ lat: 48.7, lon: 19.5, tz: 2, doy: 194, north: 0 }, CAMP.sun || {}), sunDir = new THREE.Vector3(0.35, 0.8, 0.45);
  let envKey = '', hour = 13, envT = 0;
  function sunAt(h) {                    // výška a azimut slnka (od severu v smere hodinových ručičiek), radiány
    const g = 2 * Math.PI / 365 * (SUNC.doy - 1 + (h - 12) / 24), la = SUNC.lat * Math.PI / 180;
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const ha = ((h * 60 + eqt + 4 * SUNC.lon - 60 * SUNC.tz) / 4 - 180) * Math.PI / 180;
    const el = Math.asin(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha));
    return { el, az: Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) + Math.PI + SUNC.north * Math.PI / 180 };
  }
  function applyTheme() {
    const t = document.documentElement.getAttribute('data-theme'), dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    const s = sunAt(hour), up = Math.max(0, Math.sin(s.el)), k = clamp(up / 0.5, 0, 1), day = clamp(up / 0.12, 0, 1);
    sunDir.set(Math.sin(s.az) * Math.cos(s.el), Math.max(0.04, Math.sin(s.el)), -Math.cos(s.az) * Math.cos(s.el)).normalize();
    sun.position.copy(CENTER).addScaledVector(sunDir, SPAN); sun.intensity = 2.6 * day * (1 + 2.4 * (1 - k)) * (dark ? 0.6 : 1);   // nízke slnko dopadá na zem šikmo: silnejšie svetlo, aby tiene ostali čitateľné sun.color.set(0xffa860).lerp(new THREE.Color(0xfff4e0), k);
    const top = new THREE.Color(dark ? 0x1f2b31 : 0x7096c8).lerp(new THREE.Color(dark ? 0x1f2b31 : 0x8fc3e6), k), hor = new THREE.Color(dark ? 0x4a4038 : 0xf5c596).lerp(new THREE.Color(dark ? 0x2f3e44 : 0xcfe6f2), k);
    const dusk = new THREE.Color(0x27303a); top.lerp(dusk, (1 - day) * 0.75); hor.lerp(dusk, (1 - day) * 0.6);
    SKY.copy(hor); scene.fog.color.copy(SKY);
    if (scene.background) scene.background.dispose();
    scene.background = skyTexture('#' + top.getHexString(), '#' + hor.getHexString());
    renderer.toneMappingExposure = (dark ? 0.72 : 1.18) * (0.5 + 0.5 * day); hemi.intensity = (dark ? 0.62 : 1.0) * (0.4 + 0.6 * day) * (0.6 + 0.4 * k);
    const key = dark + ':' + Math.round(hour * 2);
    if (envKey !== key) {                // obloha ako zdroj odrazov pre lak, sklo a chróm vozidiel (pri ťahaní posuvníka až po zastavení)
      envKey = key; clearTimeout(envT);
      envT = setTimeout(() => { if (scene.environment) scene.environment.dispose(); scene.environment = makeEnv(renderer, { top: '#' + top.getHexString(), horizon: '#' + hor.getHexString(), ground: dark ? '#1c2622' : '#5d6f55', sunPower: (dark ? 0.15 : 1) * day, sun: sunDir.clone() }); scene.environmentIntensity = dark ? 0.5 : 0.6; }, scene.environment ? 220 : 0);
    }
    renderer.shadowMap.needsUpdate = true;
  }
  applyTheme();

  /* ---------------- jednotky (parcely, chatky, plochy): poloha z camp.json, stav zo stránky */
  const UNITS = CAMP.parcels.map((p, i) => {
    const t = CAMP.types[p.t] || {}, pts = rectPts(p.c, p.w, p.h, p.ang || 0).map(W), c = W(p.c);
    return { id: p.id, unit: t.unit || 'parcel', pts, c, top: (p.flat ? 0.075 : 0.09) + i * 0.001, r: Math.hypot(p.w, p.h) / 2 / S };
  });
  const byId = Object.fromEntries(UNITS.map((u) => [u.id, u]));
  const overlays = new THREE.Group(); scene.add(overlays);
  UNITS.forEach((u) => {
    u.fill = new THREE.Mesh(polyGeo(u.pts, u.top + 0.012), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    u.ring = new THREE.Mesh(ringGeo(u.pts, 0.14, u.top + 0.05), new THREE.MeshBasicMaterial({ color: 0x0a5bab, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    u.ring.visible = false; u.fill.renderOrder = 2; u.ring.renderOrder = 4; overlays.add(u.fill, u.ring);
    const o = document.createElement('option'); o.value = u.id; o.textContent = unitWord(u) + ' ' + u.id; pick.appendChild(o);
  });
  /* prekážky pre chôdzu: budovy a chatky */
  const PAD = 2.6 * S;   // chodec sa k stene nedostane bližšie než 1,3 m, inak by mu vyplnila celý výhľad
  const solids = (CAMP.buildings || []).map((b) => rectPts(b.c, b.w + PAD, b.d + PAD, b.ang || 0).map(W));
  CAMP.parcels.forEach((p) => {
    const t = CAMP.types[p.t] || {}; if (t.unit !== 'cabin') return;
    const cb = t.cabin || [4.4, 3.6], a = (p.ang || 0) * Math.PI / 180;      // chatka stojí v zadnej časti pozemku (build_camp.py: off(0, h * 0.17))
    solids.push(rectPts([p.c[0] + p.h * 0.17 * Math.sin(a), p.c[1] - p.h * 0.17 * Math.cos(a)], cb[0] * S + PAD, cb[1] * S + PAD, p.ang || 0).map(W));
  });
  /* karavany, autá, stany a plošiny: dĺžka, šírka a posun stredu dopredu v metroch ako v build_camp.py; odstup 0,8 m */
  const PROP = { caravan: [6.8, 2.4, 0], motorhome: [8.4, 2.35, 0.6], car: [4.5, 1.85, 0], tent: [3.2, 2.6, 0] }, PADP = 1.6 * S;
  (CAMP.props || []).forEach((p) => { const d = p.dims ? [p.dims[0], p.dims[1], 0] : PROP[p.kind]; if (!d) return; const a = (p.ang || 0) * Math.PI / 180; solids.push(rectPts([p.c[0] + Math.cos(a) * d[2] * S, p.c[1] + Math.sin(a) * d[2] * S], d[0] * S + PADP, d[1] * S + PADP, p.ang || 0).map(W)); });
  (CAMP.boxes || []).forEach((b) => { if ((b.height || 0) > 0.4) solids.push(rectPts(b.c, b.w + PADP, b.d + PADP, b.ang || 0).map(W)); });
  const OUTSIDE = 8;     // chodec môže vyjsť najviac 8 m za hranicu areálu (k príjazdovej ceste), ďalej je na pláne len prázdna krajina
  const inArea = (x, z) => inPoly(x, z, bnd) || bnd.some((a, i) => segDist(x, z, a, bnd[(i + 1) % bnd.length]) < OUTSIDE);
  const blocked = (x, z) => x < LIM.x0 || x > LIM.x1 || z < LIM.z0 || z > LIM.z1 || !inArea(x, z) || solids.some((s) => inPoly(x, z, s));
  function freeSpot(x, z) {              // najbližšie miesto, kde sa dá stáť
    for (let r = 0; r < SPAN * 1.5; r += 2) for (let k = 0; k < (r ? 16 : 1); k++) { const a = k / 16 * Math.PI * 2, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r; if (!blocked(nx, nz)) return [nx, nz]; }
    return [x, z];
  }

  /* ---------------- model z Blendera */
  let ready = false, ground = [], niceTrees = null;
  const bin = GLB.buffer.slice(GLB.byteOffset, GLB.byteOffset + GLB.byteLength);
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(bin, '', (gltf) => {
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = ((o.parent && o.parent !== root && o.parent.name) || o.name || '').toLowerCase();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.side = THREE.DoubleSide; });
      const flat = /^(teren|voda|jazero|plocha|cesta|kruhovy|parcela)/.test(n), label = /^stitok/.test(n);
      o.userData.tree = /^stromy/.test(n);
      o.receiveShadow = !label; o.castShadow = !flat && !label;
      if (label) { o.renderOrder = 5; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4; }); }
      if (flat) ground.push(o);
    });
    /* vozidlá: desiatky malých sietí (karoséria po materiáloch, kolesá) zlúčiť do jednej siete na materiál */
    root.updateMatrixWorld(true);
    const flt = (a) => { const f = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); } return new THREE.BufferAttribute(f, 3); };
    const byMat = new Map(), cars = root.children.filter((c) => /^vozidlo/i.test(c.name));
    cars.forEach((v) => v.traverse((o) => {
      if (!o.isMesh || !o.geometry.index || !o.geometry.attributes.normal) return;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', flt(o.geometry.attributes.position)); g.setAttribute('normal', flt(o.geometry.attributes.normal));
      g.setIndex(Array.from(o.geometry.index.array)); g.applyMatrix4(o.matrixWorld);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    }));
    byMat.forEach((list, m) => {
      const g = mergeGeometries(list, false); list.forEach((x) => x.dispose()); if (!g) return;
      const mesh = new THREE.Mesh(g, m); mesh.name = 'vozidla'; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
    });
    cars.forEach((v) => { v.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); root.remove(v); });
    /* vzhľad: kresba povrchov, voda s odrazom oblohy, stromy s plnými korunami (keď má kemp ich výšky) */
    texturize(ground);
    waterize(root);
    const nice = niceTrees = buildTrees(CAMP); if (nice) { root.children.filter((c) => /^stromy/i.test(c.name) || (nice.userData.shrubs && /^kriky/i.test(c.name))).forEach((c) => { c.visible = false; c.castShadow = false; }); scene.add(nice); }
    const houses = buildBuildings(CAMP); if (houses) { root.traverse((o) => { if (houses.names.includes(o.name) || (o.parent && houses.names.includes(o.parent.name))) { o.visible = false; o.castShadow = false; } }); scene.add(houses.group); }
    scene.add(root);
    ready = true; renderer.shadowMap.needsUpdate = true; $('.c3-load').remove(); update(); startView();
  }, (err) => { $('.c3-load').textContent = '3D model sa nepodarilo načítať.'; console.error(err); });

  /* ---------------- ovládanie: prehľad */
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = false; controls.zoomToCursor = true;
  controls.minDistance = 8; controls.maxDistance = SPAN * 1.7; controls.maxPolarAngle = 1.36; controls.rotateSpeed = 0.6;
  controls.touches.ONE = THREE.TOUCH.PAN; controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  controls.addEventListener('change', () => {
    const t = controls.target; t.y = 0;
    const u = mode === 'room' && byId[roomId];           // v izbe parcely sa pohľad drží pri parcele
    const cx = u ? clamp(t.x, u.c[0] - 10, u.c[0] + 10) : clamp(t.x, LIM.x0, LIM.x1), cz = u ? clamp(t.z, u.c[1] - 10, u.c[1] + 10) : clamp(t.z, LIM.z0, LIM.z1);
    if (cx !== t.x || cz !== t.z) { camera.position.x += cx - t.x; camera.position.z += cz - t.z; t.x = cx; t.z = cz; }
  });
  function startView() {
    controls.target.copy(CENTER);
    camera.position.set(CENTER.x + SPAN * .22, SPAN * .62, CENTER.z + SPAN * .78); camera.lookAt(CENTER); controls.update();
  }

  /* ---------------- stav */
  let mode = 'map', running = false, anim = null, cardId = null, roomId = null;
  const walk = { x: CENTER.x, z: CENTER.z, yaw: 0, pitch: -0.06, keys: {}, go: null };
  function setHint() {
    hint.textContent = mode === 'walk'
      ? (touch ? 'Ťahaním sa rozhliadnete. Ťuknutím na zem tam prejdete.' : 'Ťahaním sa rozhliadnete, kliknutím na zem tam prejdete. Šípky alebo W A S D: chôdza.')
      : (touch ? 'Jeden prst posúva, dva prsty približujú a otáčajú. Ťuknite na miesto.' : 'Ťahaním posúvate, kolieskom približujete, pravým tlačidlom otáčate. Kliknite na miesto.');
  }
  function update() {                      // stav jednotiek zo stránky -> farby v 3D
    if (!ready) return;
    (api.units() || []).forEach((s) => {
      const u = byId[s.id]; if (!u) return;
      const m = u.fill.material;
      if (s.sel) { m.color.set(0x0a5bab); m.opacity = mode === 'room' ? 0.14 : 0.62; }
      else if (s.taken) { m.color.set(0x8d969b); m.opacity = 0.78; }
      else if (!s.fit) { m.color.set(0xf2f5f3); m.opacity = 0.6; }
      else m.opacity = 0;
      u.ring.visible = !!s.sel;
    });
    if (cardId) showCard(cardId);
  }
  function showCard(id) {
    const i = api.info(id); if (!i) { card.hidden = true; cardId = null; return; }
    cardId = id;
    card.querySelector('.c3-tip').innerHTML = '<div class="c3-h"><strong>' + esc(i.title) + '</strong><span class="chip ' + (i.ok ? 'ok' : 'no') + '">' + esc(i.chip) + '</span></div>'
      + '<p class="c3-f">' + i.facts.map((f) => '<span>' + esc(f) + '</span>').join('') + '</p>' + (i.total ? '<p class="c3-sum">' + esc(i.total) + '</p>' : '');
    card.querySelector('.c3-book').hidden = !i.ok; card.querySelector('.c3-fit').hidden = !(i.room !== undefined ? i.room : i.ok) || byId[id].unit === 'cabin';
    card.hidden = false;
  }
  function choose(id, fly) {
    api.select(id); showCard(id);
    const i = api.info(id);                // karta sa ukáže naraz s obsahom, čítačka by ju sama neohlásila
    if (i) $('.c3-say').textContent = [i.title, i.chip].concat(i.facts, i.total ? [i.total] : []).join(', ');
    if (fly) flyTo(byId[id]);
  }
  function flyTo(u) {
    if (mode === 'walk') {                 // v prechádzke: postaviť sa pred miesto a pozrieť sa naň
      let best = null;
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, d = u.r + 6, x = u.c[0] + Math.cos(a) * d, z = u.c[1] + Math.sin(a) * d; if (!blocked(x, z) && (!best || Math.abs(Math.sin(a) - 1) < best.s)) best = { x, z, s: Math.abs(Math.sin(a) - 1) }; }
      if (best) { walk.x = best.x; walk.z = best.z; walk.yaw = Math.atan2(u.c[0] - best.x, -(u.c[1] - best.z)); walk.pitch = -0.12; walk.go = null; }
      return;
    }
    const from = { t: controls.target.clone(), p: camera.position.clone() }, t = new THREE.Vector3(u.c[0], 0, u.c[1]), d = clamp(u.r * 5 + 22, 30, 90);
    const p = new THREE.Vector3(t.x + d * .25, d * .62, t.z + d * .78);
    if (still) { controls.target.copy(t); camera.position.copy(p); return; }
    anim = { t0: performance.now(), dur: 900, step(k) { controls.target.lerpVectors(from.t, t, k); camera.position.lerpVectors(from.p, p, k); } };
  }
  function setMode(m) {
    stopFly();
    if (m === mode) return;
    mode = m; anim = null; walk.go = null;
    host.querySelectorAll('.c3-seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'));
    host.classList.toggle('walking', m === 'walk');
    controls.enabled = m === 'map'; fwd.hidden = !(m === 'walk' && touch); $('.c3-zoom').hidden = m === 'walk';
    if (m === 'walk') {
      const [x, z] = freeSpot(controls.target.x, controls.target.z), sel = cardId && byId[cardId];
      walk.x = x; walk.z = z; walk.pitch = -0.06;
      walk.yaw = Math.atan2(CENTER.x - x, -(CENTER.z - z));
      if (sel) flyTo(sel);                                    // vybrané miesto: postaviť sa pred neho
      camera.fov = 62;
    } else {
      controls.target.set(walk.x, 0, walk.z);
      camera.position.set(walk.x + 14, 44, walk.z + 50); camera.fov = 45; controls.update();
    }
    camera.updateProjectionMatrix(); setHint();
  }

  /* ---------------- izba parcely (room.js): hosť si na parcele poskladá, s čím príde */
  const room = createRoom({ host, stage, scene, camera, renderer, controls, CAMP, api, touch, shadows: () => { renderer.shadowMap.needsUpdate = true; }, exit: (done) => leaveRoom(done) });
  function enterRoom(id) {
    const u = byId[id], raw = CAMP.parcels.find((p) => p.id === id); if (!u || !raw || !ready || u.unit === 'cabin') return;
    if (mode === 'walk') setMode('map');
    api.select(id); mode = 'room'; roomId = id; anim = null; card.hidden = true; cardId = null; host.classList.add('rooming');
    controls.enabled = true; controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; controls.mouseButtons.RIGHT = THREE.MOUSE.PAN; controls.touches.ONE = THREE.TOUCH.ROTATE; controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controls.zoomToCursor = false; controls.minDistance = 4; controls.maxPolarAngle = 1.45;
    const P = room.enter(u, raw), f = room.free();        // vzdialenosť, z ktorej sa celá parcela zmestí do voľnej časti obrazu
    const d = clamp(Math.hypot(P.w, P.h) / 2 * 1.2 * f.full / (Math.tan(camera.fov * Math.PI / 360) * Math.max(120, Math.min(f.w, f.h))), 10, 140); controls.maxDistance = d * 2.2;
    const from = { t: controls.target.clone(), p: camera.position.clone() }, t = new THREE.Vector3(u.c[0], 0, u.c[1]), p = new THREE.Vector3(t.x + d * 0.3, d * 0.74, t.z + d * 0.6);
    if (still) { controls.target.copy(t); camera.position.copy(p); } else anim = { t0: performance.now(), dur: 900, step(k) { controls.target.lerpVectors(from.t, t, k); camera.position.lerpVectors(from.p, p, k); } };
    fadeTrees(niceTrees, true); size(); update();
  }
  function leaveRoom(done) {
    const id = roomId; if (mode !== 'room') return;
    if (api.kit) api.kit(room.summary());
    room.exit(); fadeTrees(niceTrees, false); mode = 'map'; anim = null; host.classList.remove('rooming');
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN; controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; controls.touches.ONE = THREE.TOUCH.PAN; controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    controls.zoomToCursor = true; controls.minDistance = 8; controls.maxDistance = SPAN * 1.7; controls.maxPolarAngle = 1.36;
    size(); update();
    if (done) api.book(id); else { showCard(id); flyTo(byId[id]); }
  }

  /* ---------------- ukazovateľ: klik na miesto, v prechádzke rozhliadanie a chôdza */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), fingers = new Set(); let down = null;
  function hitGround(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(scene.children, true).find((x) => x.object.parent !== overlays && !(mode === 'map' && x.object.userData.tree));   // v prehľade sa vyberá aj cez korunu stromu
    return h ? h.point : null;
  }
  const unitAt = (x, z) => UNITS.find((u) => inPoly(x, z, u.pts)) || null;
  function unitNear(p, e) {              // prst je hrubší než myš: ťuk na zem tesne vedľa miesta vyberie najbližšie do 14 css px
    const u = unitAt(p.x, p.z); if (u || e.pointerType !== 'touch' || p.y > 0.5) return u;
    const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3(); let best = null, bd = 14;
    UNITS.forEach((q) => q.pts.forEach((a, i) => {          // najbližší bod každej hrany premietnutý na obrazovku
      const b = q.pts[(i + 1) % q.pts.length], dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      v.set(a[0] + dx * t, q.top, a[1] + dz * t).project(camera); if (v.z > 1) return;
      const d = Math.hypot(r.left + (v.x + 1) / 2 * r.width - e.clientX, r.top + (1 - v.y) / 2 * r.height - e.clientY);
      if (d < bd) { bd = d; best = q; }
    }));
    return best;
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (mode === 'room') { down = null; return; }         // v izbe parcely má ukazovateľ room.js
    stopFly();
    if (e.isPrimary) fingers.clear();
    fingers.add(e.pointerId);
    if (fingers.size > 1) { down = null; return; }               // druhý prst = priblíženie alebo otáčanie, nie výber
    down = { x: e.clientX, y: e.clientY, yaw: walk.yaw, pitch: walk.pitch, moved: false, id: e.pointerId };
    if (mode === 'walk') renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 6) down.moved = true;
    if (mode === 'walk' && down.moved) { walk.yaw = down.yaw - dx * 0.0045; walk.pitch = clamp(down.pitch - dy * 0.0035, -0.9, 0.6); }
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    fingers.delete(e.pointerId);
    const d = down; down = null; if (!d || d.id !== e.pointerId || d.moved || !ready || mode === 'room') return;
    const p = hitGround(e); if (!p) return;
    const u = mode === 'map' ? unitNear(p, e) : unitAt(p.x, p.z);
    if (mode === 'map') { if (u) choose(u.id, false); else { card.hidden = true; cardId = null; } return; }
    if (p.y > 2.5) return;                                   // strecha alebo koruna stromu: tam sa nejde
    walk.go = { x: p.x, z: p.z }; if (u) choose(u.id, false);
  });
  renderer.domElement.addEventListener('pointercancel', (e) => { fingers.delete(e.pointerId); down = null; });
  const KEY = { ArrowUp: 'f', KeyW: 'f', ArrowDown: 'b', KeyS: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr' };
  const onKey = (e, v) => {
    if (!KEY[e.code]) return;
    if (!v) { walk.keys[KEY[e.code]] = false; return; }           // pustenie platí vždy, aj keď fokus medzitým prešiel do rolety
    if (mode !== 'walk' || !running || e.ctrlKey || e.metaKey || e.altKey || /^(SELECT|INPUT|TEXTAREA)$/.test((e.target.tagName || ''))) return;   // Ctrl+S, Ctrl+D… patria prehliadaču
    stopFly(); walk.keys[KEY[e.code]] = true; walk.go = null; e.preventDefault();
  };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false), kb = () => { walk.keys = {}; };   // strata fokusu okna: keyup by už neprišiel
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', kb);
  fwd.addEventListener('pointerdown', () => { walk.keys.f = true; walk.go = null; });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => fwd.addEventListener(n, () => { walk.keys.f = false; }));

  host.querySelectorAll('.c3-seg button').forEach((b) => b.addEventListener('click', () => (b.dataset.mode === 'fly' ? startFly() : setMode(b.dataset.mode))));
  /* prelet: plynulý pohyb po trase kempu vo výške očí (camp.json: tour); zastaví ho dotyk, kláves alebo koniec trasy, hosť potom pokračuje pešo */
  let fly = null;
  function startFly() {
    if (!ready || !CAMP.tour) return; setMode('walk');
    const curve = new THREE.CatmullRomCurve3(CAMP.tour.map((p) => { const w = W(p); return new THREE.Vector3(w[0], EYE, w[1]); }), false, 'centripetal');
    fly = { curve, len: curve.getLength(), t: 0 }; walk.go = null; walk.pitch = -0.04;
    const b = host.querySelector('.c3-seg [data-mode="fly"]'); if (b) b.setAttribute('aria-pressed', 'true'); host.querySelector('.c3-seg [data-mode="walk"]').setAttribute('aria-pressed', 'false');
    hint.textContent = 'Prelet kempom. Dotykom alebo klávesom ho zastavíte a pokračujete pešo.';
  }
  function stopFly() { if (!fly) return; fly = null; const b = host.querySelector('.c3-seg [data-mode="fly"]'); if (b) b.setAttribute('aria-pressed', 'false'); if (mode === 'walk') { host.querySelector('.c3-seg [data-mode="walk"]').setAttribute('aria-pressed', 'true'); setHint(); } }
  function flyStep(dt) {
    fly.t += (still ? 6 : 3.2) * dt / fly.len; if (fly.t >= 0.995) { stopFly(); return; }
    const p = fly.curve.getPointAt(fly.t), a = fly.curve.getPointAt(Math.min(1, fly.t + 6 / fly.len)), want = Math.atan2(a.x - p.x, -(a.z - p.z));
    let d = want - walk.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); walk.yaw += d * Math.min(1, dt * 2.2); walk.x = p.x; walk.z = p.z;
  }
  const zoom = (k) => { const v = camera.position.clone().sub(controls.target); v.setLength(clamp(v.length() * k, controls.minDistance, controls.maxDistance)); camera.position.copy(controls.target).add(v); };
  $('.c3-zin').addEventListener('click', () => zoom(0.7)); $('.c3-zout').addEventListener('click', () => zoom(1.4));
  $('.c3-x').addEventListener('click', () => { card.hidden = true; cardId = null; });
  const sunUi = $('.c3-sun'), sunRange = sunUi.querySelector('input');
  function setHour(h) { hour = clamp(+h, 5, 21); sunRange.value = hour; sunUi.querySelector('output').textContent = Math.floor(hour) + ':' + String(Math.round(hour % 1 * 60)).padStart(2, '0'); sunUi.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.h === hour ? 'true' : 'false')); applyTheme(); }
  sunUi.addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (b) setHour(b.dataset.h); });
  sunRange.addEventListener('input', () => setHour(sunRange.value));
  $('.c3-book').addEventListener('click', () => { if (cardId) api.book(cardId); });
  $('.c3-fit').addEventListener('click', () => { if (cardId) enterRoom(cardId); });
  pick.addEventListener('change', () => { if (pick.value) { choose(pick.value, true); pick.value = ''; } });

  /* ---------------- slučka */
  let last = 0, raf = 0;
  function size() { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); room.layout(); }
  const ro = new ResizeObserver(size); ro.observe(stage);
  function tryMove(nx, nz) { if (!blocked(nx, nz)) { walk.x = nx; walk.z = nz; return true; } if (!blocked(nx, walk.z)) { walk.x = nx; return true; } if (!blocked(walk.x, nz)) { walk.z = nz; return true; } return false; }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; waterTick(dt);
    if (mode === 'walk') {
      if (fly) flyStep(dt);
      const k = walk.keys, fx = Math.sin(walk.yaw), fz = -Math.cos(walk.yaw);
      if (k.tl) walk.yaw += 1.6 * dt; if (k.tr) walk.yaw -= 1.6 * dt;
      let mx = 0, mz = 0;
      if (k.f) { mx += fx; mz += fz; } if (k.b) { mx -= fx; mz -= fz; }
      if (k.l) { mx += fz; mz -= fx; } if (k.r) { mx -= fz; mz += fx; }
      if (walk.go) { const dx = walk.go.x - walk.x, dz = walk.go.z - walk.z, d = Math.hypot(dx, dz); if (d < 0.6) walk.go = null; else { mx = dx / d; mz = dz / d; } }
      const l = Math.hypot(mx, mz);
      if (l > 0.01) { const step = WALK * (walk.go ? 1.5 : 1) * dt; if (!tryMove(walk.x + mx / l * step, walk.z + mz / l * step)) walk.go = null; }
      camera.position.set(walk.x, EYE, walk.z);
      camera.lookAt(walk.x + Math.sin(walk.yaw) * Math.cos(walk.pitch), EYE + Math.sin(walk.pitch), walk.z - Math.cos(walk.yaw) * Math.cos(walk.pitch));
    } else {
      if (anim) { const t = clamp((now - anim.t0) / anim.dur, 0, 1); anim.step(ease(t)); if (t >= 1) anim = null; }
      controls.update();
    }
    renderer.render(scene, camera);
  }
  function resume() { if (running) return; running = true; renderer.shadowMap.needsUpdate = true; applyTheme(); size(); update(); last = performance.now(); raf = requestAnimationFrame(frame); }
  function pause() { running = false; cancelAnimationFrame(raf); walk.keys = {}; }
  setHint();
  return window.Camp3D.view = { ok: true, setHour, startFly, flying: () => !!fly, flyAt(t) { startFly(); if (fly) { fly.t = t; const p = fly.curve.getPointAt(t), a = fly.curve.getPointAt(Math.min(1, t + 6 / fly.len)); walk.yaw = Math.atan2(a.x - p.x, -(a.z - p.z)); } }, sun: () => { const q = sunAt(hour); return { hour, el: +(q.el * 180 / Math.PI).toFixed(1), az: +(q.az * 180 / Math.PI).toFixed(1) }; }, update, pause, resume, setMode, enterRoom, leaveRoom, room, focusUnit(id) { if (byId[id]) { showCard(id); flyTo(byId[id]); } },
    state: () => ({ mode, ready, room: room.state(), cam: camera.position.toArray().map((v) => Math.round(v * 10) / 10), walk: { x: Math.round(walk.x * 10) / 10, z: Math.round(walk.z * 10) / 10 }, card: cardId, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    destroy() { pause(); room.destroy(); ro.disconnect(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', kb); renderer.dispose(); host.innerHTML = ''; } };
}
window.Camp3D = { mount, model: registerModel };
