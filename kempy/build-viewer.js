// Zbalí 3D prehliadku kempu: node kempy/build-viewer.js <slug>
// kempy/viewer/main.js + three.js + kempy/<slug>/camp.glb (z Blendera, build_camp.py) + camp.json -> kempy/<slug>/camp3d.js.
// Ukážková stránka (build-demo.js) ju načíta až po kliknutí na „Prejsť sa po kempe v 3D“; funguje aj z disku (file://).
const path = require('path'), fs = require('fs'), esbuild = require('esbuild');
const slug = process.argv[2];
if (!slug) { console.error('usage: node kempy/build-viewer.js <slug>'); process.exit(1); }
const dir = path.join(__dirname, slug), glb = path.join(dir, 'camp.glb'), min = path.join(dir, 'camp.min.glb'), json = path.join(dir, 'camp.json'), out = path.join(dir, 'camp3d.js');
for (const f of [glb, json]) if (!fs.existsSync(f)) { console.error('chýba ' + f + ' (najprv Blender: build_camp.py)'); process.exit(1); }
// zmenšenie exportu z Blendera (meshopt: kvantizácia a zabalenie), three.js ho rozbalí cez MeshoptDecoder
if (!fs.existsSync(min) || fs.statSync(min).mtimeMs < fs.statSync(glb).mtimeMs) {
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js'), 'meshopt', glb, min], { stdio: 'inherit' });
}
// do prehliadky ide z camp.json len to, čo potrebuje
const camp = JSON.parse(fs.readFileSync(json, 'utf8')), slim = {};
for (const k of ['name', 'pxPerM', 'origin', 'extent', 'boundary', 'types', 'parcels', 'buildings', 'props', 'boxes', 'trees', 'shrubs', 'areas', 'pools', 'roads', 'roundabouts', 'water', 'columns', 'strips', 'fences', 'signs', 'saplings', 'catalogBase', 'sun', 'tour', 'parcelStyle', 'things', 'hookups', 'lamps', 'view']) if (camp[k] !== undefined) slim[k] = camp[k];
// rozmery vozidiel z katalógu modelov (prekážky pri prechádzke); ktorý model kde stojí, zapísal build_camp.py do props.models.json
const cat = {}; for (const f of ['cars.json', 'campers.json', 'gear.json']) JSON.parse(fs.readFileSync(path.join(__dirname, 'models', f), 'utf8')).forEach((m) => { cat[m.id] = m; });
const pm = path.join(dir, 'props.models.json'), placed = fs.existsSync(pm) ? JSON.parse(fs.readFileSync(pm, 'utf8')) : [];
(slim.props || []).forEach((p, i) => { const m = cat[p.model || (placed[i] && placed[i].model)]; if (m) p.dims = [(m.Ltotal || m.L) / 1000, m.W / 1000]; });
const tmp = path.join(dir, 'camp.viewer.json'); fs.writeFileSync(tmp, JSON.stringify(slim));
esbuild.build({
  entryPoints: [path.join(__dirname, 'viewer', 'main.js')], bundle: true, minify: true, format: 'iife', target: ['es2020'],
  loader: { '.glb': 'binary' }, outfile: out, legalComments: 'none', charset: 'utf8',
  plugins: [{ name: 'camp', setup(b) { b.onResolve({ filter: /^camp-(glb|json)$/ }, (a) => ({ path: a.path === 'camp-glb' ? min : tmp })); } }],
  banner: { js: '/* 3D prehliadka kempu (Parcela). three.js (MIT, mrdoob a prispievatelia). */' },
}).then(() => {
  fs.unlinkSync(tmp);
  const s = fs.readFileSync(out, 'utf8');
  if (/<\/script/i.test(s)) { console.error('balík obsahuje uzatváraciu značku script'); process.exit(1); }
  console.log('camp3d.js', Math.round(s.length / 1024) + ' kB (model ' + Math.round(fs.statSync(min).size / 1024) + ' kB)');
}).catch((e) => { console.error(e.message); process.exit(1); });
