// Kontrola trasy preletu: node kempy/check-tour.js <slug> [--wall=3 --trunk=1.5 --prop=1.5] [--fix]
// --fix: trasu rozdelí po 2 m, body odsunie od prekážok, vyhladí a vypíše nové pole "tour" (px plánu) na vloženie do dát kempu.
// Prejde trasu (camp.json: tour) po 0,5 m rovnakou krivkou ako prehliadka a vypíše miesta, kde je bližšie k stene budovy,
// kmeňu stromu, kríku, živému plotu alebo vozidlu, než je dovolený odstup. Skončí chybou, ak také miesto nájde.
'use strict';
const path = require('path'), fs = require('fs');
const argv = process.argv.slice(2), slug = argv.find((a) => !a.startsWith('--'));
const flag = (n, d) => { const a = argv.find((x) => x.startsWith('--' + n + '=')); return a ? +a.slice(n.length + 3) : d; };
const WALL = flag('wall', 3), TRUNK = flag('trunk', 1.5), PROP = flag('prop', 1.5);
const camp = JSON.parse(fs.readFileSync(path.join(__dirname, slug, 'camp.json'), 'utf8')), S = camp.pxPerM;
if (!camp.tour) { console.log('kemp nemá trasu preletu'); process.exit(0); }
const pm = path.join(__dirname, slug, 'props.models.json'), placed = fs.existsSync(pm) ? JSON.parse(fs.readFileSync(pm, 'utf8')) : [];

(async () => {
  const THREE = await import('three');
  const curve = new THREE.CatmullRomCurve3(camp.tour.map((p) => new THREE.Vector3(p[0] / S, 0, p[1] / S)), false, 'centripetal'), len = curve.getLength();
  const rect = (c, w, h, ang) => { const a = (ang || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map((d) => [(c[0] + d[0] * ca - d[1] * sa) / S, (c[1] + d[0] * sa + d[1] * ca) / S]); };
  const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const segD = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
  const polyD = (x, z, poly) => (inPoly(x, z, poly) ? -1 : 1) * Math.min(...poly.map((a, i) => segD(x, z, a, poly[(i + 1) % poly.length])));   // vnútri záporná
  const obst = [];
  (camp.buildings || []).forEach((b) => obst.push({ what: 'budova ' + b.name, need: WALL, d: (x, z) => polyD(x, z, b.pts ? b.pts.map((p) => [p[0] / S, p[1] / S]) : rect(b.c, b.w, b.d, b.ang)) }));
  const DIM = { caravan: [6.8, 2.4], motorhome: [8.4, 2.35], car: [4.5, 1.85], tent: [3.2, 2.6] };
  (camp.props || []).forEach((p, i) => { const m = placed[i] && placed[i].dims, d = p.dims || m || DIM[p.kind]; if (d) { const r = rect(p.c, d[0] * S, d[1] * S, p.ang); obst.push({ what: p.kind + ' ' + (p.model || ''), need: PROP, d: (x, z) => polyD(x, z, r) }); } });
  (camp.boxes || []).forEach((b) => { if ((b.height || 0) > 0.4) { const r = rect(b.c, b.w, b.d, b.ang); obst.push({ what: 'objekt ' + b.name, need: PROP, d: (x, z) => polyD(x, z, r) }); } });
  (camp.trees || []).forEach((t, i) => obst.push({ what: 'kmeň stromu ' + i + ' [' + t[0] + ',' + t[1] + ']', need: TRUNK, d: (x, z) => Math.hypot(x - t[0] / S, z - t[1] / S) - Math.min(0.42, Math.max(0.09, Math.max((t[3] || 0) * 0.028, t[2] / S * 0.07))) }));   // polomer ako look.js: trunkRadius
  (camp.shrubs || []).forEach((t, i) => obst.push({ what: 'krík ' + i, need: 0.6, d: (x, z) => Math.hypot(x - t[0] / S, z - t[1] / S) - t[2] / S * 1.15 }));
  (camp.hedges || []).forEach((h) => obst.push({ what: 'živý plot ' + h.name, need: 1, d: (x, z) => Math.min(...h.pts.slice(1).map((b, i) => segD(x, z, [h.pts[i][0] / S, h.pts[i][1] / S], [b[0] / S, b[1] / S]))) - h.w / S / 2 }));
  if (argv.includes('--fix')) {
    const N = Math.max(4, Math.round(len / 2)), P = Array.from({ length: N + 1 }, (_, i) => { const q = curve.getPointAt(i / N); return [q.x, q.z]; }), O = P.map((q) => q.slice()), M = 0.35;
    for (let it = 0; it < 400; it++) {
      P.forEach((q) => obst.forEach((o) => { const d = o.d(q[0], q[1]); if (d >= o.need + M) return; const gx = o.d(q[0] + 0.05, q[1]) - o.d(q[0] - 0.05, q[1]), gz = o.d(q[0], q[1] + 0.05) - o.d(q[0], q[1] - 0.05), l = Math.hypot(gx, gz) || 1, k = (o.need + M - d) * 0.5; q[0] += gx / l * k; q[1] += gz / l * k; }));
      // vyhladzuje sa len posun oproti pôvodnej trase (susedia uhýbajú spolu), tvar trasy ostáva
      const D = P.map((q, i) => [q[0] - O[i][0], q[1] - O[i][1]]);
      for (let i = 0; i <= N; i++) { const a = D[Math.max(0, i - 1)], b = D[Math.min(N, i + 1)]; P[i][0] = O[i][0] + D[i][0] * 0.8 + (a[0] + b[0]) * 0.1; P[i][1] = O[i][1] + D[i][1] * 0.8 + (a[1] + b[1]) * 0.1; }
    }
    for (let it = 0; it < 30; it++) P.forEach((q) => obst.forEach((o) => { const d = o.d(q[0], q[1]); if (d >= o.need + 0.1) return; const gx = o.d(q[0] + 0.05, q[1]) - o.d(q[0] - 0.05, q[1]), gz = o.d(q[0], q[1] + 0.05) - o.d(q[0], q[1] - 0.05), l = Math.hypot(gx, gz) || 1, k = (o.need + 0.1 - d) * 0.5; q[0] += gx / l * k; q[1] += gz / l * k; }));
    console.log('tour: ' + JSON.stringify(P.map((q) => [Math.round(q[0] * S), Math.round(q[1] * S)])).split('],[').join('], [') + ',');
    return;
  }
  const worst = new Map(); let tight = Infinity, tightAt = '';
  for (let s = 0; s <= len; s += 0.5) {
    const t = s / len, p = curve.getPointAt(t);
    obst.forEach((o) => { const d = o.d(p.x, p.z); if (o.need === WALL && d < tight) { tight = d; tightAt = o.what + ' pri t=' + t.toFixed(3); } if (d < o.need) { const w = worst.get(o.what); if (!w || d < w.d) worst.set(o.what, { d, t, px: [Math.round(p.x * S), Math.round(p.z * S)] }); } });
  }
  console.log('trasa ' + len.toFixed(0) + ' m, najbližšia stena ' + tight.toFixed(2) + ' m (' + tightAt + ')');
  if (!worst.size) { console.log('trasa je voľná'); return; }
  [...worst.entries()].sort((a, b) => a[1].t - b[1].t).forEach(([k, w]) => console.log('  t=' + w.t.toFixed(3) + ' px ' + JSON.stringify(w.px) + '  ' + (w.d < 0 ? 'VNÚTRI (' + (-w.d).toFixed(2) + ' m)' : w.d.toFixed(2) + ' m') + '  ' + k));
  process.exit(1);
})();
