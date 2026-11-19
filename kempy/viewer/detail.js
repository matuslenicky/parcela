/* Detaily živej prehliadky, ktoré nezaťažia slabšie zariadenia:
   obloha s oblakmi (jedna guľa, jedna textúra), tráva len okolo hosťa (jedna sieť s inštanciami) a strážca plynulosti,
   ktorý podľa nameraného času snímky uberá alebo pridáva rozlíšenie a hustotu trávy. */
import * as THREE from 'three';

function rng(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---------------- obloha: prechod zenit – obzor, slnko a oblaky premietnuté na rovinu nad kempom */
function cloudTexture() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), r = rng(17);
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.globalCompositeOperation = 'lighter';
  const blob = (x, y, rad, a) => { for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); gr.addColorStop(0, 'rgba(255,255,255,' + a + ')'); gr.addColorStop(0.6, 'rgba(255,255,255,' + a * 0.4 + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2); } };
  for (let i = 0; i < 16; i++) {                 // kopy: veľký základ a menšie hrče okolo
    const cx = r() * N, cy = r() * N, big = 34 + r() * 46, n = 9 + Math.floor(r() * 9);
    for (let k = 0; k < n; k++) { const a = r() * 6.28, d = r() * big * 1.25; blob(cx + Math.cos(a) * d * 1.5, cy + Math.sin(a) * d * 0.7, big * (0.3 + r() * 0.55), 0.2 + r() * 0.16); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
export function makeSky(radius) {
  const u = {
    top: { value: new THREE.Color(0x8fc3e6) }, hor: { value: new THREE.Color(0xcfe6f2) }, sun: { value: new THREE.Vector3(0.35, 0.8, 0.45) }, sunCol: { value: new THREE.Color(0xfff4e0) },
    power: { value: 1 }, cover: { value: 1 }, shade: { value: 1 }, map: { value: cloudTexture() }, shift: { value: new THREE.Vector2() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: 'varying vec3 vd; void main(){ vd = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vd; uniform vec3 top, hor, sun, sunCol; uniform float power, cover, shade; uniform sampler2D map; uniform vec2 shift;',
      'void main(){ vec3 n = normalize(vd); float h = max(n.y, 0.0);',
      '  vec3 c = mix(hor, top, pow(h, 0.55));',
      '  float s = max(dot(n, sun), 0.0); c += sunCol * power * (smoothstep(0.9994, 0.9998, s) * 1.6 + pow(s, 180.0) * 0.5 + pow(s, 10.0) * 0.14);',
      '  vec2 uv = n.xz / max(n.y + 0.16, 0.02) * 0.085 + shift;',     // pod obzorom sa nedelí nulou
      '  float d = texture2D(map, uv).r; d *= 0.55 + 0.9 * texture2D(map, uv * 2.6 + 0.37).r;',
      '  float a = smoothstep(0.3, 0.72, d) * smoothstep(0.015, 0.2, n.y) * cover;',
      '  vec3 lit = mix(vec3(1.0), sunCol, 0.35) * (0.86 + 0.3 * pow(s, 6.0)), dim = mix(hor, vec3(0.62, 0.66, 0.72), 0.55);',
      '  c = mix(c, mix(dim, lit, smoothstep(0.35, 1.0, d)) * shade, a * 0.92);',
      '  gl_FragColor = vec4(c, 1.0);',
      '  #include <colorspace_fragment>',
      '}'].join('\n'),
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.renderOrder = -100; mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.name = 'obloha';
  return {
    mesh,
    set(top, hor, sunDir, sunCol, day, dark) { u.top.value.copy(top); u.hor.value.copy(hor); u.sun.value.copy(sunDir); u.sunCol.value.copy(sunCol); u.power.value = (dark ? 0.2 : 1) * day; u.cover.value = dark ? 0.55 : 0.9; u.shade.value = (dark ? 0.45 : 1) * (0.35 + 0.65 * day); },
    tick(dt, cam) { u.shift.value.x += dt * 0.0016; u.shift.value.y += dt * 0.0006; mesh.position.copy(cam.position); },
    dispose() { u.map.value.dispose(); mesh.geometry.dispose(); mat.dispose(); },
  };
}

/* ---------------- tráva
   Kde tráva rastie, povie pohľad zhora: zem sa raz vykreslí do malej textúry (trávnik svojou farbou, všetko ostatné čierne)
   a z nej sa číta poloha aj odtieň. Trsy stoja na pevných miestach sveta, sieť sa len dopĺňa okolo hosťa. */
function grassMask(renderer, scene, hide, box, N) {
  const rt = new THREE.WebGLRenderTarget(N, N, { depthBuffer: true }), w = box.x1 - box.x0, h = box.z1 - box.z0, cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, 600); cam.position.set(cx, 300, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld(true);
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, side: THREE.DoubleSide }), swapped = [], tmp = [], vis = hide.map((o) => o.visible);
  hide.forEach((o) => { o.visible = false; });
  scene.traverse((o) => {
    if (!o.isMesh) return; swapped.push([o, o.material]);
    const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
    if (o.userData.surf === 'grass' && !o.userData.noGrass && m0 && m0.color) { const m = new THREE.MeshBasicMaterial({ color: m0.color, fog: false, side: THREE.DoubleSide }); tmp.push(m); o.material = m; } else o.material = black;
  });
  const bg = scene.background, cc = new THREE.Color(), ca = renderer.getClearAlpha(), prev = renderer.getRenderTarget(); renderer.getClearColor(cc);
  scene.background = null; renderer.setClearColor(0x000000, 1); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
  const px = new Uint8Array(N * N * 4); renderer.readRenderTargetPixels(rt, 0, 0, N, N, px);
  renderer.setRenderTarget(prev); renderer.setClearColor(cc, ca); scene.background = bg;
  swapped.forEach(([o, m]) => { o.material = m; }); hide.forEach((o, i) => { o.visible = vis[i]; }); tmp.forEach((m) => m.dispose()); black.dispose(); rt.dispose();
  const ok = new Uint8Array(N * N);              // tráva len tam, kde je trávnik aj o bod vedľa: neprerastá cez okraj cesty
  const on = (i, j) => { if (i < 0 || j < 0 || i >= N || j >= N) return false; const k = (j * N + i) * 4; return px[k] + px[k + 1] + px[k + 2] > 12; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) ok[j * N + i] = on(i, j) && on(i - 1, j) && on(i + 1, j) && on(i, j - 1) && on(i, j + 1) ? 1 : 0;
  return { px, ok, N, box, w, h };
}
function tuftGeo() {
  const r = rng(5), pos = [], col = [], nor = [], idx = [], B = 6;
  for (let b = 0; b < B; b++) {
    const a = b / B * 6.28 + r() * 0.7, d = 0.04 + r() * 0.2, bx = Math.cos(a) * d, bz = Math.sin(a) * d, hgt = 0.05 + r() * 0.065, wd = 0.011 + r() * 0.008;
    const la = a + (r() - 0.5) * 1.6, lean = 0.02 + r() * 0.06, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean, sx = -Math.sin(la) * wd, sz = Math.cos(la) * wd, k = pos.length / 3, t = 0.9 + r() * 0.2;
    pos.push(bx - sx, 0, bz - sz, bx + sx, 0, bz + sz, bx + lx * 0.4 - sx * 0.75, hgt * 0.55, bz + lz * 0.4 - sz * 0.75, bx + lx * 0.4 + sx * 0.75, hgt * 0.55, bz + lz * 0.4 + sz * 0.75, bx + lx, hgt, bz + lz);
    [0.8, 0.8, 0.95, 0.95, 1.12].forEach((v) => { col.push(v * t, v * t, v * t * 0.94); nor.push(0, 1, 0); });
    idx.push(k, k + 1, k + 3, k, k + 3, k + 2, k + 2, k + 3, k + 4);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
}
const hash = (ix, iz, k) => { let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(k, 1274126177) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

export function makeGrass(renderer, scene, hide, box) {
  const mask = grassMask(renderer, scene, hide, box, 1024), CAP = 16000, geo = tuftGeo();
  const U = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uR: { value: 26 }, uFade: { value: 1 } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0 });   // rovnaký materiál ako zem: tráva má vždy jej svetlo a odtieň
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    // steblo je osvetlené ako zem pod ním (normála hore) z oboch strán: bez toho by rub stebla bol čierny
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;');
    sh.vertexShader = 'uniform float uTime, uR, uFade; uniform vec3 uCenter; attribute float aRank;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
      'vec3 transformed = vec3(position);',
      '#ifdef USE_INSTANCING',
      '  vec3 gp = instanceMatrix[3].xyz; float gl = uR * (1.0 - 0.72 * aRank), gd = distance(gp.xz, uCenter.xz);',     // každý trs má vlastnú hranicu: s odstupom tráva redne, nemizne naraz
      '  transformed.y *= (1.0 - smoothstep(gl * 0.7, gl, gd)) * uFade;',
      '  float gw = sin(uTime * 1.6 + gp.x * 0.7 + gp.z * 1.1) + 0.5 * sin(uTime * 2.7 + gp.z * 1.9);',
      '  transformed.x += gw * 0.16 * position.y; transformed.z += gw * 0.09 * position.y;',
      '#endif'].join('\n'));
  };
  const mesh = new THREE.InstancedMesh(geo, mat, CAP), rank = new Float32Array(CAP);
  geo.setAttribute('aRank', new THREE.InstancedBufferAttribute(rank, 1));
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); geo.attributes.aRank.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.raycast = () => {}; mesh.name = 'trava'; mesh.visible = false; scene.add(mesh);
  let q = 2, lx = 1e9, lz = 1e9, lq = -1; const QUAL = [null, { R: 15, cell: 0.42 }, { R: 22, cell: 0.3 }];
  function fill(cx, cz) {
    const { R, cell } = QUAL[q], M = mesh.instanceMatrix.array, C = mesh.instanceColor.array, { px, ok, N, w, h } = mask, RR = R + 3;
    const i0 = Math.floor((cx - RR) / cell), i1 = Math.ceil((cx + RR) / cell), j0 = Math.floor((cz - RR) / cell), j1 = Math.ceil((cz + RR) / cell); let n = 0;
    for (let iz = j0; iz <= j1 && n < CAP; iz++) for (let ix = i0; ix <= i1 && n < CAP; ix++) {
      const rk = hash(ix, iz, 1), x = (ix + hash(ix, iz, 2)) * cell, z = (iz + hash(ix, iz, 3)) * cell, d = Math.hypot(x - cx, z - cz);
      if (d > R * (1 - 0.72 * rk) + 3) continue;
      const mi = Math.floor((x - box.x0) / w * N), mj = Math.floor((box.z1 - z) / h * N); if (mi < 0 || mj < 0 || mi >= N || mj >= N || !ok[mj * N + mi]) continue;
      const a = hash(ix, iz, 4) * 6.283, s = 0.85 + hash(ix, iz, 5) * 0.6, sy = s * (0.8 + hash(ix, iz, 6) * 0.7), cs = Math.cos(a) * s, sn = Math.sin(a) * s, o = n * 16, k = (mj * N + mi) * 4, v = 0.74 + hash(ix, iz, 7) * 0.36;
      M[o] = cs; M[o + 1] = 0; M[o + 2] = -sn; M[o + 3] = 0; M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0; M[o + 8] = sn; M[o + 9] = 0; M[o + 10] = cs; M[o + 11] = 0; M[o + 12] = x; M[o + 13] = 0.012; M[o + 14] = z; M[o + 15] = 1;
      C[n * 3] = px[k] / 255 * v * 0.84; C[n * 3 + 1] = px[k + 1] / 255 * v * 0.9; C[n * 3 + 2] = px[k + 2] / 255 * v * 0.78; rank[n] = rk; n++;
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; geo.attributes.aRank.needsUpdate = true; lx = cx; lz = cz; lq = q; U.uR.value = R;
  }
  return {
    mesh,
    quality(v) { q = v; },
    /* cx, cz = miesto, okolo ktorého tráva rastie; dist = vzdialenosť kamery od neho (z výšky tráva nie je vidno a nekreslí sa) */
    update(cx, cz, dist, dt) {
      const fade = q ? 1 - sstep(38, 70, dist) : 0; mesh.visible = fade > 0.01; if (!mesh.visible) return false;
      U.uTime.value += dt; U.uFade.value = fade; U.uCenter.value.set(cx, 0, cz);
      if (lq !== q || Math.hypot(cx - lx, cz - lz) > 2.5) { fill(cx, cz); return true; }
      return false;
    },
    count: () => (mesh.visible ? mesh.count : 0),
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}

/* ---------------- strážca plynulosti: stupne od plnej kvality po úsporný režim
   pr = podiel rozlíšenia obrazovky, grass = hustota trávy (2 plná, 1 redšia, 0 žiadna) */
export const LEVELS = [{ pr: 1, grass: 2 }, { pr: 0.85, grass: 2 }, { pr: 0.72, grass: 2 }, { pr: 0.72, grass: 1 }, { pr: 0.6, grass: 1 }, { pr: 0.6, grass: 0 }, { pr: 0.5, grass: 0 }];
export function makeGovernor(start, apply) {
  let level = start, ema = 16.7, hold = 1500, good = 0, block = 0, wait = 20000, streak = 0, before = 0, frozen = 0, freeze = 60000, calm = 0;
  apply(LEVELS[level]);
  return {
    level: () => level,
    reset() { ema = 16.7; hold = 1500; good = 0; },          // po otvorení prehliadky alebo návrate na kartu: prvé snímky sa nepočítajú
    tick(ms) {                                               // ms = skutočný čas od predošlej snímky
      if (ms > 250) { hold = Math.max(hold, 600); return; }  // jednorazové zaseknutie (iná karta, načítanie) nie je dôvod uberať
      // do priemeru ide najviac 50 ms: jedna dlhá snímka (preklad shaderov, nová obloha) sama stupeň neuberie, trvalo pomalé áno
      ema += (Math.min(ms, 50) - ema) * 0.07; block -= ms; if ((hold -= ms) > 0) return;
      if ((frozen -= ms) > 0) return;
      if (ema > 23.5 && streak >= 2 && ema > before * 0.93) { level -= streak; apply(LEVELS[level]); streak = 0; frozen = freeze; freeze = Math.min(freeze * 2, 300000); hold = 1500; ema = 17; return; }   // dve ubratia nič nezrýchlili: brzdí niečo iné, kvalita sa vráti
      if (ema > 23.5 && level < LEVELS.length - 1) { if (!streak) before = ema; streak++; level++; apply(LEVELS[level]); hold = 1100; ema = 17; good = 0; calm = 0; block = wait; wait = Math.min(wait * 2, 300000); return; }   // pod ~43 snímok za sekundu
      good = ema < 17.6 ? good + ms : 0; calm = ema <= 23.5 ? calm + ms : 0; if (good > 1000 || calm > 3000) streak = 0;   // ubratie zabralo: neskoršie spomalenie sa posudzuje odznova
      if (good > 4000 && level > 0 && block <= 0) { level--; apply(LEVELS[level]); hold = 1500; ema = 16.7; good = 0; }
    },
  };
}
