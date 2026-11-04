// Template gallery: original label / tag / card designs that lay themselves out for ANY paper size.
// Each template is a function of the area size {W,H} (dots) returning designer objects. A small layout helper
// ("Stack") places text, icons, QR codes and barcodes top-to-bottom, shrinking everything uniformly until it fits.
import { newObject, measureTexts, fontStr, renderDesign } from './designer.js';

const scratch = document.createElement('canvas').getContext('2d');
const pad = (s) => Math.max(6, Math.round(Math.min(s.W, s.H) * 0.06));

function fitSize(text, w, max, o) {
  for (let size = max; size > 10; size -= 2) {
    scratch.font = fontStr({ ...o, size });
    if (scratch.measureText(String(text)).width <= w) return size;
  }
  return 10;
}

class Stack {
  constructor(s, { x = 0, y = 0, w = s.W, h = s.H, pad: p = pad(s), align = 'center', valign = 'middle' } = {}) {
    Object.assign(this, { s, x, y, w, h, p, align, valign, items: [] });
  }
  text(t, o = {}) { this.items.push({ k: 'text', t, size: 28, bold: true, font: 'sans', align: this.align, ...o }); return this; }
  icon(icon, size, o = {}) { this.items.push({ k: 'icon', icon, h: size, ...o }); return this; }
  qr(data, size, o = {}) { this.items.push({ k: 'qr', data, h: size, ...o }); return this; }
  bar(data, h, o = {}) { this.items.push({ k: 'barcode', data, h, ...o }); return this; }
  line(o = {}) { this.items.push({ k: 'line', h: (o.lw || 3) + 6, ...o }); return this; }
  gap(n) { this.items.push({ k: 'gap', h: n }); return this; }

  place(f) {
    const { s, p } = this, availW = this.w - 2 * p, x0 = this.x + p, out = [];
    let y = 0;
    for (const it of this.items) {
      const gapAfter = (it.gap ?? 4) * f;
      const ax = (w) => x0 + (it.align === 'left' ? 0 : it.align === 'right' ? availW - w : (availW - w) / 2);
      if (it.k === 'gap') { y += it.h * f; continue; }
      if (it.k === 'text') {
        const size = Math.round(it.fit ? fitSize(it.t, availW - 8, it.size * f, it) : it.size * f);
        const o = newObject('text', s, { text: it.t, x: x0, y, w: availW, size, bold: it.bold, italic: it.italic, font: it.font, align: it.align, inv: it.inv, ls: it.ls || 0 });
        measureTexts({ objects: [o] });
        out.push(o); y += o.h + gapAfter;
      } else if (it.k === 'line') {
        const w = availW * (it.wf || 1);
        out.push(newObject('line', s, { x: ax(w), y: y + 3, w, h: 0, lw: it.lw || 3, dash: it.dash })); y += it.h * f + gapAfter;
      } else {
        const h = Math.round(it.h * f), w = it.k === 'barcode' ? Math.round(availW * (it.wf || 1)) : h;
        const o = newObject(it.k, s, { x: Math.round(ax(w)), y: Math.round(y), w, h, ...(it.k === 'icon' ? { icon: it.icon } : it.k === 'qr' ? { data: it.data } : { data: it.data, hri: it.hri ?? true, format: 'CODE128' }) });
        out.push(o); y += h + gapAfter;
      }
    }
    return { out, total: y };
  }

  build() {
    const avail = this.h - 2 * this.p;
    let f = 1, res = this.place(f);
    for (let i = 0; i < 10 && res.total > avail; i++) { f *= 0.9; res = this.place(f); }
    const top = this.valign === 'top' ? this.y + this.p : this.y + Math.max(this.p, (this.h - res.total) / 2);
    for (const o of res.out) o.y = Math.round(o.y + top);
    return res.out;
  }
}

