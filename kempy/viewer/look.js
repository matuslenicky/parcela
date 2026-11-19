/* Vzhľad živej prehliadky: povrchy s jemnou kresbou (tráva, štrk, asfalt), stromy s plnými korunami namiesto hranatých gúľ.
   Všetko vzniká v prehliadači z dát kempu, model z Blendera ostáva malý. */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function rng(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

/* kresba povrchu: odtiene sivej okolo bielej, násobia farbu materiálu; dlaždica sa opakuje bez švu */
export function surfaceTexture(kind) {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), r = rng(kind === 'grass' ? 3 : kind === 'gravel' ? 5 : 7);
  g.fillStyle = kind === 'grass' ? '#d8d8d8' : '#dcdcdc'; g.fillRect(0, 0, N, N);
  const dot = (x, y, rad, col) => { for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) { g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fillStyle = col; g.fill(); } };
  if (kind === 'grass') {
    for (let i = 0; i < 70; i++) { const v = 200 + Math.floor(r() * 55); dot(r() * N, r() * N, 14 + r() * 30, 'rgba(' + v + ',' + v + ',' + v + ',0.22)'); }       // škvrny rôzne vysokej trávy
    for (let i = 0; i < 2600; i++) { const v = 150 + Math.floor(r() * 105), x = r() * N, y = r() * N; g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 3); g.stroke(); }
  } else {
    const n = kind === 'gravel' ? 3200 : 1800;
    for (let i = 0; i < n; i++) { const v = (kind === 'gravel' ? 150 : 185) + Math.floor(r() * 70); dot(r() * N, r() * N, kind === 'gravel' ? 0.8 + r() * 1.8 : 0.6 + r() * 1.1, 'rgba(' + v + ',' + v + ',' + v + ',0.7)'); }
    for (let i = 0; i < 24; i++) { const v = 205 + Math.floor(r() * 45); dot(r() * N, r() * N, 18 + r() * 28, 'rgba(' + v + ',' + v + ',' + v + ',0.16)'); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/* trávnik nie je jednofarebný: veľké svetlejšie a tmavšie škvrny podľa polohy vo svete (šum v shaderi, bez ďalšej textúry) */
const NATURAL = new THREE.Color(0x6f9e4c);
function macro(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec2 vGw;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vGw = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = ['varying vec2 vGw;', 'float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y); }', ''].join('\n')
      + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n float gm = gn(vGw * 0.06) * 0.6 + gn(vGw * 0.23 + 7.3) * 0.4; diffuseColor.rgb *= vec3(0.84 + 0.3 * gm, 0.87 + 0.26 * gm, 0.8 + 0.3 * gm);');
  };
}

/* rovným plochám z Blendera chýbajú textúrové súradnice: berú sa z polohy vo svete (1 dlaždica = size metrov) */
export function texturize(meshes) {
  const tex = { grass: surfaceTexture('grass'), gravel: surfaceTexture('gravel'), hard: surfaceTexture('hard') }, SIZE = { grass: 5, gravel: 3, hard: 4 }, done = new Set(), v = new THREE.Vector3();
  meshes.forEach((o) => {
    const g = o.geometry, p = g.attributes.position; if (!p) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material], m = mats[0], n = (m.name || '').toLowerCase();
    if (/water|label|line|pool/.test(n)) return;
    const kind = /gravel|sand|play/.test(n) ? 'gravel' : /asphalt|paved/.test(n) ? 'hard' : 'grass'; o.userData.surf = kind;
    if (!g.attributes.uv) { const uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); uv[i * 2] = v.x / SIZE[kind]; uv[i * 2 + 1] = v.z / SIZE[kind]; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
    mats.forEach((mm) => { if (done.has(mm)) return; done.add(mm); mm.map = tex[kind]; mm.color.multiplyScalar(1.16); if (kind === 'grass') { mm.color.lerp(NATURAL, 0.3); macro(mm); } mm.roughness = kind === 'hard' ? 0.82 : 0.95; mm.needsUpdate = true; });
  });
}

