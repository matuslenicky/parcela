/* Hologramy: názov a stav každej parcely vo výške očí a tabule „čo kde v kempe je“ nad budovami a plochami.
   Všetky tabule sú jedna sieť s jednou textúrou (jedno kreslenie); natáčajú sa ku kamere, zakrýva ich všetko, čo stojí pred nimi,
   a s odstupom miznú, aby pohľad nezahltili. Stav parcely (voľná, obsadená, vybraná) sa prekreslí len pri zmene. */
import * as THREE from 'three';

const CW = 384, CH = 192, COLS = 5;
const TINT = { ok: [0.5, 0.95, 1.0], no: [1.0, 0.7, 0.36], sel: [1.0, 1.0, 1.0], poi: [0.82, 0.97, 1.0] };

export function makeHolo(o) {
  const { CAMP, units, api, still } = o, S = CAMP.pxPerM, OX = CAMP.origin[0], OY = CAMP.origin[1], W = (p) => [(p[0] - OX) / S, (p[1] - OY) / S];
  const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const mid = (pts) => { const a = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]); return [a[0] / pts.length, a[1] / pts.length]; };
  const at = (o) => (o.c ? W(o.c) : o.pts && o.pts.length ? W(mid(o.pts)) : null);          // stred objektu v metroch
  const props = (CAMP.props || []).map((p) => W(p.c));

  const crowns = (CAMP.trees || []).filter((t) => t.length > 3 && t[3] > 0).map((t) => { const w = W(t); return [w[0], w[1], Math.max(0.6, t[2] / S) * 1.15]; });
  const open = (x, z) => crowns.reduce((m, c) => Math.min(m, Math.hypot(x - c[0], z - c[1]) - c[2]), 99);      // odstup od najbližšej koruny (záporný = pod korunou)
  function spot(u) {
    let best = [u.c[0], u.c[1]], bs = open(u.c[0], u.c[1]); if (bs > 1.2) return best;
    [[1, 2], [3, 0], [0, 1], [2, 3]].forEach(([i, j]) => { const x = u.c[0] + ((u.pts[i][0] + u.pts[j][0]) / 2 - u.c[0]) * 0.55, z = u.c[1] + ((u.pts[i][1] + u.pts[j][1]) / 2 - u.c[1]) * 0.55, s = open(x, z); if (s > bs + 0.5) { bs = s; best = [x, z]; } });
    return best;
  }

  /* ---- zoznam tabúľ */
  const L = [];
  units.forEach((u) => {
    const raw = CAMP.parcels.find((p) => p.id === u.id) || {}, t = CAMP.types[raw.t] || {}, busy = props.some((p) => inPoly(p[0], p[1], u.pts));
    const roof = u.unit === 'cabin' ? ((t.cabin || [])[2] || 3.4) + 1.2 : 0;          // stred pozemku chatky leží v chatke: tabuľa patrí nad strechu
    const at2 = roof ? u.c : spot(u);
    L.push({ kind: 'unit', id: u.id, x: at2[0], z: at2[1], y: roof || (busy ? 3.5 : 1.75), w: 1.9, far: 46, grow: 0.07, top: t.label || (u.unit === 'zone' ? 'Plocha' : u.unit === 'cabin' ? 'Chatka' : 'Parcela'), title: u.id, sub: '', state: '' });
  });
  const poi = (name, x, z, y) => { if (name && !L.some((l) => l.kind === 'poi' && l.title === name)) L.push({ kind: 'poi', x, z, y, w: 2.9, far: 900, grow: 0.027, top: '', title: name, sub: '', state: 'poi' }); };
  (CAMP.buildings || []).forEach((b) => { if (b.context || !(b.short || b.name)) return; const k = at(b); if (k) poi(b.short || b.name, k[0], k[1], (b.height || 3) + 1.5); });
  (CAMP.pools || []).forEach((p) => { const k = at(p); if (k) poi(p.name, k[0], k[1], 2.4); });
  (CAMP.areas || []).forEach((a) => { if (!a.name || a.kind === 'gravel' || ((a.kind === 'paved' || a.kind === 'asphalt') && !a.label)) return; const k = at(a); if (k) poi(a.name, k[0], k[1], 2.6); });

  /* tabule miest bližšie než 18 m dostanú rôzne poschodia; o poschodie ich dvíha až shader o výšku tabule v jej aktuálnej mierke,
     takže sa neprekryjú ani z výšky, kde je tabuľa zväčšená (pri pevných 2 m sa z prehľadu prekrývali) */
  { const P = L.filter((l) => l.kind === 'poi'); P.forEach((l, i) => { const used = new Set(); for (let k = 0; k < i; k++) if (Math.hypot(P[k].x - l.x, P[k].z - l.z) < 18) used.add(P[k].lift); let v = 0; while (used.has(v)) v++; l.lift = v; }); }

  /* ---- textúra: jedno políčko na tabuľu */
  const rows = Math.ceil(L.length / COLS), cv = document.createElement('canvas'); cv.width = COLS * CW; cv.height = Math.max(1, rows) * CH;
  const g = cv.getContext('2d'), FONT = (o.font || 'system-ui, sans-serif');
  function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fit(txt, weight, size, max) { do { g.font = weight + ' ' + size + 'px ' + FONT; size -= 2; } while (g.measureText(txt).width > max && size > 14); }
  function draw(i) {
    const l = L[i], x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH, P = 10;
    g.clearRect(x, y, CW, CH); g.save(); g.translate(x, y);
    rr(P, P, CW - 2 * P, CH - 2 * P, 16); g.fillStyle = 'rgba(10,52,104,0.86)'; g.fill();
    const gr = g.createLinearGradient(0, P, 0, CH - P); gr.addColorStop(0, 'rgba(255,255,255,0.3)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(255,255,255,0.2)'); g.fillStyle = gr; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
    g.lineWidth = 6; g.lineCap = 'round'; g.strokeStyle = '#fff';                       // zvýraznené rohy
    [[P + 4, P + 30, P + 4, P + 4, P + 30, P + 4], [CW - P - 30, CH - P - 4, CW - P - 4, CH - P - 4, CW - P - 4, CH - P - 30]].forEach((c) => { g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(c[2], c[3]); g.lineTo(c[4], c[5]); g.stroke(); });
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; const M = CW - 2 * P - 36;
    if (l.kind === 'unit') {
      fit(l.top, '700', 30, M); g.fillText(l.top, CW / 2, 42);
      fit(l.title, '800', 66, M); g.fillText(l.title, CW / 2, 97);
      if (l.sub) { fit(l.sub, '700', 32, M - 34); const tw = g.measureText(l.sub).width; g.beginPath(); g.arc(CW / 2 - tw / 2 - 16, 152, 8, 0, 7); g.fill(); g.fillText(l.sub, CW / 2 + 8, 153); }
    } else {
      const words = l.title.split(' '); let a = l.title, b = '';
      g.font = '800 44px ' + FONT;
      if (g.measureText(a).width > M && words.length > 1) { let best = 1e9; for (let k = 1; k < words.length; k++) { const p = words.slice(0, k).join(' '), q = words.slice(k).join(' '), d = Math.abs(g.measureText(p).width - g.measureText(q).width); if (d < best) { best = d; a = p; b = q; } } }
      if (b) { fit(a.length > b.length ? a : b, '800', 44, M); g.fillText(a, CW / 2, 72); g.fillText(b, CW / 2, 124); } else { fit(a, '800', 52, M); g.fillText(a, CW / 2, CH / 2 + 2); }
    }
    g.restore();
  }
  L.forEach((_, i) => draw(i));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;

  /* ---- sieť: tabuľa (4 body) a lúč k zemi (4 body) na každý záznam */
  const n = L.length, pos = new Float32Array(n * 8 * 3), cen = new Float32Array(n * 8 * 3), cor = new Float32Array(n * 8 * 2), uv = new Float32Array(n * 8 * 2), tint = new Float32Array(n * 8 * 3), par = new Float32Array(n * 8 * 4), idx = [];
  L.forEach((l, i) => {
    const h = l.w * CH / CW, u0 = (i % COLS) / COLS, v1 = 1 - Math.floor(i / COLS) / rows, u1 = u0 + 1 / COLS, v0 = v1 - 1 / rows;
    [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1], [-1, 0, 0, 0], [1, 0, 0, 0], [1, 1, 0, 1], [-1, 1, 0, 1]].forEach((c, k) => {
      const j = i * 8 + k, beam = k > 3;
      cen[j * 3] = l.x; cen[j * 3 + 1] = l.y; cen[j * 3 + 2] = l.z; pos[j * 3] = l.x; pos[j * 3 + 1] = l.y; pos[j * 3 + 2] = l.z;
      cor[j * 2] = c[0] * (beam ? 0.018 : l.w / 2); cor[j * 2 + 1] = beam ? c[1] : c[1] * h / 2;
      uv[j * 2] = c[2]; uv[j * 2 + 1] = c[3];
      par[j * 4] = l.far; par[j * 4 + 1] = l.grow; par[j * 4 + 2] = (beam ? 1 : 0) + (l.kind === 'poi' ? 2 : 0) + 4 * (l.lift || 0); par[j * 4 + 3] = h / 2;
    });
    const b = i * 8; idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('center', new THREE.BufferAttribute(cen, 3)); geo.setAttribute('corner', new THREE.BufferAttribute(cor, 2));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3)); geo.setAttribute('par', new THREE.BufferAttribute(par, 4)); geo.setIndex(idx);
  const U = { map: { value: tex }, uTime: { value: 0 }, uShow: { value: 1 }, uNear: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: [
      'attribute vec3 center, tint; attribute vec2 corner; attribute vec4 par; uniform float uNear; varying vec2 vUv; varying vec3 vTint; varying float vA, vBeam;',
      'void main(){',
      '  vec4 mv = modelViewMatrix * vec4(center, 1.0); float dist = -mv.z, s = max(1.0, dist * par.y);',
      '  float beam = mod(par.z, 2.0), lift = floor(par.z / 4.0) * par.w * 2.15 * s;',
      '  if (beam > 0.5) { float top = max(0.0, center.y - par.w * s); mv = modelViewMatrix * vec4(center.x, top * corner.y, center.z, 1.0); mv.x += corner.x * s; mv.y += corner.y * lift; }',
      '  else { mv.xy += corner * s; mv.y += lift; }',
      '  vA = (1.0 - smoothstep(par.x * 0.7, par.x, dist)) * smoothstep(2.5, 5.0, dist) * (par.z > 1.5 ? 1.0 : uNear);',
      '  vUv = uv; vTint = tint; vBeam = beam; gl_Position = projectionMatrix * mv; }'].join('\n'),
    fragmentShader: [
      'uniform sampler2D map; uniform float uTime, uShow; varying vec2 vUv; varying vec3 vTint; varying float vA, vBeam;',
      'void main(){',
      '  vec4 t = vBeam > 0.5 ? vec4(1.0, 1.0, 1.0, 0.5 * (0.25 + 0.75 * vUv.y)) : texture2D(map, vUv);',
      '  float scan = 0.9 + 0.1 * sin(gl_FragCoord.y * 1.4 - uTime * 5.0);',
      '  gl_FragColor = vec4(t.rgb * vTint * 1.25, t.a * vA * uShow * scan); if (gl_FragColor.a < 0.004) discard;',
      '  #include <colorspace_fragment>',
      '}'].join('\n'),
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.raycast = () => {}; mesh.name = 'hologramy';
  const setTint = (i, c) => { for (let k = 0; k < 8; k++) { tint[(i * 8 + k) * 3] = c[0]; tint[(i * 8 + k) * 3 + 1] = c[1]; tint[(i * 8 + k) * 3 + 2] = c[2]; } };
  L.forEach((l, i) => setTint(i, l.kind === 'poi' ? TINT.poi : TINT.ok));

  return {
    mesh, count: () => n, labels: () => L.map((l) => ({ kind: l.kind, title: l.title, sub: l.sub, state: l.state })),
    /* stav jednotiek zo stránky: text a farba tabule sa menia len vtedy, keď sa zmení stav */
    update() {
      let dirty = false; const st = {}; (api.units() || []).forEach((s) => { st[s.id] = s; });
      L.forEach((l, i) => {
        if (l.kind !== 'unit') return; const s = st[l.id] || {}, inf = api.info(l.id) || {}, sub = inf.chip || '', state = s.sel ? 'sel' : inf.ok === false || s.taken ? 'no' : 'ok';
        if (sub !== l.sub) { l.sub = sub; draw(i); dirty = true; }
        if (state !== l.state) { l.state = state; setTint(i, TINT[state]); geo.attributes.tint.needsUpdate = true; }
      });
      if (dirty) tex.needsUpdate = true;
    },
    /* near = 1 pri pohľade zblízka (prechádzka, priblíženie), 0 z výšky: tabule parciel sa strácajú, tabule miest ostávajú */
    tick(dt, near, show) { if (!still) U.uTime.value += dt; U.uNear.value += (near - U.uNear.value) * Math.min(1, dt * 5); U.uShow.value += ((show ? 1 : 0) - U.uShow.value) * Math.min(1, dt * 6); mesh.visible = U.uShow.value > 0.01; },
    dispose() { tex.dispose(); geo.dispose(); mat.dispose(); },
  };
}