const frame = (s, { r = 10, lw = 3, dash = false, double = false, inset = 2 } = {}) => {
  const f = (i, rr) => newObject('rect', s, { x: i, y: i, w: s.W - 2 * i, h: s.H - 2 * i, lw, r: rr, dash });
  return double ? [f(inset, r), f(inset + lw * 2 + 2, Math.max(0, r - 4))] : [f(inset, r)];
};
const band = (s, text, { h = 0.24, size = 30, pos = 'top', ls = 2 } = {}) => {
  const bh = Math.round(s.H * h);
  const o = newObject('text', s, { text, x: 0, y: pos === 'top' ? 0 : s.H - bh, w: s.W, size: Math.min(size, Math.round(bh * 0.7)), align: 'center', inv: true, bold: true, ls });
  measureTexts({ objects: [o] });
  o.y = pos === 'top' ? 0 : s.H - o.h;
  return { objs: [o], used: o.h };
};
/** QR on the left (or top when the area is tall), content stack on the right. */
function withQR(s, data, fill, { frac = 0.42 } = {}) {
  const p = pad(s), wide = s.W >= s.H * 1.15;
  if (wide) {
    const q = Math.round(Math.min(s.H - 2 * p, s.W * frac));
    const st = new Stack(s, { x: p + q, w: s.W - p - q, pad: p });
    fill(st);
    return [newObject('qr', s, { data, x: p + 2, y: Math.round((s.H - q) / 2), w: q, h: q }), ...st.build()];
  }
  const q = Math.round(Math.min(s.W - 2 * p, s.H * 0.45));
  const st = new Stack(s, { y: q + p, h: s.H - q - p, pad: p, valign: 'top' });
  fill(st);
  return [newObject('qr', s, { data, x: Math.round((s.W - q) / 2), y: p, w: q, h: q }), ...st.build()];
}

// ---------------------------------------------------------------- the templates

export const CATEGORIES = ['Retail', 'Shipping', 'Name & badge', 'Home & kitchen', 'QR & contact', 'Gift & paper', 'Office'];
export const GALLERY = [];
const add = (id, cat, name, build) => GALLERY.push({ id, cat, name, build });
const u = (s) => Math.min(s.W, s.H);

// ----- Retail
add('price-bold', 'Retail', 'Price tag', (s) => [...frame(s, { r: 12, lw: 3 }),
  ...new Stack(s, { pad: pad(s) + 4 }).text('SPECIAL PRICE', { size: 24, bold: false, ls: 3, fit: true }).text('₹ 99', { size: 110, font: 'display', fit: true, gap: 2 }).text('per piece', { size: 22, bold: false }).build()]);

add('price-sale', 'Retail', 'Sale tag', (s) => {
  const b = band(s, 'SALE', { h: 0.28, size: 44, ls: 6 });
  return [...b.objs, ...new Stack(s, { y: b.used, h: s.H - b.used }).text('₹ 79', { size: 100, font: 'display', fit: true, gap: 0 }).text('was ₹ 129', { size: 24, bold: false }).build()];
});

add('product', 'Retail', 'Product + barcode', (s) => {
  const p = pad(s);
  return new Stack(s, { valign: 'top', pad: p }).text('PRODUCT NAME', { size: 34, align: 'left', fit: true }).text('₹ 99.00', { size: 52, align: 'left', font: 'display', fit: true }).gap(4).bar('890123456789', Math.max(40, Math.round(s.H * 0.34)), { gap: 0 }).build();
});

add('shelf', 'Retail', 'Shelf label', (s) => {
  const p = pad(s), wide = s.W >= s.H * 1.3;
  const price = new Stack(s, wide ? { x: 0, w: Math.round(s.W * 0.5), pad: p } : { pad: p, h: Math.round(s.H * 0.5), valign: 'top' }).text('₹ 249', { size: 96, font: 'display', fit: true, gap: 0 }).text('per kg', { size: 22, bold: false });
  const info = new Stack(s, wide ? { x: Math.round(s.W * 0.5), w: Math.round(s.W * 0.5), pad: p } : { y: Math.round(s.H * 0.5), h: Math.round(s.H * 0.5), pad: p, valign: 'top' }).text('Basmati Rice', { size: 28, fit: true }).text('SKU 10482', { size: 20, bold: false }).bar('10482', 54, { gap: 0 });
  return [...frame(s, { r: 6, lw: 2 }), ...price.build(), ...info.build()];
});