/* koruna = niekoľko zaoblených chumáčov s jemne zvlneným povrchom; farba svetlejšia hore, tmavšia vnútri a dole */
function crownGeo(seed, det = 2, blobs = 0) {
  const r = rng(seed), parts = [], n = blobs || 6 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(1, det), s = i ? 0.42 + r() * 0.26 : 0.72, a = r() * Math.PI * 2, d = i ? 0.34 + r() * 0.28 : 0, y = i ? (r() - 0.35) * 0.62 : 0;
    g.scale(s, s * (0.82 + r() * 0.2), s); g.translate(Math.cos(a) * d, y, Math.sin(a) * d); g.deleteAttribute('uv'); parts.push(g);
  }
  let geo = mergeVertices(mergeGeometries(parts, false), 1e-4); parts.forEach((x) => x.dispose());
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const k = 1 + 0.07 * Math.sin(v.x * 9 + seed) * Math.sin(v.y * 11) * Math.sin(v.z * 8 + seed * 2); v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z);
    const l = Math.max(0, Math.min(1, 0.5 + v.y * 0.62)) * 0.5 + Math.min(1, v.length()) * 0.5, t = 0.52 + 0.6 * l * l; col[i * 3] = t; col[i * 3 + 1] = t; col[i * 3 + 2] = t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals(); return geo;
}
/* lístie: zhluky listov na priesvitných kartách rozmiestnené po povrchu koruny; normála karty je normála koruny, takže svetlo ostáva mäkké */
function leafTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), r = rng(23);
  for (let i = 0; i < 150; i++) {
    const x = N * (0.12 + r() * 0.76), y = N * (0.12 + r() * 0.76), l = 12 + r() * 16, v = 150 + Math.floor(r() * 105);
    g.save(); g.translate(x, y); g.rotate(r() * 6.28); g.fillStyle = 'rgb(' + Math.floor(v * 0.86) + ',' + v + ',' + Math.floor(v * 0.72) + ')';
    g.beginPath(); g.ellipse(0, 0, l, l * 0.42, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(40,70,30,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-l, 0); g.lineTo(l, 0); g.stroke(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function cardGeo(seed, crown, n) {
  const r = rng(seed + 40), p = crown.attributes.position, nm = crown.attributes.normal, pos = [], nor = [], uv = [], col = [], idx = [];
  const c = new THREE.Vector3(), nn = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(r() * p.count); c.fromBufferAttribute(p, k).multiplyScalar(1.05); nn.fromBufferAttribute(nm, k).normalize();
    t1.crossVectors(nn, Math.abs(nn.y) > 0.9 ? X : up).normalize().applyAxisAngle(nn, r() * 6.28); t2.crossVectors(nn, t1).multiplyScalar(0.75).addScaledVector(nn, 0.35 * (r() - 0.3)).normalize();
    const s = 0.27 + r() * 0.24, l = 0.62 + 0.5 * Math.max(0, Math.min(1, 0.5 + c.y * 0.62)), b = pos.length / 3;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, e], j) => { pos.push(c.x + (t1.x * a + t2.x * e) * s, c.y + (t1.y * a + t2.y * e) * s, c.z + (t1.z * a + t2.z * e) * s); nor.push(nn.x, nn.y, nn.z); uv.push(j === 1 || j === 2 ? 1 : 0, j > 1 ? 1 : 0); col.push(l, l, l); });
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); return g;
}

