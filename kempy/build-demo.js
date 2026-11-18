// Builds the sales demo page for one camp: node kempy/build-demo.js <slug>
// Reads kempy/<slug>/camp.json and render_3d.jpg, writes kempy/<slug>/index.html (one file, works offline except the web font).
const fs = require('fs');
const path = require('path');

const slug = process.argv[2];
if (!slug) { console.error('usage: node kempy/build-demo.js <slug>'); process.exit(1); }
const dir = path.join(__dirname, slug);
const camp = JSON.parse(fs.readFileSync(path.join(dir, 'camp.json'), 'utf8'));
const tpl = fs.readFileSync(path.join(__dirname, 'demo-template.html'), 'utf8');
const SITE = 'https://matuslenicky.github.io/parcela/';

// only what the page needs goes into the page
const keep = ['name', 'place', 'pxPerM', 'extent', 'types', 'boundary', 'water', 'roads', 'roundabouts', 'areas', 'buildings', 'parcels', 'trees', 'conifers', 'dates', 'taken', 'focusX'];
const data = {};
for (const k of keep) if (camp[k] !== undefined) data[k] = camp[k];

const jpg = path.join(dir, 'render_3d.jpg');
const render = fs.existsSync(jpg) ? 'data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64') : '';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let html = tpl
  .replace('/*CAMP_DATA*/null', JSON.stringify(data).replace(/</g, '\\u003c'))
  .replace(/\{\{NAME\}\}/g, esc(camp.name))
  .replace(/\{\{PLACE\}\}/g, esc(camp.place || ''))
  .replace(/\{\{SITE\}\}/g, SITE)
  .replace('{{RENDER}}', render);
if (!render) html = html.replace(/<section class="sec" aria-labelledby="h3d">[\s\S]*?<\/section>/, '');
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log('wrote', path.join(dir, 'index.html'), Math.round(html.length / 1024) + ' kB');