// ----- Shipping
add('address', 'Shipping', 'Address label', (s) => new Stack(s, { valign: 'top', align: 'left', pad: pad(s) + 2 })
  .text('TO', { size: 22, ls: 4, bold: false }).line({ lw: 2, gap: 2 }).text('Name Surname', { size: 40, fit: true }).text('Street address, Area\nCity – PIN code', { size: 26, bold: false }).gap(4).icon('phone', 28, { align: 'left' }).text('+00 00000 00000', { size: 24, bold: false }).build());

add('return', 'Shipping', 'Return address', (s) => [...frame(s, { r: 8, lw: 2, dash: true }),
  ...new Stack(s, { pad: pad(s) + 4 }).icon('home', 38).text('RETURN TO', { size: 20, ls: 3, bold: false }).text('Sender Name', { size: 32, fit: true }).text('Street, City, PIN', { size: 22, bold: false }).build()]);

add('fragile', 'Shipping', 'Fragile', (s) => [...frame(s, { r: 6, lw: 4, double: true }),
  ...new Stack(s, { pad: pad(s) + 10 }).icon('warning', Math.round(u(s) * 0.34)).text('FRAGILE', { size: 80, font: 'display', fit: true, gap: 0 }).text('HANDLE WITH CARE', { size: 24, ls: 2, fit: true }).build()]);

add('side-up', 'Shipping', 'This side up', (s) => {
  const arrow = newObject('icon', s, { icon: 'arrow', w: Math.round(u(s) * 0.5), h: Math.round(u(s) * 0.5), rot: 270 });
  const st = new Stack(s, { y: arrow.h, h: s.H - arrow.h }).text('THIS SIDE UP', { size: 46, font: 'display', fit: true });
  arrow.x = Math.round((s.W - arrow.w) / 2); arrow.y = pad(s) + 2;
  return [arrow, ...st.build()];
});

add('parcel', 'Shipping', 'Parcel + QR', (s) => withQR(s, 'ORDER-10482', (st) => st.text('ORDER', { size: 22, bold: false, ls: 3 }).text('#10482', { size: 54, font: 'display', fit: true }).text('Handle with care', { size: 20, bold: false })));

// ----- Name & badge
add('hello', 'Name & badge', 'Hello badge', (s) => {
  const b = band(s, 'HELLO', { h: 0.3, size: 40, ls: 8 });
  const sub = newObject('text', s, { text: 'my name is', x: 0, y: b.used + 2, w: s.W, size: Math.round(clamp(u(s) * 0.12, 14, 28)), align: 'center', bold: false });
  measureTexts({ objects: [sub] });
  const yy = b.used + sub.h;
  return [...b.objs, sub, ...new Stack(s, { y: yy, h: s.H - yy }).text('Your Name', { size: 70, font: 'script', bold: false, fit: true }).line({ wf: 0.7, lw: 2 }).build()];
});

add('nametag', 'Name & badge', 'Name tag', (s) => [...frame(s, { r: 14, lw: 3 }),
  ...new Stack(s, { pad: pad(s) + 6 }).text('YOUR NAME', { size: 60, font: 'round', fit: true, gap: 2 }).line({ wf: 0.5, lw: 3 }).text('Role · Team', { size: 24, bold: false }).build()]);

add('locker', 'Name & badge', 'Room / locker', (s) => {
  const b = band(s, 'ROOM', { h: 0.26, size: 34, ls: 6, pos: 'top' });
  return [...b.objs, ...new Stack(s, { y: b.used, h: s.H - b.used }).text('204', { size: 130, font: 'display', fit: true, gap: 0 }).text('Floor 2 · East wing', { size: 22, bold: false }).build()];
});