/* voda: jemné vlnky ako normálová mapa, ktorá sa pomaly posúva */
let waterMap = null;
export function waterize(root) {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), r = rng(31); g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 260; i++) { const x = r() * N, y = r() * N, rad = 3 + r() * 9, v = r() > 0.5 ? 255 : 0; for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); gr.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',0.22)'); gr.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)'); g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2); } }
  const h = g.getImageData(0, 0, N, N), o = g.createImageData(N, N), H = (x, y) => h.data[(((y + N) % N) * N + ((x + N) % N)) * 4] / 255;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2, dy = (H(x, y + 1) - H(x, y - 1)) * 2.2, l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4; o.data[i] = (-dx / l * 0.5 + 0.5) * 255; o.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; o.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; o.data[i + 3] = 255; }
  g.putImageData(o, 0, 0); waterMap = new THREE.CanvasTexture(c); waterMap.wrapS = waterMap.wrapT = THREE.RepeatWrapping;
  const v = new THREE.Vector3(), done = new Set();
  root.traverse((m) => {
    if (!m.isMesh) return; const mats = Array.isArray(m.material) ? m.material : [m.material]; if (!mats.some((x) => /water/.test(x.name || ''))) return;
    const g2 = m.geometry, p = g2.attributes.position; if (!g2.attributes.uv) { const uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); uv[i * 2] = v.x / 3.5; uv[i * 2 + 1] = v.z / 3.5; } g2.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
    mats.forEach((x) => { if (!/water/.test(x.name || '') || done.has(x)) return; done.add(x); x.normalMap = waterMap; x.normalScale = new THREE.Vector2(0.35, 0.35); x.roughness = 0.1; x.metalness = 0; x.envMapIntensity = 1.5; x.color.multiplyScalar(0.8); x.needsUpdate = true; });
  });
}
/* v izbe parcely koruny spriehľadnejú, aby neprekrývali parcelu; kmene a tiene ostávajú */
export function fadeTrees(grp, on) { if (!grp || !grp.userData.mats) return; grp.userData.mats.forEach((m, i) => { m.transparent = on; m.opacity = on ? (i ? 0.3 : 0.16) : 1; m.depthWrite = !on; m.needsUpdate = true; }); }
export function waterTick(dt) { if (waterMap) { waterMap.offset.x += dt * 0.035; waterMap.offset.y += dt * 0.012; } }
/* stromy z camp.json [x px, y px, polomer koruny px, výška m]: vráti skupinu, alebo null, keď kemp výšky stromov nemá */
export function buildTrees(CAMP) {
  const T = (CAMP.trees || []).filter((t) => t.length > 3 && t[3] > 0); if (!T.length) return null;
  const S = CAMP.pxPerM, OX = CAMP.origin[0], OY = CAMP.origin[1], grp = new THREE.Group(), VAR = 3, r = rng(11);
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), cardMat = new THREE.MeshStandardMaterial({ map: leafTexture(), vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 }), bark = new THREE.MeshStandardMaterial({ color: 0x6d5642, roughness: 0.95 });
  const by = Array.from({ length: VAR }, () => []); T.forEach((t, i) => by[i % VAR].push(t));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(), GREENS = [0x4f9a4a, 0x3f8a45, 0x5aa24c, 0x47914f, 0x66a850];
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1, 1, 7).translate(0, 0.5, 0), bark, T.length); let ti = 0;
  by.forEach((list, k) => {
    if (!list.length) return;
    const cg = crownGeo(k + 1), im = new THREE.InstancedMesh(cg, leaf, list.length), cards = new THREE.InstancedMesh(cardGeo(k + 1, cg, 260), cardMat, list.length);
    list.forEach((t, i) => {
      const rad = Math.max(0.6, t[2] / S), h = Math.max(rad * 1.6, t[3]), x = (t[0] - OX) / S, z = (t[1] - OY) / S, sy = Math.min(1.5, Math.max(0.75, (h * 0.62) / rad)) * rad, yc = Math.max(sy * 0.8, h - sy * 0.72);
      q.setFromAxisAngle(up, r() * 6.28); m4.compose(new THREE.Vector3(x, yc, z), q, new THREE.Vector3(rad * 1.12, sy, rad * 1.12)); im.setMatrixAt(i, m4); cards.setMatrixAt(i, m4);
      c.set(GREENS[Math.floor(r() * GREENS.length)]).multiplyScalar(0.9 + r() * 0.22); cards.setColorAt(i, c); c.multiplyScalar(0.84); im.setColorAt(i, c);   // vnútro koruny je tmavšie než lístie na povrchu
      const tr = Math.min(0.32, Math.max(0.06, rad * 0.09)); m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(tr, yc, tr)); trunk.setMatrixAt(ti++, m4);
    });
    im.castShadow = im.receiveShadow = true; im.userData.tree = true; im.frustumCulled = false; grp.add(im);
    cards.receiveShadow = true; cards.userData.tree = true; cards.frustumCulled = false; grp.add(cards);
  });
  trunk.castShadow = true; trunk.userData.tree = true; trunk.frustumCulled = false; grp.add(trunk); grp.name = 'stromy z dat'; grp.userData.mats = [leaf, cardMat];
  const SH = CAMP.shrubs || [];        // kríky medzi parcelami: malá koruna s lístím pri zemi
  if (SH.length) {
    const cg = crownGeo(9, 1, 4), body = new THREE.InstancedMesh(cg, leaf, SH.length), lv = new THREE.InstancedMesh(cardGeo(9, cg, 70), cardMat, SH.length);
    SH.forEach((t, i) => { const rad = t[2] / S * 1.15; q.setFromAxisAngle(up, r() * 6.28); m4.compose(new THREE.Vector3((t[0] - OX) / S, rad * 0.8, (t[1] - OY) / S), q, new THREE.Vector3(rad, rad * 1.05, rad)); body.setMatrixAt(i, m4); lv.setMatrixAt(i, m4); c.set(GREENS[Math.floor(r() * GREENS.length)]).multiplyScalar(0.85 + r() * 0.2); lv.setColorAt(i, c); c.multiplyScalar(0.72); body.setColorAt(i, c); });
    body.castShadow = body.receiveShadow = true; lv.receiveShadow = true; body.frustumCulled = lv.frustumCulled = false; grp.add(body, lv); grp.userData.shrubs = true;
  }
  return grp;
}

