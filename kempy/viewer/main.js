/* 3D prehliadka kempu pre ukážkové stránky (kempy/<slug>/index.html).
   kempy/build-viewer.js ju zbalí s three.js, modelom z Blendera (camp.glb) a camp.json do kempy/<slug>/camp3d.js.
   Stránka ju načíta až po kliknutí na „Prejsť sa po kempe v 3D“ a volá window.Camp3D.mount(host, api):
     api.units()  -> [{id, taken, fit, sel}]     stav jednotiek pre zvolený termín a voľbu hosťa
     api.info(id) -> {title, chip, ok, facts: [], total}   texty pre kartu (rovnaké ako v paneli stránky)
     api.select(id)   vyberie jednotku na stránke          api.book(id)   zavrie prehliadku a ukáže panel s cenou
   Jednotky: metre, x východ, z juh, y hore (Blender exportuje glTF s osou Y nahor). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
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
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
};
const ico = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[n] + '</svg>';

function rectPts(c, w, h, ang) {      // rohy obdĺžnika v px plánu (ang v stupňoch, v smere hodinových ručičiek ako na obrázku)
  const a = ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map((d) => [c[0] + d[0] * ca - d[1] * sa, c[1] + d[0] * sa + d[1] * ca]);
}
function inPoly(x, z, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
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
    + '<div class="c3-top"><label class="c3-go"><span class="sr">Prejsť na miesto</span><select aria-label="Prejsť na miesto"><option value="">Prejsť na miesto…</option></select></label></div>'
    + '<div class="c3-ctl">'
    + '<div class="c3-seg" role="group" aria-label="Režim pohľadu"><button type="button" data-mode="map" aria-pressed="true">' + ico('map') + '<span>Prehľad</span></button><button type="button" data-mode="walk" aria-pressed="false">' + ico('walk') + '<span>Prechádzka</span></button></div>'
    + '<div class="c3-stack c3-zoom"><button type="button" class="c3-zin" aria-label="Priblížiť">' + ico('plus') + '</button><button type="button" class="c3-zout" aria-label="Oddialiť">' + ico('minus') + '</button></div>'
    + '<button type="button" class="c3-fwd" aria-label="Ísť dopredu" hidden>' + ico('up') + '</button>'
    + '</div>'
    + '<div class="c3-card" hidden role="group" aria-label="Vybrané miesto"><button type="button" class="c3-x" aria-label="Zavrieť kartu">' + ico('close') + '</button><div class="c3-tip" aria-live="polite"></div><button type="button" class="btn btn-sign c3-book">Pokračovať k rezervácii</button></div>'
    + '<p class="c3-hint"></p><div class="c3-load" role="status">Načítavam 3D model kempu…</div>';
  const $ = (s) => host.querySelector(s);
  const stage = $('.c3-stage'), card = $('.c3-card'), hint = $('.c3-hint'), pick = $('.c3-go select'), fwd = $('.c3-fwd');

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { $('.c3-load').textContent = 'Tento prehliadač nevie zobraziť 3D grafiku (WebGL). Použite mapu vyššie.'; return { ok: false, update() {}, pause() {}, resume() {} }; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
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
  function applyTheme() {
    const t = document.documentElement.getAttribute('data-theme'), dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    SKY.set(dark ? 0x2f3e44 : 0xcfe6f2); scene.fog.color.copy(SKY);
    if (scene.background) scene.background.dispose();
    scene.background = dark ? skyTexture('#1f2b31', '#2f3e44') : skyTexture('#8fc3e6', '#cfe6f2');
    renderer.toneMappingExposure = dark ? 0.72 : 1.18; hemi.intensity = dark ? 0.95 : 1.55;
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
  CAMP.parcels.forEach((p) => { const t = CAMP.types[p.t] || {}; if (t.unit === 'cabin') { const cb = t.cabin || [4.4, 3.6]; solids.push(rectPts([p.c[0], p.c[1] - p.h * 0.17], cb[0] * S + PAD, cb[1] * S + PAD, p.ang || 0).map(W)); } });
  const blocked = (x, z) => x < LIM.x0 || x > LIM.x1 || z < LIM.z0 || z > LIM.z1 || solids.some((s) => inPoly(x, z, s));

  /* ---------------- model z Blendera */
  let ready = false, ground = [];
  const bin = GLB.buffer.slice(GLB.byteOffset, GLB.byteOffset + GLB.byteLength);
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(bin, '', (gltf) => {
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = ((o.parent && o.parent !== root && o.parent.name) || o.name || '').toLowerCase();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.side = THREE.DoubleSide; });
      const flat = /^(teren|voda|jazero|plocha|cesta|kruhovy|parcela)/.test(n), label = /^stitok/.test(n);
      o.receiveShadow = !label; o.castShadow = !flat && !label;
      if (label) { o.renderOrder = 5; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4; }); }
      if (flat) ground.push(o);
    });
    scene.add(root);
    ready = true; $('.c3-load').remove(); update(); startView();
  }, (err) => { $('.c3-load').textContent = '3D model sa nepodarilo načítať.'; console.error(err); });

  /* ---------------- ovládanie: prehľad */
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = false; controls.zoomToCursor = true;
  controls.minDistance = 8; controls.maxDistance = SPAN * 1.7; controls.maxPolarAngle = 1.36; controls.rotateSpeed = 0.6;
  controls.touches.ONE = THREE.TOUCH.PAN; controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  controls.addEventListener('change', () => {
    const t = controls.target; t.y = 0;
    const cx = clamp(t.x, LIM.x0, LIM.x1), cz = clamp(t.z, LIM.z0, LIM.z1);
    if (cx !== t.x || cz !== t.z) { camera.position.x += cx - t.x; camera.position.z += cz - t.z; t.x = cx; t.z = cz; }
  });
  function startView() {
    controls.target.copy(CENTER);
    camera.position.set(CENTER.x + SPAN * .22, SPAN * .62, CENTER.z + SPAN * .78); camera.lookAt(CENTER); controls.update();
  }

  /* ---------------- stav */
  let mode = 'map', running = false, anim = null, cardId = null;
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
      if (s.sel) { m.color.set(0x0a5bab); m.opacity = 0.62; }
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
    card.querySelector('.c3-book').hidden = !i.ok;
    card.hidden = false;
  }
  function choose(id, fly) {
    api.select(id); showCard(id);
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
    if (m === mode) return;
    mode = m; anim = null; walk.go = null;
    host.querySelectorAll('.c3-seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'));
    host.classList.toggle('walking', m === 'walk');
    controls.enabled = m === 'map'; fwd.hidden = !(m === 'walk' && touch); $('.c3-zoom').hidden = m === 'walk';
    if (m === 'walk') {
      let x = controls.target.x, z = controls.target.z;
      const sel = cardId && byId[cardId];
      if (blocked(x, z)) { for (let r = 3; r < 60 && blocked(x, z); r += 3) for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, nx = controls.target.x + Math.cos(a) * r, nz = controls.target.z + Math.sin(a) * r; if (!blocked(nx, nz)) { x = nx; z = nz; break; } } }
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

  /* ---------------- ukazovateľ: klik na miesto, v prechádzke rozhliadanie a chôdza */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  function hitGround(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(scene.children, true).find((x) => x.object.parent !== overlays);
    return h ? h.point : null;
  }
  const unitAt = (x, z) => UNITS.find((u) => inPoly(x, z, u.pts)) || null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw: walk.yaw, pitch: walk.pitch, moved: false, id: e.pointerId }; if (mode === 'walk') renderer.domElement.setPointerCapture(e.pointerId); });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 6) down.moved = true;
    if (mode === 'walk' && down.moved) { walk.yaw = down.yaw - dx * 0.0045; walk.pitch = clamp(down.pitch - dy * 0.0035, -0.9, 0.6); }
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    const d = down; down = null; if (!d || d.moved || !ready) return;
    const p = hitGround(e); if (!p) return;
    const u = unitAt(p.x, p.z);
    if (mode === 'map') { if (u) choose(u.id, false); else { card.hidden = true; cardId = null; } return; }
    if (p.y > 2.5) return;                                   // strecha alebo koruna stromu: tam sa nejde
    walk.go = { x: p.x, z: p.z }; if (u) choose(u.id, false);
  });
  renderer.domElement.addEventListener('pointercancel', () => { down = null; });
  const KEY = { ArrowUp: 'f', KeyW: 'f', ArrowDown: 'b', KeyS: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr' };
  const onKey = (e, v) => { if (mode !== 'walk' || !running || !KEY[e.code] || /^(SELECT|INPUT|TEXTAREA)$/.test((e.target.tagName || ''))) return; walk.keys[KEY[e.code]] = v; if (v) walk.go = null; e.preventDefault(); };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  fwd.addEventListener('pointerdown', () => { walk.keys.f = true; walk.go = null; });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => fwd.addEventListener(n, () => { walk.keys.f = false; }));

  host.querySelectorAll('.c3-seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const zoom = (k) => { const v = camera.position.clone().sub(controls.target); v.setLength(clamp(v.length() * k, controls.minDistance, controls.maxDistance)); camera.position.copy(controls.target).add(v); };
  $('.c3-zin').addEventListener('click', () => zoom(0.7)); $('.c3-zout').addEventListener('click', () => zoom(1.4));
  $('.c3-x').addEventListener('click', () => { card.hidden = true; cardId = null; });
  $('.c3-book').addEventListener('click', () => { if (cardId) api.book(cardId); });
  pick.addEventListener('change', () => { if (pick.value) { choose(pick.value, true); pick.value = ''; } });

  /* ---------------- slučka */
  let last = 0, raf = 0;
  function size() { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(size); ro.observe(stage);
  function tryMove(nx, nz) { if (!blocked(nx, nz)) { walk.x = nx; walk.z = nz; return true; } if (!blocked(nx, walk.z)) { walk.x = nx; return true; } if (!blocked(walk.x, nz)) { walk.z = nz; return true; } return false; }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    if (mode === 'walk') {
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
  function resume() { if (running) return; running = true; applyTheme(); size(); update(); last = performance.now(); raf = requestAnimationFrame(frame); }
  function pause() { running = false; cancelAnimationFrame(raf); walk.keys = {}; }
  setHint();
  return { ok: true, update, pause, resume, setMode, focusUnit(id) { if (byId[id]) { showCard(id); flyTo(byId[id]); } },
    state: () => ({ mode, ready, cam: camera.position.toArray().map((v) => Math.round(v * 10) / 10), walk: { x: Math.round(walk.x * 10) / 10, z: Math.round(walk.z * 10) / 10 }, card: cardId, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    destroy() { pause(); ro.disconnect(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); renderer.dispose(); host.innerHTML = ''; } };
}
window.Camp3D = { mount };
