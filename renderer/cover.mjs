import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
// Kullanım: node renderer/cover.mjs <kareler_klasörü> <çıktı_klasörü>  (kareler: render.mjs --stills ... --noui --scale 1)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), S = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]);
const font = (p) => 'file://' + path.join(ROOT, 'node_modules/@fontsource', p);
const covers = [
  { id: 'k01', bg: 'e1/still_63.50.png', ep: '1. BÖLÜM', lines: ['BABAMI GÖMDÜK.', 'DÜN GECE BANA', '*MESAJ ATTI.*'], notify: ['Babam', 'Kapıyı açma.', '03:17'] },
  { id: 'k02', bg: 'e2/still_44.00.png', ep: '2. BÖLÜM', lines: ['TEKNESİ', 'BATMAMIŞ.', '*BATIRILMIŞ.*'] },
  { id: 'k03', bg: 'e3/still_66.00.png', ep: '3. BÖLÜM', lines: ['ÖLÜMÜNDEN', '3 GÜN SONRA', '*KAMERAYA*', '*YAKALANDI.*'], rec: true },
  { id: 'k04', bg: 'e4/still_40.00.png', ep: '4. BÖLÜM', lines: ['DEPODA', '*KENDİ*', '*FOTOĞRAFIMI*', 'BULDUM.'] },
  { id: 'k05', bg: 'e5/still_52.00.png', ep: '5. BÖLÜM', lines: ['ÖLÜ SANDIĞIM', 'BABAM', '*BENİ KURTARDI.*'] },
  { id: 'k06', bg: 'e6/still_23.00.png', ep: 'FİNAL', lines: ['LİSTEDEKİ', 'SON İSİM:', '*KEREM.*'] },
  { id: 'poster', bg: 'e1/still_35.00.png', ep: '6 BÖLÜMLÜK GERİLİM DİZİSİ', poster: true, notify: ['Babam', 'Kapıyı açma.', '03:17'] },
];
const css = `
@font-face { font-family: Anton; src: url(${font('anton/files/anton-latin-ext-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: Anton; src: url(${font('anton/files/anton-latin-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: M; font-weight: 900; src: url(${font('montserrat/files/montserrat-latin-ext-900-normal.woff2')}) format('woff2'); }
@font-face { font-family: M; font-weight: 900; src: url(${font('montserrat/files/montserrat-latin-900-normal.woff2')}) format('woff2'); }
@font-face { font-family: M; font-weight: 700; src: url(${font('montserrat/files/montserrat-latin-ext-700-normal.woff2')}) format('woff2'); }
@font-face { font-family: M; font-weight: 700; src: url(${font('montserrat/files/montserrat-latin-700-normal.woff2')}) format('woff2'); }
html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000}
.c{position:relative;width:1080px;height:1920px;overflow:hidden}
.bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:contrast(1.15) saturate(1.1) brightness(.82)}
.sh{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.55) 30%,rgba(0,0,0,.05) 52%,rgba(0,0,0,.35) 72%,rgba(0,0,0,.92) 100%)}
.vg{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 40%,rgba(0,0,0,.6) 100%)}
.brand{position:absolute;top:300px;left:0;right:0;text-align:center;font:400 64px Anton;letter-spacing:14px;color:#fff}
.brand i{display:block;width:120px;height:6px;margin:14px auto 0;background:#ff3b4e}
.hook{position:absolute;top:430px;left:50px;right:50px;text-align:center;font:900 96px/1.04 M;color:#fff;-webkit-text-stroke:14px #000;paint-order:stroke fill;text-shadow:0 10px 30px rgba(0,0,0,.7);letter-spacing:-1px}
.hook b{color:#ffd23f;font-weight:900}
.ep{position:absolute;bottom:330px;left:0;right:0;display:flex;justify-content:center}
.ep span{padding:16px 38px;border-radius:999px;background:#ff3b4e;color:#fff;font:900 46px M;letter-spacing:3px;box-shadow:0 12px 40px rgba(255,59,78,.5)}
.nt{position:absolute;left:90px;right:90px;bottom:470px;display:flex;gap:24px;align-items:center;padding:28px 32px;border-radius:40px;background:rgba(36,40,48,.82);border:1px solid rgba(255,255,255,.15);box-shadow:0 24px 70px rgba(0,0,0,.6)}
.nt .ic{width:92px;height:92px;border-radius:22px;background:linear-gradient(180deg,#5ef26a,#1fbf3a);flex:none;display:flex;align-items:center;justify-content:center}
.nt .ic div{width:46px;height:36px;border-radius:12px;background:#fff;position:relative}
.nt .bd{flex:1}.nt .hd{display:flex;justify-content:space-between;font:700 30px M;color:rgba(255,255,255,.6)}
.nt .nm{font:900 44px M;color:#fff;margin-top:4px}.nt .tx{font:700 46px M;color:#fff;margin-top:2px}
.rec{position:absolute;top:240px;left:70px;font:900 42px M;color:#fff;display:flex;gap:14px;align-items:center}
.rec i{width:28px;height:28px;border-radius:50%;background:#ff2a2a;box-shadow:0 0 18px #ff2a2a;display:block}
.big{position:absolute;top:380px;left:0;right:0;text-align:center;font:400 250px/0.95 Anton;color:#fff;letter-spacing:4px;text-shadow:0 14px 40px rgba(0,0,0,.8)}
.big b{color:#ffd23f;font-weight:400}
.sub{position:absolute;top:900px;left:80px;right:80px;text-align:center;font:900 64px/1.15 M;color:#fff;-webkit-text-stroke:10px #000;paint-order:stroke fill}
.sub b{color:#ffd23f}
`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (l) => esc(l).replace(/\*([^*]+)\*/g, '<b>$1</b>');
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
for (const c of covers) {
  const bg = 'data:image/png;base64,' + fs.readFileSync(path.join(S, c.bg)).toString('base64');
  const notify = c.notify ? `<div class="nt"><div class="ic"><div></div></div><div class="bd"><div class="hd"><span>MESAJLAR</span><span>${c.notify[2]}</span></div><div class="nm">${c.notify[0]}</div><div class="tx">${c.notify[1]}</div></div></div>` : '';
  const body = c.poster
    ? `<div class="big">KAPIYI<br><b>AÇMA</b></div><div class="sub">Ölen babamdan gece <b>03:17</b>'de mesaj geldi.</div>${notify}<div class="ep"><span>${c.ep}</span></div>`
    : `<div class="brand">KAPIYI AÇMA<i></i></div><div class="hook">${c.lines.map(fmt).join('<br>')}</div>${notify}${c.rec ? '<div class="rec"><i></i>REC · 1 YIL ÖNCE</div>' : ''}<div class="ep"><span>${c.ep}</span></div>`;
  const html = path.join(S, 'c.html');
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="c"><div class="bg" style="background-image:url(${bg})"></div><div class="sh"></div><div class="vg"></div>${body}</div></body></html>`);
  await pg.goto('file://' + html);
  await pg.evaluate(async () => { await document.fonts.load('900 96px M', 'ÇĞİÖŞÜ'); await document.fonts.load('400 64px Anton', 'ÇĞİÖŞÜ'); await document.fonts.load('700 46px M', 'a'); await document.fonts.ready; });
  await pg.waitForTimeout(150);
  const f = path.join(OUT, `kapak-${c.id}.jpg`);
  await pg.screenshot({ path: f, type: 'jpeg', quality: 92 });
  console.log(f);
}
await b.close();
