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
  const roads = (CAMP.roads || []).filter((r) => !r.context && r.pts && r.pts.length > 1).map((r) => ({ pts: r.pts.concat(r.closed ? [r.pts[0]] : []).map(W), half: (r.w || 0) / S / 2, kind: r.kind, tracks: !!r.tracks, nolamps: r.lamps === false }));
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
      const g = k.ball ? new THREE.IcosahedronGeometry(k.ball, 1).scale(1, k.sy || 1, 1) : k.r ? new THREE.CylinderGeometry(k.r2 === undefined ? k.r : k.r2, k.r, k.h, k.seg || 8) : new THREE.BoxGeometry(k.w, k.h, k.d);
      E.set(k.rx || 0, k.ry || 0, k.rz || 0); Q.setFromEuler(E); M.compose(new THREE.Vector3(k.x || 0, k.y || 0, k.z || 0), Q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(M);
      g.rotateY(-rot); g.translate(px, 0, pz); (k.bulb ? bulbs : parts).push(paint(g, k.c));
    });
  }
  const WOOD = '#9b6f47', STEEL = '#565c60', DARK = '#3a3f42';

  /* ---- elektrické stĺpiky: roh každej parcely; kemp so zameranými prípojkami (camp.json hookups) má skrinky v things */
  units.forEach((u) => {
    if (u.unit !== 'parcel' || CAMP.hookups) return; const p = u.pts[0], x = p[0] + (u.c[0] - p[0]) * 0.07, z = p[1] + (u.c[1] - p[1]) * 0.07;
    item(x, z, 0, [{ w: 0.2, h: 0.95, d: 0.2, y: 0.475, c: '#d9dddd' }, { w: 0.24, h: 0.1, d: 0.24, y: 1.0, c: '#2f6fb5' }, { w: 0.13, h: 0.13, d: 0.02, y: 0.72, z: 0.105, c: '#2f6fb5' }, { w: 0.13, h: 0.13, d: 0.02, y: 0.72, z: -0.105, c: '#2f6fb5' }]);
  });

  /* ---- lampy pozdĺž spevnených ciest, striedavo po stranách, každých ~22 m; cesta s lamps: false má lampy len z camp.json lamps */
  const lamps = [];
  roads.filter((r) => (r.kind === 'paved' || r.kind === 'asphalt') && !r.nolamps).forEach((r) => {
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
  (CAMP.lamps || []).forEach((l) => { const w = W(l); lamps.push([w[0], w[1], 0, 1]); });   /* lampy so známou polohou: camp.json lamps [[x px, y px]] */
  lamps.forEach(([x, z]) => {          // lampa ako v kempe: svetlý stĺp s plochým kruhovým svietidlom
    item(x, z, 0, [{ r: 0.13, r2: 0.09, h: 0.9, y: 0.45, c: '#e4e5e1', seg: 10 }, { r: 0.07, r2: 0.055, h: 3.6, y: 2.7, c: '#cfd1cd' }, { r: 0.43, r2: 0.36, h: 0.14, y: 4.6, c: '#7b7f82', seg: 16 }, { r: 0.33, h: 0.05, y: 4.5, c: '#fff3d6', seg: 16, bulb: true }]);
    const d = new THREE.CircleGeometry(6.5, 24); d.rotateX(-Math.PI / 2); d.translate(x, 0.09, z); glows.push(d);
    const h = new THREE.CircleGeometry(0.8, 12); h.rotateX(Math.PI / 2); h.translate(x, 4.46, z); glows.push(h);
  });

  /* ---- lavičky: dve pri každom bazéne (čelom k vode), jedna pri ihrisku */
  const bench = (x, z, rot) => item(x, z, rot, [{ w: 1.6, h: 0.05, d: 0.42, y: 0.45, c: WOOD }, { w: 1.6, h: 0.38, d: 0.05, y: 0.72, z: -0.2, rx: -0.2, c: WOOD }, { w: 0.06, h: 0.45, d: 0.4, x: -0.65, y: 0.225, c: DARK }, { w: 0.06, h: 0.45, d: 0.4, x: 0.65, y: 0.225, c: DARK }]);
  pools.forEach((p, i) => { let n = 0; for (let k = 0; k < 12 && n < 2; k++) { const a = (k * 5 + i * 2) % 12 / 12 * 6.283, x = p.c[0] + Math.cos(a) * (p.r + 1.8), z = p.c[1] + Math.sin(a) * (p.r + 1.8); if (free(x, z)) { bench(x, z, a + Math.PI / 2); n++; k += 3; } } });

  /* ---- plochy: ihrisko, stolný tenis, cvičenie, pieskovisko */
  (CAMP.areas || []).forEach((a) => {
    if (!a.pts || a.pts.length < 3) return; const P = a.pts.map(W), c = mid(P), name = (a.name || '').toLowerCase();
    let li = 0, ll = 0; P.forEach((p, i) => { const q = P[(i + 1) % P.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > ll) { ll = l; li = i; } });
    const q = P[(li + 1) % P.length], rot0 = Math.atan2(q[1] - P[li][1], q[0] - P[li][0]), rd = (s) => Math.min(...roads.map((r) => lineD(c[0] - Math.sin(rot0) * s, c[1] + Math.cos(rot0) * s, r))), rot = rd(3) < rd(-3) ? rot0 + Math.PI : rot0, ux   /* šmykľavka a lavička mieria od cesty, nie do nej */
      = Math.cos(rot), uz = Math.sin(rot), at = (d) => [c[0] + ux * d, c[1] + uz * d];
    /* športové ihrisko (futbal, kind 'pitch') ani terasa nie sú detské ihrisko, hojdačka tam nepatrí */
    if ((a.kind === 'play' || /ihrisk/.test(name)) && a.kind !== 'pitch' && !/futbal|volejbal|basket|tenis|šport|sport|golf|teras/.test(name)) {
      const s = at(-2.4), t = at(2.4), wd = a.look === 'wood', RED = wd ? '#3f7fbf' : '#c9463d', YEL = wd ? '#e6d04a' : '#e2b53a', ROOF = wd ? '#6b4a33' : RED, BLU = wd ? '#5a3f2b' : '#3f7fbf';   // look: 'wood' = drevená veža a modrá hojdačka
      item(s[0], s[1], rot, [{ r: 0.045, h: 2.5, x: -1.4, y: 1.15, z: -0.55, rx: 0.42, c: RED }, { r: 0.045, h: 2.5, x: -1.4, y: 1.15, z: 0.55, rx: -0.42, c: RED }, { r: 0.045, h: 2.5, x: 1.4, y: 1.15, z: -0.55, rx: 0.42, c: RED }, { r: 0.045, h: 2.5, x: 1.4, y: 1.15, z: 0.55, rx: -0.42, c: RED },
        { r: 0.05, h: 3, y: 2.28, rz: Math.PI / 2, c: RED }, ...[-0.6, 0.6].flatMap((x) => [{ w: 0.45, h: 0.04, d: 0.2, x, y: 0.5, c: DARK }, { w: 0.015, h: 1.76, d: 0.015, x: x - 0.2, y: 1.4, c: STEEL }, { w: 0.015, h: 1.76, d: 0.015, x: x + 0.2, y: 1.4, c: STEEL }])]);
      item(t[0], t[1], rot, [{ w: 1.1, h: 0.08, d: 1.1, y: 1.4, c: WOOD }, ...[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, z]) => ({ w: 0.09, h: 2.3, d: 0.09, x, y: 1.15, z, c: BLU })),
        { w: 0.55, h: 0.05, d: 2.7, y: 0.72, z: 1.72, rx: 0.56, c: YEL }, { w: 0.04, h: 0.16, d: 2.7, x: -0.29, y: 0.8, z: 1.72, rx: 0.56, c: RED }, { w: 0.04, h: 0.16, d: 2.7, x: 0.29, y: 0.8, z: 1.72, rx: 0.56, c: RED },
        ...[0.3, 0.6, 0.9, 1.2].map((y) => ({ w: 0.5, h: 0.04, d: 0.05, y, z: -0.58 - (1.4 - y) * 0.25, c: STEEL })), { w: 1.2, h: 0.05, d: 1.2, y: 2.32, c: ROOF }]);
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

  /* ---- obrubníky pozdĺž spevnených ciest (prerušené tam, kde sa pripája iná cesta alebo spevnená plocha) */
  const hard = (CAMP.areas || []).filter((a) => a.pts && a.pts.length > 2 && /paved|gravel|asphalt/.test(a.kind || '')).map((a) => a.pts.map(W));
  const rounds = (CAMP.roundabouts || []).filter((q) => q.c).map((q) => ({ c: W(q.c), r: ((q.r || 0) + (q.w || 0) / 2) / S }));   /* kruhový objazd: obrubník ramena končí na jeho okraji */
  roads.filter((r) => (r.kind === 'paved' || r.kind === 'asphalt') && r.half >= 1.4).forEach((r) => {
    for (const sd of [-1, 1]) for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.3) continue; const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      /* zákruta: na vnútornej strane sa obrubník skráti, na vonkajšej predĺži, aby sa susedné úseky stretli v rohu a nevbiehali do vozovky */
      const cut = (p, q, first) => { if (!p || !q) return 0; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l < 0.3) return 0; const ux = (q[0] - p[0]) / l, uz = (q[1] - p[1]) / l, cr = first ? ux * dz - uz * dx : dx * uz - dz * ux, dt = ux * dx + uz * dz; return Math.max(-1.5, Math.min(L * 0.45, (r.half + 0.06) * cr * sd / Math.max(0.25, 1 + dt))); };
      const t0 = cut(r.pts[i - 2], a, true), Lk = L - t0 - cut(b, r.pts[i + 1], false); if (Lk < 0.3) continue; const n = Math.max(1, Math.round(Lk / 1.2));
      for (let k = 0; k < n; k++) {
        const t = t0 + (k + 0.5) / n * Lk, x = a[0] + dx * t - dz * sd * (r.half + 0.06), z = a[1] + dz * t + dx * sd * (r.half + 0.06);
        if (lineD(x, z, r) < 0.03 || rounds.some((q) => Math.hypot(x - q.c[0], z - q.c[1]) < q.r + 0.15) || roads.some((q) => q !== r && lineD(x, z, q) < 0.2) || hard.some((h) => inPoly(x, z, h)) || builds.some((q) => inPoly(x, z, q))) continue;
        item(x, z, Math.atan2(dz, dx), [{ w: Lk / n + 0.03, h: 0.1, d: 0.12, y: 0.075, c: '#c9c7be' }]);
      }
    }
  });

  /* ---- štrkové cesty ako dve vyjazdené koľaje v tráve (camp.json: roads[].tracks); pás medzi nimi a okolo je trávnik */
  roads.filter((r) => r.tracks).forEach((r, ri) => {
    for (const sd of [-1, 1]) for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.2) continue; const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, off = sd * 0.72;
      item((a[0] + b[0]) / 2 - dz * off, (a[1] + b[1]) / 2 + dx * off, Math.atan2(dz, dx), [{ w: L + 0.45, h: 0.02, d: 0.48 + ((i * 7 + ri * 3 + (sd > 0 ? 2 : 0)) % 5) * 0.035, y: 0.03, c: (i + ri) % 2 ? '#b9af9a' : '#aea48f' }]);
    }
  });

  /* ---- mladé stromčeky (alej pri plote, rohy parciel): camp.json saplings [[x px, y px, výška m]] */
  if (!(CAMP.trees || []).some((t) => t.length > 3 && t[3] > 0)) (CAMP.saplings || []).forEach((t, i) => { const w = W(t), h = t[2] || 4.5, r = h * 0.2; item(   // kemp s výškami stromov ich kreslí look.js s lístím
    w[0], w[1], i * 0.9, [{ r: 0.06, r2: 0.035, h: h * 0.5, y: h * 0.25, c: '#7a6048', seg: 6 }, { ball: r, sy: 1.5, y: h * 0.66, c: i % 3 ? '#5f9c4c' : '#6aa653' }, { ball: r * 0.7, sy: 1.3, x: r * 0.35, y: h * 0.52, z: r * 0.2, c: '#548f45' }]); });

  /* ---- tuje v radoch: camp.json columns [[x px, y px, výška m]]; kemp s výškami stromov ich kreslí look.js s lístím */
  if (!(CAMP.trees || []).some((t) => t.length > 3 && t[3] > 0)) (CAMP.columns || []).forEach((t, i) => { const w = W(t), h = t[2] || 3, r = Math.max(0.35, h * 0.16); item(w[0], w[1], i * 1.3, [{ r, r2: r * 0.92, h: h * 0.5, y: h * 0.27, c: i % 2 ? '#2f5d36' : '#35663b', seg: 9 }, { r: r * 0.92, r2: 0.06, h: h * 0.5, y: h * 0.75, c: i % 2 ? '#376a3e' : '#3d7244', seg: 9 }]); });

  /* ---- pásy v trávniku (betónové pásy medzi radmi státia): camp.json strips [{ w px, pts, color }] */
  (CAMP.strips || []).forEach((st) => { const P = (st.pts || []).map(W), w = (st.w || 5) / S; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; item((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0]), [{ w: L, h: 0.05, d: w, y: 0.045, c: st.color || '#cfcdc4' }]); } });

  /* ---- ploty: camp.json fences [{ kind: 'metal' | 'wood' | 'panel' | 'wire' (pletivo na drevených kolíkoch), h, pts }]; výplň je textúra na jednej ploche, stĺpiky sú kvádre */
  const fenceQ = { metal: [], wood: [], panel: [], wire: [] }, TILE = { metal: 0.9, wood: 0.6, panel: 2.5, wire: 2.5 };
  (CAMP.fences || []).forEach((f) => {
    const P = (f.pts || []).map(W), h = f.h || 1.6, kind = fenceQ[f.kind] ? f.kind : 'metal'; let run = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([a[0], 0.04, a[1], b[0], 0.04, b[1], b[0], h, b[1], a[0], h, a[1]], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([run / TILE[kind], 0, (run + L) / TILE[kind], 0, (run + L) / TILE[kind], 1, run / TILE[kind], 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); fenceQ[kind].push(g); run += L;
      const n = Math.max(1, Math.round(L / 2.5)), rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (let k = i === 1 ? 0 : 1; k <= n; k++) item(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, rot, [{ w: 0.09, h: h + 0.08, d: 0.09, y: (h + 0.08) / 2, c: kind === 'wood' || kind === 'wire' ? '#8f6a45' : kind === 'panel' ? '#8d9296' : '#2b2e30' }]);
    }
  });
  const fenceTex = (kind) => {
    const c = document.createElement('canvas'); c.width = kind === 'wood' ? 96 : 64; c.height = 128; const g = c.getContext('2d');
    if (kind === 'wood') { const cols = ['#c8a678', '#bf9c6c', '#d0b084', '#c2a172']; for (let i = 0; i < 4; i++) { g.fillStyle = cols[i]; g.fillRect(i * 24, 0, 24, 128); g.fillStyle = 'rgba(60,40,20,0.55)'; g.fillRect(i * 24, 0, 1.5, 128); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(i * 24 + 8, 0, 3, 128); } }
    else if (kind === 'panel') { g.fillStyle = '#b4b9bc'; g.fillRect(0, 0, 64, 128); for (let y = 0; y < 128; y += 16) { g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, y, 64, 2); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y + 14, 64, 2); } g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 1.5, 128); }
    else if (kind === 'wire') { g.clearRect(0, 0, 64, 128); g.fillStyle = '#6f7673'; for (let y = 10; y < 128; y += 22) g.fillRect(0, y, 64, 2.5); for (let x = 6; x < 64; x += 16) g.fillRect(x, 8, 1.5, 114); }
    else { g.clearRect(0, 0, 64, 128); g.fillStyle = '#26292b'; for (let x = 3; x < 64; x += 10.67) g.fillRect(x, 4, 3.2, 120); g.fillRect(0, 8, 64, 5); g.fillRect(0, 108, 64, 5); }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  };

  /* ---- tabule a múriky s nápisom: camp.json signs [{ kind: 'wall' | 'board' | 'plate' (tabuľa bez stĺpikov, napr. na fasáde), c, ang, w, h, y, title, sub, bg }] */
  const signs = [];
  (CAMP.signs || []).forEach((sg) => {
    if (!sg.c) return; const c = W(sg.c), rot = (sg.ang || 0) * Math.PI / 180, w = sg.w || 3, brick = sg.kind === 'wall' && sg.style === 'brick', round = brick && sg.round !== false, h = round ? (sg.h || 2.2) - w / 2 : sg.h || 1.6, y0 = sg.kind === 'wall' ? 0 : (sg.y || 1.6), dep = sg.kind === 'wall' ? 0.4 : 0.06;
    if (brick) item(c[0], c[1], rot, [{ w, h, d: dep, y: h / 2, c: '#ddd3bd' }, { w: w + 0.12, h: 0.14, d: dep + 0.12, y: 0.07, c: '#9a968c' }].concat(round ? [{ r: w / 2, h: dep, y: h, rx: Math.PI / 2, c: '#ddd3bd', seg: 24 }] : [{ w: w + 0.06, h: 0.07, d: dep + 0.06, y: h + 0.035, c: '#c9bea6' }]));   /* svetlý tehlový monolit so zaobleným vrchom */
    else if (sg.kind === 'wall') item(c[0], c[1], rot, [{ w, h, d: dep, y: h / 2, c: '#b3a693' }, { w: w + 0.1, h: 0.08, d: dep + 0.1, y: h + 0.04, c: '#8f8474' }]);
    else item(c[0], c[1], rot, (sg.kind === 'plate' ? [] : [{ w: 0.09, h: y0 + h, d: 0.09, x: -w / 2 + 0.12, y: (y0 + h) / 2, c: DARK }, { w: 0.09, h: y0 + h, d: 0.09, x: w / 2 - 0.12, y: (y0 + h) / 2, c: DARK }]).concat([{ w, h, d: dep, y: y0 + h / 2, c: sg.bg || '#24402f' }]));
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.max(64, Math.round(512 * h / w)); const g = cv.getContext('2d'), CW = cv.width, CHh = cv.height, font = o.font || 'sans-serif';
    if (brick) {                          // svetlé tehly na väzbu a sivá sklenená tabuľka s nápisom v hornej časti
      g.fillStyle = '#c9bea6'; g.fillRect(0, 0, CW, CHh); let sd = 11; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647), bh = CHh / (h / 0.075), bw = bh * 3.3;
      for (let y = 0, r = 0; y < CHh; y += bh, r++) for (let x = (r % 2) * -bw / 2; x < CW; x += bw) { const v = 214 + Math.floor(rnd() * 26); g.fillStyle = 'rgb(' + v + ',' + (v - 8) + ',' + (v - 26) + ')'; g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3); }
      if (!round) {                       // široká stena: okrúhla sklenená tabuľa s logom
        const R = CHh * 0.36, cx = CW * 0.5, cy = CHh * 0.46; g.beginPath(); g.arc(cx + 4, cy + 6, R, 0, 7); g.fillStyle = 'rgba(70,78,76,0.45)'; g.fill(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fillStyle = 'rgba(214,222,220,0.92)'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#8f9693'; g.stroke();
        g.fillStyle = '#2a2e2c'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + Math.round(R * 0.36) + 'px ' + font; g.fillText(sg.title || '', cx, cy - R * 0.04, R * 1.7); g.font = '600 ' + Math.round(R * 0.12) + 'px ' + font; g.fillText(sg.sub || '', cx, cy + R * 0.32, R * 1.6);
      } else {
      const pw = CW * 0.74, ph = CHh * 0.36, px = (CW - pw) / 2, py = CHh * 0.08; g.fillStyle = 'rgba(70,78,76,0.55)'; g.fillRect(px + 4, py + 6, pw, ph); g.fillStyle = '#9aa29f'; g.fillRect(px, py, pw, ph); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(px, py, pw, ph * 0.12);
      g.fillStyle = '#2a2e2c'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + Math.round(ph * 0.36) + 'px ' + font; g.fillText(sg.title || '', CW / 2, py + ph * 0.42, pw * 0.9); g.font = '600 ' + Math.round(ph * 0.14) + 'px ' + font; g.fillText(sg.sub || '', CW / 2, py + ph * 0.75, pw * 0.92);
      }
    } else if (sg.kind === 'wall') {      // lámaný kameň a biely kruh s názvom
      g.fillStyle = '#b3a693'; g.fillRect(0, 0, CW, CHh); let sd = 7; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let y = 0; y < CHh; y += 26) for (let x = -20 + (y / 26 % 2) * 30; x < CW; ) { const ww = 40 + rnd() * 50, v = 150 + Math.floor(rnd() * 60); g.fillStyle = 'rgb(' + (v + 12) + ',' + (v + 2) + ',' + (v - 14) + ')'; g.fillRect(x + 1.5, y + 1.5, ww - 3, 23); x += ww; }
      const R = CHh * 0.4; g.beginPath(); g.arc(CW / 2, CHh / 2, R, 0, 7); g.fillStyle = '#f4f2ec'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#8f8474'; g.stroke();
      g.fillStyle = '#2f3d36'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + Math.round(R * 0.36) + 'px ' + font; g.fillText(sg.title || '', CW / 2, CHh / 2 - R * 0.06); g.font = '600 ' + Math.round(R * 0.13) + 'px ' + font; g.fillText(sg.sub || '', CW / 2, CHh / 2 + R * 0.3);
    } else {
      g.fillStyle = sg.bg || '#24402f'; g.fillRect(0, 0, CW, CHh); g.fillStyle = '#f4f2ec'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const TW = CW * (sg.kind === 'plate' ? 0.9 : Math.max(0.5, 1 - 0.46 / w));   /* text sa zmestí medzi stĺpiky tabule */
      g.font = '700 ' + Math.round(CHh * (sg.sub ? 0.34 : 0.46)) + 'px ' + font; g.fillText(sg.title || '', CW / 2, CHh * (sg.sub ? 0.36 : 0.52), TW); if (sg.sub) { g.font = '500 ' + Math.round(CHh * 0.2) + 'px ' + font; g.fillText(sg.sub, CW / 2, CHh * 0.74, TW); }
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const f1 = new THREE.PlaneGeometry(w, h); f1.translate(0, y0 + h / 2, dep / 2 + 0.012); const f2 = new THREE.PlaneGeometry(w, h); f2.rotateY(Math.PI); f2.translate(0, y0 + h / 2, -dep / 2 - 0.012);
    const gm = mergeGeometries([f1, f2], false); gm.rotateY(-rot); gm.translate(c[0], 0, c[1]); signs.push([gm, t]);
  });

  /* ---- drobné predmety z dát kempu: camp.json things [{ at: [x px, y px], ang °, parts: [kusy ako v item()] }] */
  (CAMP.things || []).forEach((t) => { const w = W(t.at); item(w[0], w[1], (t.ang || 0) * Math.PI / 180, t.parts || []); });
  /* ---- káble od karavanov a obytných áut k najbližšej prípojke (camp.json hookups [[x px, y px]]) */
  (CAMP.props || []).forEach((p, i) => {
    if (!CAMP.hookups || !/caravan|motorhome|camper/.test(p.kind || '')) return; const a = W(p.c); let best = null, bd = 14;
    const cross = (q) => { for (let k = 1; k < 12; k++) { const x = a[0] + (q[0] - a[0]) * k / 12, z = a[1] + (q[1] - a[1]) * k / 12; if (roads.some((r) => lineD(x, z, r) < 0)) return true; } return false; };   /* kábel nevedie cez cestu */
    CAMP.hookups.forEach((h) => { const q = W(h), d = Math.hypot(q[0] - a[0], q[1] - a[1]); if (d < bd && !cross(q)) { bd = d; best = q; } }); if (!best || bd < 2) return;
    const n = Math.max(4, Math.round(bd / 1.2)), dx = (best[0] - a[0]) / bd, dz = (best[1] - a[1]) / bd; let px = a[0] + dx * 1.2, pz = a[1] + dz * 1.2;
    for (let k = 1; k <= n; k++) { const t = k / n, wob = Math.sin(t * Math.PI) * Math.sin(t * 9 + i) * 0.5, x = a[0] + dx * (1.2 + (bd - 1.35) * t) - dz * wob, z = a[1] + dz * (1.2 + (bd - 1.35) * t) + dx * wob, L = Math.hypot(x - px, z - pz); item((x + px) / 2, (z + pz) / 2, Math.atan2(z - pz, x - px), [{ w: L + 0.02, h: 0.03, d: 0.035, y: 0.11, c: i % 2 ? '#d9731c' : '#26282a' }]); px = x; pz = z; }
  });

  /* ---- siete */
  const grp = new THREE.Group(); grp.name = 'vybavenie kempu';
  const merge = (list) => { if (!list.length) return null; const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false); list.forEach((x) => x.dispose()); return g; };
  const body = merge(parts), bulbGeo = merge(bulbs), glowGeo = merge(glows);
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, emissive: 0xffd28a, emissiveIntensity: 0, roughness: 0.4 });
  if (body) { const m = new THREE.Mesh(body, bodyMat); m.castShadow = m.receiveShadow = true; grp.add(m); }
  if (bulbGeo) grp.add(new THREE.Mesh(bulbGeo, bulbMat));
  const extra = [];
  for (const kind of ['metal', 'wood', 'panel', 'wire']) { if (!fenceQ[kind].length) continue; const t = fenceTex(kind); extra.push(t); const m = new THREE.Mesh(mergeGeometries(fenceQ[kind], false), new THREE.MeshStandardMaterial({ map: t, alphaTest: kind === 'metal' || kind === 'wire' ? 0.5 : 0, side: THREE.DoubleSide, roughness: 0.8 })); m.castShadow = kind !== 'metal' && kind !== 'wire'; m.receiveShadow = true; grp.add(m); }
  signs.forEach(([g, t]) => { extra.push(t); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 })); m.receiveShadow = true; grp.add(m); });
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
    dispose() { if (glowTex) glowTex.dispose(); extra.forEach((t) => t.dispose()); grp.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } }); },
  };
}
