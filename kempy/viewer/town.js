/* Okolité domy za plotom kempu (camp.json: buildings[].context): namiesto sivých kvádrov domy s oknami a strechou.
   Steny všetkých domov rovnakej farby sú jedna sieť s jednou malou opakovanou textúrou (pole okna = 3 × 2,9 m),
   strechy sú spolu druhá sieť: desiatky domov stoja pár kreslení. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function rng(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const BAY = 3, FLOOR = 2.9;
const WALLS = ['#efe8d6', '#e6dccb', '#f3efe6', '#ddd5c4', '#ead9b6', '#dfe3e0', '#f0e2cf'], BLOCKS = ['#d9d6cd', '#cfd4d7', '#e4ddd0'];
const ROOFS = ['#a5523f', '#8c4a3a', '#6e5a4e', '#55595c', '#9a5d44', '#7a3f35'], FLAT = '#8f918e';

function bayTexture(wall, seed) {          // jedno pole steny s oknom; okraje poľa sú čistá stena
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), r = rng(seed), px = N / BAY, py = N / FLOOR;
  g.fillStyle = wall; g.fillRect(0, 0, N, N);
  const im = g.getImageData(0, 0, N, N), d = im.data; for (let i = 0; i < d.length; i += 4) { const v = (r() - 0.5) * 12; d[i] += v; d[i + 1] += v; d[i + 2] += v; } g.putImageData(im, 0, 0);
  const ww = 1.25 * px, wh = 1.4 * py, x0 = (N - ww) / 2, y0 = N - (0.9 + 1.4) * py, f = 0.07 * px;
  g.fillStyle = '#f4f4f1'; g.fillRect(x0 - f, y0 - f, ww + 2 * f, wh + 2 * f);
  const gr = g.createLinearGradient(0, y0, 0, y0 + wh); gr.addColorStop(0, '#73899a'); gr.addColorStop(0.5, '#3a4a56'); gr.addColorStop(1, '#27343e'); g.fillStyle = gr; g.fillRect(x0, y0, ww, wh);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0, y0, ww, wh * 0.08);
  g.fillStyle = '#f4f4f1'; g.fillRect(N / 2 - f / 2, y0, f, wh);
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x0 - f * 1.5, y0 + wh + f, ww + 3 * f, f * 0.9); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x0 - f * 1.5, y0 + wh + f * 1.9, ww + 3 * f, f * 0.7);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function glassTexture() {                 // pole presklenej fasády: zelenkasté sklo s lamelami, svetlá hrana stropu, úzke okno
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, N); gr.addColorStop(0, '#b9d4d2'); gr.addColorStop(0.7, '#8fb3b2'); gr.addColorStop(1, '#7ea3a3'); g.fillStyle = gr; g.fillRect(0, 0, N, N);
  for (let x = 0; x < N; x += N / 10) { g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, 0, 2, N); g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + 4, 0, 2, N); }
  g.fillStyle = '#4c5a58'; g.fillRect(N * 0.42, N * 0.18, N * 0.14, N * 0.62); g.fillStyle = '#c9b48f'; g.fillRect(N * 0.42, N * 0.18, N * 0.14, N * 0.06);
  g.fillStyle = '#eef0ec'; g.fillRect(0, N - N * 0.1, N, N * 0.1); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, N - N * 0.1, N, 2);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function roofTexture() {                   // drážky krytiny, farbu dáva sieť
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#e9e9e9'; g.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 8) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x, 0, 3, 64); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x + 5, 0, 2, 64); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function geo(pts, uv, col) {               // trojuholník alebo štvoruholník z bodov [x, y, z]
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(pts.flatMap(() => col), 3));
  g.setIndex(pts.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g;
}

export function buildContext(CAMP) {
  const list = (CAMP.buildings || []).filter((b) => b.context && !b.style && b.height > 0 && ((b.pts && b.pts.length > 2) || (b.c && b.w > 0 && b.d > 0))); if (!list.length) return null;
  const S = CAMP.pxPerM, OX = CAMP.origin[0], OY = CAMP.origin[1], W = (p) => [(p[0] - OX) / S, (p[1] - OY) / S];
  const walls = new Map(), roofs = [], C = new THREE.Color();
  const wall = (key, a, b, h0, h1, floors) => {          // stena od a po b; krátka stena je bez okna
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.2) return; const n = L < 2.2 ? 0.07 : Math.max(1, Math.round(L / BAY)), top = Math.max(h0, h1);
    if (!walls.has(key)) walls.set(key, []);
    walls.get(key).push(geo([[a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], h1, b[1]], [a[0], h0, a[1]]], [0, 0, n, 0, n, floors * h1 / top, 0, floors * h0 / top]));
  };
  list.forEach((b, bi) => {
    const r = rng(bi * 13 + 5), h = b.height, big = b.poly || h > 9.5 || Math.max(b.w || 0, b.d || 0) / S > 22 || !(b.c && b.w > 0 && b.d > 0) || (b.pts && b.pts.length !== 4);
    const key = b.facade === 'glass' ? 'glass' : (big ? BLOCKS : WALLS)[Math.floor(r() * (big ? BLOCKS : WALLS).length)];
    if (big) {                                           // bytovka alebo hala: steny po obvode, rovná strecha s atikou
      const fa = (b.ang || 0) * Math.PI / 180, fc = Math.cos(fa), fs2 = Math.sin(fa);
      const P = (b.pts && b.pts.length > 2 ? b.pts : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map((k) => [b.c[0] + k[0] * b.w / 2 * fc - k[1] * b.d / 2 * fs2, b.c[1] + k[0] * b.w / 2 * fs2 + k[1] * b.d / 2 * fc])).map(W), floors = Math.max(1, Math.round(h / FLOOR));
      P.forEach((a, i) => wall(key, a, P[(i + 1) % P.length], h, h, floors));
      const sg = new THREE.ShapeGeometry(new THREE.Shape(P.map((p) => new THREE.Vector2(p[0], -p[1])))); sg.rotateX(-Math.PI / 2); sg.translate(0, h - 0.25, 0);
      C.set(FLAT).multiplyScalar(0.9 + r() * 0.2); const n = sg.attributes.position.count; sg.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [C.r, C.g, C.b]).flat(), 3));
      const up = sg.attributes.position, uv = sg.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, up.getX(i) / 1.2, up.getZ(i) / 1.2);
      roofs.push(sg.index ? sg.toNonIndexed() : sg);
      return;
    }
    /* rodinný dom: sedlová strecha s hrebeňom pozdĺž dlhšej strany, presah 0,4 m */
    const a = (b.ang || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), w = b.w / S, d = b.d / S, [cx, cz] = W(b.c), P = (dx, dz) => [cx + dx * ca - dz * sa, cz + dx * sa + dz * ca];
    const e = Math.max(2.2, Math.min(h * 0.68, h - 0.8)), floors = Math.max(1, Math.round(e / FLOOR)), K = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
    K.forEach((p, i) => wall(key, p, K[(i + 1) % 4], e, e, floors));
    C.set(ROOFS[Math.floor(r() * ROOFS.length)]).multiplyScalar(0.9 + r() * 0.2); const col = [C.r, C.g, C.b], ov = 0.4, R = (dx, dz, y) => { const q = P(dx, dz); return [q[0], y, q[1]]; };
    const lw = d >= w, half = (lw ? w : d) / 2, k = (h - e) / half, ye = e - ov * k, W2 = w / 2 + ov, D2 = d / 2 + ov, len = (lw ? d : w) / 1.2;
    C.set(key); const wc = [C.r, C.g, C.b];
    if (lw) {
      roofs.push(geo([R(-W2, D2, ye), R(-W2, -D2, ye), R(0, -D2, h), R(0, D2, h)], [0, 0, len, 0, len, 1, 0, 1], col), geo([R(W2, -D2, ye), R(W2, D2, ye), R(0, D2, h), R(0, -D2, h)], [0, 0, len, 0, len, 1, 0, 1], col));
      for (const s of [-1, 1]) roofs.push(geo([R(-w / 2, s * d / 2, e), R(w / 2, s * d / 2, e), R(0, s * d / 2, h), R(0, s * d / 2, h)], [0, 0, 0.01, 0, 0.01, 0.01, 0, 0.01], wc));   // štít vo farbe steny
    } else {
      roofs.push(geo([R(-W2, -D2, ye), R(W2, -D2, ye), R(W2, 0, h), R(-W2, 0, h)], [0, 0, len, 0, len, 1, 0, 1], col), geo([R(W2, D2, ye), R(-W2, D2, ye), R(-W2, 0, h), R(W2, 0, h)], [0, 0, len, 0, len, 1, 0, 1], col));
      for (const s of [-1, 1]) roofs.push(geo([R(s * w / 2, -d / 2, e), R(s * w / 2, d / 2, e), R(s * w / 2, 0, h), R(s * w / 2, 0, h)], [0, 0, 0.01, 0, 0.01, 0.01, 0, 0.01], wc));
    }
  });
  const grp = new THREE.Group(); grp.name = 'okolite domy'; const tex = [];
  const add = (parts, mat) => { const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g)), m = mergeGeometries(flat, false); parts.forEach((g) => g.dispose()); if (!m) return; const mesh = new THREE.Mesh(m, mat); mesh.castShadow = mesh.receiveShadow = true; grp.add(mesh); };
  let i = 0; walls.forEach((parts, key) => { const t = key === 'glass' ? glassTexture() : bayTexture(key, ++i); tex.push(t); add(parts, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide })); });
  const rt = roofTexture(); tex.push(rt); add(roofs, new THREE.MeshStandardMaterial({ map: rt, vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }));
  /* pôvodné kvádre z GLB: „budova <názov>“, Blender k opakovanému názvu pridáva .001 (three.js z neho spraví budova_<názov>001) */
  const names = new Set(list.map((b) => THREE.PropertyBinding.sanitizeNodeName('budova ' + b.name)));
  return { group: grp, hide: { test: (n) => { const m = n.replace(/_\d+$/, ''); return names.has(n) || names.has(m) || names.has(m.replace(/\d{3}$/, '')); } }, count: list.length, dispose() { tex.forEach((t) => t.dispose()); grp.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); } };
}
