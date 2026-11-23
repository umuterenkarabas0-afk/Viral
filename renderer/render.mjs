#!/usr/bin/env node
// Headless Chromium ile deterministik kare render'ı.
//   node renderer/render.mjs --timeline output/x/timeline.json --frames output/x/frames [--workers 3]
//   node renderer/render.mjs --timeline ... --stills 1.2,7.5 --out-dir output/x/stills
// Kareler JPEG olarak yazılır; mevcut kareler atlanır (kaldığı yerden devam).
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; o[k] = v; }
  }
  return o;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve(root) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const p = path.normalize(path.join(root, u));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function openPage(port, timeline, gpu, opts = {}) {
  const flags = gpu ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args: [...flags, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--font-render-hinting=none', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.includes('INIT') ) errors.push(t); if (process.env.RENDER_DEBUG) console.log('[page]', t); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(([tl, ro]) => { window.__TIMELINE__ = tl; window.__RENDER_OPTS__ = ro; }, [timeline, opts]);
  await page.goto(`http://127.0.0.1:${port}/renderer/${(timeline.meta && timeline.meta.page) || 'index.html'}`);
  try {
    await page.waitForFunction('window.__ready === true || !!window.__initError', null, { timeout: 180000 });
  } catch (e) { throw new Error('Sayfa hazır olmadı: ' + errors.join('\n')); }
  const initErr = await page.evaluate('window.__initError || null');
  if (initErr) throw new Error('Renderer init hatası: ' + initErr + '\n' + errors.join('\n'));
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp, errors };
}

async function capture(cdp, format = 'jpeg') {
  const r = await cdp.send('Page.captureScreenshot', format === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 94, optimizeForSpeed: false });
  return Buffer.from(r.data, 'base64');
}

async function main() {
  const o = args();
  if (!o.timeline) { console.error('--timeline gerekli'); process.exit(2); }
  const timeline = JSON.parse(fs.readFileSync(o.timeline, 'utf8'));
  const fps = timeline.meta.fps || 30;
  const total = Math.ceil(timeline.meta.duration * fps);
  const srv = await serve(ROOT);
  const port = srv.address().port;
  const gpu = !!o.gpu;
  const ropts = { scale: Number(o.scale || (gpu ? 1 : 0.75)), msaa: Number(o.msaa ?? (gpu ? 4 : 0)) };

  if (o.stills) {
    const outDir = o['out-dir'] || path.join(path.dirname(o.timeline), 'stills');
    fs.mkdirSync(outDir, { recursive: true });
    const { browser, page, cdp, errors } = await openPage(port, timeline, gpu, ropts);
    // sahne geçişlerinin doğru kurulması için kısa ön-ısıtma yok: render tamamen t'ye bağlı
    for (const ts of String(o.stills).split(',').map(Number)) {
      await page.evaluate((t) => window.renderFrame(t), ts);
      if (o.debug) console.log(ts, JSON.stringify(await page.evaluate(() => window.__director && window.__director.debug ? window.__director.debug() : null)));
      const buf = await capture(cdp, 'png');
      const f = path.join(outDir, `still_${ts.toFixed(2)}.png`);
      fs.writeFileSync(f, buf);
      console.log(f);
    }
    if (errors.length) console.error('Sayfa hataları:\n' + errors.slice(0, 10).join('\n'));
    await browser.close(); srv.close();
    return;
  }

  const framesDir = o.frames || path.join(path.dirname(o.timeline), 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const workers = Math.max(1, Number(o.workers || Math.min(3, Math.max(1, os.cpus().length - 1))));
  const start = Number(o.start || 0), end = Math.min(total, Number(o.end || total));
  const todo = [];
  for (let i = start; i < end; i++) if (!fs.existsSync(path.join(framesDir, `${String(i).padStart(5, '0')}.jpg`))) todo.push(i);
  console.log(`Kareler: ${end - start} (eksik ${todo.length}), işçi: ${workers}, fps: ${fps}`);
  if (!todo.length) { srv.close(); return; }
  const chunk = Math.ceil(todo.length / workers);
  let done = 0; const t0 = Date.now();
  const tick = setInterval(() => {
    const el = (Date.now() - t0) / 1000, rate = done / Math.max(1, el);
    const eta = rate > 0 ? (todo.length - done) / rate : 0;
    console.log(`  ${done}/${todo.length} kare · ${rate.toFixed(2)} kare/sn · kalan ~${Math.round(eta)} sn`);
  }, 15000);
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const mine = todo.slice(w * chunk, (w + 1) * chunk);
    if (!mine.length) return;
    const { browser, page, cdp, errors } = await openPage(port, timeline, gpu, ropts);
    for (const i of mine) {
      await page.evaluate((t) => window.renderFrame(t), i / fps);
      const buf = await capture(cdp, 'jpeg');
      const f = path.join(framesDir, `${String(i).padStart(5, '0')}.jpg`);
      fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f);
      done++;
    }
    if (errors.length) console.error(`[işçi ${w}] sayfa hataları:\n` + errors.slice(0, 10).join('\n'));
    await browser.close();
  }));
  clearInterval(tick);
  console.log(`Bitti: ${todo.length} kare, ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
  srv.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
