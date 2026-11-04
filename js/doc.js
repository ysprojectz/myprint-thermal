// Builders that turn UI state into print "blocks" (the printer-independent document model).
//
// Block types:
//   text    {text, align, bold, ul, inv, size 1-4}
//   row     {left, right, bold, size}            left text + right-aligned text on one line
//   hr      {style: dash|solid|double|dot}
//   qr      {data, size, ec, align}
//   barcode {data, format, height, width, hri, align}
//   image   {src, scale, dither, brightness, contrast, align}
//   pattern {kind: ruler|gradient|checker}
//   feed    {n}     cut {}

export const text = (t, o = {}) => ({ t: 'text', text: t, ...o });
export const row = (left, right, o = {}) => ({ t: 'row', left, right, ...o });
export const hr = (style = 'dash') => ({ t: 'hr', style });
export const feed = (n = 1) => ({ t: 'feed', n });

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const flat = (s) => String(s ?? '').replace(/[  ]/g, ' ');

export function formatMoney(n, shop) {
  return `${shop.currency || ''}${num(n).toFixed(Math.max(0, Math.min(4, shop.decimals ?? 2)))}`;
}

export function receiptNumber(shop, r) {
  return r.no?.trim() || `${shop.prefix || ''}${String(shop.receiptNo || 1).padStart(4, '0')}`;
}

export function receiptTotals(r, shop) {
  const sub = (r.items || []).reduce((s, i) => s + num(i.qty) * num(i.price), 0);
  const disc = Math.min(sub, r.discountType === 'percent' ? (sub * num(r.discount)) / 100 : num(r.discount));
  const base = sub - disc;
  const rate = num(shop.taxRate);
  const inclusive = shop.taxMode === 'included';
  const tax = inclusive ? (base * rate) / (100 + rate) : (base * rate) / 100;
  const total = inclusive ? base : base + tax;
  return { sub, disc, tax, total, inclusive, rate };
}

export function receiptBlocks(r, shop, date = new Date()) {
  const m = (n) => formatMoney(n, shop);
  const b = [];
  if (shop.name) b.push(text(shop.name, { align: 'center', bold: true, size: 2 }));
  for (const l of [shop.address, shop.phone, shop.taxId && `${shop.taxIdLabel || 'Tax ID'}: ${shop.taxId}`])
    if (l) b.push(text(l, { align: 'center' }));
  b.push(hr('dash'));
  if (r.title) b.push(text(r.title, { align: 'center', bold: true }));
  b.push(row('No', receiptNumber(shop, r)));
  b.push(row('Date', flat(date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))));
  if (r.cashier) b.push(row('Cashier', r.cashier));
  if (r.customer) b.push(row('Customer', r.customer));
  b.push(hr('dash'));

  for (const it of r.items || []) {
    if (!it.name && !num(it.price)) continue;
    const qty = num(it.qty) || 1;
    b.push(text(it.name || 'Item', { bold: true }));
    b.push(row(`  ${qty} x ${m(it.price)}`, m(qty * num(it.price))));
  }
  b.push(hr('dash'));

  const t = receiptTotals(r, shop);
  b.push(row('Subtotal', m(t.sub)));
  if (t.disc) b.push(row(r.discountType === 'percent' ? `Discount (${num(r.discount)}%)` : 'Discount', '-' + m(t.disc)));
  if (t.rate) b.push(row(`${shop.taxLabel || 'Tax'} ${t.rate}%${t.inclusive ? ' (incl.)' : ''}`, m(t.tax)));
  b.push(hr('double'));
  b.push(row('TOTAL', m(t.total), { bold: true, size: 2 }));
  b.push(hr('double'));
  if (r.payMethod) b.push(row('Payment', r.payMethod));
  if (num(r.paid) > 0) {
    b.push(row('Paid', m(r.paid)));
    const diff = num(r.paid) - t.total;
    b.push(diff >= 0 ? row('Change', m(diff)) : row('Balance due', m(-diff), { bold: true }));
  }
  if (r.note) b.push(text(r.note, { align: 'center' }));
  if (shop.footer) { b.push(feed(1)); b.push(text(shop.footer, { align: 'center' })); }
  if (r.qrOn && r.qrData) { b.push(feed(1)); b.push({ t: 'qr', data: r.qrData, size: 6, ec: 'M', align: 'center' }); }
  if (r.barOn) b.push({ t: 'barcode', data: receiptNumber(shop, r), format: 'CODE128', height: 50, width: 2, hri: true, align: 'center' });
  return b;
}

