// Motion graphics katmanı (DOM). Her kare overlay.update(t, ctx) ile
// deterministik olarak güncellenir; ekran görüntüsü WebGL + DOM'u birlikte yakalar.
import { clamp, ease, lerp, invLerp, spring } from './util.js';
import { icon } from './icons.js';

const TR = 'tr-TR';
const up = (s) => (s || '').toLocaleUpperCase(TR);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fitText(node, maxW, maxFs, minFs = 30) {
  let fs = maxFs;
  node.style.fontSize = fs + 'px';
  for (let i = 0; i < 30 && node.scrollWidth > maxW && fs > minFs; i++) {
    fs -= 4; node.style.fontSize = fs + 'px';
  }
  return fs;
}

export class Overlay {
  constructor(root, timeline) {
    this.root = root;
    this.tl = timeline;
    const th = timeline.theme || {};
    root.style.setProperty('--accent', th.accent || '#FFD60A');
    root.style.setProperty('--accent2', th.accent2 || '#2EE6D6');
    root.style.setProperty('--danger', th.danger || '#FF4D5E');
    this.items = timeline.segments.filter((s) => s.kind === 'item');
    this._buildProgress();
    this._buildHeader();
    this._buildHookTitle();
    this._buildCallout();
    this._buildCaptions();
    this._buildOutro();
    this._buildBrand();
    this.curCaption = -1;
    this.curItem = null;
  }

  // ---------------------------------------------------------------- yapı
  _buildProgress() {
    const wrap = el('div', 'progress');
    this.progressDots = this.items.map((it) => {
      const d = el('div', 'pdot', `<span>${esc(it.rank)}</span>`);
      wrap.appendChild(d);
      return d;
    });
    this.progress = wrap;
    if (this.items.length) this.root.appendChild(wrap);
  }

  _buildHeader() {
    const h = el('div', 'header');
    h.innerHTML = `
      <div class="rank"><span class="hash">#</span><span class="num"></span><div class="ring"></div></div>
      <div class="namebox">
        <div class="name"></div>
        <div class="latin"></div>
      </div>
      <div class="chips"></div>`;
    this.root.appendChild(h);
    this.header = h;
    this.hRank = h.querySelector('.rank'); this.hNum = h.querySelector('.num'); this.hRing = h.querySelector('.ring');
    this.hName = h.querySelector('.name'); this.hLatin = h.querySelector('.latin'); this.hChips = h.querySelector('.chips');
    this.hNameBox = h.querySelector('.namebox');
  }

