import { defaultStudioData } from './templates.js';

// Persistence: settings in localStorage, print jobs + templates in IndexedDB (works offline).

export const DEFAULT_SETTINGS = {
  ver: 2,
  // media: continuous | diecut | blackmark; labelW/labelH are the label size in mm (used by the label presets)
  paper: { preset: '58', dots: 384, margin: 0, media: 'continuous', labelW: 50, labelH: 0, lineSpacing: 30, topFeed: 0 },
  tint: 'white',
  buzzer: false, // beep after each print (0x1E, model specific)
  translit: false, // native text: replace symbols the codepage lacks (₹ -> Rs.) instead of switching to graphic mode
  qrEngine: 'native', // native GS ( k / GS k  |  raster bitmap
  roll: { size: 1000, remaining: 1000 }, // die-cut label roll counter
  font: 'A', // native font A (12x24) / B (9x17)
  mode: 'auto', // auto | native | raster
  codepage: 'PC850',
  feed: 3,
  cut: 'none',
  drawer: false,
  densityOn: false,
  density: 50,
  imageCmd: 'gsv0', // gsv0 | escstar
  strip: 24, // rows per GS v 0 band: 24 rows = 1,152 bytes on 58 mm, safe for ~4 KB printer buffers
  threshold: 140,
  raster: { font: 'sans', size: 22, lineGap: 1.25 },
  link: { profile: 'balanced', chunk: 100, delay: 12, ack: false, baud: 115200 },
  shop: {
    name: 'My Shop', address: '', phone: '', taxId: '', taxIdLabel: 'GST',
    footer: 'Thank you! Visit again.', currency: '', decimals: 2,
    prefix: 'INV-', receiptNo: 1, taxLabel: 'GST', taxRate: 0, taxMode: 'added',
  },
  autoFlush: false,
  autoReconnect: true,
  theme: 'auto',
  last: null,
};

export const DEFAULT_DRAFT = {
  kind: 'receipt',
  receipt: {
    title: 'RECEIPT', no: '', cashier: '', customer: '', payMethod: 'Cash', paid: 0, note: '',
    discount: 0, discountType: 'amount', qrOn: false, qrData: '', barOn: true,
    items: [{ name: 'Sample item', qty: 1, price: 10 }],
  },
  text: { body: '# Hello\n---\nLeft | Right\n>> Right aligned\n<> Centered\n[qr:https://example.com]', align: 'left', size: 1, bold: false, markup: true },
  code: { type: 'qr', data: 'https://example.com', size: 6, ec: 'M', format: 'CODE128', height: 60, width: 2, hri: true, caption: '', align: 'center' },
  image: { src: null, name: '', scale: 100, dither: 'atkinson', brightness: 0, contrast: 0, align: 'center' },
  studio: { tpl: 'todo', data: defaultStudioData() },
  raw: { hex: '1B 40 "Hello from MyPrint" 0A 0A 0A' },
  copies: 1,
};

const clone = (o) => JSON.parse(JSON.stringify(o));
export function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], over[k]);
    else if (over[k] !== undefined) base[k] = over[k];
  }
  return base;
}

function loadJSON(key, defaults) {
  try { return deepMerge(clone(defaults), JSON.parse(localStorage.getItem(key))); } catch { return clone(defaults); }
}
function saveJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}

export function loadSettings() {
  const s = loadJSON('myprint.settings', DEFAULT_SETTINGS);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('myprint.settings')); } catch { /* ignore */ }
  if (saved && (saved.ver || 1) < 2) { s.strip = 24; s.ver = 2; } // v2: safer raster band height
  return s;
}
export const saveSettings = (s) => saveJSON('myprint.settings', s);
export const loadDraft = () => loadJSON('myprint.draft', DEFAULT_DRAFT);
export const saveDraft = (d) => saveJSON('myprint.draft', d);
export const resetAll = () => { try { localStorage.removeItem('myprint.settings'); localStorage.removeItem('myprint.draft'); } catch { /* ignore */ } };
export const freshSettings = () => clone(DEFAULT_SETTINGS);

// ---------------------------------------------------------------- IndexedDB

let dbp;
const mem = { jobs: new Map(), templates: new Map() }; // fallback when IndexedDB is blocked (private mode)
const KEYS = { jobs: 'id', templates: 'name' };

function open() {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('no indexedDB'));
      const req = indexedDB.open('myprint', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('jobs', { keyPath: 'id' });
        req.result.createObjectStore('templates', { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null, mem[store]);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store), null);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  async put(store, v) {
    return tx(store, 'readwrite', (os, m) => (os ? os.put(v) : m.set(v[KEYS[store]], v)));
  },
  async del(store, key) {
    return tx(store, 'readwrite', (os, m) => (os ? os.delete(key) : m.delete(key)));
  },
  async clear(store) {
    return tx(store, 'readwrite', (os, m) => (os ? os.clear() : m.clear()));
  },
  async all(store) {
    const db_ = await open();
    if (!db_) return [...mem[store].values()];
    return new Promise((resolve, reject) => {
      const r = db_.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
};
