/* „Izba parcely“ v 3D prehliadke: hosť si na vybranej parcele vec po veci poskladá, s čím príde (auto, karavan, stan, markíza, stôl…).
   Veci sú modely v skutočných rozmeroch z kempy/katalog (kempy/build-catalog.js); každý sa načíta až po výbere.
   Parcela má vlastnú sústavu: počiatok v strede, x pozdĺž šírky, z pozdĺž dĺžky, jednotky metre. Vec = { e: položka katalógu, x, z, rot, host, slide, side, color }.
   Pripojené veci (markíza a predstan na boku karavanu, strešný stan na aute) sú deti hostiteľa a posúvajú sa len pozdĺž neho. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import CAT from './catalog.json';

const TABS = [['kit', 'Na parcele'], ['auto', 'Autá'], ['obytne', 'Karavany a obytné autá'], ['stan', 'Stany'], ['pristresok', 'Prístrešky'], ['vybava', 'Vybavenie']];
const PAINT = ['#e9e9e6', '#8d9399', '#1d1f22', '#27384f', '#3f5f7a', '#7b1f24', '#2f4a3c', '#c4601f', '#b9b29f'];
const byCat = Object.fromEntries(CAT.map((e) => [e.id, e]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (n) => (Math.round(n * 100) / 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, '').replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>', rotl: '<path d="M4 5v5h5"/><path d="M4.6 10A8 8 0 1 1 6 17.3"/>', rotr: '<path d="M20 5v5h-5"/><path d="M19.4 10A8 8 0 1 0 18 17.3"/>',
  flip: '<path d="M12 3v18M8 7 4 12l4 5M16 7l4 5-4 5"/>', paint: '<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.200 12 3 12 3z"/>', bin: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const ico = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[n] + '</svg>';

/* ---------------- modely: skript kempy/katalog/m/<id>.js zavolá Camp3D.model(id, base64) */
const waiting = {}, cache = {};
export function registerModel(id, b64) { if (waiting[id]) { waiting[id](b64); delete waiting[id]; } }
function prepare(root) {              // desiatky malých sietí zlúčiť do jednej na materiál; rebrík strešného stanu ostáva samostatný (predlžuje sa podľa auta)
  root.updateMatrixWorld(true);
  const out = new THREE.Group(), byMat = new Map(), lad = root.getObjectByName('rebrik');
  const flt = (a) => { const f = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); } return new THREE.BufferAttribute(f, 3); };
  const under = (o, p) => { for (let q = o; q; q = q.parent) if (q === p) return true; return false; };
  const geo = (o, m) => {
    const s = o.geometry; if (!s.attributes.normal) s.computeVertexNormals();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', flt(s.attributes.position)); g.setAttribute('normal', flt(s.attributes.normal));
    g.setIndex(s.index ? Array.from(s.index.array) : Array.from({ length: s.attributes.position.count }, (_, i) => i)); g.applyMatrix4(m); return g;
  };
  const ladGeo = new Map(), inv = lad ? lad.matrixWorld.clone().invert() : null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material; mat.side = THREE.DoubleSide;
    const tgt = lad && under(o, lad) ? ladGeo : byMat, m = tgt === ladGeo ? inv.clone().multiply(o.matrixWorld) : o.matrixWorld;
    if (!tgt.has(mat)) tgt.set(mat, []);
    tgt.get(mat).push(geo(o, m));
  });
  const put = (map, parent) => map.forEach((list, mat) => { const g = mergeGeometries(list, false); list.forEach((x) => x.dispose()); if (!g) return; const mesh = new THREE.Mesh(g, mat); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); });
  put(byMat, out);
  if (lad) { const L = new THREE.Group(); L.name = 'rebrik'; lad.matrixWorld.decompose(L.position, L.quaternion, L.scale); put(ladGeo, L); out.add(L); }
  return out;
}
function fetchModel(id, base) {
  if (!cache[id]) cache[id] = new Promise((res, rej) => {
    waiting[id] = res; const s = document.createElement('script'); s.src = base + 'm/' + id + '.js'; s.onerror = () => { delete cache[id]; delete waiting[id]; rej(new Error('model ' + id)); }; document.head.appendChild(s);
  }).then((b64) => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(u8.buffer, ''); })
    .then((g) => prepare(g.scene));
  return cache[id];
}

