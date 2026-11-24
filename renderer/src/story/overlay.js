// Hikâye motion graphics katmanı (DOM): dizi rozeti + bölüm çubuğu, kinetik başlık, mekân/saat yazısı,
// 3D'ye bağlı etiketler, mühür damgası, BİLGİ kartı, el yazısı alıntı, sayaç, skor bandı, merak kancası kartı
// ve kelime kelime altyazı. Her şey t'nin fonksiyonudur.
import { clamp, ease, lerp, spring, smoothstep, mulberry32 } from '../util.js';
import { icon } from '../icons.js';
import { Overlay } from '../overlay.js';

const TR = 'tr-TR';
const up = (s) => (s || '').toLocaleUpperCase(TR);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

const CSS = `
.s-top { position:absolute; top:96px; left:56px; right:56px; display:flex; flex-direction:column; gap:14px; }
.s-row { display:flex; align-items:center; justify-content:space-between; }
.s-series { display:flex; align-items:center; gap:14px; font:900 34px 'Montserrat'; letter-spacing:3px; color:#fff; text-shadow:0 3px 12px rgba(0,0,0,.7); }
.s-series .dot { width:16px; height:16px; border-radius:50%; background:var(--danger); box-shadow:0 0 14px var(--danger); }
.s-ep { padding:10px 22px; border-radius:999px; background:var(--accent); color:#1a1205; font:900 32px 'Montserrat'; letter-spacing:1px; box-shadow:0 6px 24px rgba(0,0,0,.35); }
.s-pips { display:flex; gap:8px; }
.s-pip { flex:1; height:9px; border-radius:5px; background:rgba(255,255,255,.22); overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.35); }
.s-pip i { display:block; height:100%; width:0%; background:#fff; }
.s-pip.done i { width:100%; background:rgba(255,255,255,.75); }
.s-pip.now i { background:var(--accent); }

.g-title { position:absolute; top:360px; left:0; right:0; text-align:center; opacity:0; }
.g-title .k { display:inline-block; padding:10px 26px; border:4px solid #fff; border-radius:8px; font:900 46px 'Montserrat'; letter-spacing:12px; color:#fff; text-shadow:0 4px 14px rgba(0,0,0,.6); background:rgba(0,0,0,.25); }
.g-title .b { margin-top:22px; font:400 150px/0.98 'Anton'; letter-spacing:2px; color:#fff; padding:0 40px; }
.g-title .b .ch { display:inline-block; background:linear-gradient(180deg,#fffbe6 0%, var(--accent) 52%, #ff7a00 100%); -webkit-background-clip:text; background-clip:text; color:transparent;
  filter: drop-shadow(0 5px 0 #6b3200) drop-shadow(0 10px 0 #3d1c00) drop-shadow(0 18px 22px rgba(0,0,0,.6)); }
.g-title .sw { margin:18px auto 0; width:560px; height:8px; border-radius:4px; background:linear-gradient(90deg,transparent,var(--accent2),transparent); }

.g-chapter { position:absolute; top:300px; left:60px; opacity:0; font:800 44px 'Montserrat'; letter-spacing:6px; color:#fff; text-shadow:0 3px 14px rgba(0,0,0,.8); }
.g-chapter .bar { margin-top:12px; height:6px; width:0; background:var(--accent); border-radius:3px; }
.g-chapter .cur { display:inline-block; width:22px; height:44px; margin-left:6px; background:var(--accent); vertical-align:-6px; }

.g-label-svg { position:absolute; inset:0; width:1080px; height:1920px; overflow:visible; opacity:0; }
.g-label-svg .ln { fill:none; stroke:#fff; stroke-width:5; stroke-linecap:round; filter:drop-shadow(0 2px 5px rgba(0,0,0,.6)); }
.g-label-svg .dt { fill:var(--accent); stroke:#fff; stroke-width:4; }
.g-label-svg .pl { fill:none; stroke:var(--accent); stroke-width:4; }
.g-label { position:absolute; opacity:0; padding:14px 26px; border-radius:14px; background:rgba(255,255,255,.96); color:#121212; font:900 38px 'Montserrat'; letter-spacing:1px; white-space:nowrap; border-left:10px solid var(--accent); box-shadow:0 12px 30px rgba(0,0,0,.45); }

.g-stamp { position:absolute; top:620px; left:0; right:0; display:flex; justify-content:center; opacity:0; }
.g-stamp span { display:inline-block; padding:18px 38px; border:9px solid var(--accent); border-radius:14px; color:var(--accent); font:400 92px/1 'Anton'; letter-spacing:4px;
  background:rgba(10,8,4,.35); text-shadow:0 4px 18px rgba(0,0,0,.5); box-shadow: inset 0 0 0 4px rgba(0,0,0,.15), 0 14px 40px rgba(0,0,0,.4); }
.g-stamp.danger span { border-color:var(--danger); color:var(--danger); }

.g-fact { position:absolute; top:330px; left:70px; right:70px; opacity:0; padding:40px 44px 44px; border-radius:36px; background:linear-gradient(160deg, rgba(14,30,50,.86), rgba(4,10,20,.9));
  border:3px solid rgba(92,225,230,.55); box-shadow:0 30px 80px rgba(0,0,0,.55), 0 0 60px rgba(92,225,230,.18) inset; text-align:center; }
.g-fact .tag { display:inline-flex; align-items:center; gap:12px; padding:10px 24px; border-radius:999px; background:var(--accent2); color:#03222a; font:900 36px 'Montserrat'; letter-spacing:5px; }
.g-fact .ic { margin:26px auto 4px; width:120px; height:120px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:var(--accent); background:rgba(255,201,60,.12); border:3px solid rgba(255,201,60,.5); }
.g-fact .v { margin-top:16px; font:400 128px/1 'Anton'; color:#fff; letter-spacing:2px; white-space:nowrap; text-shadow:0 6px 0 rgba(0,0,0,.35), 0 0 40px rgba(255,201,60,.35); }
.g-fact .v b { color:var(--accent); font-weight:400; }
.g-fact .l { margin-top:18px; font:900 46px 'Montserrat'; color:#fff; }
.g-fact .s { margin-top:12px; font:700 34px 'Montserrat'; color:#9fdfff; }

.g-quote { position:absolute; top:520px; left:80px; right:80px; opacity:0; text-align:center; }
.g-quote .pq { display:inline-block; padding:30px 44px; background:#f2ead6; border-radius:6px; box-shadow:0 20px 50px rgba(0,0,0,.5); transform:rotate(-2.5deg); }
.g-quote .tx { font:700 108px/1.05 'Caveat'; color:#1f3a8a; white-space:nowrap; }

.g-counter { position:absolute; top:400px; left:0; right:0; text-align:center; opacity:0; }
.g-counter .n { font:400 190px/1 'Anton'; color:#fff; letter-spacing:2px; text-shadow:0 8px 0 rgba(0,0,0,.4), 0 0 50px rgba(255,201,60,.5); }
.g-counter .n b { color:var(--accent); font-weight:400; }
.g-counter .l { margin-top:10px; display:inline-block; padding:12px 28px; border-radius:999px; background:rgba(0,0,0,.55); font:900 40px 'Montserrat'; letter-spacing:6px; color:#fff; }

.g-score { position:absolute; top:300px; left:60px; right:60px; opacity:0; display:flex; align-items:stretch; height:120px; border-radius:20px; overflow:hidden; box-shadow:0 18px 50px rgba(0,0,0,.55); font-family:'Montserrat'; }
.g-score .tm { flex:1; display:flex; align-items:center; justify-content:center; background:rgba(10,14,30,.92); color:#fff; font:900 36px 'Montserrat'; letter-spacing:1px; }
.g-score .sc { width:210px; display:flex; align-items:center; justify-content:center; background:#fff; color:#0a0e1e; font:400 86px 'Anton'; }
.g-score .mn { width:150px; display:flex; align-items:center; justify-content:center; background:var(--danger); color:#fff; font:400 58px 'Anton'; }

.g-cliff { position:absolute; inset:0; opacity:0; }
.g-cliff .shade { position:absolute; inset:0; background:radial-gradient(ellipse at 50% 40%, rgba(0,0,0,.15), rgba(0,0,0,.78)); }
.g-cliff .box { position:absolute; top:330px; left:0; right:0; text-align:center; }
.g-cliff .dv { font:900 50px 'Montserrat'; letter-spacing:16px; color:#fff; text-shadow:0 4px 14px rgba(0,0,0,.6); }
.g-cliff .ep { margin-top:6px; font:400 230px/1 'Anton'; color:transparent; background:linear-gradient(180deg,#fffbe6, var(--accent) 55%, #ff7a00); -webkit-background-clip:text; background-clip:text;
  filter: drop-shadow(0 6px 0 #6b3200) drop-shadow(0 18px 24px rgba(0,0,0,.6)); }
.g-cliff .nx { margin-top:8px; font:900 58px 'Montserrat'; color:#fff; letter-spacing:2px; text-shadow:0 4px 16px rgba(0,0,0,.7); }
.g-cliff .q { margin:34px auto 0; width:120px; height:120px; border-radius:50%; border:6px solid #fff; display:flex; align-items:center; justify-content:center; font:400 96px 'Anton'; color:#fff; }
.g-cliff .cta { position:relative; margin:40px auto 0; width:max-content; display:flex; align-items:center; gap:14px; padding:24px 50px; border-radius:999px; background:var(--danger); color:#fff; font:900 50px 'Montserrat'; box-shadow:0 14px 40px rgba(255,77,94,.55); }
.g-cliff .tap { position:absolute; left:84%; top:68%; width:84px; height:84px; border-radius:50%; border:6px solid #fff; opacity:0; }
.s-brand { position:absolute; left:50%; bottom:110px; transform:translateX(-50%); opacity:.55; font:800 30px 'Montserrat'; color:#fff; text-shadow:0 2px 8px rgba(0,0,0,.7); }
.s-flashtext { position:absolute; inset:0; }
`;