// ----- Home & kitchen
add('jar', 'Home & kitchen', 'Jar label', (s) => [...frame(s, { r: 18, lw: 3, double: true }),
  ...new Stack(s, { pad: pad(s) + 12 }).icon('leaf', Math.round(u(s) * 0.2)).text('Homemade Jam', { size: 44, font: 'script', bold: false, fit: true }).line({ wf: 0.6, lw: 2 }).text('Packed 04·11·2026', { size: 20, bold: false }).text('Best before 6 months', { size: 20, bold: false }).build()]);

add('spice', 'Home & kitchen', 'Spice label', (s) => [...frame(s, { r: 6, lw: 3 }),
  ...new Stack(s, { pad: pad(s) + 4 }).text('TURMERIC', { size: 54, font: 'display', fit: true, gap: 2 }).text('HALDI · ஹல்தி', { size: 22, bold: false, ls: 2 }).line({ wf: 0.8, lw: 2 }).text('Batch 07 · Nov 2026', { size: 20, bold: false }).build()]);

add('freezer', 'Home & kitchen', 'Freezer / expiry', (s) => {
  const b = band(s, 'USE BY', { h: 0.26, size: 30, ls: 5 });
  return [...b.objs, ...new Stack(s, { y: b.used, h: s.H - b.used }).text('12 NOV', { size: 84, font: 'display', fit: true, gap: 0 }).icon('clock', 30).text('Cooked 04 Nov · Rice', { size: 20, bold: false }).build()];
});

add('cable', 'Home & kitchen', 'Cable / device tag', (s) => new Stack(s, { pad: pad(s) + 2 }).icon('bolt', Math.round(u(s) * 0.28)).text('CHARGER', { size: 48, font: 'round', fit: true, gap: 2 }).line({ wf: 0.7, lw: 3 }).text('Living room · 65 W', { size: 22, bold: false }).build());

add('box', 'Home & kitchen', 'Storage box', (s) => {
  const b = band(s, 'BOX 04', { h: 0.28, size: 42, ls: 6 });
  return [...b.objs, ...new Stack(s, { y: b.used, h: s.H - b.used, align: 'left', valign: 'top', pad: pad(s) + 2 }).text('• Winter sweaters\n• Bed linen\n• Spare cables', { size: 28, bold: false }).build()];
});

add('allergen', 'Home & kitchen', 'Allergen note', (s) => [...frame(s, { r: 8, lw: 3 }),
  ...new Stack(s, { pad: pad(s) + 4 }).icon('warning', Math.round(u(s) * 0.26)).text('CONTAINS', { size: 26, ls: 4 }).text('NUTS · MILK · GLUTEN', { size: 30, font: 'narrow', fit: true }).build()]);

// ----- QR & contact
add('wifi', 'QR & contact', 'Wi-Fi card', (s) => withQR(s, 'WIFI:S:HomeNetwork;T:WPA;P:password123;;', (st) => st.icon('wifi', Math.round(u(s) * 0.2)).text('WI-FI', { size: 40, font: 'display', fit: true }).text('Network: HomeNetwork', { size: 20, bold: false }).text('Pass: password123', { size: 20, bold: false })));

add('scan', 'QR & contact', 'Scan me', (s) => {
  const b = band(s, 'SCAN ME', { h: 0.2, size: 30, ls: 6, pos: 'bottom' });
  const q = Math.round(Math.min(s.W - 2 * pad(s), s.H - b.used - 2 * pad(s)));
  return [newObject('qr', s, { data: 'https://example.com', x: Math.round((s.W - q) / 2), y: pad(s), w: q, h: q }), ...b.objs];
});