/* ---------------- geometria */
function overlap(A, B) {              // dva konvexné štvoruholníky sa prekrývajú (oddeľovacia os)
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], nx = b[1] - a[1], nz = a[0] - b[0];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = p[0] * nx + p[1] * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of B) { const d = p[0] * nx + p[1] * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 + 0.02 || b1 <= a0 + 0.02) return false;   // dotyk a 2 cm sa nepočítajú
  }
  return true;
}
function stripGeo(pts, w) {           // obrys vo forme pásu na zemi
  const n = pts.length, pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    pos.push(p[0] - dz * w, 0, p[1] + dx * w, p[0] + dz * w, 0, p[1] - dx * w);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
function textPlane(txt) {             // kóta na zemi
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(16,28,22,.82)'; g.beginPath(); g.roundRect(4, 4, 248, 56, 28); g.fill();
  g.fillStyle = '#fff'; g.font = '700 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 6; return m;
}

export function createRoom(o) {
  const { host, stage, scene, camera, renderer, controls, CAMP, api, touch } = o;
  const BASE = CAMP.catalogBase || '../katalog/', KEY = 'parcela-zostava:' + CAMP.name;
  const ui = document.createElement('div'); ui.className = 'c3r'; ui.hidden = true;
  ui.innerHTML =
    '<div class="c3r-bar"><button type="button" class="c3r-back">' + ico('back') + '<span>Späť do kempu</span></button>'
    + '<div class="c3r-title"><strong></strong><span></span></div><button type="button" class="btn btn-sign c3r-done">Hotovo</button></div>'
    + '<div class="c3r-tool" hidden role="group" aria-label="Vybraná vec"><div class="c3r-th"><strong></strong><span class="chip"></span></div><p class="c3r-why"></p>'
    + '<div class="c3r-acts"><button type="button" data-a="rotl" aria-label="Otočiť doľava">' + ico('rotl') + '</button><button type="button" data-a="rotr" aria-label="Otočiť doprava">' + ico('rotr') + '</button>'
    + '<button type="button" data-a="flip" aria-label="Dať na druhú stranu">' + ico('flip') + '</button><button type="button" data-a="paint" aria-label="Zmeniť farbu">' + ico('paint') + '</button>'
    + '<button type="button" data-a="bin" aria-label="Odstrániť z parcely">' + ico('bin') + '</button></div></div>'
    + '<div class="c3r-panel"><div class="c3r-tabs" role="group" aria-label="Čo chcete pridať"></div><div class="c3r-subs" role="group" aria-label="Druh"></div><div class="c3r-cards"></div></div>'
    + '<p class="c3r-hint"></p><p class="sr c3r-say" role="status"></p>';
  host.appendChild(ui);
  const $ = (s) => ui.querySelector(s), tool = $('.c3r-tool'), cards = $('.c3r-cards'), tabsEl = $('.c3r-tabs'), subsEl = $('.c3r-subs'), panel = $('.c3r-panel');
  const say = (t) => { $('.c3r-say').textContent = ''; setTimeout(() => { $('.c3r-say').textContent = t; }, 30); };

  const G = new THREE.Group(); G.name = 'izba'; scene.add(G);                   // sústava parcely
  const deco = new THREE.Group(); G.add(deco);                                  // mriežka, kóty
  let P = null, items = [], sel = null, active = false, uid = 1, tab = 'auto', sub = '', drag = null, dirty = false, trunks = [];
  const v3 = new THREE.Vector3(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const C_OK = new THREE.Color(0x0a5bab), C_BAD = new THREE.Color(0xd23b25), C_IDLE = new THREE.Color(0xffffff);

  /* ---------------- veci */
  const corners = (e) => { const b = e.box; return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]; };
  function poly(it) { it.obj.updateWorldMatrix(true, false); return corners(it.e).map(([x, z]) => { v3.set(x, 0, z); it.obj.localToWorld(v3); G.worldToLocal(v3); return [v3.x, v3.z]; }); }
  function seat(it) {                    // poloha veci v sústave parcely alebo na hostiteľovi
    const e = it.e, ob = it.obj;
    if (!it.host) { ob.position.set(it.x, 0, it.z); ob.rotation.set(0, -it.rot, 0); ob.scale.set(1, 1, 1); return; }
    const he = it.host.e;
    if (e.att === 'side') {              // markíza a predstan: na boku obytnej časti, výška podľa vozidla
      const len = he.Lb || he.L * 0.72, cx = he.Lb ? -(he.L - he.Lb) / 2 : -he.L * 0.1, half = Math.max(0, len / 2 - e.L / 2 - 0.1);
      it.slide = clamp(it.slide || 0, -half, half);
      ob.position.set(cx + it.slide * it.side, 0, it.side * he.W / 2); ob.rotation.set(0, it.side > 0 ? 0 : Math.PI, 0);
      ob.scale.set(1, (he.H - (e.cat === 'awning' ? 0.28 : 0.2)) / e.z0, 1);
    } else {                             // strešný stan: pevná polovica na streche, vyklopená s rebríkom nad bokom auta
      const off = e.fx ? e.L / 4 : (e.cw > 1 ? e.W / 2 - e.cw / 2 : he.W / 2 - 0.3), half = Math.max(0, he.L * 0.18);
      it.slide = clamp(it.slide || 0, -half, half);
      ob.position.set(-he.L * 0.07 + it.slide, he.H + 0.04, it.side * off); ob.rotation.set(0, (e.fx ? -Math.PI / 2 : 0) + (it.side > 0 ? 0 : Math.PI), 0); ob.scale.set(1, 1, 1);
      const lad = ob.getObjectByName('rebrik'); if (lad) lad.scale.setScalar((he.H + 0.11) / 1.82);
    }
  }
  function make(e, st) {
    const it = Object.assign({ uid: uid++, e, x: 0, z: 0, rot: 0, host: null, slide: 0, side: 1, color: e.paint || null, bad: '' }, st || {});
    it.obj = new THREE.Group(); it.obj.userData.item = it;
    const b = e.box, h = Math.max(0.3, Math.min(e.H || 1, 3.2));                // kým sa model načíta, stojí na mieste priesvitný hranol
    it.ghost = new THREE.Mesh(new THREE.BoxGeometry(b[2] - b[0], h, b[3] - b[1]), new THREE.MeshBasicMaterial({ color: 0x0a5bab, transparent: true, opacity: 0.22, depthWrite: false }));
    it.ghost.position.set((b[0] + b[2]) / 2, h / 2 + (e.att === 'roof' ? 0 : 0), (b[1] + b[3]) / 2); it.obj.add(it.ghost);
    it.line = new THREE.Mesh(stripGeo(corners(e), 0.06), new THREE.MeshBasicMaterial({ color: C_IDLE.clone(), transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
    it.line.position.y = 0.03; it.line.renderOrder = 7; it.obj.add(it.line);
    it.fill = new THREE.Mesh(new THREE.PlaneGeometry(b[2] - b[0], b[3] - b[1]), new THREE.MeshBasicMaterial({ color: 0xd23b25, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    it.fill.rotation.x = -Math.PI / 2; it.fill.position.set((b[0] + b[2]) / 2, 0.025, (b[1] + b[3]) / 2); it.fill.renderOrder = 6; it.fill.visible = false; it.obj.add(it.fill);   // červená plocha pod vecou, ktorá sa nezmestí
    (it.host ? it.host.obj : G).add(it.obj); seat(it);
    fetchModel(e.id, BASE).then((tpl) => {
      if (!items.includes(it)) return;
      const m = tpl.clone(true); it.model = m;
      if (e.paint) m.traverse((q) => { if (q.isMesh && /^lak /.test(q.material.name)) { q.material = q.material.clone(); it.paintMat = q.material; } });
      it.obj.remove(it.ghost); it.ghost.geometry.dispose(); it.ghost = null; it.obj.add(m);
      if (it.color && it.paintMat) it.paintMat.color.set(it.color);
      if (it.host) { it.line.position.y = -it.obj.position.y + 0.03; it.fill.position.y = -it.obj.position.y + 0.025; }
      seat(it); items.filter((c) => c.host === it).forEach(seat); o.shadows(); refresh();
    }).catch(() => { say('Model sa nepodarilo načítať. Skontrolujte pripojenie.'); });
    if (it.host) { it.line.position.y = -(it.host.e.H + 0.04) * (e.att === 'roof' ? 1 : 0) + 0.03; it.fill.position.y = it.line.position.y - 0.005; }
    items.push(it); return it;
  }
  function removeItem(it) {
    items.filter((c) => c.host === it).forEach(removeItem);
    it.obj.removeFromParent(); it.line.geometry.dispose(); it.fill.geometry.dispose(); if (it.paintMat) it.paintMat.dispose();
    items = items.filter((x) => x !== it); if (sel === it) sel = null;
  }
  const cls = (it) => it.e.cls || 'solid';
  function clash(a, b) {
    if (a === b || a.host === b || b.host === a) return false;
    const A = cls(a), B = cls(b);
    if ((A === 'low' && B === 'cover') || (A === 'cover' && B === 'low')) return false;   // stôl pod markízou je v poriadku
    return overlap(a.poly, b.poly);
  }
  function validate() {
    const hw = P.w / 2 + 0.03, hh = P.h / 2 + 0.03;
    items.forEach((it) => { it.poly = poly(it); });
    items.forEach((it) => {
      const out = it.poly.some((p) => Math.abs(p[0]) > hw || Math.abs(p[1]) > hh), hit = items.find((b) => clash(it, b)), tree = !out && !hit && it.e.att !== 'roof' && trunks.some((t) => overlap(it.poly, t));
      it.bad = out ? 'Prečnieva cez hranicu parcely.' : hit ? 'Prekrýva sa: ' + hit.e.n + '.' : tree ? 'Na tomto mieste stojí strom.' : '';
    });
    return items.every((it) => !it.bad);
  }
  function tryAt(it, x, z, rot) { it.x = x; it.z = z; it.rot = rot; seat(it); it.poly = poly(it); const hw = P.w / 2 + 0.03, hh = P.h / 2 + 0.03; return !it.poly.some((p) => Math.abs(p[0]) > hw || Math.abs(p[1]) > hh) && !items.some((b) => b !== it && (b.poly = b.poly || poly(b)) && clash(it, b)) && !trunks.some((t) => overlap(it.poly, t)); }
  function autoPlace(it) {              // prvé voľné miesto od rohu parcely; vec leží pozdĺž dlhšej strany, pravým bokom (dvere, markíza) dovnútra
    const long = P.h > P.w ? Math.PI / 2 : 0, cx = long ? P.w / 2 : -P.w / 2, cz = -P.h / 2; let best = null;
    items.forEach((b) => { if (b !== it) b.poly = poly(b); });
    for (const r of [long, long + Math.PI / 2]) for (let z = -P.h / 2 + 0.25; z <= P.h / 2 - 0.25; z += 0.25) for (let x = -P.w / 2 + 0.25; x <= P.w / 2 - 0.25; x += 0.25) {
      const d = Math.hypot(x - cx, z - cz) + (r === long ? 0 : 2.5); if (best && d >= best.d) continue;
      if (tryAt(it, x, z, r)) best = { x, z, r, d };
    }
    if (best) tryAt(it, best.x, best.z, best.r); else tryAt(it, 0, 0, long);
    return !!best;
  }
  function hostFor(e) {
    const ok = (h) => !h.host && (h.e.host === e.att || h.e.host === 'both') && !items.some((c) => c.host === h && c.e.att === e.att);
    return sel && ok(sel) ? sel : items.find(ok) || null;
  }
  function add(id) {
    const e = byCat[id]; if (!e || !P) return null;
    let it;
    if (e.att) {
      const h = hostFor(e);
      if (!h) { say(e.att === 'roof' ? 'Strešný stan patrí na auto. Najprv pridajte auto.' : 'Markíza a predstan patria ku karavanu alebo obytnému autu. Najprv ho pridajte.'); note(e.att === 'roof' ? 'Najprv pridajte auto, strešný stan sa položí naň.' : 'Najprv pridajte karavan alebo obytné auto.'); return null; }
      it = make(e, { host: h });
      const free = (s) => { it.side = s; seat(it); items.forEach((b) => { b.poly = poly(b); }); return !it.poly.some((p) => Math.abs(p[0]) > P.w / 2 + 0.03 || Math.abs(p[1]) > P.h / 2 + 0.03) && !items.some((b) => clash(it, b)); };
      if (!free(1) && !free(-1)) free(1);                    // strana, na ktorej je miesto; inak pravá (dvere)
    } else { it = make(e); const ok = autoPlace(it); if (!ok) note('Na parcele už nie je voľné miesto. Vec som položil do stredu, posuňte ju alebo niečo odstráňte.'); }
    select(it); changed(); say(e.n + ' pridané na parcelu.'); return it;
  }
  function changed() { dirty = true; o.shadows(); refresh(); save(); if (!$('.c3r-hint').classList.contains('warn')) hint(); }

  /* ---------------- uloženie zostavy (prenáša sa medzi parcelami) */
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ parcel: P.id, items: items.map((it) => ({ id: it.e.id, x: +it.x.toFixed(2), z: +it.z.toFixed(2), rot: +it.rot.toFixed(4), host: it.host ? items.indexOf(it.host) : -1, slide: +(it.slide || 0).toFixed(2), side: it.side, color: it.color })) })); } catch (e) { /* súkromný režim */ }
  }
  function load() {
    let d = null; try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
    if (!d || !Array.isArray(d.items)) return;
    const same = d.parcel === P.id, made = [];
    d.items.forEach((s) => { const e = byCat[s.id]; made.push(e && s.host < 0 ? make(e, { x: s.x, z: s.z, rot: s.rot, color: s.color || e.paint || null }) : null); });
    d.items.forEach((s, i) => { const e = byCat[s.id], h = s.host >= 0 ? made[s.host] : null; if (e && h) made[i] = make(e, { host: h, slide: s.slide, side: s.side || 1 }); });
    if (!same) {                         // iná parcela: zostava sa skúsi poukladať nanovo v rovnakom poradí
      const top = items.filter((it) => !it.host); top.forEach((it) => { it.x = 99; it.z = 99; seat(it); });
      top.sort((a, b) => (b.e.box[2] - b.e.box[0]) * (b.e.box[3] - b.e.box[1]) - (a.e.box[2] - a.e.box[0]) * (a.e.box[3] - a.e.box[1])).forEach((it) => { it.x = 0; it.z = 0; autoPlace(it); });
    }
  }

  /* ---------------- rozhranie */
  let noteT = 0;
  function note(t) { const h = $('.c3r-hint'); h.textContent = t; h.classList.add('warn'); clearTimeout(noteT); noteT = setTimeout(hint, 6000); }
  function hint() { const h = $('.c3r-hint'); h.classList.remove('warn'); h.textContent = items.length ? (touch ? 'Vec posuniete prstom. Ťahaním mimo vecí otáčate pohľad, dvoma prstami približujete.' : 'Vec posuniete myšou, klávesom R ju otočíte. Ťahaním mimo vecí otáčate pohľad.') : 'Vyberte, s čím prídete. Každá vec má skutočné rozmery.'; }
  function select(it) { sel = it || null; refresh(); }
  function refresh() {
    if (!P) return;
    const ok = validate(), bad = items.filter((it) => it.bad).length, used = items.filter((it) => !it.host && cls(it) !== 'cover').reduce((s, it) => s + (it.e.box[2] - it.e.box[0]) * (it.e.box[3] - it.e.box[1]), 0);
    items.forEach((it) => { it.line.material.color.copy(it.bad ? C_BAD : it === sel ? C_OK : C_IDLE); it.line.material.opacity = it.bad || it === sel ? 1 : 0.55; it.fill.visible = !!it.bad; });
    $('.c3r-title strong').textContent = P.word + ' ' + P.id;
    $('.c3r-title span').textContent = num(P.w) + ' × ' + num(P.h) + ' m' + (items.length ? ' · zabraté ' + Math.round(used) + ' z ' + Math.round(P.w * P.h) + ' m²' : '');
    const done = $('.c3r-done'); done.textContent = !items.length ? 'Pokračovať bez zostavy' : ok ? 'Hotovo, zmestím sa' : bad === 1 ? '1 vec sa nezmestí' : bad + ' veci sa nezmestia';
    done.setAttribute('aria-disabled', ok ? 'false' : 'true'); done.classList.toggle('bad', !ok);
    tool.hidden = !sel;
    if (sel) {
      tool.querySelector('strong').textContent = sel.e.n;
      const chip = tool.querySelector('.chip'); chip.textContent = sel.bad ? 'Nezmestí sa' : 'Zmestí sa'; chip.className = 'chip ' + (sel.bad ? 'no' : 'ok');
      tool.querySelector('.c3r-why').textContent = sel.bad || num(sel.e.L) + ' × ' + num(sel.e.W) + ' m' + (sel.host ? ' · pripojené: ' + sel.host.e.n : '');
      tool.querySelector('[data-a="flip"]').hidden = !sel.host; tool.querySelector('[data-a="paint"]').hidden = !sel.e.paint;
      tool.querySelector('[data-a="rotl"]').hidden = tool.querySelector('[data-a="rotr"]').hidden = !!sel.host;
    }
    tabsEl.querySelector('[data-t="kit"]').textContent = 'Na parcele' + (items.length ? ' (' + items.length + ')' : '');
    if (tab === 'kit') renderCards();
  }
  function renderTabs() {
    tabsEl.innerHTML = TABS.map(([k, n]) => '<button type="button" data-t="' + k + '" aria-pressed="' + (k === tab) + '">' + n + '</button>').join('');
    const subs = tab === 'kit' ? [] : [...new Set(CAT.filter((e) => e.tab === tab).map((e) => e.sub))];
    if (!subs.includes(sub)) sub = subs[0] || '';
    subsEl.innerHTML = subs.map((s) => '<button type="button" data-s="' + esc(s) + '" aria-pressed="' + (s === sub) + '">' + esc(s) + '</button>').join(''); subsEl.hidden = subs.length < 2;
    renderCards(); refresh();
  }
  function renderCards() {
    if (tab === 'kit') {
      cards.className = 'c3r-cards kit';
      cards.innerHTML = items.length ? '<ul>' + items.map((it) => '<li class="' + (it.bad ? 'bad' : '') + (it === sel ? ' on' : '') + '"><button type="button" class="c3r-pick" data-u="' + it.uid + '"><img src="' + BASE + 't/' + it.e.id + '.webp" alt="" width="64" height="44"><span><b>' + esc(it.e.n) + '</b><i>' + (it.bad ? esc(it.bad) : num(it.e.L) + ' × ' + num(it.e.W) + ' m') + '</i></span></button><button type="button" class="c3r-rm" data-u="' + it.uid + '" aria-label="Odstrániť: ' + esc(it.e.n) + '">' + ico('bin') + '</button></li>').join('') + '</ul>'
        : '<p class="c3r-empty">Parcela je zatiaľ prázdna. V záložkách vyššie vyberte auto, karavan, stan a všetko, čo si beriete.</p>';
      return;
    }
    cards.className = 'c3r-cards';
    cards.innerHTML = CAT.filter((e) => e.tab === tab && (!sub || e.sub === sub)).map((e) => '<button type="button" class="c3r-card" data-id="' + e.id + '"><img src="' + BASE + 't/' + e.id + '.webp" alt="" loading="lazy" width="320" height="220"><b>' + esc(e.n) + '</b><i>' + num(e.L) + ' × ' + num(e.W) + ' m</i><span class="c3r-add">' + ico('plus') + '</span></button>').join('');
    cards.scrollTop = 0; cards.scrollLeft = 0;
  }
  tabsEl.addEventListener('click', (ev) => { const b = ev.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; renderTabs(); });
  subsEl.addEventListener('click', (ev) => { const b = ev.target.closest('[data-s]'); if (!b) return; sub = b.dataset.s; renderTabs(); });
  cards.addEventListener('click', (ev) => {
    const c = ev.target.closest('.c3r-card'), rm = ev.target.closest('.c3r-rm'), pk = ev.target.closest('.c3r-pick');
    if (c) add(c.dataset.id);
    else if (rm) { const it = items.find((x) => x.uid === +rm.dataset.u); if (it) { const n = it.e.n; removeItem(it); changed(); say(n + ' odstránené.'); } }
    else if (pk) select(items.find((x) => x.uid === +pk.dataset.u));
  });
  function act(a) {
    if (!sel) return;
    if (a === 'rotl' || a === 'rotr') { if (sel.host) return; sel.rot += (a === 'rotr' ? 1 : -1) * Math.PI / 12; seat(sel); }
    else if (a === 'flip') { sel.side = -sel.side; seat(sel); }
    else if (a === 'paint') { const i = PAINT.indexOf(sel.color); sel.color = PAINT[(i + 1) % PAINT.length]; if (sel.paintMat) sel.paintMat.color.set(sel.color); }
    else if (a === 'bin') { const n = sel.e.n; removeItem(sel); say(n + ' odstránené.'); }
    changed();
  }
  tool.addEventListener('click', (ev) => { const b = ev.target.closest('[data-a]'); if (b) act(b.dataset.a); });
  $('.c3r-back').addEventListener('click', () => o.exit(false));
  $('.c3r-done').addEventListener('click', () => {
    if (!validate()) { const b = items.find((it) => it.bad); select(b); note('Zostava sa na túto parcelu celá nezmestí. Posuňte veci, niečo odstráňte, alebo sa vráťte do kempu a skúste väčšiu parcelu.'); return; }
    o.exit(true);
  });
  const onKey = (ev) => {
    if (!active || ev.ctrlKey || ev.metaKey || ev.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName || '')) return;
    if (ev.code === 'Escape' && sel) { select(null); ev.preventDefault(); ev.stopPropagation(); return; }
    if (!sel) return;
    const step = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[ev.code];
    if (step && !/^BUTTON$/.test(ev.target.tagName || '')) { if (sel.host) sel.slide += step[0] || -step[1]; else { sel.x += step[0]; sel.z += step[1]; } seat(sel); changed(); ev.preventDefault(); }
    else if (ev.code === 'KeyR') { act(ev.shiftKey ? 'rotl' : 'rotr'); ev.preventDefault(); }
    else if (ev.code === 'Delete' || ev.code === 'Backspace') { act('bin'); ev.preventDefault(); }
  };
  window.addEventListener('keydown', onKey, true);

  /* ---------------- ukazovateľ: vec sa chytí a posúva po zemi; mimo vecí ostáva otáčanie pohľadu */
  function groundAt(ev) {
    const r = renderer.domElement.getBoundingClientRect(); ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); ground.constant = -G.position.y; return ray.ray.intersectPlane(ground, v3) ? v3.clone() : null;
  }
  function itemAt(ev) {
    groundAt(ev);
    const hit = ray.intersectObjects(items.map((it) => it.model || it.ghost).filter(Boolean), true)[0];
    if (hit) { for (let q = hit.object; q; q = q.parent) if (q.userData.item) return q.userData.item; }
    const p = groundAt(ev); if (!p) return null;
    G.worldToLocal(p); const inQ = (pl) => { let c = false; for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) { if ((pl[i][1] > p.z) !== (pl[j][1] > p.z) && p.x < (pl[j][0] - pl[i][0]) * (p.z - pl[i][1]) / (pl[j][1] - pl[i][1]) + pl[i][0]) c = !c; } return c; };
    return items.slice().reverse().find((it) => inQ(it.poly || poly(it))) || null;
  }
  stage.addEventListener('pointerdown', (ev) => {
    if (!active || !ev.isPrimary || ev.button > 0) return;
    const it = itemAt(ev);
    if (!it) { drag = { tap: true, x: ev.clientX, y: ev.clientY }; return; }           // ťuk do prázdna zruší výber, ťahanie otáča pohľad
    ev.stopPropagation(); ev.preventDefault();                                          // ovládanie kamery túto udalosť nedostane
    const p = groundAt(ev); if (!p) return;
    select(it); const frame = it.host ? it.host.obj : G; frame.worldToLocal(p);
    drag = { it, id: ev.pointerId, dx: (it.host ? it.obj.position.x : it.x) - p.x, dz: it.z - p.z, moved: false };
    try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* starší prehliadač */ }
  }, true);
  stage.addEventListener('pointermove', (ev) => {
    if (!drag || !drag.it) { if (drag && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 6) drag.tap = false; return; }
    if (ev.pointerId !== drag.id) return;
    const p = groundAt(ev); if (!p) return;
    const it = drag.it, frame = it.host ? it.host.obj : G; frame.worldToLocal(p); drag.moved = true;
    if (it.host) { const he = it.host.e, cx = it.e.att === 'side' ? (he.Lb ? -(he.L - he.Lb) / 2 : -he.L * 0.1) : -he.L * 0.07; it.slide = (p.x + drag.dx - cx) * (it.e.att === 'side' ? it.side : 1); }
    else { it.x = Math.round((p.x + drag.dx) * 20) / 20; it.z = Math.round((p.z + drag.dz) * 20) / 20; }
    seat(it); o.shadows(); refresh();
  }, true);
  const up = (ev) => {
    if (!drag) return;
    if (drag.it) { if (ev.pointerId !== drag.id) return; if (drag.moved) { dirty = true; save(); } }
    else if (drag.tap && ev.type === 'pointerup') select(null);
    drag = null;
  };
  stage.addEventListener('pointerup', up, true); stage.addEventListener('pointercancel', up, true);

  /* ---------------- vstup a odchod */
  function decorate() {
    deco.clear();
    const hw = P.w / 2, hh = P.h / 2, pos = [];
    for (let x = Math.ceil(-hw); x <= hw; x++) pos.push(x, 0, -hh, x, 0, hh);
    for (let z = Math.ceil(-hh); z <= hh; z++) pos.push(-hw, 0, z, hw, 0, z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false })); grid.position.y = 0.02; grid.renderOrder = 3; deco.add(grid);
    const a = textPlane(num(P.w) + ' m'); a.position.set(0, 0.04, hh + 0.55); deco.add(a);
    const b = textPlane(num(P.h) + ' m'); b.position.set(-hw - 0.55, 0.04, 0); b.rotation.z = Math.PI / 2; deco.add(b);
  }
  function layout() {                    // obraz sa posunie mimo panela, aby parcela ostala v strede voľnej plochy
    if (!active) return;
    const w = stage.clientWidth, h = stage.clientHeight, r = panel.getBoundingClientRect(), wide = r.height > h * 0.7;
    camera.setViewOffset(w, h, wide ? -r.width / 2 : 0, wide ? 0 : r.height / 2, w, h);
  }
  function free() {                      // voľná časť obrazu vedľa panela alebo nad ním (v css px) a výška celého obrazu
    const w = stage.clientWidth, h = stage.clientHeight, r = panel.getBoundingClientRect(), bar = $('.c3r-bar').getBoundingClientRect().height, wide = r.height > h * 0.7;
    return { w: wide ? w - r.width : w, h: (wide ? h : h - r.height) - bar, full: h };
  }
  function enter(u, raw) {
    if (P && P.id !== u.id) { items.slice().forEach((it) => { if (!it.host) removeItem(it); }); items = []; }
    const ang = (raw.ang || 0) * Math.PI / 180, fresh = !P || P.id !== u.id;
    P = { id: u.id, w: raw.w / CAMP.pxPerM, h: raw.h / CAMP.pxPerM, word: u.unit === 'zone' ? 'Plocha' : 'Parcela', r: u.r };
    G.position.set(u.c[0], u.top + 0.004, u.c[1]); G.rotation.set(0, -ang, 0); G.updateMatrixWorld(true);
    // stromy, ktoré na parcele naozaj stoja (camp.json: trees a mladé stromčeky v shrubs): kmeň je prekážka
    trunks = [];
    (CAMP.trees || []).concat((CAMP.shrubs || []).filter((s) => s[2] >= 6)).forEach((t) => {
      v3.set((t[0] - CAMP.origin[0]) / CAMP.pxPerM, 0, (t[1] - CAMP.origin[1]) / CAMP.pxPerM); G.worldToLocal(v3);
      const k = t.length > 3 ? 0.3 : 0.2; if (Math.abs(v3.x) < P.w / 2 - 0.1 && Math.abs(v3.z) < P.h / 2 - 0.1) trunks.push([[v3.x - k, v3.z - k], [v3.x + k, v3.z - k], [v3.x + k, v3.z + k], [v3.x - k, v3.z + k]]);
    });
    active = true; ui.hidden = false; deco.visible = true; decorate();
    if (fresh) { sel = null; load(); }
    tab = items.length ? 'kit' : 'auto'; renderTabs(); hint(); layout(); o.shadows();
    return P;
  }
  function exit() { active = false; ui.hidden = true; deco.visible = false; sel = null; drag = null; camera.clearViewOffset(); items.forEach((it) => { it.line.material.opacity = 0; it.fill.visible = false; }); if (P) save(); }
  return { enter, exit, layout, free, add, act, select: (i) => select(items[i]), get active() { return active; },
    summary: () => items.map((it) => it.e.n),
    screenOf(i) { const it = items[i]; if (!it) return null; it.obj.updateWorldMatrix(true, false); const b = it.e.box, r = renderer.domElement.getBoundingClientRect();   // stred veci na obrazovke (skúšky)
      v3.set((b[0] + b[2]) / 2, 0.3, (b[1] + b[3]) / 2); it.obj.localToWorld(v3); v3.project(camera); return [r.left + (v3.x + 1) / 2 * r.width, r.top + (1 - v3.y) / 2 * r.height]; },
    state: () => ({ active, parcel: P && P.id, trunks: trunks.length, tab, sel: sel ? sel.e.id : null, items: items.map((it) => ({ id: it.e.id, x: it.x, z: it.z, rot: +it.rot.toFixed(3), bad: it.bad, host: it.host ? it.host.e.id : null, loaded: !!it.model })) }),
    destroy() { window.removeEventListener('keydown', onKey, true); ui.remove(); } };
}