function fmtNum(n) { return Math.round(n).toLocaleString(TR); }

export class StoryOverlay {
  constructor(root, tl) {
    this.root = root; this.tl = tl;
    const th = tl.theme || {};
    root.style.setProperty('--accent', th.accent || '#FFC93C');
    root.style.setProperty('--accent2', th.accent2 || '#5CE1E6');
    root.style.setProperty('--danger', th.danger || '#FF4D5E');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this._buildTop();
    this.items = [];
    tl.segments.forEach((seg) => (seg.gfx || []).forEach((g) => this.items.push({ g, seg, node: this._build(g) })));
    // altyazılar: geri sayım katmanının altyazı motorunu yeniden kullan
    const cap = el('div', 'captions'); root.appendChild(cap);
    this.capEl = cap; this.curCaption = -1;
    if (tl.meta?.handle) { const b = el('div', 's-brand', esc(tl.meta.handle)); root.appendChild(b); }
  }

  _buildTop() {
    const s = this.tl.series || {};
    const top = el('div', 's-top');
    top.innerHTML = `<div class="s-row"><div class="s-series"><span class="dot"></span>${esc(up(s.title || this.tl.meta?.title || ''))}</div>
      <div class="s-ep">BÖLÜM ${esc(s.episode || 1)}/${esc(s.total || 1)}</div></div>`;
    const pips = el('div', 's-pips');
    this.pips = [];
    for (let i = 1; i <= (s.total || 1); i++) { const p = el('div', 's-pip' + (i < s.episode ? ' done' : i === s.episode ? ' now' : ''), '<i></i>'); pips.appendChild(p); this.pips.push(p); }
    top.appendChild(pips);
    this.root.appendChild(top); this.top = top;
    this.nowPip = this.pips[(s.episode || 1) - 1]?.querySelector('i');
  }

