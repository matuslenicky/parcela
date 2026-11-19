// Zostaví kempy/models/cars.json z overených rozmerov plánovača Pullmann (src/data/dims-cars.json) a z doplnkov v cars-extra.json.
//   node kempy/models/make-spec.js [cesta k dims-cars.json]
// Každé auto: rozmery výrobcu v mm + typ karosérie + farba. Zdroje rozmerov ostávajú v položke "src".
'use strict';
const fs = require('fs'), path = require('path');
const src = process.argv[2] || 'C:/Users/lenic/camping-pullmann/src/data/dims-cars.json';
const BODY = { small: 'small', hatch: 'hatch', sedan: 'sedan', kombi: 'kombi', suv: 'suv', mpv: 'mpv', pickup: 'pickup' };
const OVERRIDE = { model3: { body: 'lift' }, octavia: { body: 'lift' }, superb: { body: 'lift' } };          // liftbacky: zadné sklo plynule do kufra
const COLORS = ['#2f4a3c', '#c4601f', '#27384f', '#8d9399', '#7b1f24', '#e9e9e6', '#1d1f22', '#3f5f7a', '#b9b29f', '#56606a', '#a8402a', '#ddd6c6'];
// tvár podľa značky (prvé slovo názvu); FACES v car.py
const FACE = { vw: 'vw', 'škoda': 'skoda', kia: 'kia', hyundai: 'kia', toyota: 'toyota', fiat: 'fiat', tesla: 'tesla', dacia: 'dacia', bmw: 'bmw', audi: 'audi', mercedes: 'mercedes',
  'mercedes-benz': 'mercedes', ford: 'ford', peugeot: 'peugeot', 'citroën': 'peugeot', opel: 'vw', renault: 'renault', nissan: 'kia', volvo: 'volvo', mazda: 'mazda', seat: 'kia', suzuki: 'toyota',
  mitsubishi: 'ford', isuzu: 'ford', ram: 'audi', jeep: 'jeep', ssangyong: 'mercedes', kgm: 'mercedes' };
const face = (name) => FACE[name.split(/\s+/)[0].toLowerCase()] || 'vw';
const out = [];
// predný previs, ktorý výrobca nezverejňuje (Touran, Sharan, RAM 1500), je odhad z plánovača a v položke je označený foEst
const prov = fs.existsSync(path.join(path.dirname(src), 'provisional.json')) ? JSON.parse(fs.readFileSync(path.join(path.dirname(src), 'provisional.json'), 'utf8')) : {};
const add = (x, i) => {
  if (!BODY[x.cat]) return;
  if (x.cat === 'pickup' && !x.bed) { const f = (x.feat || []).map((t) => /^bed-length:(\d+)/.exec(t)).find(Boolean); x = Object.assign({}, x, { bed: f ? +f[1] : prov[x.id] && prov[x.id].bed ? Math.round(prov[x.id].bed * 1000) : undefined }); }
  if (!x.fo && prov[x.id] && prov[x.id].fo) x = Object.assign({}, x, { fo: Math.round(prov[x.id].fo * 1000), foEst: true });
  out.push(Object.assign({ id: x.id, name: x.name, cat: x.cat, body: BODY[x.cat], face: x.face || face(x.name), L: x.L, W: x.W, H: x.H, wb: x.wb, fo: x.fo, trackF: x.trackF, trackR: x.trackR, tyre: x.tyre,
    color: x.color || COLORS[i % COLORS.length], src: x.src }, OVERRIDE[x.id] || {}, x.p ? { p: x.p } : {}, x.foEst ? { foEst: true } : {}, x.bed ? { bed: x.bed } : {}));
};
Object.values(JSON.parse(fs.readFileSync(src, 'utf8'))).forEach(add);
const extra = path.join(__dirname, 'cars-extra.json');
if (fs.existsSync(extra)) JSON.parse(fs.readFileSync(extra, 'utf8')).forEach((x, i) => add(x, out.length + i));
const bad = out.filter((c) => !(c.L && c.W && c.H && c.wb && c.fo && c.tyre));
if (bad.length) { console.error('chýbajú rozmery: ' + bad.map((c) => c.id).join(', ')); process.exit(1); }
fs.writeFileSync(path.join(__dirname, 'cars.json'), JSON.stringify(out, null, 1));
const by = {}; out.forEach((c) => { (by[c.cat] = by[c.cat] || []).push(c.id); });
Object.keys(by).forEach((k) => console.log(k + ' (' + by[k].length + '): ' + by[k].join(', ')));