/**
 * Mini markup for the Text tab:
 *   # big title   ## bold line   --- dashed rule   === double rule
 *   >> right      <> centered    left | right  (two-column row)
 *   [qr:data]  [bar:data]  [feed:3]  [cut]
 */
export function markupBlocks(src, o = {}) {
  const base = { align: o.align || 'left', bold: !!o.bold, size: o.size || 1 };
  const out = [];
  for (const raw of String(src ?? '').split('\n')) {
    const l = raw.replace(/\s+$/, '');
    let m;
    if (!o.markup) out.push(text(l, base));
    else if (l === '---') out.push(hr('dash'));
    else if (l === '===') out.push(hr('double'));
    else if (l.startsWith('## ')) out.push(text(l.slice(3), { ...base, bold: true }));
    else if (l.startsWith('# ')) out.push(text(l.slice(2), { ...base, align: 'center', bold: true, size: Math.max(2, base.size) }));
    else if (l.startsWith('>> ')) out.push(text(l.slice(3), { ...base, align: 'right' }));
    else if (l.startsWith('<> ')) out.push(text(l.slice(3), { ...base, align: 'center' }));
    else if ((m = l.match(/^\[qr:(.+)\]$/))) out.push({ t: 'qr', data: m[1], size: 6, ec: 'M', align: 'center' });
    else if ((m = l.match(/^\[bar:(.+)\]$/))) out.push({ t: 'barcode', data: m[1], format: 'CODE128', height: 50, width: 2, hri: true, align: 'center' });
    else if ((m = l.match(/^\[feed:(\d+)\]$/))) out.push(feed(Math.min(20, +m[1])));
    else if (l === '[cut]') out.push({ t: 'cut' });
    else if (l.includes(' | ')) { const i = l.indexOf(' | '); out.push(row(l.slice(0, i), l.slice(i + 3), base)); }
    else out.push(text(l, base));
  }
  return out;
}

export function codeBlocks(c) {
  const b = [];
  if (c.type === 'qr') b.push({ t: 'qr', data: c.data, size: num(c.size) || 6, ec: c.ec || 'M', align: c.align || 'center' });
  else b.push({ t: 'barcode', data: c.data, format: c.format, height: num(c.height) || 60, width: num(c.width) || 2, hri: !!c.hri, align: c.align || 'center' });
  if (c.caption) b.push(text(c.caption, { align: c.align || 'center', bold: true }));
  return b;
}

export function imageBlocks(i) {
  if (!i.src) return [];
  return [{ t: 'image', src: i.src, scale: num(i.scale) || 100, dither: i.dither, brightness: num(i.brightness), contrast: num(i.contrast), align: i.align || 'center' }];
}

// ---------------------------------------------------------------- diagnostics

export function testPageBlocks(cfg) {
  const mm = (cfg.dots / 8).toFixed(0);
  return [
    text('MyPrint test', { align: 'center', bold: true, size: 2 }),
    hr('double'),
    row('Paper width', `${mm} mm`),
    row('Printable', `${cfg.dots - 2 * cfg.margin} dots`),
    row('Codepage', cfg.codepage),
    row('Font', cfg.font),
    hr('dash'),
    text('Normal text 0123456789'),
    text('Bold text', { bold: true }),
    text('Underlined', { ul: true }),
    text('Inverted', { inv: true }),
    text('Double size', { size: 2 }),
    text('Left', { align: 'left' }), text('Center', { align: 'center' }), text('Right', { align: 'right' }),
    hr('dash'),
    text('Latin: Ç ü é ñ Ü ß ¿ ½ « » £'),
    row('Item left', 'right 12.50'),
    { t: 'pattern', kind: 'ruler' },
    { t: 'pattern', kind: 'gradient' },
    { t: 'pattern', kind: 'checker' },
    { t: 'qr', data: 'https://github.com/', size: 5, ec: 'M', align: 'center' },
    { t: 'barcode', data: 'MYPRINT-0001', format: 'CODE128', height: 50, width: 2, hri: true, align: 'center' },
    text('End of test', { align: 'center' }),
  ];
}

export function unicodeTestBlocks() {
  return [
    text('Unicode / graphic mode', { align: 'center', bold: true, size: 2 }),
    hr('dash'),
    text('Currency: ₹ € £ ¥ ₩ ₺ ₫'),
    text('தமிழ் — வணக்கம்'),
    text('हिन्दी — नमस्ते'),
    text('മലയാളം — നമസ്കാരം'),
    text('తెలుగు — నమస్కారం'),
    text('العربية — مرحبا'),
    text('中文 — 你好   日本語 — こんにちは'),
    text('Emoji ✓ ★ ♥ ☎ ✉'),
  ];
}
