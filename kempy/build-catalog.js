// Katalóg modelov pre „izbu parcely“ v 3D prehliadke: node kempy/build-catalog.js [--skip-blender] [--only id,id]
//   1. Blender postaví chýbajúce modely do kempy/models/out (autá car.py, karavany a obytné autá camper.py, vybavenie gear.py)
//   2. náhľady (kempy/katalog/t/<id>.webp) a skutočné obrysy modelov vykreslí kempy/models/preview.js
//   3. každý model sa zbalí (meshopt) do kempy/katalog/m/<id>.js; prehliadka ho načíta až keď si ho hosť vyberie.
//      Je to skript, nie .glb, aby sa dal načítať aj zo stránky otvorenej z disku (file://).
//   4. kempy/viewer/catalog.json = zoznam pre prehliadku (názov, rozmery, obrys, kam sa dá pripojiť)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const here = __dirname, M = path.join(here, 'models'), OUT = path.join(M, 'out'), KAT = path.join(here, 'katalog');
const argv = process.argv.slice(2), ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const read = (f) => JSON.parse(fs.readFileSync(path.join(M, f), 'utf8'));
const cars = read('cars.json'), campers = read('campers.json'), gear = read('gear.json');
for (const d of [OUT, path.join(KAT, 'm'), path.join(KAT, 't')]) fs.mkdirSync(d, { recursive: true });

const TAB = { small: ['auto', 'Malé'], hatch: ['auto', 'Hatchback'], sedan: ['auto', 'Sedan'], kombi: ['auto', 'Kombi'], suv: ['auto', 'SUV'], mpv: ['auto', 'MPV'], pickup: ['auto', 'Pick-up'],
  van: ['auto', 'Dodávka'], minibus: ['auto', 'Dodávka'], caravan: ['obytne', 'Karavan'], motorhome: ['obytne', 'Obytné auto'], campervan: ['obytne', 'Obytná dodávka'],
  tent23: ['stan', 'Stan pre 2 – 3'], tentfam: ['stan', 'Rodinný stan'], rooftent: ['stan', 'Strešný stan'],
  awning: ['pristresok', 'Markíza'], awningtent: ['pristresok', 'Predstan'], gazebo: ['pristresok', 'Altánok'], tarp: ['pristresok', 'Plachta'],
  tableset: ['vybava', 'Stôl'], grill: ['vybava', 'Gril'], bike: ['vybava', 'Bicykel'], relax: ['vybava', 'Oddych'], pool: ['vybava', 'Bazén'] };
const NAME = { caddy: 'VW Caddy Cargo', transporter: 'VW Transporter T6.1', sprinter: 'Mercedes Sprinter, dlhý', transitbus: 'Ford Transit minibus', sprintertransfer: 'Mercedes Sprinter Transfer 45',
  sprintercity: 'Mercedes Sprinter City 75', california: 'VW California 6.1 Ocean', summit600: 'Pössl Summit 600', boxstar630: 'Knaus BoxStar 630', sunlightt58: 'Sunlight T 58', caradoa464: 'Carado A 464',
  hymerbml890: 'Hymer B-Klasse ML I 890', troll530: 'Eriba Touring 530', hobby495: 'Hobby De Luxe 495 UL', hobby720: 'Hobby Prestige 720',
  q2seconds: 'Quechua 2 Seconds, 2 osoby', darwin3: 'Coleman Darwin 3', bizon3: 'Husky Bizon 3', arpenaz41: 'Quechua Arpenaz 4.1', vail4: 'Coleman Vail 4', tent6: 'Coleman Vail 6',
  foothill: 'Thule Tepui Foothill, 2 osoby', kukenam3: 'Thule Tepui Kukenam 3', skycamp: 'iKamper Skycamp 3.0', f45s260: 'Fiamma F45s 260', f45s350: 'Fiamma F45s 350', f45s450: 'Fiamma F45s 450',
  rally260: 'Dometic Rally AIR Pro 260', rally330: 'Dometic Rally AIR Pro 330', rally390: 'Dometic Rally AIR Pro 390', eventm: 'Coleman Event Shelter 3 × 3 m', eventl: 'Coleman Event Shelter 3,65 m',
  eventxl: 'Coleman Event Shelter 4,5 m', set2: 'Stôl a 2 stoličky', set4: 'Stôl a 4 stoličky', set6: 'Stôl a 6 stoličiek', goanywhere: 'Weber Go-Anywhere', mastertouch: 'Weber Master-Touch 57 cm',
  spirit310: 'Plynový Weber Spirit II', bike20: 'Detský bicykel 20″', bike29: 'Horský bicykel 29″', cargobike: 'Nákladný bicykel', intex183: 'Intex Easy Set 1,83 m', intex244: 'Intex Easy Set 2,44 m',
  intex305: 'Intex Easy Set 3,05 m', lounger: 'Ležadlo', loungers2: 'Dve ležadlá so stolíkom', hammock: 'Hojdacia sieť so stojanom', tarp3: 'Plachta 3 × 3 m', tarp4: 'Plachta 4 × 3 m' };
// prístrešky nebránia nábytku pod sebou; nízke veci (stôl, gril, ležadlo) môžu stáť pod prístreškom
const CLS = { awning: 'cover', gazebo: 'cover', tarp: 'cover', awningtent: 'cover', tableset: 'low', grill: 'low', bike: 'low', relax: 'low' };
const all = [].concat(cars.map((c) => Object.assign({ gen: 'car' }, c)), campers.map((c) => Object.assign({ gen: 'camper' }, c)), gear.map((c) => Object.assign({ gen: 'gear' }, c)))
  .filter((c) => TAB[c.cat] && (!ONLY || ONLY.includes(c.id)));