/* ---------------- budovy s fasádou: steny s oknami, dverami a soklom nakreslené do textúry, strecha s presahom.
   camp.json: buildings[].style = { wall, plinth, roof, type: gable|mono|flat, clad: 'larch', win: { every, w, h, sill, frame }, door } */
function facade(L, Hh, st, long, seed) {
  const PX = Math.max(40, Math.min(112, 1792 / Math.max(L, Hh))), c = document.createElement('canvas'); c.width = Math.max(64, Math.round(L * PX)); c.height = Math.max(64, Math.round(Hh * PX)); const g = c.getContext('2d'), r = rng(seed), W = c.width, Hc = c.height;
  g.fillStyle = st.wall; g.fillRect(0, 0, W, Hc);
  if (st.clad === 'larch') { for (let y = 0; y < Hc; y += PX * 0.14) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '255,235,200' : '70,40,10') + ',' + (0.05 + r() * 0.12) + ')'; g.fillRect(0, y, W, PX * 0.14 - 1); g.fillStyle = 'rgba(40,22,8,0.45)'; g.fillRect(0, y + PX * 0.14 - 1.5, W, 1.5); } }
  else for (let i = 0; i < W * Hc / 900; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '255,255,255' : '120,110,90') + ',0.02)'; g.fillRect(r() * W, r() * Hc, 20 + r() * 60, 14 + r() * 40); }
  { const im = g.getImageData(0, 0, W, Hc), d = im.data; for (let i = 0; i < d.length; i += 4) { const v = (r() - 0.5) * (st.clad === 'larch' ? 9 : 13); d[i] += v; d[i + 1] += v; d[i + 2] += v; } g.putImageData(im, 0, 0); }   // zrno omietky / dreva
  for (let i = 0; i < W / 26; i++) { const x = r() * W, l = Hc * (0.08 + r() * 0.3); const gr = g.createLinearGradient(0, 0, 0, l); gr.addColorStop(0, 'rgba(60,62,58,0.07)'); gr.addColorStop(1, 'rgba(60,62,58,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + r() * 5, l); }   // stopy po daždi pod odkvapom
  const y = (m) => Hc - m * PX;                                        // výška nad zemou -> riadok obrázka
  if (st.plinth) { g.fillStyle = st.plinth; g.fillRect(0, y(0.38), W, 0.38 * PX); }
  if (st.win) {
    const n = Math.max(long ? 2 : 1, Math.round(L / st.win.every * (long ? 1 : 0.7))), mid = long && st.door ? Math.floor(n / 2) : -1;
    for (let i = 0; i < n; i++) {
      const cx = W * (i + 0.5) / n;
      if (i === mid) { const dw = 1.0 * PX, dh = 2.08 * PX; g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(cx - dw / 2 - 3, y(0) - dh - 3, dw + 6, dh + 3); g.fillStyle = st.door; g.fillRect(cx - dw / 2, y(0) - dh, dw, dh); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(cx - dw / 2 + 5, y(0) - dh + 6, dw - 10, dh * 0.42); continue; }
      const ww = st.win.w * PX, wh = st.win.h * PX, x0 = cx - ww / 2, y0 = y(st.win.sill + st.win.h), f = 0.07 * PX;
      g.fillStyle = st.win.frame; g.fillRect(x0 - f, y0 - f, ww + 2 * f, wh + 2 * f);
      const gr = g.createLinearGradient(0, y0, 0, y0 + wh); gr.addColorStop(0, '#6f8796'); gr.addColorStop(0.55, '#34444f'); gr.addColorStop(1, '#22303a'); g.fillStyle = gr; g.fillRect(x0, y0, ww, wh);
      g.save(); g.beginPath(); g.rect(x0, y0, ww, wh); g.clip(); g.fillStyle = 'rgba(255,255,255,0.13)'; g.beginPath(); g.moveTo(x0 + ww * 0.1, y0 + wh); g.lineTo(x0 + ww * 0.42, y0); g.lineTo(x0 + ww * 0.62, y0); g.lineTo(x0 + ww * 0.3, y0 + wh); g.fill(); g.restore();   // odlesk skla
      g.fillStyle = 'rgba(0,0,0,0.34)'; g.fillRect(x0, y0, ww, wh * 0.07); g.fillRect(x0, y0, ww * 0.05, wh);                    // tieň ostenia: okno je zapustené
      g.fillStyle = st.win.frame; g.fillRect(cx - f / 2, y0, f, wh);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x0 - f * 1.6, y0 + wh + f, ww + 3.2 * f, f * 0.8);                        // parapet
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x0 - f * 1.6, y0 + wh + f * 1.8, ww + 3.2 * f, f * 0.7);
    }
  } else if (long && st.door) { const cx = W * 0.3, dw = 1.0 * PX, dh = 2.08 * PX; g.fillStyle = st.door; g.fillRect(cx - dw / 2, y(0) - dh, dw, dh); g.fillRect(W - cx - dw / 2, y(0) - dh, dw, dh); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
let plaster = null;
function plasterBump(L, Hh) {            // jemný reliéf omietky: jedna malá textúra, každá stena má len vlastné opakovanie
  if (!plaster) { const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), r = rng(41), im = g.createImageData(N, N); for (let i = 0; i < N * N; i++) { const v = 96 + r() * 64; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } g.putImageData(im, 0, 0); g.filter = 'blur(0.7px)'; g.drawImage(c, 0, 0); plaster = new THREE.CanvasTexture(c); plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping; }
  const t = plaster.clone(); t.repeat.set(L / 0.55, Hh / 0.55); t.needsUpdate = true; return t;
}
function roofTex(hex) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); g.fillStyle = hex; g.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 8) { g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x, 0, 3, 64); g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(x + 5, 0, 2, 64); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function quadGeo(p, uv) {                // štyri body [x, y, z] proti smeru hodinových ručičiek
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv || [0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex(p.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g;
}
export function buildBuildings(CAMP) {
  const S = CAMP.pxPerM, OX = CAMP.origin[0], OY = CAMP.origin[1], grp = new THREE.Group(), names = []; grp.name = 'budovy s fasadou';
  (CAMP.buildings || []).forEach((b, bi) => {
    const st = b.style; if (!st) return;
    const a = (b.ang || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), w = b.w / S, d = b.d / S, cx = (b.c[0] - OX) / S, cz = (b.c[1] - OY) / S;
    const P = (dx, dz) => [cx + dx * ca - dz * sa, cz + dx * sa + dz * ca], hgt = b.height, type = st.type || 'gable', e = type === 'flat' ? hgt : (b.eave || hgt * 0.72);
    const C = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)], LEN = [w, d, w, d], longMin = Math.max(w, d) * 0.8;
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; grp.add(m); };
    const hi = type === 'mono' ? [hgt, hgt, e, e] : [e, e, e, e];       // pultová strecha: stena pri hrane 0 – 1 je vyššia
    for (let i = 0; i < 4; i++) {
      const p = C[i], q = C[(i + 1) % 4], h0 = hi[i], h1 = hi[(i + 1) % 4], Hw = Math.max(h0, h1);
      const mat = new THREE.MeshStandardMaterial({ map: facade(LEN[i], Hw, st, LEN[i] >= longMin, bi * 7 + i + 1), roughness: 0.88, side: THREE.DoubleSide }); if (st.clad !== 'larch') { mat.bumpMap = plasterBump(LEN[i], Hw); mat.bumpScale = 0.7; }
      add(quadGeo([[q[0], 0, q[1]], [p[0], 0, p[1]], [p[0], h0, p[1]], [q[0], h1, q[1]]], [0, 0, 1, 0, 1, h0 / Hw, 0, h1 / Hw]), mat);
    }
    const ov = st.over === undefined ? 0.45 : st.over, rt = roofTex(st.roof), rmat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
    const wallm = new THREE.MeshStandardMaterial({ color: st.wall, roughness: 0.9, side: THREE.DoubleSide });
    const R = (dx, dz, yy) => { const q = P(dx, dz); return [q[0], yy, q[1]]; }, W2 = w / 2 + ov, D2 = d / 2 + ov;
    if (type === 'flat') { add(quadGeo([R(-W2 + 0.2, D2 - 0.2, hgt + 0.1), R(W2 - 0.2, D2 - 0.2, hgt + 0.1), R(W2 - 0.2, -D2 + 0.2, hgt + 0.1), R(-W2 + 0.2, -D2 + 0.2, hgt + 0.1)], [0, 0, w / 1.2, 0, w / 1.2, d / 1.2, 0, d / 1.2]), rmat); const f = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * ov - 0.4, 0.2, d + 2 * ov - 0.4), new THREE.MeshStandardMaterial({ color: st.fascia || st.roof, roughness: 0.8 })); f.position.set(cx, hgt, cz); f.rotation.y = -a; f.castShadow = true; grp.add(f); }
    else if (type === 'mono') { const k = (hgt - e) / d, y0 = hgt + ov * k + 0.06, y1 = e - ov * k + 0.06; add(quadGeo([R(-W2, D2, y1), R(W2, D2, y1), R(W2, -D2, y0), R(-W2, -D2, y0)], [0, 0, w / 1.2, 0, w / 1.2, d / 1.2, 0, d / 1.2]), rmat); }
    else {
      const k = (hgt - e) / (Math.min(w, d) / 2), ye = e - ov * k + 0.05;
      if (d >= w) {                      // hrebeň pozdĺž dlhšej strany
        add(quadGeo([R(-W2, D2, ye), R(-W2, -D2, ye), R(0, -D2, hgt + 0.05), R(0, D2, hgt + 0.05)], [0, 0, d / 1.2, 0, d / 1.2, 1, 0, 1]), rmat); add(quadGeo([R(W2, -D2, ye), R(W2, D2, ye), R(0, D2, hgt + 0.05), R(0, -D2, hgt + 0.05)], [0, 0, d / 1.2, 0, d / 1.2, 1, 0, 1]), rmat);
        for (const s of [-1, 1]) add(quadGeo([R(-w / 2, s * d / 2, e), R(w / 2, s * d / 2, e), R(0, s * d / 2, hgt)]), wallm);
      } else {
        add(quadGeo([R(-W2, -D2, ye), R(W2, -D2, ye), R(W2, 0, hgt + 0.05), R(-W2, 0, hgt + 0.05)], [0, 0, w / 1.2, 0, w / 1.2, 1, 0, 1]), rmat); add(quadGeo([R(W2, D2, ye), R(-W2, D2, ye), R(-W2, 0, hgt + 0.05), R(W2, 0, hgt + 0.05)], [0, 0, w / 1.2, 0, w / 1.2, 1, 0, 1]), rmat);
        for (const s of [-1, 1]) add(quadGeo([R(s * w / 2, -d / 2, e), R(s * w / 2, d / 2, e), R(s * w / 2, 0, hgt)]), wallm);
      }
    }
    names.push(THREE.PropertyBinding.sanitizeNodeName('budova ' + b.name));
  });
  return names.length ? { group: grp, names } : null;
}
