// "Studio" templates (ported from Thermal Print Studio): each has default data, a form schema and a block builder.
// Builders return the same printer-independent blocks as doc.js, so they print in native or graphic mode.
import { text, row, hr, feed } from './doc.js';
import { columns } from './escpos.js';
import { clipartDataUrl, CLIPART } from './clipart.js';

const dayLong = () => new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const dayShort = () => new Date().toLocaleDateString('en-GB');
const box = (v) => (v ? '[X]' : '[ ]');
const qr = (data, size = 6) => ({ t: 'qr', data, size, ec: 'M', align: 'center' });
const wifiEsc = (s) => String(s ?? '').replace(/([\\;,:"])/g, '\\$1');
const clip = (s, n) => String(s ?? '').slice(0, n);

const opts = (...pairs) => pairs.map((p) => (Array.isArray(p) ? p : [p, p]));

export const TEMPLATES = {
  // ------------------------------------------------------------------ 1
  todo: {
    name: 'Daily To-Do', sub: 'Tasks & habits', icon: '✅',
    defaults: () => ({
      title: "TODAY'S PLANNER", date: dayLong(), mood: 'Focused', topFocus: 'Finish the one important thing',
      tasks: [
        { done: true, tag: '[!]', text: 'Morning stretch & water' },
        { done: false, tag: '[*]', text: 'Read for 20 minutes' },
        { done: false, tag: '[ ]', text: 'Buy groceries' },
      ],
      habits: [{ done: true, name: 'Water 2.5L' }, { done: false, name: 'Walk 8k' }, { done: false, name: 'No sugar' }],
      quote: 'Done is better than perfect.',
    }),
    fields: [
      { k: 'title', label: 'Title', type: 'text', wide: true },
      { k: 'date', label: 'Date', type: 'text' },
      { k: 'mood', label: 'Mood', type: 'text' },
      { k: 'topFocus', label: 'Top focus (printed inverted)', type: 'text', wide: true },
      { k: 'tasks', label: 'Tasks', type: 'list', add: '+ Add task', blank: { done: false, tag: '[ ]', text: '' },
        cols: [{ k: 'done', type: 'check' }, { k: 'tag', type: 'select', options: opts(['[!]', '! urgent'], ['[*]', '* important'], ['[ ]', 'normal']) }, { k: 'text', type: 'text', flex: true }] },
      { k: 'habits', label: 'Daily habits', type: 'list', add: '+ Add habit', blank: { done: false, name: '' },
        cols: [{ k: 'done', type: 'check' }, { k: 'name', type: 'text', flex: true }] },
      { k: 'quote', label: 'Quote', type: 'text', wide: true },
    ],
    build: (d) => [
      text(d.title, { align: 'center', bold: true }),
      text([d.date, d.mood].filter(Boolean).join(' | '), { align: 'center' }),
      hr('double'),
      ...(d.topFocus ? [text(` FOCUS: ${d.topFocus} `, { inv: true, align: 'center' }), hr()] : []),
      text('TO-DO CHECKLIST:', { bold: true }),
      ...d.tasks.map((t) => row(`${box(t.done)} ${t.text}`, t.tag === '[ ]' ? '' : t.tag)),
      hr(),
      text('DAILY HABITS:', { bold: true }),
      text(d.habits.map((h) => `${box(h.done)}${h.name}`).join(' ')),
      hr(),
      ...(d.quote ? [text(`"${d.quote}"`, { align: 'center' })] : []),
    ],
  },

  // ------------------------------------------------------------------ 2
  digest: {
    name: 'Pocket Digest', sub: 'Article zine + QR', icon: '📰',
    defaults: () => ({
      edition: 'THE POCKET GAZETTE', category: 'Tech', date: dayShort(), headline: 'Your headline goes here',
      summary: 'Write two or three sentences you want to keep from the article.', source: 'Source name', readTime: '2 min read',
      take: 'My take: worth trying this weekend.', url: 'https://example.com', printQr: true,
    }),
    fields: [
      { k: 'edition', label: 'Edition title', type: 'text', wide: true },
      { k: 'category', label: 'Category', type: 'text' }, { k: 'date', label: 'Date', type: 'text' },
      { k: 'headline', label: 'Headline', type: 'text', wide: true },
      { k: 'summary', label: 'Summary', type: 'area', rows: 4, wide: true },
      { k: 'source', label: 'Source', type: 'text' }, { k: 'readTime', label: 'Read time', type: 'text' },
      { k: 'take', label: 'Personal note', type: 'text', wide: true },
      { k: 'printQr', label: 'Print QR for the link', type: 'check', wide: true },
      { k: 'url', label: 'Link', type: 'text', wide: true, show: (d) => d.printQr },
    ],
    build: (d) => [
      text(d.edition, { align: 'center', bold: true, tall: true }),
      row(`[${d.category}]`, d.date),
      hr('double'),
      text(d.headline, { bold: true }),
      text(`Source: ${d.source} (${d.readTime})`),
      hr(),
      text(d.summary),
      hr(),
      ...(d.take ? [text(d.take), hr()] : []),
      ...(d.printQr && d.url ? [qr(d.url, 5), text('SCAN FOR FULL ARTICLE', { align: 'center' })] : []),
    ],
  },

  // ------------------------------------------------------------------ 3
  trip: {
    name: 'Vacation & Trip', sub: 'Pack & itinerary', icon: '✈️',
    defaults: () => ({
      name: 'WEEKEND GETAWAY', destination: 'Destination', dates: '14 Nov - 17 Nov', ref: 'PNR / booking ref', departure: '07:30 AM',
      stay: 'Hotel name (check-in 12 PM)', emergency: 'ICE: phone number', mapLink: 'https://maps.google.com/?q=', printQr: true,
      packing: [
        { done: true, text: 'ID cards & tickets' }, { done: true, text: 'Chargers & power bank' },
        { done: false, text: 'First-aid kit & medicines' }, { done: false, text: 'Camera & thermal printer!' },
      ],
    }),
    fields: [
      { k: 'name', label: 'Trip name', type: 'text', wide: true },
      { k: 'destination', label: 'Destination', type: 'text' }, { k: 'dates', label: 'Dates', type: 'text' },
      { k: 'ref', label: 'Booking / PNR / seat', type: 'text', wide: true },
      { k: 'departure', label: 'Departure', type: 'text' }, { k: 'stay', label: 'Stay', type: 'text' },
      { k: 'emergency', label: 'Emergency note', type: 'text', wide: true },
      { k: 'packing', label: 'Packing list', type: 'list', add: '+ Add item', blank: { done: false, text: '' },
        cols: [{ k: 'done', type: 'check' }, { k: 'text', type: 'text', flex: true }] },
      { k: 'printQr', label: 'Print map / itinerary QR', type: 'check', wide: true },
      { k: 'mapLink', label: 'Map link', type: 'text', wide: true, show: (d) => d.printQr },
    ],
    build: (d) => [
      text(d.name, { align: 'center', bold: true }),
      text(d.destination, { align: 'center', bold: true, tall: true }),
      text(d.dates, { align: 'center' }),
      hr('double'),
      text(`REF:  ${d.ref}`), text(`DEP:  ${d.departure}`), text(`STAY: ${d.stay}`),
      hr(),
      text('PACKING CHECKLIST:', { bold: true }),
      ...d.packing.map((p) => text(`${box(p.done)} ${p.text}`)),
      hr(),
      text(d.emergency),
      ...(d.printQr && d.mapLink ? [qr(d.mapLink, 5), text('SCAN FOR MAP / ITINERARY', { align: 'center' })] : []),
    ],
  },

  // ------------------------------------------------------------------ 4
  label: {
    name: 'Home Labels', sub: 'Pantry, box, 50×25 sticker', icon: '🏷️',
    defaults: () => ({
      type: 'pantry', title: 'FILTER COFFEE POWDER', subtitle: 'Chicory blend 80:20', packed: dayShort(), expiry: 'Use within 45 days',
      location: 'KITCHEN SHELF #2', notes: 'Keep lid airtight and dry.', boxItems: '1. Winter sweaters\n2. Bed linen\n3. Spare cables',
      specHeader: 'Direct thermal barcode label sticker - 50mm x 25mm',
      spec: [{ l: 'Color', v: 'WHITE' }, { l: 'Length', v: '15cm' }, { l: 'Width', v: '10cm' }, { l: 'Height', v: '4cm' }, { l: 'Weight', v: '194g' }],
      barcode: 'LABEL-0001',
    }),
    fields: [
      { k: 'type', label: 'Label type', type: 'select', rr: true, wide: true,
        options: opts(['pantry', 'Pantry / jar'], ['cable', 'Cable / device'], ['storage', 'Storage box'], ['spec', '50×25 mm spec sticker with barcode']) },
      { k: 'size', type: 'button', label: 'Use 50×25 mm label paper', action: 'preset:5025', show: (d) => d.type === 'spec' },
      { k: 'title', label: 'Title', type: 'text', wide: true, show: (d) => d.type !== 'spec' },
      { k: 'subtitle', label: 'Subtitle', type: 'text', wide: true, show: (d) => d.type !== 'spec' },
      { k: 'packed', label: 'Date', type: 'text', show: (d) => d.type !== 'spec' },
      { k: 'expiry', label: 'Expiry / note', type: 'text', show: (d) => d.type !== 'spec' },
      { k: 'location', label: 'Location', type: 'text', wide: true, show: (d) => d.type !== 'spec' },
      { k: 'notes', label: 'Notes', type: 'area', rows: 3, wide: true, show: (d) => d.type === 'pantry' || d.type === 'cable' },
      { k: 'boxItems', label: 'Box contents', type: 'area', rows: 4, wide: true, show: (d) => d.type === 'storage' },
      { k: 'specHeader', label: 'Header (3 lines max)', type: 'area', rows: 2, wide: true, show: (d) => d.type === 'spec' },
      { k: 'spec', label: 'Spec columns', type: 'list', blank: { l: '', v: '' }, fixed: true, show: (d) => d.type === 'spec',
        cols: [{ k: 'l', type: 'text', flex: true }, { k: 'v', type: 'text', flex: true }] },
      { k: 'barcode', label: 'Barcode value (Code 128)', type: 'text', wide: true, show: (d) => d.type === 'spec' },
    ],
    build(d) {
      if (d.type === 'spec')
        return [
          text(clip(d.specHeader, 126), { font: 'B' }),
          hr(),
          { t: 'cols', cells: d.spec.map((s) => s.l), font: 'B', bold: true },
          { t: 'cols', cells: d.spec.map((s) => s.v), font: 'B' },
          hr(),
          { t: 'barcode', data: d.barcode || 'LABEL', format: 'CODE128', height: 36, width: 2, hri: false, align: 'center' },
        ];
      return [
        hr('double'),
        text(` ${d.type.toUpperCase()} LABEL `, { inv: true, align: 'center' }),
        text(d.title, { align: 'center', bold: true, size: 2 }),
        text(d.subtitle, { align: 'center' }),
        hr(),
        row(`DATE: ${d.packed}`, d.expiry),
        ...(d.location ? [text(`LOCATION: ${d.location}`)] : []),
        hr(),
        text(d.type === 'storage' ? d.boxItems : d.notes),
        hr('double'),
      ];
    },
  },

  // ------------------------------------------------------------------ 5
  photo: {
    name: 'Mini Photo', sub: 'Polaroid & art (1-bit)', icon: '📷',
    defaults: () => ({
      header: 'POCKET POLAROID', source: 'clipart', clip: 'camera', uploadedSrc: null, uploadName: '', dither: 'atkinson',
      brightness: 5, contrast: 20, invert: false, border: 'polaroid', caption: 'Good times & great memories!', stamp: dayShort(),
    }),
    fields: [
      { k: 'header', label: 'Header', type: 'text', wide: true },
      { k: 'source', label: 'Source', type: 'select', rr: true, options: opts(['clipart', 'Clipart gallery'], ['upload', 'Upload a photo']) },
      { k: 'clip', label: 'Clipart', type: 'select', show: (d) => d.source === 'clipart', options: Object.entries(CLIPART).map(([k, v]) => [k, v.name]) },
      { k: 'uploadedSrc', label: 'Choose photo', type: 'file', nameK: 'uploadName', wide: true, show: (d) => d.source === 'upload' },
      { k: 'dither', label: 'Dithering', type: 'select', options: opts(['atkinson', 'Atkinson (crisp)'], ['floyd', 'Floyd–Steinberg'], ['bayer', 'Halftone'], ['threshold', 'Threshold']) },
      { k: 'border', label: 'Frame', type: 'select', options: opts(['polaroid', 'Polaroid frame'], ['stars', '* * * Starry banner'], ['none', 'None']) },
      { k: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100 },
      { k: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100 },
      { k: 'invert', label: 'Invert (negative)', type: 'check' },
      { k: 'caption', label: 'Caption', type: 'text', wide: true },
      { k: 'stamp', label: 'Date stamp', type: 'text' },
    ],
    build(d) {
      const src = d.source === 'upload' ? d.uploadedSrc : clipartDataUrl(d.clip, 288, 200);
      const stars = '* '.repeat(15).trim();
      return [
        text(d.header, { align: 'center', bold: true }),
        ...(d.border === 'stars' ? [text(stars, { align: 'center' })] : []),
        ...(src ? [{ t: 'image', src, scale: 75, dither: d.dither, brightness: d.brightness, contrast: d.contrast, invert: d.invert, frame: d.border === 'polaroid' ? 'polaroid' : 'none', align: 'center' }] : []),
        ...(d.border === 'stars' ? [text(stars, { align: 'center' })] : []),
        text(d.caption, { align: 'center' }),
        text(d.stamp, { align: 'center' }),
      ];
    },
  },

  // ------------------------------------------------------------------ 6
  doc: {
    name: 'Mini Doc Print', sub: 'Notes & recipes', icon: '📝',
    defaults: () => ({
      title: 'QUICK NOTE', font: 'A', boxed: true, stamp: true,
      body: 'South Indian filter coffee:\n- 3 tbsp coffee powder in the upper chamber\n- Pour 150 ml boiling water, cover for 12 min\n- Froth hot milk with 1 tsp jaggery\n- Serve piping hot!',
    }),
    fields: [
      { k: 'title', label: 'Title', type: 'text', wide: true },
      { k: 'font', label: 'Font', type: 'select', options: opts(['A', 'A · 12×24 (larger)'], ['B', 'B · 9×17 (compact)']) },
      { k: 'boxed', label: 'Draw a box border', type: 'check' },
      { k: 'stamp', label: 'Print time stamp', type: 'check' },
      { k: 'body', label: 'Body', type: 'area', rows: 9, wide: true },
    ],
    build: (d) => [
      text(d.title, { align: 'center', bold: true }),
      d.boxed ? { t: 'box', text: d.body, font: d.font } : text(d.body, { font: d.font }),
      ...(d.stamp ? [text(new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), { align: 'center' })] : []),
    ],
  },

  // ------------------------------------------------------------------ 7
  qrhub: {
    name: 'Smart QR Hub', sub: 'Wi-Fi, vCard, link, tag', icon: '🔳',
    defaults: () => ({
      mode: 'wifi', ssid: 'Home_Network', pass: 'change-me', enc: 'WPA', name: 'Your Name', phone: '+00 00000 00000', email: 'you@example.com',
      url: 'https://example.com', urlLabel: 'Scan to open on your phone', owner: 'Owner name', ownerPhone: '+00 00000 00000', reward: 'Thank you for returning this!',
    }),
    fields: [
      { k: 'mode', label: 'QR type', type: 'select', rr: true, wide: true, options: opts(['wifi', 'Wi-Fi guest access'], ['vcard', 'Contact card (vCard)'], ['url', 'Web link'], ['luggage', 'Luggage / if-found tag']) },
      { k: 'ssid', label: 'Network name', type: 'text', show: (d) => d.mode === 'wifi' },
      { k: 'pass', label: 'Password', type: 'text', show: (d) => d.mode === 'wifi' },
      { k: 'enc', label: 'Security', type: 'select', show: (d) => d.mode === 'wifi', options: opts(['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'Open']) },
      { k: 'name', label: 'Name', type: 'text', show: (d) => d.mode === 'vcard' },
      { k: 'phone', label: 'Phone', type: 'text', show: (d) => d.mode === 'vcard' },
      { k: 'email', label: 'Email', type: 'text', wide: true, show: (d) => d.mode === 'vcard' },
      { k: 'url', label: 'Link', type: 'text', wide: true, show: (d) => d.mode === 'url' },
      { k: 'urlLabel', label: 'Caption', type: 'text', wide: true, show: (d) => d.mode === 'url' },
      { k: 'owner', label: 'Owner', type: 'text', show: (d) => d.mode === 'luggage' },
      { k: 'ownerPhone', label: 'Phone', type: 'text', show: (d) => d.mode === 'luggage' },
      { k: 'reward', label: 'Message', type: 'text', wide: true, show: (d) => d.mode === 'luggage' },
    ],
    build(d) {
      const top = [hr('double')];
      if (d.mode === 'wifi')
        return [...top, text('GUEST WI-FI', { align: 'center', bold: true, tall: true }),
          qr(`WIFI:S:${wifiEsc(d.ssid)};T:${d.enc};P:${wifiEsc(d.pass)};H:false;;`, 6),
          text(`SSID: ${d.ssid}`, { align: 'center' }), ...(d.enc === 'nopass' ? [] : [text(`PASS: ${d.pass}`, { align: 'center' })]), hr('double')];
      if (d.mode === 'vcard')
        return [...top, text('CONTACT CARD', { align: 'center', bold: true, tall: true }),
          qr(`BEGIN:VCARD\nVERSION:3.0\nFN:${d.name}\nTEL:${d.phone}\nEMAIL:${d.email}\nEND:VCARD`, 5),
          text(d.name, { align: 'center', bold: true }), text(d.phone, { align: 'center' }), text(d.email, { align: 'center' }), hr('double')];
      if (d.mode === 'luggage')
        return [...top, text(' IF FOUND PLEASE CONTACT ', { inv: true, align: 'center' }), qr(`tel:${d.ownerPhone.replace(/\s/g, '')}`, 6),
          text(d.owner, { align: 'center', bold: true }), text(`CALL: ${d.ownerPhone}`, { align: 'center' }), text(d.reward, { align: 'center' }), hr('double')];
      return [...top, text('QUICK LINK', { align: 'center', bold: true }), qr(d.url, 6), text(d.urlLabel, { align: 'center' }), hr('double')];
    },
  },

  // ------------------------------------------------------------------ 8
  sketch: {
    name: 'Doodle & Memo', sub: 'Fridge sketchpad', icon: '✏️',
    defaults: () => ({ header: 'QUICK DOODLE & NOTE', footer: `Left on the desk at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, canvasDataUrl: null }),
    fields: [
      { k: 'header', label: 'Header', type: 'text', wide: true },
      { k: 'canvasDataUrl', label: 'Draw here', type: 'sketch', wide: true },
      { k: 'footer', label: 'Footer note', type: 'text', wide: true },
    ],
    build: (d) => [
      text(d.header, { align: 'center', bold: true }),
      ...(d.canvasDataUrl ? [{ t: 'image', src: d.canvasDataUrl, scale: 100, dither: 'threshold', align: 'center' }] : []),
      text(d.footer, { align: 'center' }),
    ],
  },

  // ------------------------------------------------------------------ 9
  selftest: {
    name: 'Test & Bookmark', sub: '5806-6605 profile', icon: '🧪',
    defaults: () => ({
      mode: 'selftest', version: '5806-6605', font: '1.15 (U24)', codepage: 'PC850 [Multilingual]', iface: 'USB & Bluetooth', baud: '115200', temp: '30 C', depth: '38 level',
      title: 'EX LIBRIS', subtitle: 'Personal reading slip', ref: 'BOOKMARK-001', owner: '', edition: 'Personal edition', qrData: 'https://example.com', notes: 'From the desk of a happy reader',
    }),
    fields: [
      { k: 'mode', label: 'Slip', type: 'select', rr: true, wide: true, options: opts(['selftest', 'Printer spec sheet + ruler'], ['bookmark', 'Ex-libris bookmark']) },
      ...['version', 'font', 'codepage', 'iface', 'baud', 'temp', 'depth'].map((k) => ({ k, label: k, type: 'text', show: (d) => d.mode === 'selftest' })),
      { k: 'title', label: 'Title', type: 'text', wide: true, show: (d) => d.mode === 'bookmark' },
      { k: 'subtitle', label: 'Subtitle', type: 'text', wide: true, show: (d) => d.mode === 'bookmark' },
      { k: 'ref', label: 'Reference', type: 'text', show: (d) => d.mode === 'bookmark' },
      { k: 'owner', label: 'Owner', type: 'text', show: (d) => d.mode === 'bookmark' },
      { k: 'edition', label: 'Edition', type: 'text', show: (d) => d.mode === 'bookmark' },
      { k: 'qrData', label: 'QR content', type: 'text', wide: true, show: (d) => d.mode === 'bookmark' },
      { k: 'notes', label: 'Note', type: 'text', wide: true, show: (d) => d.mode === 'bookmark' },
    ],
    build(d, ctx) {
      if (d.mode === 'bookmark')
        return [
          text(d.title, { align: 'center', bold: true, size: 2 }), text(d.subtitle, { align: 'center' }), hr(), qr(d.qrData, 5),
          row('Ref:', d.ref), ...(d.owner ? [row('Owner:', d.owner)] : []), row('Edition:', d.edition), hr(), text(d.notes, { align: 'center' }),
        ];
      const cols = ctx?.cfg ? columns(ctx.cfg) : 32;
      return [
        text('SELF TEST', { align: 'center', bold: true, size: 2 }), hr('double'),
        row('Version:', d.version), row('Font:', d.font), row('Codepage:', d.codepage), row('Interface:', d.iface),
        row('Baudrate:', d.baud), row('Print temp:', d.temp), row('Print depth:', d.depth), hr(),
        text('COLUMN RULER:', { bold: true }),
        text('1234567890'.repeat(Math.ceil(cols / 10)).slice(0, cols), { font: undefined }),
        { t: 'pattern', kind: 'ruler' },
      ];
    },
  },
};

export const defaultStudioData = () => Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, t.defaults()]));
