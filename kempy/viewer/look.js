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

/* rovným plochám z Blendera chýbajú textúrové súradnice: berú sa z polohy vo svete (1 dlaždica = size metrov) */
export function texturize(meshes) {
  const tex = { grass: surfaceTexture('grass'), gravel: surfaceTexture('gravel'), hard: surfaceTexture('hard') }, SIZE = { grass: 5, gravel: 3, hard: 4 }, done = new Set(), v = new THREE.Vector3();
  meshes.forEach((o) => {
    const g = o.geometry, p = g.attributes.position; if (!p) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material], m = mats[0], n = (m.name || '').toLowerCase();
    if (/water|label|line|pool/.test(n)) return;
    const kind = /gravel|sand|play/.test(n) ? 'gravel' : /asphalt|paved/.test(n) ? 'hard' : 'grass';
    if (!g.attributes.uv) { const uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); uv[i * 2] = v.x / SIZE[kind]; uv[i * 2 + 1] = v.z / SIZE[kind]; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
    mats.forEach((mm) => { if (done.has(mm)) return; done.add(mm); mm.map = tex[kind]; mm.color.multiplyScalar(1.16); mm.roughness = kind === 'hard' ? 0.82 : 0.95; mm.needsUpdate = true; });
  });
}

/* koruna = niekoľko zaoblených chumáčov s jemne zvlneným povrchom; farba svetlejšia hore, tmavšia vnútri a dole */
function crownGeo(seed) {
  const r = rng(seed), parts = [], n = 6 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(1, 2), s = i ? 0.42 + r() * 0.26 : 0.72, a = r() * Math.PI * 2, d = i ? 0.34 + r() * 0.28 : 0, y = i ? (r() - 0.35) * 0.62 : 0;
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
/* stromy z camp.json [x px, y px, polomer koruny px, výška m]: vráti skupinu, alebo null, keď kemp výšky stromov nemá */
export function buildTrees(CAMP) {
  const T = (CAMP.trees || []).filter((t) => t.length > 3 && t[3] > 0); if (!T.length) return null;
  const S = CAMP.pxPerM, OX = CAMP.origin[0], OY = CAMP.origin[1], grp = new THREE.Group(), VAR = 3, r = rng(11);
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), bark = new THREE.MeshStandardMaterial({ color: 0x6d5642, roughness: 0.95 });
  const by = Array.from({ length: VAR }, () => []); T.forEach((t, i) => by[i % VAR].push(t));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(), GREENS = [0x4f9a4a, 0x3f8a45, 0x5aa24c, 0x47914f, 0x66a850];
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1, 1, 7).translate(0, 0.5, 0), bark, T.length); let ti = 0;
  by.forEach((list, k) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(crownGeo(k + 1), leaf, list.length);
    list.forEach((t, i) => {
      const rad = Math.max(0.6, t[2] / S), h = Math.max(rad * 1.6, t[3]), x = (t[0] - OX) / S, z = (t[1] - OY) / S, sy = Math.min(1.5, Math.max(0.75, (h * 0.62) / rad)) * rad, yc = Math.max(sy * 0.8, h - sy * 0.72);
      q.setFromAxisAngle(up, r() * 6.28); m4.compose(new THREE.Vector3(x, yc, z), q, new THREE.Vector3(rad * 1.12, sy, rad * 1.12)); im.setMatrixAt(i, m4);
      c.set(GREENS[Math.floor(r() * GREENS.length)]).multiplyScalar(0.9 + r() * 0.22); im.setColorAt(i, c);
      const tr = Math.min(0.32, Math.max(0.06, rad * 0.09)); m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(tr, yc, tr)); trunk.setMatrixAt(ti++, m4);
    });
    im.castShadow = im.receiveShadow = true; im.userData.tree = true; im.frustumCulled = false; grp.add(im);
  });
  trunk.castShadow = true; trunk.userData.tree = true; trunk.frustumCulled = false; grp.add(trunk); grp.name = 'stromy z dat';
  return grp;
}