  _setItem(seg) {
    if (this.curItem === seg) return;
    this.curItem = seg;
    if (!seg) return;
    this.hNum.textContent = seg.rank;
    const name = up(seg.name);
    this.hName.innerHTML = [...name].map((ch) => `<span class="ch">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
    this.hName.style.fontSize = '';
    fitText(this.hName, 650, 104, 52);
    this.nameChars = [...this.hName.querySelectorAll('.ch')];
    this.hLatin.textContent = seg.latin || '';
    this.hChips.innerHTML = '';
    this.chipEls = (seg.chips || []).slice(0, 3).map((c) => {
      const e = el('div', 'chip' + (c.tone ? ' ' + c.tone : ''), `${icon(c.icon || 'sparkle', 38)}<span>${esc(c.text)}</span>`);
      this.hChips.appendChild(e);
      return e;
    });
  }

  _buildHookTitle() {
    const h = el('div', 'hooktitle');
    h.innerHTML = `<div class="kicker"></div><div class="big"></div><div class="sweep"></div>`;
    this.root.appendChild(h);
    this.hook = h;
    this.hookKicker = h.querySelector('.kicker'); this.hookBig = h.querySelector('.big'); this.hookSweep = h.querySelector('.sweep');
    const hs = this.tl.segments.find((s) => s.kind === 'hook');
    if (hs && hs.title) {
      this.hookKicker.textContent = up(hs.title.kicker || '');
      this.hookBig.textContent = up(hs.title.big || '');
      fitText(this.hookBig, 940, 230, 90);
    }
    this.hookSeg = hs;
  }

  _buildCallout() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'callout-svg');
    svg.setAttribute('viewBox', '0 0 1080 1920');
    svg.innerHTML = `
      <circle class="c-pulse" r="30" />
      <circle class="c-dot" r="13" />
      <polyline class="c-line" points="" />`;
    this.root.appendChild(svg);
    this.cSvg = svg;
    this.cPulse = svg.querySelector('.c-pulse'); this.cDot = svg.querySelector('.c-dot'); this.cLine = svg.querySelector('.c-line');
    const lab = el('div', 'callout-label');
    this.root.appendChild(lab);
    this.cLabel = lab;
  }

  _buildCaptions() {
    const c = el('div', 'captions');
    this.root.appendChild(c);
    this.capEl = c;
  }

  _buildOutro() {
    const o = el('div', 'outro');
    const seg = this.tl.segments.find((s) => s.kind === 'outro');
    const cta = (seg && seg.cta) || {};
    o.innerHTML = `
      <div class="q">${esc(up(cta.question || 'Sence en ilginci hangisi?'))}</div>
      <div class="cmt">${icon('comment', 56)}<span>${esc(up(cta.comment || 'Yorumlara yaz'))}</span></div>
      <div class="follow"><div class="btn">${icon('plus', 46, 3)}<span>${esc(up(cta.follow || 'Takip et'))}</span></div><div class="tap"></div></div>`;
    this.root.appendChild(o);
    this.outro = o; this.outroSeg = seg;
    this.oQ = o.querySelector('.q'); this.oC = o.querySelector('.cmt'); this.oF = o.querySelector('.follow'); this.oTap = o.querySelector('.tap');
  }

  _buildBrand() {
    const h = this.tl.meta && this.tl.meta.handle;
    if (!h) return;
    const b = el('div', 'brand', `${icon('wave', 30)}<span>${esc(h)}</span>`);
    this.root.appendChild(b);
    this.brand = b;
  }

  // ---------------------------------------------------------------- güncelleme
  update(t, ctx) {
    const segs = this.tl.segments;
    const seg = ctx.segment;
    this._updateProgress(t);
    this._updateHeader(t, seg, ctx);
    this._updateHook(t);
    this._updateCallout(t, seg, ctx);
    this._updateCaptions(t);
    this._updateOutro(t);
    void segs;
  }

  _updateProgress(t) {
    if (!this.items.length) return;
    const first = this.items[0];
    const vis = clamp(invLerp(first.start - 0.2, first.start + 0.3, t));
    this.progress.style.opacity = vis * (this.outroSeg && t > this.outroSeg.start + 0.2 ? 0.0 : 1);
    this.progress.style.transform = `translateY(${(1 - ease.outCubic(vis)) * -40}px)`;
    this.items.forEach((it, i) => {
      const d = this.progressDots[i];
      const active = t >= it.start && t < it.end + 0.4;
      const done = t >= it.end + 0.4;
      d.classList.toggle('active', active);
      d.classList.toggle('done', done);
      const k = active ? 1 + 0.18 * Math.sin(clamp((t - it.start) / 0.35) * Math.PI) : 1;
      d.style.transform = `scale(${k})`;
    });
  }

  _updateHeader(t, seg, ctx) {
    const h = this.header;
    if (!seg || seg.kind !== 'item') { h.style.opacity = 0; this._setItem(null); return; }
    this._setItem(seg);
    const lt = t - seg.start; // yerel zaman
    const outT = seg.end + (ctx.transOut ?? 0.25) - t;
    const exitK = clamp(1 - outT / 0.3);
    h.style.opacity = 1 - ease.inCubic(exitK);
    h.style.transform = `translateY(${-60 * ease.inCubic(exitK)}px)`;
    // rank çakılma
    const rk = clamp((lt + 0.05) / 0.38);
    const sc = lerp(2.6, 1, ease.outBack(rk, 1.2));
    this.hRank.style.opacity = clamp(rk * 3);
    this.hRank.style.transform = `scale(${sc}) rotate(${lerp(-14, -4, ease.outCubic(rk))}deg)`;
    this.hRank.style.filter = `blur(${(1 - clamp(rk * 2)) * 10}px)`;
    const rg = clamp((lt - 0.12) / 0.55);
    this.hRing.style.opacity = rg > 0 && rg < 1 ? 1 - rg : 0;
    this.hRing.style.transform = `translate(-50%,-50%) scale(${0.4 + ease.outCubic(rg) * 2.2})`;
    // isim harf harf
    (this.nameChars || []).forEach((c, i) => {
      const k = clamp((lt - 0.18 - i * 0.028) / 0.32);
      const e = ease.outBack(k, 1.6);
      c.style.opacity = clamp(k * 2.5);
      c.style.transform = `translateY(${(1 - e) * 70}px) rotate(${(1 - e) * 12}deg)`;
    });
    const lk = clamp((lt - 0.5) / 0.45);
    this.hLatin.style.opacity = ease.outCubic(lk) * 0.92;
    this.hLatin.style.clipPath = `inset(0 ${100 - ease.outCubic(lk) * 100}% 0 0)`;
    (this.chipEls || []).forEach((c, i) => {
      const k = clamp((lt - 0.85 - i * 0.18) / 0.4);
      const e = ease.outBack(k, 1.4);
      c.style.opacity = clamp(k * 2);
      c.style.transform = `translateX(${(1 - e) * -120}px) scale(${0.8 + 0.2 * e})`;
    });
  }

  _updateHook(t) {
    const hs = this.hookSeg;
    if (!hs || !hs.title) { this.hook.style.opacity = 0; return; }
    const t0 = hs.title.at ?? hs.start + 2;
    const t1 = hs.end - 0.28;
    if (t < t0 - 0.05 || t > t1 + 0.3) { this.hook.style.opacity = 0; return; }
    const k = clamp((t - t0) / 0.5);
    const out = clamp((t - t1) / 0.28);
    this.hook.style.opacity = (1 - out);
    this.hookKicker.style.transform = `translateY(${(1 - ease.outCubic(k)) * 40}px)`;
    this.hookKicker.style.opacity = ease.outCubic(k);
    this.hookKicker.style.letterSpacing = `${lerp(30, 10, ease.outCubic(k))}px`;
    const kb = clamp((t - t0 - 0.12) / 0.5);
    this.hookBig.style.transform = `scale(${lerp(1.8, 1, ease.outBack(kb, 1.3)) * (1 + out * 0.6)})`;
    this.hookBig.style.opacity = clamp(kb * 3);
    this.hookBig.style.filter = `blur(${(1 - clamp(kb * 2)) * 14 + out * 10}px)`;
    const ks = clamp((t - t0 - 0.3) / 0.6);
    this.hookSweep.style.transform = `scaleX(${ease.inOutCubic(ks)})`;
  }

  _updateCallout(t, seg, ctx) {
    const c = seg && seg.callout;
    const show = c && ctx.anchorScreen && t >= c.t0 && t <= c.t1 + 0.3;
    if (!show) { this.cSvg.style.opacity = 0; this.cLabel.style.opacity = 0; return; }
    const a = ctx.anchorScreen;
    const k = clamp((t - c.t0) / 0.5), out = clamp((t - c.t1) / 0.3);
    const vis = 1 - out;
    // etiket konumu: güvenli bölge içinde, çapanın karşı tarafında
    if (this.cLabel.dataset.txt !== c.text) { this.cLabel.innerHTML = `${icon(c.icon || 'eye', 36)}<span>${esc(up(c.text))}</span>`; this.cLabel.dataset.txt = c.text; }
    const lw = this.cLabel.offsetWidth || 400;
    const toLeft = a.x > 540; // etiket çapanın solunda (sağ kenarı uçta)
    let ex = toLeft ? a.x - 150 : a.x + 150;
    ex = toLeft ? clamp(ex, 50 + lw, 1030) : clamp(ex, 50, 1030 - lw);
    const ey = clamp(a.y + (a.y < 980 ? 230 : -230), 720, 1150);
    const mx = a.x + (ex - a.x) * 0.45, my = ey;
    const lk = ease.outCubic(clamp((t - c.t0 - 0.12) / 0.4));
    const p1 = [a.x, a.y], p2 = [lerp(a.x, mx, lk), lerp(a.y, my, lk)], p3 = [lerp(mx, ex, clamp(lk * 1.5 - 0.5)), my];
    this.cSvg.style.opacity = vis;
    this.cLine.setAttribute('points', `${p1.join(',')} ${p2.join(',')} ${p3.join(',')}`);
    const dk = ease.outBack(clamp(k * 2), 2);
    this.cDot.setAttribute('cx', a.x); this.cDot.setAttribute('cy', a.y); this.cDot.setAttribute('r', 13 * dk);
    const pk = ((t - c.t0) % 1.0);
    this.cPulse.setAttribute('cx', a.x); this.cPulse.setAttribute('cy', a.y); this.cPulse.setAttribute('r', 14 + pk * 40);
    this.cPulse.style.opacity = (1 - pk) * 0.8;
    const tk = ease.outBack(clamp((t - c.t0 - 0.35) / 0.35), 1.5);
    const left = toLeft;
    this.cLabel.style.opacity = clamp(tk * 2) * vis;
    this.cLabel.style.left = `${ex}px`; this.cLabel.style.top = `${ey}px`;
    this.cLabel.style.transform = `translate(${left ? '-100%' : '0'}, -50%) scale(${0.7 + 0.3 * tk})`;
    this.cLabel.style.transformOrigin = left ? 'right center' : 'left center';
  }

  _updateCaptions(t) {
    const caps = this.tl.captions || [];
    let idx = -1;
    for (let i = 0; i < caps.length; i++) { if (t >= caps[i].s && t < caps[i].e) { idx = i; break; } }
    if (idx !== this.curCaption) {
      this.curCaption = idx;
      this.capEl.innerHTML = '';
      this.capWords = [];
      if (idx >= 0) {
        const cap = caps[idx];
        const line = el('div', 'capline ' + (cap.style || ''));
        cap.w.forEach((wi) => {
          const w = this.tl.words[wi];
          const s = el('span', 'w' + (w.emph ? ' emph' : '') + (w.tone ? ' ' + w.tone : ''), esc(up(w.text)));
          line.appendChild(s);
          this.capWords.push({ el: s, w });
        });
        this.capEl.appendChild(line);
        this.capLine = line;
      }
    }
    if (idx < 0) return;
    const cap = caps[idx];
    const k = clamp((t - cap.s) / 0.16);
    const outK = clamp((t - (cap.e - 0.08)) / 0.08);
    this.capLine.style.transform = `scale(${lerp(0.72, 1, ease.outBack(k, 2.0))})`;
    this.capLine.style.opacity = clamp(k * 3) * (1 - outK);
    for (const { el: e, w } of this.capWords) {
      const active = t >= w.s - 0.03 && t < w.e + 0.02;
      const spoken = t >= w.s - 0.03;
      e.classList.toggle('on', active);
      e.classList.toggle('said', spoken);
      const pk = clamp((t - w.s + 0.03) / 0.14);
      const sc = active ? 1 + 0.08 * Math.sin(pk * Math.PI * 0.5) : 1;
      e.style.transform = `scale(${sc}) translateY(${active ? -4 : 0}px)`;
    }
  }

  _updateOutro(t) {
    const s = this.outroSeg;
    if (!s || t < s.start - 0.1) { this.outro.style.opacity = 0; return; }
    const lt = t - s.start;
    this.outro.style.opacity = 1;
    const k1 = clamp(lt / 0.5), k2 = clamp((lt - 0.45) / 0.45), k3 = clamp((lt - 0.9) / 0.45);
    this.oQ.style.opacity = clamp(k1 * 2); this.oQ.style.transform = `scale(${lerp(1.5, 1, ease.outBack(k1, 1.4))})`;
    this.oC.style.opacity = clamp(k2 * 2); this.oC.style.transform = `translateY(${(1 - ease.outBack(k2)) * 60}px)`;
    this.oF.style.opacity = clamp(k3 * 2);
    const pulse = 1 + 0.06 * Math.max(0, Math.sin((lt - 1.4) * Math.PI * 2.2));
    this.oF.style.transform = `scale(${lerp(0.6, 1, ease.outBack(k3, 2)) * pulse})`;
    const tk = ((lt - 1.6) % 1.4) / 1.4;
    this.oTap.style.opacity = lt > 1.6 ? (1 - tk) : 0;
    this.oTap.style.transform = `translate(-50%,-50%) scale(${0.3 + tk * 1.6})`;
  }
}
