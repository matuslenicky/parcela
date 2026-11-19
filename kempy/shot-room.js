// Skúška a snímky „izby parcely“: node kempy/shot-room.js <slug> <out dir> [--phone] [--dark] [--parcel=ID] [--items=kodiaq,hobby495,…]
// Otvorí kempy/<slug>/index.html vo vlastnom headless Chromiu (softvérové WebGL), v prehliadke vyberie voľnú parcelu, vojde do izby,
// pridá veci z katalógu cez skutočné tlačidlá, jednu posunie myšou a uloží snímky. Skončí chybou, ak je v konzole chyba.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright'));
const argv = process.argv.slice(2), pos = argv.filter((a) => !a.startsWith('--')), slug = pos[0], out = path.resolve(pos[1] || 'shots');
const flag = (n, d) => { const a = argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const phone = argv.includes('--phone'), dark = argv.includes('--dark'), root = __dirname;
const want = flag('items', 'kodiaq,hobby495,f45s350,set4,mastertouch,bike29').split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  let browser, code = 0;
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1400, height: 860 } });
    const page = await ctx.newPage(), errs = []; page.setDefaultTimeout(120000);   // softvérové WebGL je pri veľkom kempe pomalé
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('exception: ' + e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/' + slug + '/index.html' + (dark ? '?theme=dark' : ''));
    await page.click('#open3d');
    await page.waitForFunction(() => document.querySelector('.c3-stage canvas') && !document.querySelector('.c3-load'), null, { timeout: 120000 });
    const shot = async (n) => { await page.waitForTimeout(1600); await page.screenshot({ path: path.join(out, n + '.png'), timeout: 180000 }); console.log(path.join(out, n + '.png')); };
    // voľná parcela: zadaná, alebo prvá, pri ktorej karta ponúkne „Zariadiť parcelu“
    const ids = flag('parcel', '') ? [flag('parcel', '')] : await page.$$eval('.c3-go option', (o) => o.map((x) => x.value).filter(Boolean));
    let picked = null;
    for (const id of ids) { await page.selectOption('.c3-go select', id); await page.waitForTimeout(150); if (await page.isVisible('.c3-fit')) { picked = id; break; } }
    if (!picked) throw new Error('žiadna voľná parcela s tlačidlom Zariadiť parcelu');
    await shot('izba-0-karta');
    await page.click('.c3-fit'); await page.waitForSelector('.c3r:not([hidden])');
    await shot('izba-1-prazdna');
    const cat = JSON.parse(fs.readFileSync(path.join(root, 'viewer', 'catalog.json'), 'utf8')), TAB = { auto: 'Autá', obytne: 'Karavany a obytné autá', stan: 'Stany', pristresok: 'Prístrešky', vybava: 'Vybavenie' };
    for (const id of want) {
      const e = cat.find((x) => x.id === id); if (!e) throw new Error('v katalógu nie je ' + id);
      await page.click('.c3r-tabs button:has-text("' + TAB[e.tab] + '")');
      if (await page.isVisible('.c3r-subs')) await page.click('.c3r-subs button[data-s="' + e.sub + '"]');
      await page.click('.c3r-card[data-id="' + id + '"]');
      await page.waitForFunction((n) => document.querySelectorAll('.c3r-tabs [data-t="kit"]')[0].textContent.includes('(' + n + ')'), want.indexOf(id) + 1, { timeout: 30000 }).catch(() => { throw new Error('vec sa nepridala: ' + id + ' / ' + (errs.join(' | ') || 'bez chyby v konzole')); });
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(2500);
    await shot('izba-2-zostava');
    await page.click('.c3r-tabs [data-t="kit"]');
    await shot('izba-3-zoznam');
    console.log('stav: ' + await page.$eval('.c3r-done', (b) => b.textContent) + ' | ' + await page.$eval('.c3r-title span', (b) => b.textContent));
    console.log(await page.$$eval('.c3r-cards.kit li', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join('\n')));
    // ovládanie: vec sa chytí myšou a posunie, tlačidlom otočí, košom odstráni; Hotovo zavrie prehliadku a stránka ukáže zostavu
    const st = () => page.evaluate(() => window.Camp3D.view.state().room), fail = (m) => { console.log('ZLYHALO: ' + m); code = 1; };
    const n0 = (await st()).items.length; const all0 = (await st()).items, top = all0.findIndex((i) => !i.host && !all0.some((c) => c.host === i.id));   // vec bez pripojenej markízy: tá by ju z niektorých uhlov prekryla
    if (!phone) {
      const a = (await st()).items[top], [sx, sy] = await page.evaluate((i) => window.Camp3D.view.room.screenOf(i), top);
      await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 30, sy + 10, { steps: 4 }); await page.mouse.move(sx + 70, sy + 24, { steps: 6 }); await page.mouse.up();
      const b = (await st()).items[top];
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.3) fail('ťahanie myšou vec neposunulo (' + a.x + ',' + a.z + ' -> ' + b.x + ',' + b.z + ')'); else console.log('ťahanie: ' + a.id + ' posunuté o ' + Math.hypot(b.x - a.x, b.z - a.z).toFixed(2) + ' m' + (b.bad ? ' (' + b.bad + ')' : ''));
      await page.click('.c3r-acts [data-a="rotr"]'); const c = (await st()).items[top];
      if (Math.abs(c.rot - b.rot) < 0.2) fail('otočenie nezmenilo uhol'); else console.log('otočenie: ' + ((c.rot - b.rot) * 180 / Math.PI).toFixed(0) + '°');
      await shot('izba-4-po-posune');
      await page.keyboard.press('Control+z').catch(() => {});
    }
    await page.click('.c3r-tabs [data-t="kit"]'); await page.click('.c3r-cards.kit li:last-child .c3r-rm');
    if ((await st()).items.length !== n0 - 1) fail('odstránenie zo zoznamu nezmenilo počet vecí');
    if ((await page.getAttribute('.c3r-done', 'aria-disabled')) === 'true') { console.log('zostava sa po posune nezmestí, vraciam sa do kempu'); await page.click('.c3r-back'); await page.waitForSelector('.c3r', { state: 'hidden' }); if (!(await page.isVisible('.c3-card'))) fail('po návrate do kempu chýba karta parcely'); }
    else { await page.click('.c3r-done'); await page.waitForFunction(() => !document.getElementById('tour').open, null, { timeout: 5000 }).catch(() => fail('Hotovo nezavrelo prehliadku'));
      const t = await page.$eval('#panel', (p) => p.innerText.replace(/\s+/g, ' ')); if (!/Vaša zostava/.test(t)) fail('panel stránky neukazuje zostavu: ' + t.slice(0, 160)); else console.log('panel: ' + t.slice(0, 230)); await shot('izba-5-panel'); }
    if (errs.length) { console.log('chyby v konzole:\n' + errs.join('\n')); code = 1; }
  } catch (e) { console.error(e.message); code = 1; } finally { if (browser) await browser.close(); server.close(); process.exit(code); }
});
