// Snímky 3D prehliadky ukážkovej stránky kempu: node kempy/shot3d.js <slug> <out dir> [--phone] [--dark]
// Otvorí kempy/<slug>/index.html vo vlastnom headless Chromiu (softvérové WebGL), spustí prehliadku a uloží prehľad, priblíženie a prechádzku.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright'));
const argv = process.argv.slice(2), pos = argv.filter((a) => !a.startsWith('--')), slug = pos[0], out = path.resolve(pos[1] || 'shots');
const phone = argv.includes('--phone'), dark = argv.includes('--dark'), dir = path.join(__dirname, slug);
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  let browser, code = 0;
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1400, height: 860 } });
    const page = await ctx.newPage(), errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('exception: ' + e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/' + (dark ? '?theme=dark' : ''));
    await page.click('#open3d');
    await page.waitForFunction(() => document.querySelector('.c3-stage canvas') && !document.querySelector('.c3-load'), null, { timeout: 120000 });
    const shot = async (n) => { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(out, n + '.png') }); console.log(path.join(out, n + '.png')); };
    await shot('3d-prehlad');
    for (let i = 0; i < 4; i++) { await page.click('.c3-zin'); await page.waitForTimeout(350); }
    await shot('3d-blizko');
    await page.click('.c3-seg [data-mode="walk"]'); await page.waitForTimeout(1800);
    await shot('3d-prechadzka');
    if (errs.length) { console.log('chyby v konzole:\n' + errs.join('\n')); code = 1; }
  } catch (e) { console.error(e.message); code = 1; } finally { if (browser) await browser.close(); server.close(); process.exit(code); }
});