  _build(g) {
    let n;
    switch (g.type) {
      case 'title': {
        n = el('div', 'g-title');
        const letters = [...up(g.big || '')].map((c) => (c === ' ' ? '<span class="ch">&nbsp;</span>' : `<span class="ch">${esc(c)}</span>`)).join('');
        n.innerHTML = `${g.kicker ? `<div class="k">${esc(up(g.kicker))}</div>` : ''}<div class="b">${letters}</div><div class="sw"></div>`;
        break;
      }
      case 'chapter': n = el('div', 'g-chapter', `<span class="tx"></span><span class="cur"></span><div class="bar"></div>`); break;
      case 'label': {
        n = el('div', '');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'g-label-svg'); svg.setAttribute('viewBox', '0 0 1080 1920');
        svg.innerHTML = '<path class="ln"/><circle class="pl" r="20"/><circle class="dt" r="13"/>';
        const lab = el('div', 'g-label', esc(up(g.text)));
        n.appendChild(svg); n.appendChild(lab);
        n._svg = svg; n._lab = lab;
        break;
      }
      case 'stamp': n = el('div', 'g-stamp' + (g.tone === 'danger' ? ' danger' : ''), `<span>${esc(up(g.text))}</span>`); break;
      case 'fact':
        n = el('div', 'g-fact', `<div class="tag">${icon('sparkle', 34, 2.6)}BİLGİ</div><div class="ic">${icon(g.icon || 'sparkle', 72, 2)}</div>
          <div class="v"></div><div class="l">${esc(g.label || '')}</div><div class="s">${esc(g.sub || '')}</div>`);
        break;
      case 'quote': n = el('div', 'g-quote', `<div class="pq"><div class="tx">${esc(g.text)}</div></div>`); break;
      case 'counter': n = el('div', 'g-counter', `<div class="n"></div><div class="l">${esc(up(g.label || ''))}</div>`); break;
      case 'score':
        n = el('div', 'g-score', `<div class="tm">${esc(g.home)}</div><div class="sc">${g.a} - ${g.b}</div><div class="tm">${esc(g.away)}</div><div class="mn">${esc(g.minute || '')}</div>`);
        break;
      case 'cliff':
        n = el('div', 'g-cliff', `<div class="shade"></div><div class="box"><div class="dv">DEVAMI</div><div class="ep">${esc(up(g.title || ''))}</div>
          <div class="nx">${esc(up(g.next || ''))}</div><div class="q">?</div>
          <div class="cta">${icon('plus', 44, 3)}<span>${esc(up(g.cta || 'Takip et'))}</span><div class="tap"></div></div></div>`);
        break;
      default: n = el('div', '');
    }
    n.style.opacity = 0;
    this.root.appendChild(n);
    return n;
  }

  update(t, ctx) {
    const dur = this.tl.meta.duration;
    if (this.nowPip) this.nowPip.style.width = `${clamp(t / dur) * 100}%`;
    // cliff sırasında üst bar ve altyazı biraz geri çekilir
    let cliffK = 0;
    for (const it of this.items) {
      const { g, node } = it;
      const k0 = (t - g.t0), k1 = (g.t1 - t);
      const on = t >= g.t0 - 0.05 && t <= g.t1 + 0.3;
      if (!on) { node.style.opacity = 0; continue; }
      const inK = clamp(k0 / 0.45), outK = clamp(1 - k1 / 0.25);
      this[`_u_${g.type}`]?.(node, g, t, k0, inK, outK, ctx);
      if (g.type === 'cliff') cliffK = inK;
    }
    this.top.style.opacity = 1 - 0.0 * cliffK;
    Overlay.prototype._updateCaptions.call(this, t);
    if (this.capLine && cliffK > 0) this.capEl.style.transform = `translateY(${cliffK * 230}px)`; else this.capEl.style.transform = '';
  }

  _u_title(n, g, t, k0, inK, outK) {
    const chars = n.querySelectorAll('.b .ch');
    chars.forEach((c, i) => {
      const k = clamp((k0 - i * 0.035) / 0.4);
      const s = spring(Math.max(0, k0 - i * 0.035), { freq: 2.4, damping: 0.45 });
      c.style.transform = `translateY(${(1 - s) * -160}px) rotate(${(1 - s) * (i % 2 ? 14 : -14)}deg) scale(${0.6 + 0.4 * s})`;
      c.style.opacity = clamp(k * 4);
    });
    const kk = n.querySelector('.k');
    if (kk) { kk.style.transform = `scale(${lerp(1.8, 1, ease.outBack(inK))})`; kk.style.opacity = clamp(inK * 3); }
    const sw = n.querySelector('.sw'); sw.style.transform = `scaleX(${ease.outCubic(clamp((k0 - 0.3) / 0.6))})`;
    n.style.opacity = 1 - outK;
    n.style.transform = `scale(${1 + outK * 0.25})`;
  }

  _u_chapter(n, g, t, k0, inK, outK) {
    const txt = up(g.text || '');
    const shown = Math.floor(clamp(k0 / Math.max(0.6, txt.length * 0.045)) * txt.length);
    n.querySelector('.tx').textContent = txt.slice(0, shown);
    n.querySelector('.cur').style.opacity = (Math.floor(t * 3) % 2 || shown < txt.length) ? 1 : 0;
    n.querySelector('.bar').style.width = `${ease.outCubic(clamp((k0 - 0.3) / 0.8)) * 100}%`;
    n.style.opacity = 1 - outK;
  }

  _u_label(n, g, t, k0, inK, outK, ctx) {
    const a = ctx.anchors?.[g.anchor];
    if (!a || !a.vis) { n.style.opacity = 0; n._svg.style.opacity = 0; n._lab.style.opacity = 0; return; }
    n.style.opacity = 1;
    const x = clamp(a.x, 90, 990), y = clamp(a.y, 420, 1180);
    const left = x > 540;
    const lx = left ? x - 230 : x + 230, ly = y - 170;
    const d = ease.outCubic(clamp(k0 / 0.4));
    const mx = lerp(x, lx, d), my = lerp(y, ly, d);
    n._svg.style.opacity = 1 - outK;
    n._svg.querySelector('.ln').setAttribute('d', `M${x},${y} L${mx},${my}`);
    const pl = n._svg.querySelector('.pl'); pl.setAttribute('cx', x); pl.setAttribute('cy', y); pl.setAttribute('r', 14 + 22 * ((t * 1.4) % 1)); pl.style.opacity = 1 - ((t * 1.4) % 1);
    const dt = n._svg.querySelector('.dt'); dt.setAttribute('cx', x); dt.setAttribute('cy', y); dt.setAttribute('r', 13 * ease.outBack(clamp(k0 / 0.25)));
    const lab = n._lab;
    const lk = ease.outBack(clamp((k0 - 0.25) / 0.35));
    lab.style.opacity = clamp((k0 - 0.25) * 5) * (1 - outK);
    lab.style.left = `${lx}px`; lab.style.top = `${ly}px`;
    lab.style.transform = `translate(${left ? '-100%' : '0'}, -50%) scale(${0.6 + 0.4 * lk})`;
    lab.style.transformOrigin = left ? 'right center' : 'left center';
  }

  _u_stamp(n, g, t, k0, inK, outK) {
    const k = clamp(k0 / 0.22);
    const sc = k < 1 ? lerp(2.6, 0.94, ease.inQuad(k)) : 0.94 + 0.06 * spring(k0 - 0.22, { freq: 3, damping: 0.4 });
    n.style.opacity = clamp(k * 3) * (1 - outK);
    n.querySelector('span').style.transform = `rotate(-7deg) scale(${sc})`;
  }

  _u_fact(n, g, t, k0, inK, outK) {
    const s = spring(k0, { freq: 1.6, damping: 0.55 });
    n.style.opacity = clamp(k0 * 4) * (1 - outK);
    n.style.transform = `translateY(${(1 - s) * 140}px) scale(${0.85 + 0.15 * s})`;
    const ic = n.querySelector('.ic'); ic.style.transform = `scale(${ease.outBack(clamp((k0 - 0.15) / 0.4))}) rotate(${Math.sin(t * 2) * 6}deg)`;
    // değer: rakamlar karışarak yerine oturur
    const v = String(g.value || '');
    const k = clamp((k0 - 0.25) / 1.1);
    const r = mulberry32(Math.floor(t * 20));
    let out = '';
    [...v].forEach((c, i) => {
      const settle = k * v.length * 1.3 - i;
      if (/\d/.test(c) && settle < 1) out += String(Math.floor(r() * 10));
      else out += c;
    });
    n.querySelector('.v').innerHTML = esc(out).replace(/^(\d[\d.,]*)/, '<b>$1</b>');
    n.querySelector('.l').style.opacity = clamp((k0 - 0.6) * 3);
    n.querySelector('.s').style.opacity = clamp((k0 - 0.9) * 3);
  }

  _u_quote(n, g, t, k0, inK, outK) {
    n.style.opacity = clamp(k0 * 5) * (1 - outK);
    const pq = n.querySelector('.pq');
    pq.style.transform = `rotate(-2.5deg) scale(${lerp(0.85, 1, ease.outBack(clamp(k0 / 0.35)))})`;
    const w = clamp((k0 - 0.15) / Math.max(0.8, (g.text || '').length * 0.06));
    n.querySelector('.tx').style.clipPath = `inset(0 ${(1 - w) * 100}% 0 0)`;
  }

  _u_counter(n, g, t, k0, inK, outK) {
    const k = ease.outCubic(clamp(k0 / (g.dur ? Math.min(g.dur * 0.7, 2.6) : 2)));
    const val = lerp(g.from || 0, g.to || 0, k);
    n.querySelector('.n').innerHTML = `<b>${fmtNum(val)}</b>${esc(g.suffix || '')}`;
    n.style.opacity = clamp(k0 * 4) * (1 - outK);
    n.style.transform = `scale(${lerp(0.7, 1, ease.outBack(clamp(k0 / 0.4)))})`;
  }

  _u_score(n, g, t, k0, inK, outK) {
    n.style.opacity = clamp(k0 * 4) * (1 - outK);
    n.style.transform = `translateY(${(1 - ease.outCubic(inK)) * -60}px)`;
    const sc = n.querySelector('.sc');
    const pulse = g.b > 0 || g.a > 0 ? Math.max(0, 1 - k0 / 0.6) : 0;
    sc.style.transform = `scale(${1 + 0.25 * pulse})`;
    sc.style.background = pulse > 0 ? '#ffc93c' : '#fff';
    n.querySelector('.mn').style.opacity = 0.75 + 0.25 * Math.sin(t * 6);
  }

  _u_cliff(n, g, t, k0, inK, outK) {
    n.style.opacity = clamp(k0 * 3);
    n.querySelector('.shade').style.opacity = ease.outCubic(clamp(k0 / 0.6));
    const ep = n.querySelector('.ep'); const s = spring(Math.max(0, k0 - 0.15), { freq: 1.8, damping: 0.5 });
    ep.style.transform = `scale(${0.4 + 0.6 * s})`; ep.style.opacity = clamp((k0 - 0.15) * 5);
    n.querySelector('.dv').style.opacity = clamp(k0 * 4);
    n.querySelector('.dv').style.letterSpacing = `${lerp(40, 16, ease.outCubic(clamp(k0 / 0.6)))}px`;
    const nx = n.querySelector('.nx'); nx.style.opacity = clamp((k0 - 0.45) * 4); nx.style.transform = `translateY(${(1 - ease.outCubic(clamp((k0 - 0.45) / 0.4))) * 30}px)`;
    const q = n.querySelector('.q'); q.style.opacity = clamp((k0 - 0.7) * 4); q.style.transform = `scale(${ease.outBack(clamp((k0 - 0.7) / 0.4))}) rotate(${Math.sin(t * 3) * 8}deg)`;
    const cta = n.querySelector('.cta'); const ck = clamp((k0 - 1.0) / 0.35);
    cta.style.opacity = ck; cta.style.transform = `scale(${(0.6 + 0.4 * ease.outBack(ck)) * (1 + 0.04 * Math.sin(t * 6))})`;
    const tap = n.querySelector('.tap'); const tp = ((k0 - 1.4) % 1.1) / 1.1;
    tap.style.opacity = k0 > 1.4 ? (1 - tp) : 0; tap.style.transform = `translate(-50%,-50%) scale(${0.5 + tp * 1.6})`;
  }
}
