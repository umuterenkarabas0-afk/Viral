// Hikâye modu motion graphics katmanı (DOM). Her kare update(t, shot, D) ile deterministik
// olarak güncellenir: kanca, rozet, konum etiketi (daktilo), karakter kartı, kelime kelime
// altyazı (not/yabancı el yazısı stilleri), konuşma balonu, şüpheli panosu, kamera kayıt
// arayüzü, fotoğraf çerçevesi, ağ grafiği ve bölüm sonu kartı.
import { clamp, ease, lerp } from '../src/util.js';

const TR = 'tr-TR';
const up = (s) => (s || '').toLocaleUpperCase(TR);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function el(tag, cls, html, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
const NOTE_ICON = (s = 40) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M4 3h12l4 4v14H4z" fill="#fff8e2" stroke="#1e1a16" stroke-width="1.8"/><path d="M16 3v4h4" fill="none" stroke="#1e1a16" stroke-width="1.8"/><path d="M7 11h9M7 14.5h9M7 18h6" stroke="#1c2a52" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const PIN = `<svg width="34" height="34" viewBox="0 0 24 24"><path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z" fill="#FFC94A"/><circle cx="12" cy="9.5" r="2.6" fill="#1e1a16"/></svg>`;
const CMT = `<svg width="54" height="54" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="#1e1a16" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
const PLUS = `<svg width="46" height="46" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>`;
const SPEAKER = { nuri: 'NURİ AMCA', simitci: 'SİMİTÇİ', husnu: 'KIRMIZI ŞEMSİYELİ ADAM', selim: 'SELİM AMCA', kerem: 'KEREM' };

function fitWidth(node, maxW, sizes, apply) {
  for (const fs of sizes) { apply(fs); if (node.scrollWidth <= maxW) return fs; }
  return sizes[sizes.length - 1];
}

export class StoryOverlay {
  constructor(root, tl, D) {
    this.root = root; this.tl = tl; this.D = D;
    const th = tl.theme || {};
    for (const [k, v] of Object.entries({ '--accent': th.accent, '--accent2': th.accent2, '--danger': th.danger, '--paper': th.paper, '--ink': th.ink })) if (v) root.style.setProperty(k, v);
    const m = tl.meta;
    this.progress = el('div', 'progress', undefined, root);
    this.badge = el('div', 'badge', `<div class="logo">${NOTE_ICON(40)}<span>${esc(up(m.series || ''))}</span></div><div class="ep">BÖLÜM <b>${m.episode}</b>/${m.episodes}</div>`, root);
    // kanca
    const words = (tl.hook?.text || '').split(/\s+/).filter(Boolean);
    this.hook = el('div', 'hook', `<div class="paper">${words.map((w, i) => `<span class="w${i === words.length - 1 || /YARIN|NOT|KEDİ|BAĞIRDIM|AYNI|40|SUÇÜSTÜ|GİZLİCE|FİNALİ|BENDE|YAZIYORUM/.test(w) ? ' hl' : ''}">${esc(w)}</span>`).join(' ')}</div><div class="kick">${esc(up(m.title || ''))}</div>`, root);
    this.hookWords = [...this.hook.querySelectorAll('.w')];
    this.hookPaper = this.hook.querySelector('.paper'); this.hookKick = this.hook.querySelector('.kick');
    fitWidth(this.hookPaper, 960, [124, 116, 108, 100, 92, 84], (fs) => this.hookWords.forEach((w) => (w.style.fontSize = fs + 'px')));
    // kalıcı kaplar
    this.labelEl = el('div', 'label hide', '', root);
    this.tagEl = el('div', 'tag hide', '', root);
    this.bubbleEl = el('div', 'bubble hide', '', root);
    this.bigEl = el('div', 'bigtext hide', '', root);
    this.suspEl = el('div', 'suspects hide', '', root);
    this.recEl = el('div', 'rec hide', '', root);
    this.photoEl = el('div', 'photo hide', '', root);
    this.pjoinEl = el('div', 'pjoin hide', '', root);
    this.netEl = el('div', 'network hide', '', root);
    this.heartEl = el('div', 'heart hide', '♥', root);
    this.capEl = el('div', 'captions', '', root);
    this.endEl = el('div', 'endcard hide', '', root);
    this._buildEnd();
    this.curShot = -1; this.curCap = -1;
  }

  _buildEnd() {
    const c = this.tl.cliff || {}, m = this.tl.meta;
    const final = !!c.final;
    const dots = Array.from({ length: m.episodes }, (_, i) => `<i class="${i + 1 < m.episode ? 'done' : i + 1 === m.episode ? 'cur' : ''}">${i + 1}</i>`).join('');
    this.endEl.innerHTML = `<div class="shade"></div><div class="box">
      <div class="kick">${final ? 'SEZON 1 SONU' : 'DEVAMI'}</div>
      <div class="big">${esc(up(final ? '2. SEZON?' : (c.next || '') + "'DE"))}</div>
      <div class="q">${CMT}<span>${esc(up(c.question || 'Sence ne olacak?'))}</span></div>
      <div class="follow">${PLUS}<span>${final ? 'TAKİP ET, KAÇIRMA' : 'TAKİP ET'}</span></div>
      <div class="dots">${dots}</div></div>`;
    const big = this.endEl.querySelector('.big');
    fitWidth(big, 960, [170, 150, 130, 112, 96], (fs) => (big.style.fontSize = fs + 'px'));
    this.endParts = ['.kick', '.big', '.q', '.follow', '.dots'].map((s) => this.endEl.querySelector(s));
  }

  _enter(shot) {
    // etiket
    if (shot.label) {
      this.labelEl.innerHTML = `<div class="row p">${PIN}<span class="tx"></span></div>${shot.label.time ? '<div class="row t"><span class="tx"></span></div>' : ''}`;
      this.labelTx = [...this.labelEl.querySelectorAll('.tx')];
    }
    if (shot.tag) {
      this.tagEl.innerHTML = `<div class="slab">${esc(up(shot.tag.name))}</div>${shot.tag.sub ? `<div class="sub">${esc(shot.tag.sub)}</div>` : ''}`;
    }
    if (shot.bubble) this.bubbleEl.innerHTML = esc(shot.bubble.text);
    const o = shot.overlay;
    if (o && o.type === 'bigtext') this.bigEl.innerHTML = esc(o.text);
    if (o && o.type === 'suspects') {
      this.suspEl.innerHTML = o.items.map((n, i) => `<div class="scard"><div class="pin"></div><div class="num">#${i + 1}</div><div class="nm">${esc(n)}</div><div class="strike"></div><div class="circle"></div></div>`).join('');
      this.scards = [...this.suspEl.querySelectorAll('.scard')];
    }
    if (o && o.type === 'rec') {
      this.recEl.innerHTML = `<div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
        <div class="top"><span><i class="dot"></i>REC</span><span class="tc"></span></div><div class="nosig">SİNYAL YOK</div><div class="lost"><span>4 SANİYE KAYIP!</span></div><div class="static"></div>`;
      this.recTc = this.recEl.querySelector('.tc'); this.recDot = this.recEl.querySelector('.dot'); this.recNo = this.recEl.querySelector('.nosig'); this.recLost = this.recEl.querySelector('.lost'); this.recStatic = this.recEl.querySelector('.static');
    }
    if (o && o.type === 'photo') {
      const left = o.half === 'left';
      const x0 = 70, x1 = 1010, y0 = 240, y1 = 1180;
      const jag = []; const n = 22;
      for (let i = 0; i <= n; i++) { const y = y0 + ((y1 - y0) * i) / n; const x = (left ? x1 : x0) + (i % 2 ? -1 : 1) * 16 * (left ? 1 : -1) + Math.sin(i * 2.3) * 10; jag.push([x, y]); }
      const inner = left ? [[x0, y0], ...jag, [x0, y1]] : [[x1, y0], [x1, y1], ...jag.reverse()];
      const path = `M0 0H1080V1920H0Z M${inner.map((p) => p.join(' ')).join(' L')} Z`;
      this.photoEl.innerHTML = `<svg width="1080" height="1920" viewBox="0 0 1080 1920" style="position:absolute;inset:0;filter:drop-shadow(0 0 30px rgba(0,0,0,.6))"><path d="${path}" fill="#efe8d8" fill-rule="evenodd"/><path d="${path}" fill="rgba(0,0,0,0.42)" fill-rule="evenodd" transform="translate(0 0)" opacity="0.0"/></svg>
        <div class="stamp" style="left:${left ? 600 : 140}px; top:1000px">${esc(o.stamp || '1984')}</div>`;
      this.photoStamp = this.photoEl.querySelector('.stamp');
    }
    if (o && o.type === 'photojoin') {
      this.pjoinEl.innerHTML = `<div class="half L"><div class="img"><i style="left:110px"></i></div></div><div class="half R"><div class="img"><i style="left:80px"></i></div></div><div class="photo"><div class="stamp" style="left:380px; top:520px; font-size:90px">1984</div></div>`;
      this.pjL = this.pjoinEl.querySelector('.L'); this.pjR = this.pjoinEl.querySelector('.R'); this.pjStamp = this.pjoinEl.querySelector('.stamp');
    }
    if (o && o.type === 'network') {
      this.netEl.innerHTML = `<svg width="1080" height="1920" style="position:absolute;inset:0">${o.items.map(() => '<line stroke="#fff" stroke-width="5" stroke-dasharray="14 10" stroke-linecap="round"/>').join('')}</svg>` + o.items.map((n) => `<div class="node">${esc(n)}</div>`).join('');
      this.netNodes = [...this.netEl.querySelectorAll('.node')]; this.netLines = [...this.netEl.querySelectorAll('line')];
    }
  }

  update(t, shot, D) {
    const tl = this.tl, dur = tl.meta.duration;
    if (shot.i !== this.curShot) { this.curShot = shot.i; this._enter(shot); }
    const lt = t - shot.start, se = shot.end;
    this.progress.style.width = `${(clamp(t / dur) * 1080).toFixed(1)}px`;
    // kanca + rozet
    const hk = tl.hook || {};
    const hookEnd = Math.min(2.6, tl.shots[0].end - 0.1);
    const hIn = clamp(t / 0.25), hOut = clamp((t - hookEnd + 0.3) / 0.3);
    this.hook.style.opacity = hk.text ? (1 - hOut) : 0;
    this.hookPaper.style.transform = `rotate(-3deg) scale(${lerp(1.35, 1, ease.outBack(hIn, 1.6)) * (1 + hOut * 0.25)})`;
    this.hookWords.forEach((w, i) => { const k = clamp((t - 0.08 - i * 0.12) / 0.18); w.style.opacity = k; w.style.transform = `translateY(${(1 - ease.outBack(k, 2)) * 40}px) scale(${lerp(1.6, 1, ease.outCubic(k))})`; });
    const kk = clamp((t - 0.55) / 0.4); this.hookKick.style.opacity = kk * (1 - hOut); this.hookKick.style.letterSpacing = `${lerp(20, 8, ease.outCubic(kk))}px`;
    const bk = clamp((t - hookEnd + 0.1) / 0.4);
    const endK = tl.cliff?.t !== undefined ? clamp((t - tl.cliff.t) / 0.4) : 0;
    this.badge.style.opacity = (0.35 + 0.65 * ease.outCubic(bk)) * (1 - endK);
    this.badge.style.transform = `scale(${lerp(0.9, 0.85, bk)})`;

    this._label(t, shot);
    this._tag(t, shot, D);
    this._bubble(t, shot, D);
    this._overlay(t, shot, D);
    this._captions(t);
    this._end(t);
  }

  _label(t, shot) {
    const L = shot.label;
    if (!L) { this.labelEl.style.opacity = 0; return; }
    const k = t - L.t, out = clamp((t - (shot.end - 0.25)) / 0.25);
    this.labelEl.style.opacity = k < 0 ? 0 : 1 - out;
    const texts = [up(L.place), up(L.time || '')];
    this.labelTx.forEach((tx, i) => {
      const s = texts[i]; const start = i === 0 ? 0 : 0.05 + s.length * 0.0;
      const n = Math.floor(clamp((k - start - i * 0.45) / (0.035 * Math.max(4, texts[i].length))) * texts[i].length);
      const caret = (n < texts[i].length && k > start) || Math.floor(k * 3) % 2 === 0 ? '<i class="caret"></i>' : '<i class="caret" style="opacity:0"></i>';
      tx.innerHTML = esc(s.slice(0, Math.max(0, n))) + (i === this.labelTx.length - 1 ? caret : '');
      tx.parentElement.style.opacity = n > 0 || i === 0 ? 1 : 0;
    });
    this.labelEl.style.transform = `translateX(${(1 - ease.outCubic(clamp(k / 0.3))) * -40}px)`;
  }

  _tag(t, shot, D) {
    const T = shot.tag;
    if (!T) { this.tagEl.style.opacity = 0; return; }
    const k = t - T.t, dur = 2.6;
    const out = clamp((k - dur) / 0.3);
    if (k < 0 || out >= 1) { this.tagEl.style.opacity = 0; return; }
    const hp = D.projectChar(T.who, 0.25);
    let x = 70, y = 860;
    if (hp) { y = clamp(hp.y + 120, 620, 1060); x = hp.x > 540 ? 70 : 70; }
    this.tagEl.style.left = x + 'px'; this.tagEl.style.top = y + 'px';
    const e = ease.outBack(clamp(k / 0.35), 1.8);
    this.tagEl.style.opacity = clamp(k * 5) * (1 - out);
    this.tagEl.style.transform = `translateX(${(1 - e) * -500}px) scale(${1 - out * 0.1})`;
  }

  _bubble(t, shot, D) {
    const B = shot.bubble;
    if (!B) { this.bubbleEl.style.opacity = 0; return; }
    const k = t - B.t, out = clamp((t - shot.end + 0.25) / 0.2);
    if (k < 0) { this.bubbleEl.style.opacity = 0; return; }
    let hp = B.who === 'phone' ? D.projectChar(shot.cast[0]?.who, 0.05) : D.projectChar(B.who, 0.32);
    if (!hp) hp = { x: 540, y: 700 };
    const w = this.bubbleEl.offsetWidth || 400, h = this.bubbleEl.offsetHeight || 120;
    const x = clamp(hp.x - w / 2, 40, 1040 - w), y = clamp(hp.y - h - 60, 230, 1050);
    this.bubbleEl.style.left = x + 'px'; this.bubbleEl.style.top = y + 'px';
    this.bubbleEl.style.setProperty('--tail', `${clamp(hp.x - x, 40, w - 40)}px`);
    const e = ease.outBack(clamp(k / 0.3), 2.2);
    this.bubbleEl.style.opacity = clamp(k * 6) * (1 - out);
    this.bubbleEl.style.transform = `scale(${0.4 + 0.6 * e}) rotate(${(1 - e) * -8}deg)`;
  }

  _overlay(t, shot, D) {
    const o = shot.overlay || {};
    const show = (e, on) => { e.style.opacity = on ? 1 : 0; };
    // büyük yazı
    if (o.type === 'bigtext' && t >= o.t) {
      const k = t - o.t; const e = ease.outBack(clamp(k / 0.22), 3);
      this.bigEl.style.opacity = clamp(k * 8) * (1 - clamp((t - shot.end + 0.2) / 0.2));
      this.bigEl.style.transform = `scale(${lerp(2.4, 1, e)}) rotate(${Math.sin(k * 40) * 2 * Math.exp(-k * 3)}deg) translate(${Math.sin(k * 55) * 10 * Math.exp(-k * 4)}px, 0)`;
    } else show(this.bigEl, false);
    // şüpheliler
    if (o.type === 'suspects') {
      show(this.suspEl, true);
      const k0 = t - shot.start;
      this.scards.forEach((c, i) => {
        const vis = i < (o.show || 0);
        const isNew = i === (o.show || 0) - 1;
        const k = isNew ? clamp((k0 - 0.1) / 0.35) : 1;
        c.style.opacity = vis ? clamp(k * 3) : 0.18;
        c.style.filter = vis ? 'none' : 'grayscale(1) brightness(.6)';
        c.style.transform = `rotate(${[-4, 2, -2][i]}deg) translateY(${(1 - ease.outBack(k, 2)) * -120}px) scale(${isNew ? lerp(1.2, 1, ease.outCubic(k)) : 1})`;
        const strikeN = o.strike || 0;
        let sk = 0;
        if (i < strikeN) sk = (i === strikeN - 1 && o.strike_t !== undefined) ? ease.outCubic(clamp((t - o.strike_t) / 0.3)) : 1;
        c.querySelector('.strike').style.transform = `rotate(-12deg) scaleX(${sk})`;
        const circ = c.querySelector('.circle');
        if (o.circle !== undefined && i === o.circle - 1) { const ck = clamp((t - (o.t ?? shot.start)) / 0.4); circ.style.opacity = ck; circ.style.transform = `scale(${lerp(1.4, 1, ease.outBack(ck, 2))}) rotate(${-8 + ck * 8}deg)`; }
        else circ.style.opacity = 0;
      });
    } else show(this.suspEl, false);
    // kayıt
    if (o.type === 'rec') {
      show(this.recEl, true);
      const [h, m, s] = (o.from || '03:11:58').split(':').map(Number);
      const lt = t - shot.start;
      const gl = o.glitch_t ?? 1e9;
      let sec = h * 3600 + m * 60 + s + Math.floor(lt);
      const inGl = t >= gl && t < gl + 1.3;
      if (t >= gl + 1.3) sec += 4;
      const f = (n) => String(n).padStart(2, '0');
      this.recTc.textContent = inGl ? '--:--:--' : `${f(Math.floor(sec / 3600))}:${f(Math.floor(sec / 60) % 60)}:${f(sec % 60)}`;
      this.recDot.style.opacity = Math.floor(lt * 2) % 2 ? 1 : 0.2;
      this.recNo.style.opacity = inGl ? (Math.floor(t * 12) % 2 ? 1 : 0.6) : 0;
      this.recStatic.style.opacity = inGl ? 1 : 0.15;
      const lk = clamp((t - gl - 1.3) / 0.3);
      this.recLost.style.opacity = lk; this.recLost.style.transform = `scale(${lerp(1.6, 1, ease.outBack(lk, 2))})`;
    } else show(this.recEl, false);
    // fotoğraf
    if (o.type === 'photo') {
      const k = clamp((t - shot.start) / 0.35);
      this.photoEl.style.opacity = k;
      const sk = clamp((t - shot.start - 0.6) / 0.25);
      this.photoStamp.style.opacity = sk; this.photoStamp.style.transform = `rotate(-12deg) scale(${lerp(2.2, 1, ease.outBack(sk, 2))})`;
    } else show(this.photoEl, false);
    if (o.type === 'photojoin') {
      const k = ease.inOutCubic(clamp((t - (o.t ?? shot.start) + 0.2) / 0.7));
      show(this.pjoinEl, true);
      this.pjL.style.left = `${lerp(-60, 210, k)}px`; this.pjR.style.left = `${lerp(810, 540, k)}px`;
      this.pjL.style.transform = `rotate(${lerp(-12, 0, k)}deg)`; this.pjR.style.transform = `rotate(${lerp(10, 0, k)}deg)`;
      this.pjStamp.parentElement.style.opacity = k >= 1 ? 1 : 0;
      const sk = clamp((t - (o.t ?? shot.start) - 0.55) / 0.25); this.pjStamp.style.transform = `rotate(-12deg) scale(${lerp(2.2, 1, ease.outBack(sk, 2))})`;
      this.pjoinEl.style.opacity = 1 - clamp((t - shot.end + 0.3) / 0.3);
    } else show(this.pjoinEl, false);
    if (o.type === 'network') {
      show(this.netEl, true);
      const c = D.projectChar(shot.cast[0]?.who, 0.1) || { x: 540, y: 800 };
      const pos = [[180, 420], [900, 470], [170, 1080], [880, 1030]];
      const sp = (shot.ve - shot.vs) * 0.8 / Math.max(1, o.items.length);
      this.netNodes.forEach((n, i) => {
        const k = clamp((t - shot.vs - i * sp) / 0.3);
        const [x, y] = pos[i % 4];
        n.style.left = `${x - n.offsetWidth / 2}px`; n.style.top = `${y}px`;
        n.style.opacity = k; n.style.transform = `scale(${lerp(0.3, 1, ease.outBack(k, 2))}) rotate(${(i % 2 ? 3 : -3)}deg)`;
        const ln = this.netLines[i]; ln.setAttribute('x1', c.x); ln.setAttribute('y1', c.y); ln.setAttribute('x2', lerp(c.x, x, k)); ln.setAttribute('y2', lerp(c.y, y + 30, k)); ln.style.opacity = k * 0.9;
      });
    } else show(this.netEl, false);
    // el ele (kalp)
    const hh = (this.tl.cues || []).find((q) => q.type === 'holdhands' && q.shot === shot.i);
    if (hh && t >= hh.t) {
      const k = t - hh.t; const p = D.projectMid('kerem', 'defne') || { x: 540, y: 900 };
      this.heartEl.style.left = `${p.x - 40}px`; this.heartEl.style.top = `${p.y - 120 - k * 30}px`;
      this.heartEl.style.opacity = clamp(k * 4) * (1 - clamp((k - 2.2) / 0.5));
      this.heartEl.style.transform = `scale(${ease.outBack(clamp(k / 0.4), 3) * (1 + 0.08 * Math.sin(k * 8))})`;
    } else this.heartEl.style.opacity = 0;
  }

  _captions(t) {
    const caps = this.tl.captions || [];
    let idx = -1;
    for (let i = 0; i < caps.length; i++) if (t >= caps[i].s && t < caps[i].e) { idx = i; break; }
    if (this.tl.cliff?.t !== undefined && t > this.tl.cliff.t + 0.2) idx = -1;
    if (idx !== this.curCap) {
      this.curCap = idx; this.capEl.innerHTML = ''; this.capWords = [];
      if (idx >= 0) {
        const cap = caps[idx];
        const style = cap.style === 'note' ? 'note' : cap.style === 'twist' ? 'twist' : cap.style === 'shout' ? 'shout' : '';
        if (cap.by && SPEAKER[cap.by] && !style) el('div', 'speaker', esc(SPEAKER[cap.by]), this.capEl);
        else if (['nuri', 'stranger', 'old'].includes(cap.style) && cap.by) el('div', 'speaker', esc(SPEAKER[cap.by] || up(cap.by)), this.capEl);
        if (style === 'note' || style === 'twist') el('div', 'speaker', style === 'twist' ? '✎ YABANCI BİR EL YAZISI' : '✎ NOT', this.capEl).style.borderColor = style === 'twist' ? '#c0281e' : '';
        const line = el('div', 'capline ' + style, '', this.capEl);
        cap.w.forEach((wi) => {
          const w = this.tl.words[wi];
          const txt = style === 'note' || style === 'twist' ? w.text : up(w.text);
          const s = el('span', 'w' + (w.emph ? ' emph' : '') + (w.tone ? ' ' + w.tone : ''), esc(txt), line);
          this.capWords.push({ el: s, w });
        });
        this.capLine = line;
        const base = style === 'note' ? 96 : style === 'twist' ? 120 : style === 'shout' ? 110 : 82;
        fitWidth(line, 880, [base, base - 8, base - 16, base - 24, base - 32], (fs) => this.capWords.forEach(({ el: e }) => (e.style.fontSize = fs + 'px')));
      }
    }
    if (idx < 0) return;
    const cap = caps[idx];
    const k = clamp((t - cap.s) / 0.15), outK = clamp((t - (cap.e - 0.07)) / 0.07);
    const rot = cap.style === 'note' ? -1.5 : cap.style === 'twist' ? 1.5 : 0;
    const shake = cap.style === 'shout' ? Math.sin(t * 60) * 6 : 0;
    this.capLine.style.transform = `rotate(${rot}deg) scale(${lerp(0.75, 1, ease.outBack(k, 2))}) translateX(${shake}px)`;
    this.capEl.style.opacity = clamp(k * 3) * (1 - outK);
    for (const { el: e, w } of this.capWords) {
      const on = t >= w.s - 0.03 && t < w.e + 0.02;
      e.classList.toggle('on', on);
      e.classList.toggle('said', t >= w.s - 0.03);
      const pk = clamp((t - w.s + 0.03) / 0.12);
      e.style.transform = on ? `scale(${1 + 0.07 * Math.sin(pk * Math.PI * 0.5)}) translateY(-4px)` : 'none';
    }
  }

  _end(t) {
    const c = this.tl.cliff;
    if (!c || c.t === undefined || t < c.t) { this.endEl.style.opacity = 0; return; }
    const k = t - c.t;
    this.endEl.style.opacity = clamp(k / 0.3);
    this.endParts.forEach((p, i) => {
      const kk = clamp((k - 0.1 - i * 0.16) / 0.35);
      p.style.opacity = kk;
      const base = i === 2 ? 'rotate(-2deg) ' : '';
      const pulse = i === 3 ? 1 + 0.05 * Math.max(0, Math.sin((k - 1.2) * 6)) : 1;
      p.style.transform = `${base}translateY(${(1 - ease.outBack(kk, 1.8)) * 60}px) scale(${(i === 1 ? lerp(1.5, 1, ease.outBack(kk, 1.6)) : 1) * pulse})`;
    });
  }
}
