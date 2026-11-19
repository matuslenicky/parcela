// Meranie plynulosti 3D prehliadky: node kempy/perf3d.js <slug> <out dir> [--phone] [--soft] [--hour=13]
// Otvorí kempy/<slug>/index.html vo vlastnom Chromiu (predvolene s grafickou kartou počítača, --soft = softvérové WebGL),
// v prehľade, priblížení a prechádzke odmeria snímky za sekundu, počet kreslení a trojuholníkov a uloží zábery.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright'));
const argv = process.argv.slice(2), pos = argv.filter((a) => !a.startsWith('--')), slug = pos[0], out = path.resolve(pos[1] || 'perf');
const phone = argv.includes('--phone'), soft = argv.includes('--soft'), dir = path.join(__dirname, slug);
const hour = (argv.find((a) => a.startsWith('--hour=')) || '').split('=')[1];
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  let browser, code = 0;
  try {
    const args = soft ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
    browser = await chromium.launch({ headless: true, args: args.concat(['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']) });
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1400, height: 860 } });
    const page = await ctx.newPage(), errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('exception: ' + e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    const t0 = Date.now();
    await page.click('#open3d');
    await page.waitForFunction(() => document.querySelector('.c3-stage canvas') && !document.querySelector('.c3-load'), null, { timeout: 180000 });
    const load = Date.now() - t0;
    const gpu = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'), e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'neznáma'; });
    console.log('grafika: ' + gpu + '\nnačítanie 3D: ' + load + ' ms');
    if (hour) await page.evaluate((h) => window.Camp3D.view.setHour(+h), hour);
    const measure = async (name) => {
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => new Promise((done) => {
        const ts = []; let n = 0; const t0 = performance.now();
        const f = (t) => { ts.push(t); if (t - t0 < 3000) requestAnimationFrame(f); else { const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b), s = window.Camp3D.view.state(); done({ fps: Math.round((ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000)), p95: Math.round(d[Math.floor(d.length * 0.95)] * 10) / 10, calls: s.calls, tris: s.tris, level: s.level, pr: s.pr, grass: s.grass }); } };
        requestAnimationFrame(f);
      }));
      console.log(name.padEnd(12) + ' ' + String(r.fps).padStart(4) + ' fps | 95 % snímok do ' + r.p95 + ' ms | kreslení ' + r.calls + ' | trojuholníkov ' + r.tris + ' | stupeň ' + r.level + ', rozlíšenie ×' + r.pr + ', trsov trávy ' + r.grass);
      try { await page.screenshot({ path: path.join(out, name + '.png'), timeout: 120000 }); } catch (e) { console.log('záber ' + name + ' sa nepodaril: ' + e.message.split('\n')[0]); }
      return r;
    };
    await measure('prehlad');
    for (let i = 0; i < 4; i++) { await page.click('.c3-zin'); await page.waitForTimeout(250); }
    await measure('blizko');
    await page.click('.c3-seg [data-mode="walk"]');
    await measure('prechadzka');
    if (await page.$('.c3-seg [data-mode="fly"]')) { await page.evaluate(() => window.Camp3D.view.flyAt(0.3)); await measure('prelet'); }
    if (errs.length) { console.log('chyby v konzole:\n' + errs.join('\n')); code = 1; }
  } catch (e) { console.error(e.message); code = 1; } finally { if (browser) await browser.close(); server.close(); process.exit(code); }
});
