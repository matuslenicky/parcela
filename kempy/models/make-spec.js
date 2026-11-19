// Zostaví kempy/models/cars.json z overených rozmerov plánovača Pullmann (src/data/dims-cars.json) a z doplnkov v cars-extra.json.
//   node kempy/models/make-spec.js [cesta k dims-cars.json]
// Každé auto: rozmery výrobcu v mm + typ karosérie + farba. Zdroje rozmerov ostávajú v položke "src".
'use strict';
const fs = require('fs'), path = require('path');
const src = process.argv[2] || 'C:/Users/lenic/camping-pullmann/src/data/dims-cars.json';
const BODY = { small: 'small', hatch: 'hatch', sedan: 'sedan', kombi: 'kombi', suv: 'suv', mpv: 'mpv', pickup: 'pickup' };
const OVERRIDE = { model3: { body: 'lift' }, octavia: { body: 'lift' }, superb: { body: 'lift' }, arteon: { body: 'lift' } };          // liftbacky: zadné sklo plynule do kufra
const COLORS = ['#2f4a3c', '#c4601f', '#27384f', '#8d9399', '#7b1f24', '#e9e9e6', '#1d1f22', '#3f5f7a', '#b9b29f', '#56606a', '#a8402a', '#ddd6c6'];
// tvár podľa značky (prvé slovo názvu); FACES v car.py
const FACE = { vw: 'vw', volkswagen: 'vw', 'ssangyong/kgm': 'mercedes', 'škoda': 'skoda', kia: 'kia', hyundai: 'kia', toyota: 'toyota', fiat: 'fiat', tesla: 'tesla', dacia: 'dacia', bmw: 'bmw', audi: 'audi', mercedes: 'mercedes',
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
    color: x.color || COLORS[i % COLORS.length], src: x.src }, OVERRIDE[x.id] || {}, x.p ? { p: x.p } : {}, x.foEst ? { foEst: true } : {}, x.conf ? { conf: x.conf } : {}, x.bed ? { bed: x.bed } : {}));
};
Object.values(JSON.parse(fs.readFileSync(src, 'utf8'))).forEach(add);
// doplnené autá: kempy/models/research/*.json (rozmery dohľadané zo zdrojov uvedených pri každom aute); bez predného previsu sa auto nedá postaviť
const rdir = path.join(__dirname, 'research'), RENAME = { caddy: 'caddylife' }, skipped = [], nofo = [];
if (fs.existsSync(rdir)) fs.readdirSync(rdir).filter((f) => f.endsWith('.json')).sort().forEach((f) => JSON.parse(fs.readFileSync(path.join(rdir, f), 'utf8')).forEach((x) => {
  x = Object.assign({}, x, { id: RENAME[x.id] || x.id });
  if (out.some((c) => c.id === x.id)) return;
  if (!(x.L && x.W && x.H && x.wb && x.tyre)) { skipped.push(x.id); return; }
  if (!x.fo) { nofo.push(x); return; }
  add(x, out.length);
}));
// Výrobca neuvádza rozdelenie previsov (dĺžka aj rázvor sú oficiálne): predný previs sa dopočíta podielom, aký majú autá tej istej kategórie
// so známymi údajmi (medián fo / (L − rázvor)). Položka má foEst: true; poloha náprav môže byť o pár centimetrov inde, vonkajšie rozmery sú presné.
nofo.forEach((x) => {
  const sh = out.filter((c) => c.cat === x.cat && !c.foEst).map((c) => c.fo / (c.L - c.wb)).sort((a, b) => a - b);
  if (!sh.length) { skipped.push(x.id); return; }
  add(Object.assign({}, x, { fo: Math.round((x.L - x.wb) * sh[Math.floor(sh.length / 2)]), foEst: true }), out.length);
});
if (nofo.length) console.log('predný previs dopočítaný (foEst): ' + nofo.map((x) => x.id).join(', '));
if (skipped.length) console.log('vynechané (chýba rozmer): ' + skipped.join(', '));
const bad = out.filter((c) => !(c.L && c.W && c.H && c.wb && c.fo && c.tyre));
if (bad.length) { console.error('chýbajú rozmery: ' + bad.map((c) => c.id).join(', ')); process.exit(1); }
fs.writeFileSync(path.join(__dirname, 'cars.json'), JSON.stringify(out, null, 1));
// karavany, dodávky, obytné dodávky a obytné autá (dims-vans.json): rozmery bez úprav, predný previs z odhadu len tam, kde ho výrobca neuvádza
const vsrc = path.join(path.dirname(src), 'dims-vans.json');
if (fs.existsSync(vsrc)) {
  const keep = ['caravan', 'campervan', 'motorhome', 'van', 'minibus'], vans = [];
  Object.values(JSON.parse(fs.readFileSync(vsrc, 'utf8'))).forEach((x) => {
    if (!keep.includes(x.cat)) return;
    const y = Object.assign({}, x); delete y.note;
    if (x.cat !== 'caravan' && !y.fo && prov[x.id] && prov[x.id].fo) { y.fo = Math.round(prov[x.id].fo * 1000); y.foEst = true; }
    if (x.cat === 'caravan' ? y.Ltotal && y.Lbody : y.L && y.wb && y.fo) vans.push(y); else console.error('vynechané (chýba rozmer): ' + x.id);
  });
  fs.writeFileSync(path.join(__dirname, 'campers.json'), JSON.stringify(vans, null, 1));
  console.log('campers.json: ' + vans.map((v) => v.id).join(', '));
}
// kempingové vybavenie (stany, altánky, markízy, stoly): dims-gear.json bez úprav
const gsrc = path.join(path.dirname(src), 'dims-gear.json');
if (fs.existsSync(gsrc)) {
  const gear = Object.values(JSON.parse(fs.readFileSync(gsrc, 'utf8'))).filter((x) => ['tent23', 'tentfam', 'gazebo', 'awning', 'tableset'].includes(x.cat)).map((x) => { const y = Object.assign({}, x); delete y.note; return y; });
  fs.writeFileSync(path.join(__dirname, 'gear.json'), JSON.stringify(gear, null, 1));
  console.log('gear.json: ' + gear.map((v) => v.id).join(', '));
}
const by = {}; out.forEach((c) => { (by[c.cat] = by[c.cat] || []).push(c.id); });
Object.keys(by).forEach((k) => console.log(k + ' (' + by[k].length + '): ' + by[k].join(', ')));
