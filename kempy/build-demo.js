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
const keep = ['name', 'place', 'pxPerM', 'extent', 'types', 'boundary', 'water', 'lakes', 'pools', 'roads', 'roundabouts', 'areas', 'buildings', 'parcels', 'trees', 'conifers', 'dates', 'taken', 'focusX', 'startV', 'person', 'elec', 'tax', 'hit'];
// texty stránky: kemp s chatkami alebo bez parciel si ich nastaví v camp.json, inak platia tieto
const TEXT = {
  H1: camp.headline || 'Takto by si hosť vybral parcelu vo vašom kempe',
  LEAD: camp.lead || 'Mapu som prekreslil z plánu areálu na vašom webe. Vyskúšajte si ju ako hosť: vyberte, s čím prídete, a kliknite na parcelu.',
  NOTE: camp.note || 'Rozloženie parciel je podľa plánu na vašom webe. Obsadenosť a ceny sú len na ukážku, v ostrej verzii by boli vaše.',
  LEAD3D: camp.lead3d || 'Z toho istého plánu som v Blenderi postavil model celého areálu. Hosť si ho môže pozrieť skôr, než príde, a vidí, kde jeho parcela leží.',
  ALT3D: camp.alt3d || `3D model areálu ${camp.name}: farebné parcely podľa veľkosti, cesty, budovy a stromy`,
};
// kemp s chatkami (bez očíslovaných parciel) hovorí o chatkách a miestach, nie o parcelách
const CABINS = Object.values(camp.types || {}).some((t) => t.unit === 'cabin');
Object.assign(TEXT, {
  NOTICE: camp.notice || `Ukážka návrhu pre ${camp.name}. Nie je to oficiálna stránka kempu: obsadenosť a ceny sú vymyslené a rezervácia sa nikam neodosiela.`,
  MAPOF: CABINS ? 'chatiek a miest' : 'parciel',
  STEP1: CABINS ? 'Mapu doladím podľa skutočného rozloženia chatiek a plôch a vášho cenníka.' : 'Mapu doladím podľa skutočných rozmerov parciel a vášho cenníka.',
  PICK: CABINS ? 'chatku alebo miesto' : 'parcelu',
  CREDIT: camp.credit || 'Zdroj rozloženia: plán areálu zverejnený na webe kempu.',
});
// 3D prehliadka: ak je pri kempe camp3d.js (node kempy/build-viewer.js <slug>), stránka dostane tlačidlo a dialóg
const HAS3D = fs.existsSync(path.join(dir, 'camp3d.js'));
const RAW = {
  TOUR_BTN: HAS3D ? (camp.view === 'top' ? '<p class="tour-go"><button type="button" class="btn btn-sign" id="open3d">Pozrieť kemp v 3D</button><span>Kemp vidíte zhora, otočíte si ho a priblížite. Po výbere parcely sa pohľad priblíži k nej a môžete si ju zariadiť.</span></p>' : '<p class="tour-go"><button type="button" class="btn btn-sign" id="open3d">Prejsť sa po kempe v 3D</button><span>Kemp si otočíte, priblížite a prejdete vo výške očí. Výber miesta ostáva rovnaký ako na mape.</span></p>') : '',
  TOUR_DLG: HAS3D ? `<dialog class="tour" id="tour" aria-label="3D prehliadka: ${esc0(camp.name)}"><div class="tour-bar"><strong>${esc0(camp.name)} v 3D</strong><button type="button" class="tour-x" id="tourX">Zavrieť</button></div><div id="tourHost"></div></dialog>` : '',
};
TEXT.CAP3D = HAS3D ? 'Model z Blendera podľa plánu areálu. Tlačidlom nad obrázkom ho otvoríte ako prehliadku priamo v prehliadači.' : 'Model z Blendera podľa plánu areálu. V ostrej verzii sa dá otáčať a prechádzať priamo na webe.';
function esc0(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
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
  .replace('{{RENDER}}', render)
  .replace(/\{\{(H1|LEAD3D|LEAD|NOTICE|NOTE|ALT3D|CAP3D|MAPOF|STEP1|PICK|CREDIT)\}\}/g, (m, k) => esc(TEXT[k]))
  .replace(/\{\{(TOUR_BTN|TOUR_DLG)\}\}/g, (m, k) => RAW[k]);
if (!render) html = html.replace(/<section class="sec" aria-labelledby="h3d">[\s\S]*?<\/section>/, '');
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log('wrote', path.join(dir, 'index.html'), Math.round(html.length / 1024) + ' kB');
