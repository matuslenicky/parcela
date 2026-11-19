/* Drobné vybavenie kempu, ktoré pri prechádzke robí miesto skutočným: elektrické stĺpiky pri parcelách, lampy pozdĺž
   spevnených ciest (večer svietia), lavičky pri bazénoch, hojdačka a šmykľavka na ihrisku, pingpongový stôl, hrazdy, pieskovisko.
   Všetko vzniká z dát kempu a je to spolu jedna sieť s farbami vo vrcholoch + žiarovky + svetelné kruhy na zemi (3 kreslenia). */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function makeProps(o) {
  const { CAMP, units } = o, S = CAMP.pxPerM, OX = CAMP.origin[0], OY = CAMP.origin[1], W = (p) => [(p[0] - OX) / S, (p[1] - OY) / S];
  const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const segD = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
  const rect = (c, w, h, ang) => { const a = (ang || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map((d) => W([c[0] + d[0] * ca - d[1] * sa, c[1] + d[0] * sa + d[1] * ca])); };
  const mid = (pts) => { const a = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]); return [a[0] / pts.length, a[1] / pts.length]; };
  const builds = (CAMP.buildings || []).map((b) => (b.pts && b.pts.length > 2 ? b.pts.map(W) : b.c ? rect(b.c, b.w, b.d, b.ang) : null)).filter(Boolean);
  const roads = (CAMP.roads || []).filter((r) => !r.context && r.pts && r.pts.length > 1).map((r) => ({ pts: r.pts.map(W), half: (r.w || 0) / S / 2, kind: r.kind }));
  const waters = (CAMP.water || []).filter((w) => !w.context && w.w && w.pts && w.pts.length > 1).map((w) => ({ pts: w.pts.map(W), half: w.w / S / 2 }));
  const pools = (CAMP.pools || []).map((p) => (p.pts && p.pts.length ? { c: W(mid(p.pts)), r: Math.max(...p.pts.map((q) => Math.hypot(...W(q).map((v, i) => v - W(mid(p.pts))[i])))) } : p.c ? { c: W(p.c), r: (p.r || 30) / S } : null)).filter(Boolean);
  const boundary = (CAMP.boundary || []).map(W);
  const lineD = (x, z, l) => Math.min(...l.pts.slice(1).map((b, i) => segD(x, z, l.pts[i], b))) - l.half;
  /* voľné miesto: v areáli, mimo budov, parciel, ciest, vody a bazénov */
  const free = (x, z, skipRoad) => (!boundary.length || inPoly(x, z, boundary)) && !builds.some((b) => inPoly(x, z, b) || b.some((a, i) => segD(x, z, a, b[(i + 1) % b.length]) < 0.9))
    && !units.some((u) => inPoly(x, z, u.pts)) && !roads.some((r) => r !== skipRoad && lineD(x, z, r) < 0.3) && !waters.some((w) => lineD(x, z, w) < 0.6) && !pools.some((p) => Math.hypot(x - p.c[0], z - p.c[1]) < p.r + 0.6);

  const parts = [], bulbs = [], glows = [], C = new THREE.Color(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const paint = (g, hex) => { C.set(hex); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = C.r; a[i * 3 + 1] = C.g; a[i * 3 + 2] = C.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  /* kus = kváder alebo valec v miestnych súradniciach predmetu (x doprava, y hore, z dopredu), predmet stojí na [px, pz] otočený o rot */
  function item(px, pz, rot, list) {
    list.forEach((k) => {
      const g = k.r ? new THREE.CylinderGeometry(k.r2 === undefined ? k.r : k.r2, k.r, k.h, k.seg || 8) : new THREE.BoxGeometry(k.w, k.h, k.d);
      E.set(k.rx || 0, k.ry || 0, k.rz || 0); Q.setFromEuler(E); M.compose(new THREE.Vector3(k.x || 0, k.y || 0, k.z || 0), Q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(M);
      g.rotateY(-rot); g.translate(px, 0, pz); (k.bulb ? bulbs : parts).push(paint(g, k.c));
    });
  }
  const WOOD = '#9b6f47', STEEL = '#565c60', DARK = '#3a3f42';

  /* ---- elektrické stĺpiky: roh každej parcely */
  units.forEach((u) => {
    if (u.unit !== 'parcel') return; const p = u.pts[0], x = p[0] + (u.c[0] - p[0]) * 0.07, z = p[1] + (u.c[1] - p[1]) * 0.07;
    item(x, z, 0, [{ w: 0.2, h: 0.95, d: 0.2, y: 0.475, c: '#d9dddd' }, { w: 0.24, h: 0.1, d: 0.24, y: 1.0, c: '#2f6fb5' }, { w: 0.13, h: 0.13, d: 0.02, y: 0.72, z: 0.105, c: '#2f6fb5' }, { w: 0.13, h: 0.13, d: 0.02, y: 0.72, z: -0.105, c: '#2f6fb5' }]);
  });

  /* ---- lampy pozdĺž spevnených ciest, striedavo po stranách, každých ~22 m */
  const lamps = [];
  roads.filter((r) => r.kind === 'paved' || r.kind === 'asphalt').forEach((r) => {
    let acc = 11, side = 1;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (; acc < L; acc += 22) {
        for (const s of [side, -side]) {
          const x = a[0] + dx * acc - dz * s * (r.half + 0.7), z = a[1] + dz * acc + dx * s * (r.half + 0.7);
          if (!free(x, z, r) || lamps.some((l) => Math.hypot(l[0] - x, l[1] - z) < 12)) continue;
          lamps.push([x, z, Math.atan2(dz * s, dx * s), s]); side = -s; break;   // rameno lampy mieri nad cestu
        }
      }
      acc -= L;
    }
  });
  lamps.forEach(([x, z, rot]) => {
    item(x, z, rot, [{ r: 0.075, r2: 0.05, h: 4.3, y: 2.15, c: STEEL }, { r: 0.11, h: 0.5, y: 0.25, c: DARK }, { w: 0.06, h: 0.06, d: 0.9, y: 4.28, z: -0.42, c: STEEL }, { w: 0.3, h: 0.09, d: 0.55, y: 4.25, z: -0.95, c: DARK },
      { w: 0.22, h: 0.03, d: 0.42, y: 4.19, z: -0.95, c: '#fff3d6', bulb: true }]);
    const gx = x + Math.sin(rot) * 0.95, gz = z - Math.cos(rot) * 0.95;                 // bod pod svietidlom
    const d = new THREE.CircleGeometry(6.5, 24); d.rotateX(-Math.PI / 2); d.translate(gx, 0.09, gz); glows.push(d);
    const h = new THREE.CircleGeometry(0.75, 12); h.rotateX(Math.PI / 2); h.translate(gx, 4.16, gz); glows.push(h);
  });

  /* ---- lavičky: dve pri každom bazéne (čelom k vode), jedna pri ihrisku */
  const bench = (x, z, rot) => item(x, z, rot, [{ w: 1.6, h: 0.05, d: 0.42, y: 0.45, c: WOOD }, { w: 1.6, h: 0.38, d: 0.05, y: 0.72, z: -0.2, rx: -0.2, c: WOOD }, { w: 0.06, h: 0.45, d: 0.4, x: -0.65, y: 0.225, c: DARK }, { w: 0.06, h: 0.45, d: 0.4, x: 0.65, y: 0.225, c: DARK }]);
  pools.forEach((p, i) => { let n = 0; for (let k = 0; k < 12 && n < 2; k++) { const a = (k * 5 + i * 2) % 12 / 12 * 6.283, x = p.c[0] + Math.cos(a) * (p.r + 1.8), z = p.c[1] + Math.sin(a) * (p.r + 1.8); if (free(x, z)) { bench(x, z, a + Math.PI / 2); n++; k += 3; } } });

  /* ---- plochy: ihrisko, stolný tenis, cvičenie, pieskovisko */
  (CAMP.areas || []).forEach((a) => {
    if (!a.pts || a.pts.length < 3) return; const P = a.pts.map(W), c = mid(P), name = (a.name || '').toLowerCase();
    let li = 0, ll = 0; P.forEach((p, i) => { const q = P[(i + 1) % P.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > ll) { ll = l; li = i; } });
    const q = P[(li + 1) % P.length], rot = Math.atan2(q[1] - P[li][1], q[0] - P[li][0]), ux = Math.cos(rot), uz = Math.sin(rot), at = (d) => [c[0] + ux * d, c[1] + uz * d];
    /* športové ihrisko (futbal, kind 'pitch') ani terasa nie sú detské ihrisko, hojdačka tam nepatrí */
    if ((a.kind === 'play' || /ihrisk/.test(name)) && a.kind !== 'pitch' && !/futbal|volejbal|basket|tenis|šport|sport|golf|teras/.test(name)) {
      const s = at(-2.4), t = at(2.4), RED = '#c9463d', YEL = '#e2b53a', BLU = '#3f7fbf';
      item(s[0], s[1], rot, [{ r: 0.045, h: 2.5, x: -1.4, y: 1.15, z: -0.55, rx: 0.42, c: RED }, { r: 0.045, h: 2.5, x: -1.4, y: 1.15, z: 0.55, rx: -0.42, c: RED }, { r: 0.045, h: 2.5, x: 1.4, y: 1.15, z: -0.55, rx: 0.42, c: RED }, { r: 0.045, h: 2.5, x: 1.4, y: 1.15, z: 0.55, rx: -0.42, c: RED },
        { r: 0.05, h: 3, y: 2.28, rz: Math.PI / 2, c: RED }, ...[-0.6, 0.6].flatMap((x) => [{ w: 0.45, h: 0.04, d: 0.2, x, y: 0.5, c: DARK }, { w: 0.015, h: 1.76, d: 0.015, x: x - 0.2, y: 1.4, c: STEEL }, { w: 0.015, h: 1.76, d: 0.015, x: x + 0.2, y: 1.4, c: STEEL }])]);
      item(t[0], t[1], rot, [{ w: 1.1, h: 0.08, d: 1.1, y: 1.4, c: WOOD }, ...[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, z]) => ({ w: 0.09, h: 2.3, d: 0.09, x, y: 1.15, z, c: BLU })),
        { w: 0.55, h: 0.05, d: 2.7, y: 0.72, z: 1.72, rx: 0.56, c: YEL }, { w: 0.04, h: 0.16, d: 2.7, x: -0.29, y: 0.8, z: 1.72, rx: 0.56, c: RED }, { w: 0.04, h: 0.16, d: 2.7, x: 0.29, y: 0.8, z: 1.72, rx: 0.56, c: RED },
        ...[0.3, 0.6, 0.9, 1.2].map((y) => ({ w: 0.5, h: 0.04, d: 0.05, y, z: -0.58 - (1.4 - y) * 0.25, c: STEEL })), { w: 1.2, h: 0.05, d: 1.2, y: 2.32, c: RED }]);
      const b = at(0); if (free(b[0] - uz * 4.2, b[1] + ux * 4.2)) bench(b[0] - uz * 4.2, b[1] + ux * 4.2, rot + Math.PI);
    } else if (/stoln\S* tenis|ping/.test(name)) {
      item(c[0], c[1], rot, [{ w: 2.74, h: 0.04, d: 1.525, y: 0.76, c: '#1f5fae' }, { w: 2.74, h: 0.045, d: 0.03, y: 0.76, c: '#f2f2f2' }, { w: 0.03, h: 0.045, d: 1.525, x: -1.355, y: 0.76, c: '#f2f2f2' }, { w: 0.03, h: 0.045, d: 1.525, x: 1.355, y: 0.76, c: '#f2f2f2' },
        { w: 0.02, h: 0.15, d: 1.7, y: 0.855, c: DARK }, ...[[-1.05, -0.55], [1.05, -0.55], [1.05, 0.55], [-1.05, 0.55]].map(([x, z]) => ({ w: 0.06, h: 0.74, d: 0.06, x, y: 0.37, z, c: STEEL }))]);
    } else if (/workout|cvič/.test(name)) {
      item(c[0], c[1], rot, [{ r: 0.05, h: 2.5, x: -1.6, y: 1.25, c: STEEL }, { r: 0.05, h: 2.5, x: -0.2, y: 1.25, c: STEEL }, { r: 0.03, h: 1.4, x: -0.9, y: 2.4, rz: Math.PI / 2, c: '#c9463d' },
        { r: 0.05, h: 1.3, x: 0.9, y: 0.65, z: -0.3, c: STEEL }, { r: 0.05, h: 1.3, x: 2.3, y: 0.65, z: -0.3, c: STEEL }, { r: 0.05, h: 1.3, x: 0.9, y: 0.65, z: 0.3, c: STEEL }, { r: 0.05, h: 1.3, x: 2.3, y: 0.65, z: 0.3, c: STEEL },
        { r: 0.03, h: 1.6, x: 1.6, y: 1.3, z: -0.3, rz: Math.PI / 2, c: '#c9463d' }, { r: 0.03, h: 1.6, x: 1.6, y: 1.3, z: 0.3, rz: Math.PI / 2, c: '#c9463d' }]);
    } else if (/piesk/.test(name)) {
      const xs = P.map((p) => (p[0] - c[0]) * ux + (p[1] - c[1]) * uz), zs = P.map((p) => -(p[0] - c[0]) * uz + (p[1] - c[1]) * ux), w = Math.min(6, Math.max(...xs) - Math.min(...xs)) * 0.9, d = Math.min(6, Math.max(...zs) - Math.min(...zs)) * 0.9;
      item(c[0], c[1], rot, [{ w, h: 0.22, d: 0.14, y: 0.11, z: -d / 2, c: WOOD }, { w, h: 0.22, d: 0.14, y: 0.11, z: d / 2, c: WOOD }, { w: 0.14, h: 0.22, d, x: -w / 2, y: 0.11, c: WOOD }, { w: 0.14, h: 0.22, d, x: w / 2, y: 0.11, c: WOOD }]);
    }
  });

  /* ---- siete */
  const grp = new THREE.Group(); grp.name = 'vybavenie kempu';
  const merge = (list) => { if (!list.length) return null; const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false); list.forEach((x) => x.dispose()); return g; };
  const body = merge(parts), bulbGeo = merge(bulbs), glowGeo = merge(glows);
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, emissive: 0xffd28a, emissiveIntensity: 0, roughness: 0.4 });
  if (body) { const m = new THREE.Mesh(body, bodyMat); m.castShadow = m.receiveShadow = true; grp.add(m); }
  if (bulbGeo) grp.add(new THREE.Mesh(bulbGeo, bulbMat));
  let glow = null, glowTex = null;
  if (glowGeo) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
    glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffc36a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    glow.renderOrder = 3; glow.visible = false; glow.raycast = () => {}; glow.name = 'svetlo lamp'; grp.add(glow);
  }
  return {
    group: grp, glow, lamps: lamps.length,
    /* night 0 – 1: za šera sa lampy rozsvietia (žiarovka žiari, na zemi svetelný kruh) */
    night(v) { bulbMat.emissiveIntensity = v * 4; if (glow) { glow.material.opacity = v * 0.55; glow.visible = v > 0.02; } },
    dispose() { if (glowTex) glowTex.dispose(); grp.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } }); },
  };
}
