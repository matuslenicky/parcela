// Zábery prehliadky v rôznu dennú dobu: node kempy/shot-sun.js <slug> <out dir> [--walk] [--fly=0.3 (miesto na trase preletu, 0 – 1)] [hodiny, napr. 8,13,19]
// Vypíše aj výšku a azimut slnka, aby sa dali porovnať s tabuľkami (azimut od severu v smere hodinových ručičiek).
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright'));
const argv = process.argv.slice(2), pos = argv.filter((a) => !a.startsWith('--')), slug = pos[0], out = path.resolve(pos[1] || 'shots'), hours = (pos[2] || '8,13,19').split(',').map(Number), root = __dirname;
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  let browser, code = 0;
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage(), errs = []; page.setDefaultTimeout(180000);
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push('exception: ' + e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/' + slug + '/index.html');
    await page.click('#open3d');
    await page.waitForFunction(() => document.querySelector('.c3-stage canvas') && !document.querySelector('.c3-load'));
    const flyT = (argv.find((a) => a.startsWith('--fly=')) || '').slice(6);
    if (flyT) {                          // prelet sa musí sám hýbať: poloha po troch sekundách je inde
      await page.evaluate((t) => window.Camp3D.view.flyAt(t), +flyT); await page.waitForTimeout(600);
      const a = await page.evaluate(() => window.Camp3D.view.state().walk); await page.waitForTimeout(3000); const b = await page.evaluate(() => window.Camp3D.view.state().walk), moved = Math.hypot(b.x - a.x, b.z - a.z);
      console.log('prelet: za 3 s posun o ' + moved.toFixed(1) + ' m, beží: ' + await page.evaluate(() => window.Camp3D.view.flying())); if (moved < 0.3) code = 1;
    }
    else if (argv.includes('--walk')) { await page.click('.c3-seg [data-mode="walk"]'); await page.waitForTimeout(1500); }
    else { const z = +((argv.find((x) => x.startsWith('--zoom=')) || '').slice(7) || 2), at = (argv.find((x) => x.startsWith('--at=')) || '').slice(5); if (at) { await page.selectOption('.c3-go select', at); await page.waitForTimeout(1600); } for (let i = 0; i < z; i++) { await page.click('.c3-zin'); await page.waitForTimeout(300); } }
    for (const h of hours) {
      await page.evaluate((x) => window.Camp3D.view.setHour(x), h); await page.waitForTimeout(2200);
      const f = path.join(out, 'slnko-' + String(h).replace('.', '_') + '.png'); await page.screenshot({ path: f, timeout: 180000 });
      console.log(f + '  ' + JSON.stringify(await page.evaluate(() => window.Camp3D.view.sun())));
    }
    if (errs.length) { console.log('chyby v konzole:\n' + errs.join('\n')); code = 1; }
  } catch (e) { console.error(e.message); code = 1; } finally { if (browser) await browser.close(); server.close(); process.exit(code); }
});
