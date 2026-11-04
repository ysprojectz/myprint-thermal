// Interactive canvas designer: objects (text, image, QR, barcode, shapes) + a pen layer, drawn at printer-dot
// resolution (8 dots = 1 mm). The same paint code feeds the on-screen editor and the printed bitmap, so what you
// see is exactly what prints.
import { newCanvas, ctx2d, loadImage, bwFromCanvas, qrBitmap, barcodeBitmap, binarize } from './render.js';
import { iconPath } from './icons.js';

export const DPM = 8; // dots per millimetre at 203 dpi
const FONTS = {
  sans: '"Segoe UI","Helvetica Neue",Arial,"Noto Sans","Noto Sans Tamil","Noto Sans Devanagari","Nirmala UI",sans-serif',
  mono: '"SF Mono",Menlo,Consolas,"Courier New",monospace',
  serif: 'Georgia,"Times New Roman","Noto Serif",serif',
  display: '"Arial Black","Impact","Helvetica Neue",Arial,sans-serif',
  round: '"Arial Rounded MT Bold","Varela Round","Nunito","Trebuchet MS",sans-serif',
  script: '"Brush Script MT","Segoe Script","Snell Roundhand","Lucida Handwriting",cursive',
  narrow: '"Arial Narrow","Roboto Condensed","Helvetica Neue Condensed",Arial,sans-serif',
};
export const FONT_NAMES = { sans: 'Sans', display: 'Heavy', round: 'Rounded', narrow: 'Narrow', serif: 'Serif', script: 'Script', mono: 'Mono' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rad = (d) => (d * Math.PI) / 180;
let counter = 0;
const nid = () => `o${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyDesign = () => ({ objects: [], ink: null, heightMm: 80, trim: true });

// ---------------------------------------------------------------- objects

export function newObject(type, size, extra = {}) {
  const { W, H } = size;
  const base = { id: nid(), t: type, x: 0, y: 0, w: 100, h: 60, rot: 0 };
  const side = Math.round(Math.min(W, H) * 0.5 / 8) * 8;
  const defs = {
    text: { w: Math.round(W * 0.7), h: 40, text: 'Text', size: Math.round(clamp(H * 0.14, 24, 40)), bold: true, italic: false, font: 'sans', align: 'left', inv: false, ls: 0 },
    icon: { w: Math.round(side * 0.7), h: Math.round(side * 0.7), icon: 'star' },
    image: { w: Math.round(W * 0.5), h: Math.round(W * 0.5), src: null, r90: 0, flipH: false, flipV: false, dither: 'atkinson', brightness: 0, contrast: 0, invert: false, auto: true },
    qr: { w: side, h: side, data: 'https://example.com', ec: 'M' },
    barcode: { w: Math.round(W * 0.8), h: Math.round(clamp(H * 0.3, 56, 110)), data: '123456789012', format: 'CODE128', hri: true },
    rect: { w: Math.round(W * 0.6), h: Math.round(Math.min(H * 0.4, W * 0.4)), lw: 3, fill: false, r: 0, dash: false },
    ellipse: { w: Math.round(W * 0.5), h: Math.round(Math.min(H * 0.4, W * 0.4)), lw: 3, fill: false },
    line: { w: Math.round(W * 0.7), h: 0, lw: 3, arrow: false, dash: false },
  };
  const o = { ...base, ...defs[type], ...extra };
  if (extra.x === undefined) o.x = Math.round((W - o.w) / 2);
  if (extra.y === undefined) o.y = Math.round(Math.max(0, (H - o.h) / 2));
  return o;
}

/** Starter layouts for common labels; coordinates are in dots, scaled to the label. */
export const STARTERS = {
  blank: { name: 'Blank', build: () => [] },
  product: {
    name: 'Product label',
    build: (s) => [
      newObject('text', s, { text: 'PRODUCT NAME', x: 8, y: 6, w: s.W - 16, size: 34, align: 'left' }),
      newObject('text', s, { text: '₹ 99.00', x: 8, y: s.H - 120 > 60 ? 52 : 46, w: Math.round(s.W * 0.5), size: 44, align: 'left' }),
      newObject('barcode', s, { x: 8, y: s.H - Math.min(96, Math.round(s.H * 0.45)) - 6, w: s.W - 16, h: Math.min(96, Math.round(s.H * 0.45)), data: '8901234567890'.slice(0, 12), format: 'CODE128', hri: true }),
    ],
  },
  address: {
    name: 'Address label',
    build: (s) => [
      newObject('text', s, { text: 'TO:', x: 8, y: 6, w: 60, size: 24, bold: false }),
      newObject('text', s, { text: 'Name Surname\nStreet address\nCity, PIN', x: 8, y: 34, w: s.W - 16, size: 28, bold: true }),
    ],
  },
  qr: {
    name: 'QR + caption',
    build: (s) => {
      const q = Math.min(s.H - 16, Math.round(s.W * 0.45));
      return [
        newObject('qr', s, { x: 8, y: Math.round((s.H - q) / 2), w: q, h: q }),
        newObject('text', s, { text: 'SCAN ME', x: q + 20, y: Math.round(s.H / 2 - 24), w: s.W - q - 28, size: 34, align: 'center' }),
      ];
    },
  },
  nametag: {
    name: 'Name tag',
    build: (s) => [
      newObject('text', s, { text: 'HELLO', x: 8, y: 8, w: s.W - 16, size: 30, align: 'center', inv: true }),
      newObject('text', s, { text: 'Your Name', x: 8, y: Math.round(s.H * 0.4), w: s.W - 16, size: 48, align: 'center' }),
    ],
  },
  price: {
    name: 'Price tag',
    build: (s) => [
      newObject('text', s, { text: 'ITEM', x: 8, y: 6, w: s.W - 16, size: 26, align: 'center', bold: false }),
      newObject('text', s, { text: '₹ 149', x: 8, y: Math.round(s.H * 0.3), w: s.W - 16, size: Math.round(clamp(s.H * 0.4, 40, 80)), align: 'center' }),
    ],
  },
};

// ---------------------------------------------------------------- text layout & painting

const scratch = ctx2d(newCanvas(8, 8));
export const fontStr = (o) => `${o.italic ? 'italic ' : ''}${o.bold ? 700 : 400} ${o.size}px ${FONTS[o.font] || FONTS.sans}`;

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      let w = word;
      while (ctx.measureText(w).width > maxW && [...w].length > 1) {
        let n = [...w].length;
        while (n > 1 && ctx.measureText([...w].slice(0, n).join('')).width > maxW) n--;
        if (cur) { out.push(cur); cur = ''; }
        out.push([...w].slice(0, n).join(''));
        w = [...w].slice(n).join('');
      }
      const next = cur ? `${cur} ${w}` : w;
      if (!cur || ctx.measureText(next).width <= maxW) cur = next; else { out.push(cur); cur = w; }
    }
    out.push(cur);
  }
  return out;
}

/** Text boxes grow to fit their wrapped text. */
export function measureTexts(design) {
  for (const o of design.objects) {
    if (o.t !== 'text') continue;
    scratch.font = fontStr(o); scratch.letterSpacing = `${o.ls || 0}px`;
    o._lines = wrapLines(scratch, o.text, o.w - 8);
    o.h = Math.max(8, Math.round(o._lines.length * o.size * 1.2) + 4);
  }
}

const cache = new Map(); // key -> canvas | {error}
const keyOf = (o) => {
  switch (o.t) {
    case 'image': return `i|${o.src?.length}|${o.src?.slice(-24)}|${Math.round(o.w)}|${Math.round(o.h)}|${o.r90}|${o.flipH}|${o.flipV}|${o.dither}|${o.brightness}|${o.contrast}|${o.invert}|${o.auto}`;
    case 'qr': return `q|${o.data}|${o.ec}`;
    case 'barcode': return `b|${o.data}|${o.format}|${o.hri}|${Math.round(o.h)}`;
    default: return null;
  }
};
const hold = (k, v) => { cache.set(k, v); if (cache.size > 60) cache.delete(cache.keys().next().value); return v; };

/** Decodes / dithers / encodes everything that needs async or heavy work. Returns a list of error strings. */
export async function prepare(design) {
  const errors = [];
  for (const o of design.objects) {
    const k = keyOf(o);
    if (!k || cache.has(k)) { if (k && cache.get(k)?.error) errors.push(cache.get(k).error); continue; }
    try {
      if (o.t === 'image') {
        if (!o.src) continue;
        const im = await loadImage(o.src);
        const w = Math.max(8, Math.round(o.w)), h = Math.max(8, Math.round(o.h)), odd = o.r90 % 2 === 1;
        const c = newCanvas(w, h), ctx = ctx2d(c);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(w / 2, h / 2); ctx.rotate(rad(o.r90 * 90)); ctx.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
        const dw = odd ? h : w, dh = odd ? w : h;
        ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh);
        hold(k, bwFromCanvas(c, o));
      } else if (o.t === 'qr') hold(k, qrBitmap(o.data || ' ', o.ec, 1));
      else if (o.t === 'barcode') hold(k, barcodeBitmap(o.data, o.format, Math.max(20, Math.round(o.h) - (o.hri ? 22 : 0)), o.hri, 2));
    } catch (e) {
      const msg = o.t === 'qr' ? 'QR: data too long' : e.message;
      hold(k, { error: msg });
      errors.push(msg);
    }
  }
  return errors;
}

function paintObject(ctx, o) {
  ctx.save();
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
  ctx.rotate(rad(o.rot));
  ctx.translate(-o.w / 2, -o.h / 2);
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
  ctx.imageSmoothingEnabled = false;
  const bmp = cache.get(keyOf(o));
  switch (o.t) {
    case 'text': {
      if (o.inv) ctx.fillRect(0, 0, o.w, o.h);
      ctx.fillStyle = o.inv ? '#fff' : '#000';
      ctx.font = fontStr(o); ctx.textBaseline = 'top'; ctx.letterSpacing = `${o.ls || 0}px`;
      const lh = o.size * 1.2;
      (o._lines || []).forEach((l, i) => {
        const w = ctx.measureText(l).width;
        const x = o.align === 'center' ? (o.w - w) / 2 : o.align === 'right' ? o.w - w - 4 : 4;
        ctx.fillText(l, x, 2 + i * lh + (lh - o.size) / 2);
      });
      break;
    }
    case 'image': case 'qr': case 'barcode':
      if (bmp?.error) { ctx.lineWidth = 2; ctx.strokeRect(1, 1, o.w - 2, o.h - 2); ctx.font = '14px sans-serif'; ctx.textBaseline = 'top'; ctx.fillText(bmp.error, 6, 6); }
      else if (bmp) ctx.drawImage(bmp, 0, 0, o.w, o.h);
      break;
    case 'icon': ctx.scale(o.w / 24, o.h / 24); ctx.fill(iconPath(o.icon)); break;
    case 'rect': {
      ctx.lineWidth = o.lw; ctx.setLineDash(o.dash ? [o.lw * 3, o.lw * 2] : []);
      const x = o.fill ? 0 : o.lw / 2, y = o.fill ? 0 : o.lw / 2, w = o.fill ? o.w : o.w - o.lw, h = o.fill ? o.h : o.h - o.lw;
      ctx.beginPath();
      if (ctx.roundRect && o.r > 0) ctx.roundRect(x, y, w, h, Math.min(o.r, w / 2, h / 2)); else ctx.rect(x, y, w, h);
      o.fill ? ctx.fill() : ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'ellipse':
      ctx.lineWidth = o.lw; ctx.beginPath();
      ctx.ellipse(o.w / 2, o.h / 2, Math.max(1, o.w / 2 - o.lw / 2), Math.max(1, o.h / 2 - o.lw / 2), 0, 0, Math.PI * 2);
      o.fill ? ctx.fill() : ctx.stroke(); break;
    case 'line': {
      ctx.lineWidth = o.lw; ctx.lineCap = 'butt'; ctx.setLineDash(o.dash ? [o.lw * 3, o.lw * 2] : []);
      ctx.beginPath(); ctx.moveTo(0, o.h / 2); ctx.lineTo(o.w, o.h / 2); ctx.stroke(); ctx.setLineDash([]);
      if (o.arrow) { const a = o.lw * 4; ctx.beginPath(); ctx.moveTo(o.w, o.h / 2); ctx.lineTo(o.w - a, o.h / 2 - a / 1.6); ctx.lineTo(o.w - a, o.h / 2 + a / 1.6); ctx.closePath(); ctx.fill(); }
      break;
    }
  }
  ctx.restore();
}

/** Paints the whole design (white page, objects, then pen layer) onto ctx. `ink` is an optional canvas. */
export function paintDesign(ctx, design, size, ink) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.W, size.H);
  measureTexts(design);
  for (const o of design.objects) paintObject(ctx, o);
  if (ink) ctx.drawImage(ink, 0, 0);
}

/** Final 1-bit bitmap exactly as it will print. Throws if an object is invalid (e.g. a bad barcode value). */
export async function renderDesign(design, size) {
  const errors = await prepare(design);
  if (errors.length) throw new Error(errors[0]);
  const c = newCanvas(size.W, size.H);
  let ink = null;
  if (design.ink) ink = await loadImage(design.ink);
  paintDesign(ctx2d(c), design, size, ink);
  return binarize(c, 140);
}

/** Roll printing: drop the empty paper below the last object so you don't waste roll. */
export function trimCanvas(c, pad = 16) {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  let last = -1;
  for (let y = c.height - 1; y >= 0 && last < 0; y--) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4] < 128) { last = y; break; }
  const h = Math.min(c.height, Math.max(8, last + 1 + pad));
  if (h >= c.height) return c;
  const out = newCanvas(c.width, h);
  ctx2d(out).drawImage(c, 0, 0);
  return out;
}

/** Centre a design bitmap on the full print head (labels narrower than the head). */
export function padToHead(c, head) {
  if (c.width >= head) return c;
  const out = newCanvas(head, c.height), ctx = ctx2d(out);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, head, c.height);
  ctx.drawImage(c, Math.floor((head - c.width) / 2 / 8) * 8, 0);
  return out;
}

// ---------------------------------------------------------------- geometry helpers

const center = (o) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
function toLocal(o, p) { // world dots -> object-local dots (origin top-left, unrotated)
  const c = center(o), a = -rad(o.rot), dx = p.x - c.x, dy = p.y - c.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a) + o.w / 2, y: dx * Math.sin(a) + dy * Math.cos(a) + o.h / 2 };
}
function corners(o) {
  const c = center(o), a = rad(o.rot), cos = Math.cos(a), sin = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = (sx * o.w) / 2, ly = (sy * o.h) / 2;
    return { x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos };
  });
}
function aabb(o) {
  const cs = corners(o), xs = cs.map((p) => p.x), ys = cs.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Millimetre rulers (8 dots = 1 mm) sized to the paper at the given css-px-per-dot scale. */
export function drawRulers(rt, rl, W, H, s, cursor) {
  const color = getComputedStyle(document.body).color;
  rt.width = Math.round(W * s); rt.height = 18; rl.width = 22; rl.height = Math.round(H * s);
  rt.style.width = rt.width + 'px'; rl.style.height = rl.height + 'px';
  const pxmm = DPM * s, step = pxmm >= 6 ? 1 : pxmm >= 2.5 ? 5 : 10;
  for (const [c, horiz] of [[rt, true], [rl, false]]) {
    const ctx = c.getContext('2d'), len = horiz ? W / DPM : H / DPM;
    ctx.clearRect(0, 0, c.width, c.height); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.font = '10px system-ui'; ctx.lineWidth = 1;
    for (let mm = 0; mm <= len; mm += step) {
      const p = mm * pxmm, big = mm % 10 === 0, mid = mm % 5 === 0, L = big ? 12 : mid ? 8 : 4;
      ctx.beginPath();
      if (horiz) { ctx.moveTo(p + .5, 18); ctx.lineTo(p + .5, 18 - L); } else { ctx.moveTo(22, p + .5); ctx.lineTo(22 - L, p + .5); }
      ctx.stroke();
      if (big && mm) {
        if (horiz) ctx.fillText(String(mm / 10), p + 2, 9);
        else { ctx.save(); ctx.translate(9, p + 2); ctx.rotate(-Math.PI / 2); ctx.fillText(String(mm / 10), -8, 0); ctx.restore(); }
      }
    }
    if (cursor) {
      ctx.strokeStyle = '#e11d48'; ctx.beginPath();
      if (horiz) { ctx.moveTo(cursor.x * s, 0); ctx.lineTo(cursor.x * s, 18); } else { ctx.moveTo(0, cursor.y * s); ctx.lineTo(22, cursor.y * s); }
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------- editor

export class Editor {
  /**
   * ui: { display, overlay, rulerTop, rulerLeft, stage }   hooks: { design(), size(), changed(), selected(obj|null), active() }
   */
  constructor(ui, hooks) {
    this.ui = ui; this.h = hooks;
    this.sel = null; this.tool = 'select'; this.pen = { size: 4, eraser: false };
    this.zoom = 'fit'; this.scale = 1; this.guides = []; this.drag = null; this.cursor = null;
    this.hist = []; this.histIdx = -1; this.ink = null; this.snap = true;
    const o = ui.overlay;
    o.onpointerdown = (e) => this.down(e);
    o.onpointermove = (e) => this.move(e);
    o.onpointerup = o.onpointercancel = (e) => this.up(e);
    o.onpointerleave = () => { this.cursor = null; this.drawRulers(); };
    o.ondblclick = () => { if (this.sel?.t === 'text') this.h.edit?.(); };
    this.ptrs = new Map();
    o.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY); } }, { passive: false });
    this.keyHandler = (e) => this.key(e);
    document.addEventListener('keydown', this.keyHandler);
    this.ro = new ResizeObserver(() => { if (this.zoom === 'fit') this.redraw(); });
    this.ro.observe(ui.stage);
  }

  destroy() { document.removeEventListener('keydown', this.keyHandler); this.ro.disconnect(); }
  get design() { return this.h.design(); }
  get size() { return this.h.size(); }

  // ----- view
  setZoom(z) { this.zoom = z; this.redraw(); }
  computeScale() {
    const { W } = this.size, avail = Math.max(120, this.ui.stage.clientWidth - 44);
    const mm = 96 / 25.4 / DPM; // css px per dot at true physical size
    this.scale = this.zoom === 'custom' ? this.zf : this.zoom === 'fit' ? Math.min(avail / W, 2.4) : this.zoom === 'actual' ? mm : Number(this.zoom) * mm;
    return this.scale;
  }
  /** Zoom around a screen point (wheel / pinch / buttons). factor > 1 zooms in. */
  zoomBy(f, cx, cy) {
    const ov = this.ui.overlay, r = ov.getBoundingClientRect(), old = this.scale, ns = clamp(old * f, 0.25, 8);
    if (ns === old) return;
    const ax = cx ?? r.left + r.width / 2, ay = cy ?? r.top + r.height / 2;
    const dx = (ax - r.left) / old, dy = (ay - r.top) / old;
    this.zoom = 'custom'; this.zf = ns; this.relayout();
    const r2 = ov.getBoundingClientRect();
    this.ui.stage.scrollLeft += r2.left + dx * ns - ax; this.ui.stage.scrollTop += r2.top + dy * ns - ay;
  }
  fitView() { this.zoom = 'fit'; this.relayout(); }
  /** Synchronous part of a redraw: sizes only (zoom never needs to repaint the pixels). */
  relayout() {
    const { W, H } = this.size, s = this.computeScale(), { display, overlay } = this.ui;
    display.style.width = Math.round(W * s) + 'px'; display.style.height = Math.round(H * s) + 'px';
    overlay.width = Math.round(W * s); overlay.height = Math.round(H * s);
    overlay.style.width = overlay.width + 'px'; overlay.style.height = overlay.height + 'px';
    this.drawOverlay(); this.drawRulers(); this.h.zoomed?.(s);
  }
  async syncInk() {
    const { W, H } = this.size, d = this.design;
    if (!this.ink || this.ink.width !== W || this.ink.height !== H) {
      const old = this.ink;
      this.ink = newCanvas(W, H);
      if (d.ink) { try { ctx2d(this.ink).drawImage(await loadImage(d.ink), 0, 0); } catch { /* ignore */ } }
      else if (old) ctx2d(this.ink).drawImage(old, 0, 0);
    }
  }

  async redraw() {
    const { W, H } = this.size, { display } = this.ui;
    const token = (this.token = (this.token || 0) + 1);
    await this.syncInk();
    await prepare(this.design);
    if (token !== this.token) return;
    display.width = W; display.height = H;
    paintDesign(ctx2d(display), this.design, this.size, this.ink);
    binarize(display, 140);
    this.relayout();
  }

  /** Cheap repaint while dragging (objects only; caches are warm). */
  quick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      paintDesign(ctx2d(this.ui.display), this.design, this.size, this.ink);
      binarize(this.ui.display, 140);
      this.drawOverlay();
    });
  }

  drawOverlay() {
    const o = this.ui.overlay, ctx = o.getContext('2d'), s = this.scale;
    ctx.clearRect(0, 0, o.width, o.height);
    if (this.tool !== 'select') return;
    const el = this.sel;
    if (el) {
      const cs = corners(el).map((p) => [p.x * s, p.y * s]);
      ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); cs.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      for (const [x, y] of cs) { ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); }
      const r = this.rotHandle(el); // rotation knob
      ctx.beginPath(); ctx.moveTo((cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2); ctx.lineTo(r.x * s, r.y * s); ctx.stroke();
      ctx.beginPath(); ctx.arc(r.x * s, r.y * s, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = '#d946ef'; ctx.lineWidth = 1;
    for (const g of this.guides) { ctx.beginPath(); if (g.x !== undefined) { ctx.moveTo(g.x * s, 0); ctx.lineTo(g.x * s, o.height); } else { ctx.moveTo(0, g.y * s); ctx.lineTo(o.width, g.y * s); } ctx.stroke(); }
  }

  rotHandle(el) {
    const c = center(el), a = rad(el.rot), d = el.h / 2 + 22 / this.scale;
    return { x: c.x + Math.sin(a) * d, y: c.y - Math.cos(a) * d };
  }

  drawRulers() { drawRulers(this.ui.rulerTop, this.ui.rulerLeft, this.size.W, this.size.H, this.scale, this.cursor); }

  // ----- selection / mutation
  select(el) { this.sel = el; this.h.selected?.(el); this.drawOverlay(); }
  commit() { this.pushHistory(); this.h.changed?.(); }
  pushHistory() {
    const snap = JSON.stringify(this.design.objects.map(({ _lines, ...r }) => r));
    if (this.hist[this.histIdx] === snap) return;
    this.hist = this.hist.slice(0, this.histIdx + 1); this.hist.push(snap); if (this.hist.length > 60) this.hist.shift();
    this.histIdx = this.hist.length - 1;
  }
  resetHistory() { this.hist = []; this.histIdx = -1; this.pushHistory(); }
  undo() { if (this.histIdx > 0) this.restore(--this.histIdx); }
  redo() { if (this.histIdx < this.hist.length - 1) this.restore(++this.histIdx); }
  restore(i) {
    const id = this.sel?.id;
    this.design.objects = JSON.parse(this.hist[i]);
    this.select(this.design.objects.find((o) => o.id === id) || null);
    this.h.changed?.(); this.redraw();
  }
  add(type, extra = {}) {
    const o = newObject(type, this.size, extra);
    this.design.objects.push(o); this.select(o); this.commit(); this.redraw();
    return o;
  }
  update(patch, quick = false) {
    if (!this.sel) return;
    Object.assign(this.sel, patch);
    if (this.sel.t === 'qr' || this.sel.t === 'icon') this.sel.h = this.sel.w;
    this.h.changed?.();
    quick ? this.quick() : this.redraw();
  }
  remove() {
    if (!this.sel) return;
    this.design.objects = this.design.objects.filter((o) => o !== this.sel);
    this.select(null); this.commit(); this.redraw();
  }
  duplicate() {
    if (!this.sel) return;
    const { _lines, ...r } = this.sel, o = { ...JSON.parse(JSON.stringify(r)), id: nid(), x: r.x + 16, y: r.y + 16 };
    this.design.objects.push(o); this.select(o); this.commit(); this.redraw();
  }
  order(dir) {
    const a = this.design.objects, i = a.indexOf(this.sel);
    if (i < 0) return;
    a.splice(i, 1);
    a.splice(dir === 'front' ? a.length : dir === 'back' ? 0 : clamp(i + (dir === 'up' ? 1 : -1), 0, a.length), 0, this.sel);
    this.commit(); this.redraw();
  }
  rotate90(step = 1) {
    const o = this.sel;
    if (!o) return;
    if (o.t === 'image') { o.r90 = (o.r90 + step + 4) % 4; const c = center(o); [o.w, o.h] = [o.h, o.w]; o.x = c.x - o.w / 2; o.y = c.y - o.h / 2; }
    else o.rot = (((o.rot + 90 * step) % 360) + 360) % 360;
    this.commit(); this.redraw();
  }
  flip(axis) { if (this.sel?.t === 'image') { this.sel[axis === 'h' ? 'flipH' : 'flipV'] = !this.sel[axis === 'h' ? 'flipH' : 'flipV']; this.commit(); this.redraw(); } }
  /** Align the selected object to the paper: left|center|right|top|middle|bottom. */
  align(dir) {
    const o = this.sel;
    if (!o) return;
    const b = aabb(o), { W, H } = this.size;
    if (dir === 'left') o.x += 0 - b.x0;
    if (dir === 'right') o.x += W - b.x1;
    if (dir === 'center') o.x += W / 2 - (b.x0 + b.x1) / 2;
    if (dir === 'top') o.y += 0 - b.y0;
    if (dir === 'bottom') o.y += H - b.y1;
    if (dir === 'middle') o.y += H / 2 - (b.y0 + b.y1) / 2;
    this.commit(); this.h.selected?.(o); this.redraw();
  }
  fit() { // scale selected image/QR/barcode to the paper width keeping its aspect
    const o = this.sel;
    if (!o) return;
    const k = this.size.W / o.w; o.w = Math.round(o.w * k); o.h = Math.round(o.h * k); o.x = 0;
    if (o.y + o.h > this.size.H) o.y = Math.max(0, this.size.H - o.h);
    this.commit(); this.h.selected?.(o); this.redraw();
  }
  clearInk() { this.ink = newCanvas(this.size.W, this.size.H); this.design.ink = null; this.h.changed?.(); this.redraw(); }

  // ----- pointer interaction
  pt(e) { const r = this.ui.overlay.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * this.size.W, y: ((e.clientY - r.top) / r.height) * this.size.H }; }
  hit(p) {
    const pad = 6 / this.scale;
    for (let i = this.design.objects.length - 1; i >= 0; i--) {
      const o = this.design.objects[i], l = toLocal(o, p);
      if (l.x >= -pad && l.x <= o.w + pad && l.y >= -pad && l.y <= o.h + pad) return o;
    }
    return null;
  }
  down(e) {
    const p = this.pt(e);
    this.ui.overlay.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 2) { // two fingers: pinch-zoom
      const [a, b] = [...this.ptrs.values()];
      this.drag = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: this.scale };
      return;
    }
    if (this.tool !== 'select') { this.drag = { mode: 'ink', last: p }; this.stroke(p, p); return; }
    const el = this.sel, tol = 10 / this.scale;
    if (el) {
      const r = this.rotHandle(el);
      if (Math.hypot(p.x - r.x, p.y - r.y) < tol) { this.drag = { mode: 'rotate' }; return; }
      const cs = corners(el);
      const ci = cs.findIndex((c) => Math.hypot(p.x - c.x, p.y - c.y) < tol);
      if (ci >= 0) { this.drag = { mode: 'resize', anchor: cs[(ci + 2) % 4], ci, aspect: el.w / Math.max(1, el.h) }; return; }
    }
    const h = this.hit(p);
    this.select(h);
    if (h) this.drag = { mode: 'move', dx: p.x - h.x, dy: p.y - h.y, moved: false };
    else this.drag = { mode: 'pan', x: e.clientX, y: e.clientY, sl: this.ui.stage.scrollLeft, st: this.ui.stage.scrollTop }; // empty space: pan
  }
  move(e) {
    const p = this.pt(e);
    this.cursor = p; this.drawRulers();
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag, el = this.sel;
    if (!d) return;
    if (d.mode === 'pinch') {
      if (this.ptrs.size < 2) return;
      const [a, b] = [...this.ptrs.values()], dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoomBy((d.s0 * dist / d.d0) / this.scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (d.mode === 'pan') { this.ui.stage.scrollLeft = d.sl - (e.clientX - d.x); this.ui.stage.scrollTop = d.st - (e.clientY - d.y); return; }
    if (d.mode === 'ink') { this.stroke(d.last, p); d.last = p; return; }
    if (!el) return;
    if (d.mode === 'move') {
      let x = p.x - d.dx, y = p.y - d.dy;
      this.guides = [];
      if (this.snap) {
        const tx = [0, this.size.W / 2, this.size.W], ty = [0, this.size.H / 2, this.size.H];
        for (const o of this.design.objects) if (o !== el) { tx.push(o.x, o.x + o.w / 2, o.x + o.w); ty.push(o.y, o.y + o.h / 2, o.y + o.h); }
        const th = 5 / this.scale;
        const best = (cands, tg) => { let m = null; for (const c of cands) for (const t of tg) { const dd = t - c; if (Math.abs(dd) < th && (!m || Math.abs(dd) < Math.abs(m.d))) m = { d: dd, t }; } return m; };
        const bx = best([x, x + el.w / 2, x + el.w], tx), by = best([y, y + el.h / 2, y + el.h], ty);
        if (bx) { x += bx.d; this.guides.push({ x: bx.t }); }
        if (by) { y += by.d; this.guides.push({ y: by.t }); }
      }
      el.x = Math.round(x); el.y = Math.round(y); d.moved = true;
    } else if (d.mode === 'rotate') {
      const c = center(el);
      let a = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
      a = ((a % 360) + 360) % 360;
      for (const t of [0, 90, 180, 270, 360]) if (Math.abs(a - t) < 4) a = t % 360;
      el.rot = Math.round(a) % 360;
    } else if (d.mode === 'resize') {
      const a = d.anchor, ang = -rad(el.rot), c = center(el);
      const rel = (q) => ({ x: (q.x - c.x) * Math.cos(ang) - (q.y - c.y) * Math.sin(ang), y: (q.x - c.x) * Math.sin(ang) + (q.y - c.y) * Math.cos(ang) });
      const la = rel(a); let lp = rel(p);
      let w = Math.max(8, Math.abs(lp.x - la.x)), h = Math.max(8, Math.abs(lp.y - la.y));
      if (el.t === 'qr' || el.t === 'icon') w = h = Math.max(w, h); // QR codes and icons stay square
      else if (el.t === 'image' || e.shiftKey) { const k = Math.max(w / d.aspect, h); h = k; w = k * d.aspect; } // keep aspect
      if (el.t === 'line') h = Math.max(0, h);
      const sx = lp.x >= la.x ? 1 : -1, sy = lp.y >= la.y ? 1 : -1;
      lp = { x: la.x + sx * w, y: la.y + sy * h };
      const mid = { x: (la.x + lp.x) / 2, y: (la.y + lp.y) / 2 }, r = rad(el.rot);
      const nc = { x: c.x + mid.x * Math.cos(r) - mid.y * Math.sin(r), y: c.y + mid.x * Math.sin(r) + mid.y * Math.cos(r) };
      el.w = Math.round(w); el.h = Math.round(h); el.x = Math.round(nc.x - el.w / 2); el.y = Math.round(nc.y - el.h / 2);
    }
    this.h.changed?.(true);
    this.quick();
  }
  up(e) {
    const d = this.drag;
    this.ptrs.delete(e.pointerId);
    if (d?.mode === 'pinch') { if (this.ptrs.size < 2) this.drag = null; return; }
    this.drag = null; this.guides = [];
    if (!d || d.mode === 'pan') return;
    if (d.mode === 'ink') { this.design.ink = this.ink.toDataURL('image/png'); this.h.changed?.(); return; }
    this.h.selected?.(this.sel);
    this.commit(); this.redraw();
  }
  stroke(a, b) {
    const ctx = ctx2d(this.ink);
    ctx.lineCap = ctx.lineJoin = 'round';
    if (this.pen.eraser) { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = this.pen.size * 3; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = '#000'; ctx.lineWidth = this.pen.size; }
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x + 0.01, b.y); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    this.quick();
  }
  key(e) {
    if (!this.h.active?.() || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const el = this.sel, step = e.shiftKey ? DPM : 1;
    if ((e.key === 'Delete' || e.key === 'Backspace') && el) { e.preventDefault(); this.remove(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicate(); }
    else if (el && e.key.startsWith('Arrow')) {
      e.preventDefault();
      el.x += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      el.y += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.h.changed?.(true); this.quick(); clearTimeout(this.nt); this.nt = setTimeout(() => this.commit(), 400);
    }
  }
}