add('vcard', 'QR & contact', 'Contact card', (s) => withQR(s, 'BEGIN:VCARD\nVERSION:3.0\nFN:Your Name\nTEL:+000000000\nEND:VCARD', (st) => st.icon('person', Math.round(u(s) * 0.18)).text('Your Name', { size: 34, fit: true }).text('Role · Company', { size: 20, bold: false }).text('+00 00000 00000', { size: 20, bold: false }), { frac: 0.4 }));

// ----- Gift & paper
add('gift', 'Gift & paper', 'Gift tag', (s) => [...frame(s, { r: 16, lw: 3, dash: true }),
  ...new Stack(s, { pad: pad(s) + 8, align: 'left' }).icon('gift', Math.round(u(s) * 0.24), { align: 'center' }).text('To:', { size: 28, font: 'script', bold: false, gap: 0 }).line({ lw: 2, dash: true, gap: 6 }).text('From:', { size: 28, font: 'script', bold: false, gap: 0 }).line({ lw: 2, dash: true }).build()]);

add('thanks', 'Gift & paper', 'Thank you', (s) => [...frame(s, { r: 20, lw: 3, double: true }),
  ...new Stack(s, { pad: pad(s) + 12 }).icon('heart', Math.round(u(s) * 0.22)).text('Thank you', { size: 64, font: 'script', bold: false, fit: true }).text('for supporting small business', { size: 20, bold: false }).build()]);

add('bookmark', 'Gift & paper', 'Bookmark', (s) => [...frame(s, { r: 10, lw: 2 }),
  ...new Stack(s, { pad: pad(s) + 6 }).icon('star', Math.round(u(s) * 0.2)).text('READ MORE', { size: 40, font: 'display', fit: true }).line({ wf: 0.6, lw: 2 }).text('"A reader lives a\nthousand lives."', { size: 24, font: 'serif', italic: true, bold: false }).build()]);

add('quote', 'Gift & paper', 'Quote card', (s) => [...frame(s, { r: 4, lw: 2, inset: 4 }),
  ...new Stack(s, { pad: pad(s) + 8 }).text('“Done is better\nthan perfect.”', { size: 46, font: 'serif', italic: true, bold: false }).line({ wf: 0.3, lw: 2 }).text('— Anonymous', { size: 20, bold: false, ls: 2 }).build()]);

add('planner', 'Gift & paper', 'To-do strip', (s) => {
  const p = pad(s), items = Math.max(2, Math.min(5, Math.floor((s.H - 2 * p - 40) / 42)));
  const out = [...new Stack(s, { valign: 'top', pad: p, h: 40 + p }).text('TODAY', { size: 28, ls: 6, align: 'left' }).build()];
  for (let i = 0; i < items; i++) {
    const y = p + 40 + i * 42;
    out.push(newObject('rect', s, { x: p, y, w: 26, h: 26, lw: 3, r: 4 }), newObject('line', s, { x: p + 38, y: y + 24, w: s.W - 2 * p - 38, h: 0, lw: 2, dash: true }));
  }
  return out;
});

// ----- Office
add('asset', 'Office', 'Asset tag', (s) => [...frame(s, { r: 6, lw: 3 }),
  ...new Stack(s, { pad: pad(s) + 3 }).text('PROPERTY OF', { size: 20, ls: 4, bold: false }).text('YOUR COMPANY', { size: 34, font: 'narrow', fit: true }).bar('ASSET0042', Math.max(36, Math.round(s.H * 0.3)), { gap: 0 }).build()]);

add('caution', 'Office', 'Caution', (s) => {
  const b = band(s, 'CAUTION', { h: 0.28, size: 38, ls: 6 });
  return [...b.objs, ...new Stack(s, { y: b.used, h: s.H - b.used }).icon('warning', Math.round(u(s) * 0.3)).text('Hot surface – do not touch', { size: 26, fit: true }).build()];
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Draws a template at the given area size as a 1-bit canvas (used for the gallery thumbnails). */
export async function renderThumb(tpl, size) {
  return renderDesign({ objects: tpl.build(size), ink: null }, size);
}