/* 1. Blender */
if (!argv.includes('--skip-blender')) {
  for (const gen of ['car', 'camper', 'gear']) {
    const miss = all.filter((c) => c.gen === gen && (argv.includes('--force') || !fs.existsSync(path.join(OUT, c.id + '.glb')))).map((c) => c.id);
    if (!miss.length) continue;
    console.log(gen + ': staviam ' + miss.length + ' modelov');
    const spec = path.join(M, gen === 'car' ? 'cars.json' : gen === 'camper' ? 'campers.json' : 'gear.json');
    const r = cp.spawnSync(BLENDER, ['-b', '--factory-startup', '-P', path.join(M, gen + '.py'), '--', spec, OUT, '--only', miss.join(',')].concat(gen === 'gear' ? ['--bare'] : []), { encoding: 'utf8', maxBuffer: 1 << 28 });
    const bad = (r.stdout + r.stderr).split('\n').filter((l) => /Error|Traceback|File "/.test(l));
    if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  }
}
const missing = all.filter((c) => !fs.existsSync(path.join(OUT, c.id + '.glb'))).map((c) => c.id);
if (missing.length) { console.error('chýbajú modely: ' + missing.join(', ')); process.exit(1); }

/* 2. náhľady a obrysy (po dávkach, softvérové WebGL má málo pamäte) */
const TW = 320, TH = 220, boxes = {}, tmp = path.join(OUT, '_kat'); fs.mkdirSync(tmp, { recursive: true });
for (let i = 0; i < all.length; i += 20) {
  const part = all.slice(i, i + 20), sheet = path.join(tmp, 'sheet' + i + '.png'), js = path.join(tmp, 'box' + i + '.json');
  cp.execFileSync(process.execPath, [path.join(M, 'preview.js'), sheet].concat(part.map((c) => path.join(OUT, c.id + '.glb')), ['--views=hi34', '--cols=1', '--tile=' + TW + 'x' + TH, '--bg=#e9eeea', '--ground=#e9eeea', '--nolabel', '--json=' + js]), { stdio: ['ignore', 'ignore', 'inherit'] });
  JSON.parse(fs.readFileSync(js, 'utf8')).forEach((s) => { boxes[s.name] = s; });
  cp.execFileSync('python', ['-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert("RGB")\nfor k, n in enumerate(sys.argv[4:]):\n    im.crop((0, k * int(sys.argv[3]), int(sys.argv[2]), (k + 1) * int(sys.argv[3]))).save(n, "WEBP", quality=82, method=6)',
    sheet, String(TW), String(TH)].concat(part.map((c) => path.join(KAT, 't', c.id + '.webp'))));
  console.log('náhľady ' + Math.min(i + 20, all.length) + ' / ' + all.length);
}

/* 3. zbalené modely */
const cli = path.join(here, '..', 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js'); let bytes = 0;
all.forEach((c, k) => {
  const src = path.join(OUT, c.id + '.glb'), min = path.join(tmp, c.id + '.min.glb'), dst = path.join(KAT, 'm', c.id + '.js');
  if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) {
    cp.execFileSync(process.execPath, [cli, 'meshopt', src, min], { stdio: 'ignore' });
    fs.writeFileSync(dst, 'Camp3D.model(' + JSON.stringify(c.id) + ',"' + fs.readFileSync(min).toString('base64') + '");\n');
  }
  bytes += fs.statSync(dst).size;
  if ((k + 1) % 20 === 0) console.log('modely ' + (k + 1) + ' / ' + all.length);
});

/* 4. zoznam pre prehliadku */
const r2 = (v) => Math.round(v * 100) / 100;
const cat = all.map((c) => {
  const b = boxes[c.id].box, [tab, sub] = TAB[c.cat], p = c.parts || {};
  const e = { id: c.id, tab, sub, cat: c.cat, n: NAME[c.id] || c.name.replace(/\s*\(.*$/, '').replace(/\s+5-door$/, ''),
    L: r2((c.Ltotal || c.L) / 1000), W: r2(c.W / 1000), H: c.H ? r2(c.H / 1000) : r2(b[4]),
    box: [r2(b[0]), r2(b[2]), r2(b[3]), r2(b[5])] };                     // obrys modelu na zemi: min x, min z, max x, max z (x = dopredu, z = doprava)
  if (CLS[c.cat]) e.cls = CLS[c.cat];
  if (c.gen === 'car') e.paint = c.color;
  if (c.gen !== 'gear') e.host = c.cat === 'caravan' || c.cat === 'motorhome' ? 'side' : c.gen === 'car' ? 'roof' : 'both';   // čo sa dá pripojiť: markíza na bok, strešný stan na strechu
  if (c.cat === 'caravan') e.Lb = r2(c.Lbody / 1000);
  if (c.cat === 'awning' || c.cat === 'awningtent') { e.att = 'side'; e.z0 = c.cat === 'awning' ? 2.35 : 2.45; e.box = [r2(-c.L / 2000), 0, r2(c.L / 2000), r2(c.W / 1000)]; }
  if (c.cat === 'rooftent') { e.att = 'roof'; e.fx = (p.openL || 0) > (p.closedL || 1e9) * 1.3; e.cw = r2((p.closedW || c.W * .6) / 1000); e.box = [r2(-c.L / 2000), r2(-c.W / 2000), r2(c.L / 2000), r2(c.W / 2000)]; }
  return e;
});
if (!ONLY) fs.writeFileSync(path.join(here, 'viewer', 'catalog.json'), JSON.stringify(cat));
console.log('katalóg: ' + cat.length + ' položiek, modely spolu ' + (bytes / 1048576).toFixed(1) + ' MB' + (ONLY ? ' (čiastočný beh, catalog.json sa neprepísal)' : ''));
