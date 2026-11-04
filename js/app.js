import { loadSettings, saveSettings, loadDraft, saveDraft, resetAll, freshSettings, deepMerge, db } from './store.js';
import { compile, deriveCfg, PAPER_PRESETS } from './engine.js';
import { CODEPAGES, EscPos, parseHex, hexDump, columns } from './escpos.js';
import { Printer, LINK_PROFILES, support } from './printer.js';
import {
  receiptBlocks, markupBlocks, codeBlocks, imageBlocks, testPageBlocks, unicodeTestBlocks, receiptNumber, text as textBlock,
} from './doc.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const fmtTime = (t) => new Date(t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
const KIND_NAME = { ble: 'Bluetooth LE', usb: 'USB', serial: 'USB serial', spp: 'Bluetooth classic', sim: 'Demo' };

let settings = loadSettings();
let draft = loadDraft();
let cfg = deriveCfg(settings);
const printer = new Printer();
let busy = false;

// ================================================================ toasts + log

function toast(msg, { action, fn, err = false, ms = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action;
    b.onclick = () => { fn?.(); el.remove(); };
    el.append(b);
  }
  $('#toasts').append(el);
  setTimeout(() => el.remove(), action ? ms + 3000 : ms);
}

const logLines = [];
printer.addEventListener('log', (e) => {
  const { msg, dir, t } = e.detail;
  const line = `${new Date(t).toLocaleTimeString([], { hour12: false })}  ${msg}`;
  logLines.push({ line, dir });
  if (logLines.length > 250) logLines.shift();
  const c = $('#console');
  const div = document.createElement('div');
  div.className = dir;
  div.textContent = line;
  c.append(div);
  c.scrollTop = c.scrollHeight;
});
const log = (msg, dir) => printer.log(msg, dir);

// ================================================================ navigation

function go(page) {
  $$('.page').forEach((p) => p.classList.toggle('on', p.id === 'page-' + page));
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  if (page === 'jobs') renderJobs();
  window.scrollTo({ top: 0 });
}
$('#nav').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.page); };
$('#connPill').onclick = () => go('printer');

function setKind(kind) {
  draft.kind = kind;
  $$('#kindSeg button').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
  $$('.kind').forEach((c) => c.classList.toggle('on', c.dataset.kind === kind));
  persistDraft();
  schedulePreview();
}
$('#kindSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) setKind(b.dataset.kind); };

// ================================================================ two-way binding

function readEl(el, cur) {
  if (el.type === 'checkbox') return el.checked;
  if (typeof cur === 'number') return el.value === '' ? 0 : Number(el.value);
  return el.value;
}

function fillAll() {
  for (const el of $$('[data-s]')) {
    const v = get(settings, el.dataset.s);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  }
  for (const el of $$('[data-d]')) {
    const v = get(draft, el.dataset.d);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  }
  refreshDerived();
}

function refreshDerived() {
  for (const o of $$('output[data-out]')) {
    const p = o.dataset.out;
    o.textContent = get(settings, p) ?? get(draft, p) ?? '';
  }
  const kind = draft.code.type;
  $$('[data-show]').forEach((el) => (el.hidden = el.dataset.show !== kind));
  $$('[data-show-when="custom"]').forEach((el) => (el.hidden = settings.paper.preset !== 'custom'));
  $('#copies').textContent = draft.copies || 1;
  const mm = (cfg.dots / 8).toFixed(0);
  $('#layoutInfo').textContent = `${cfg.dots} dots (${mm} mm at 203 dpi) · ${columns(cfg)} native columns with font ${cfg.font} · ${cfg.dots - 2 * cfg.margin} dots usable after margins.`;
  $('#printLabel').textContent = busy ? 'Printing…' : 'Print';
  $('#printBtn').title = printer.connected ? 'Print now' : 'Printer not connected — the job will be saved to the queue';
  document.documentElement.dataset.theme = settings.theme === 'auto' ? '' : settings.theme;
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
}

let saveTimer;
function persistDraft() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDraft(draft), 300); }

function onSettingChanged(path) {
  if (path === 'paper.preset') { if (settings.paper.preset !== 'custom') settings.paper.dots = PAPER_PRESETS[settings.paper.preset].dots; }
  if (path === 'link.profile' && settings.link.profile !== 'custom') {
    const p = LINK_PROFILES[settings.link.profile];
    settings.link.chunk = p.chunk; settings.link.delay = p.delay;
    $('[data-s="link.chunk"]').value = p.chunk; $('[data-s="link.delay"]').value = p.delay;
  }
  if (path === 'link.chunk' || path === 'link.delay') {
    settings.link.profile = 'custom';
    $('[data-s="link.profile"]').value = 'custom';
  }
  Object.assign(printer.link, settings.link);
  cfg = deriveCfg(settings);
  saveSettings(settings);
  refreshDerived();
  schedulePreview();
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset?.s) { set(settings, el.dataset.s, readEl(el, get(settings, el.dataset.s))); onSettingChanged(el.dataset.s); }
  else if (el.dataset?.d) {
    set(draft, el.dataset.d, readEl(el, get(draft, el.dataset.d)));
    persistDraft(); refreshDerived(); schedulePreview();
  }
});

// ================================================================ receipt items + templates

function renderItems() {
  $('#items').innerHTML = draft.receipt.items
    .map((it, i) => `<div class="item" data-i="${i}">
      <input data-f="name" value="${esc(it.name)}" placeholder="Item name" aria-label="Item name">
      <input data-f="qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(it.qty)}" aria-label="Quantity">
      <input data-f="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(it.price)}" aria-label="Unit price">
      <button class="x" data-rm aria-label="Remove item"><svg class="ic"><use href="#i-x"/></svg></button></div>`)
    .join('');
}
$('#items').addEventListener('input', (e) => {
  e.stopPropagation();
  const row = e.target.closest('.item'); if (!row) return;
  const f = e.target.dataset.f;
  draft.receipt.items[+row.dataset.i][f] = f === 'name' ? e.target.value : Number(e.target.value) || 0;
  persistDraft(); schedulePreview();
});
$('#items').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]'); if (!rm) return;
  draft.receipt.items.splice(+rm.closest('.item').dataset.i, 1);
  renderItems(); persistDraft(); schedulePreview();
});
$('#addItem').onclick = () => {
  draft.receipt.items.push({ name: '', qty: 1, price: 0 });
  renderItems(); persistDraft();
  $$('#items .item').at(-1).querySelector('input').focus();
};

async function renderTemplates() {
  const list = (await db.all('templates')).sort((a, b) => a.name.localeCompare(b.name));
  $('#tplList').innerHTML = list.length ? list.map((t) => `<option>${esc(t.name)}</option>`).join('') : '<option value="">No saved templates</option>';
}
$('#tplSave').onclick = async () => {
  const name = $('#tplName').value.trim();
  if (!name) return toast('Type a template name first');
  await db.put('templates', { name, receipt: { ...clone(draft.receipt), no: '' } });
  $('#tplName').value = '';
  await renderTemplates(); $('#tplList').value = name;
  toast(`Template “${name}” saved`);
};
$('#tplLoad').onclick = async () => {
  const t = (await db.all('templates')).find((x) => x.name === $('#tplList').value);
  if (!t) return;
  draft.receipt = deepMerge(clone(draft.receipt), clone(t.receipt));
  draft.receipt.items = clone(t.receipt.items);
  fillAll(); renderItems(); persistDraft(); schedulePreview();
  toast(`Loaded “${t.name}”`);
};
$('#tplDel').onclick = async () => {
  const n = $('#tplList').value;
  if (!n) return;
  await db.del('templates', n); await renderTemplates(); toast(`Deleted “${n}”`);
};

// ================================================================ image input

async function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Please choose an image file', { err: true });
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    const w0 = im.naturalWidth || 512, h0 = im.naturalHeight || 512;
    const k = Math.min(1, 1024 / w0);
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    draft.image.src = c.toDataURL('image/jpeg', 0.92);
    draft.image.name = file.name;
    $('#imgName').textContent = `${file.name} · ${c.width}×${c.height}px`;
    persistDraft(); schedulePreview();
  } catch { toast('Could not read that image', { err: true }); } finally { URL.revokeObjectURL(url); }
}
$('#imgFile').onchange = (e) => loadImageFile(e.target.files[0]);
$('#imgClear').onclick = () => { draft.image.src = null; draft.image.name = ''; $('#imgName').textContent = 'PNG, JPG, SVG, WebP — converted to black & white dots'; $('#imgFile').value = ''; persistDraft(); schedulePreview(); };
const drop = $('#drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); loadImageFile(e.dataTransfer.files[0]); };

// ================================================================ blocks + preview

function currentBlocks() {
  switch (draft.kind) {
    case 'receipt': return receiptBlocks(draft.receipt, settings.shop);
    case 'text': return markupBlocks(draft.text.body, draft.text);
    case 'code': return draft.code.data ? codeBlocks(draft.code) : [];
    case 'image': return imageBlocks(draft.image);
    default: return [];
  }
}

function jobLabel() {
  switch (draft.kind) {
    case 'receipt': return `Receipt ${receiptNumber(settings.shop, draft.receipt)}`;
    case 'text': return draft.text.body.split('\n').find((l) => l.trim())?.replace(/^[#>< ]+/, '').slice(0, 40) || 'Text';
    case 'code': return `${draft.code.type === 'qr' ? 'QR' : 'Barcode'}: ${draft.code.data.slice(0, 30)}`;
    case 'image': return draft.image.name || 'Image';
    default: return 'Raw';
  }
}

let previewTimer, previewSeq = 0;
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }

async function renderPreview() {
  const seq = ++previewSeq;
  const err = $('#prevErr'), canvas = $('#prevCanvas'), hexEl = $('#prevHex');
  err.hidden = true;
  if (draft.kind === 'raw') {
    const bytes = parseHex(draft.raw.hex);
    canvas.hidden = true; hexEl.hidden = false;
    hexEl.textContent = bytes.length ? hexDump(bytes) : '(no bytes)';
    $('#modeChip').textContent = 'Raw bytes';
    $('#sizeChip').textContent = `${bytes.length} bytes`;
    return;
  }
  canvas.hidden = false; hexEl.hidden = true;
  try {
    const blocks = currentBlocks();
    const comp = await compile(blocks, cfg);
    if (seq !== previewSeq) return;
    canvas.width = comp.canvas.width; canvas.height = comp.canvas.height;
    canvas.getContext('2d').drawImage(comp.canvas, 0, 0);
    canvas.style.width = Math.min(comp.canvas.width, 576) + 'px';
    $('#modeChip').textContent = comp.mode === 'native' ? 'Native ESC/POS text' : comp.lossy ? 'Graphic · Unicode' : 'Graphic';
    $('#sizeChip').textContent = `${cfg.dots} dots · ${(cfg.dots / 8) | 0} mm · ${comp.canvas.height} rows`;
    if (!blocks.length) { err.textContent = draft.kind === 'image' ? 'Choose an image to see it here.' : 'Nothing to print yet.'; err.hidden = false; err.style.color = 'var(--muted)'; }
    else err.style.color = '';
  } catch (e) {
    if (seq !== previewSeq) return;
    err.textContent = e.message; err.hidden = false;
  }
}

// ================================================================ printing

function setProgress(f) {
  const p = $('#progress');
  p.hidden = f == null;
  if (f != null) { p.firstElementChild.style.width = Math.round(f * 100) + '%'; $('#printLabel').textContent = `Printing ${Math.round(f * 100)}%`; }
}

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

function needPrinter() {
  if (printer.connected) return true;
  toast('Connect a printer first', { action: 'Connect', fn: () => go('printer') });
  return false;
}

async function sendBytes(bytes, okMsg = 'Sent ✓') {
  if (!needPrinter()) return false;
  busy = true; refreshDerived();
  try {
    await printer.write(bytes, { onProgress: setProgress });
    toast(okMsg);
    return true;
  } catch (e) {
    toast(`Print failed: ${e.message}`, { err: true });
    log(`✗ ${e.message}`, 'err');
    return false;
  } finally { busy = false; setProgress(null); refreshDerived(); }
}

async function runJob(job) {
  if (!needPrinter()) return false;
  busy = true; refreshDerived();
  try {
    const comp = await compile(clone(job.blocks), cfg, job.force);
    const one = comp.bytes();
    const bytes = job.copies > 1 ? concat(Array.from({ length: job.copies }, () => one)) : one;
    await printer.write(bytes, { onProgress: setProgress });
    Object.assign(job, { status: 'done', doneAt: Date.now(), error: null, mode: comp.mode });
    await db.put('jobs', job);
    await trimHistory();
    toast(`Printed “${job.label}” ✓`);
    return true;
  } catch (e) {
    Object.assign(job, { status: 'queued', error: e.message });
    await db.put('jobs', job);
    toast(`Print failed: ${e.message}`, { err: true });
    log(`✗ ${e.message}`, 'err');
    return false;
  } finally { busy = false; setProgress(null); refreshDerived(); renderJobs(); }
}

async function trimHistory() {
  const done = (await db.all('jobs')).filter((j) => j.status === 'done').sort((a, b) => b.doneAt - a.doneAt);
  for (const j of done.slice(60)) await db.del('jobs', j.id);
}

async function createJob(label, blocks, extra = {}) {
  const job = { id: uid(), ts: Date.now(), label, blocks, copies: draft.copies || 1, status: 'queued', ...extra };
  await db.put('jobs', job);
  return job;
}

async function printCurrent(forceQueue = false) {
  if (draft.kind === 'raw') {
    const bytes = parseHex(draft.raw.hex);
    if (!bytes.length) return toast('Nothing to send');
    return sendBytes(bytes);
  }
  let blocks;
  try { blocks = currentBlocks(); await compile(clone(blocks), cfg); } catch (e) { return toast(e.message, { err: true }); }
  if (!blocks.length) return toast('Nothing to print yet');
  const job = await createJob(jobLabel(), clone(blocks));
  if (draft.kind === 'receipt' && !draft.receipt.no.trim()) { settings.shop.receiptNo = (+settings.shop.receiptNo || 1) + 1; saveSettings(settings); fillAll(); schedulePreview(); }
  if (printer.connected && !forceQueue) await runJob(job);
  else {
    toast(printer.connected ? 'Saved to queue' : 'Printer not connected — saved to queue', printer.connected ? {} : { action: 'Connect', fn: () => go('printer') });
    renderJobs();
  }
}

$('#printBtn').onclick = () => { if (!busy) printCurrent(); };
$('#queueBtn').onclick = () => printCurrent(true);
$('#copyMinus').onclick = () => { draft.copies = Math.max(1, (draft.copies || 1) - 1); refreshDerived(); persistDraft(); };
$('#copyPlus').onclick = () => { draft.copies = Math.min(9, (draft.copies || 1) + 1); refreshDerived(); persistDraft(); };
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !busy) printCurrent(); });

// ---------------------------------------------------------------- raw tools

$('#rawQuick').onclick = (e) => {
  const b = e.target.closest('[data-hex]'); if (!b) return;
  const ta = $('#rawHex');
  ta.value = (ta.value.trim() + ' ' + b.dataset.hex).trim();
  draft.raw.hex = ta.value; persistDraft(); schedulePreview();
};

async function currentBytes() {
  if (draft.kind === 'raw') return parseHex(draft.raw.hex);
  const comp = await compile(currentBlocks(), cfg);
  return comp.bytes();
}
$('#dlBin').onclick = async () => {
  try {
    const bytes = await currentBytes();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = 'myprint-job.bin';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { toast(e.message, { err: true }); }
};
$('#rawbt').onclick = async () => {
  try {
    const bytes = await currentBytes();
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    location.href = 'rawbt:base64,' + btoa(bin);
  } catch (e) { toast(e.message, { err: true }); }
};

// ================================================================ jobs page

async function renderJobs() {
  const all = (await db.all('jobs')).sort((a, b) => b.ts - a.ts);
  const queue = all.filter((j) => j.status !== 'done').sort((a, b) => a.ts - b.ts);
  const hist = all.filter((j) => j.status === 'done').sort((a, b) => b.doneAt - a.doneAt);
  const badge = $('#jobBadge');
  badge.hidden = !queue.length; badge.textContent = queue.length;
  $('#flushBtn').disabled = !queue.length;
  const li = (j, actions) => `<li data-id="${j.id}"><div class="meta"><b>${esc(j.label)}</b><small class="${j.error ? 'fail' : ''}">${j.error ? 'Failed: ' + esc(j.error) : fmtTime(j.doneAt || j.ts)}${j.copies > 1 ? ` · ×${j.copies}` : ''}${j.mode ? ' · ' + j.mode : ''}</small></div>${actions}</li>`;
  $('#queueList').innerHTML = queue.length
    ? queue.map((j) => li(j, '<button class="btn" data-act="print">Print</button><button class="btn ghost danger" data-act="del">Delete</button>')).join('')
    : '<li class="empty">Nothing waiting.</li>';
  $('#historyList').innerHTML = hist.length
    ? hist.map((j) => li(j, '<button class="btn" data-act="again">Print again</button><button class="btn ghost danger" data-act="del">✕</button>')).join('')
    : '<li class="empty">No printed jobs yet.</li>';
}

$('#page-jobs').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const job = (await db.all('jobs')).find((j) => j.id === b.closest('li').dataset.id);
  if (!job) return;
  if (b.dataset.act === 'del') { await db.del('jobs', job.id); renderJobs(); }
  else if (b.dataset.act === 'print') await runJob(job);
  else if (b.dataset.act === 'again') await runJob({ ...clone(job), id: uid(), ts: Date.now(), status: 'queued', doneAt: null });
});

async function flushQueue() {
  if (!needPrinter()) return;
  const queue = (await db.all('jobs')).filter((j) => j.status !== 'done').sort((a, b) => a.ts - b.ts);
  for (const job of queue) if (!(await runJob(job))) break;
}
$('#flushBtn').onclick = flushQueue;
$('#clearHistory').onclick = async () => {
  for (const j of (await db.all('jobs')).filter((x) => x.status === 'done')) await db.del('jobs', j.id);
  renderJobs();
};

// ================================================================ printer page

const PROFILE = [
  ['Version', '5806-6605'], ['Font', '1.15'], ['Code type', 'codepage'], ['Char type', 'U24'], ['Language', 'PC850 [multiple]'],
  ['Interface', 'USB & Bluetooth'], ['Baud rate', '115200'], ['Sleep time', '14400 s'], ['Command set', 'ESC'], ['Page mode', '0'],
  ['Print mode', 'S'], ['Speed', '1'], ['Print depth', '38 level'], ['Quality', '4 level'], ['Black label', 'disabled'],
  ['Passive buzzer', 'enabled'], ['BT multi-connection', 'enabled'], ['BT broadcast', '32'],
];
$('#profileTable').innerHTML = PROFILE.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
$('#applyProfile').onclick = () => {
  Object.assign(settings, { font: 'A', codepage: 'PC850', mode: 'auto', imageCmd: 'gsv0', densityOn: false, feed: 3, cut: 'none' });
  settings.paper = { preset: '58', dots: 384, margin: 0 };
  settings.link.baud = 115200;
  cfg = deriveCfg(settings); saveSettings(settings); fillAll(); schedulePreview();
  toast('Settings matched to the self-test profile');
};

for (const [sel, src, f] of [['paper', PAPER_PRESETS, (v) => v.label], ['codepage', CODEPAGES, (v) => v.label], ['link', LINK_PROFILES, (v) => v.label]])
  $(`[data-opts="${sel}"]`).innerHTML = Object.entries(src).map(([k, v]) => `<option value="${k}">${esc(f(v))}</option>`).join('');

function renderSupport() {
  const s = support();
  const items = [
    ['HTTPS / localhost', s.secure], ['Web Bluetooth', s.ble], ['WebUSB', s.usb], ['Web Serial', s.serial],
    ['Offline (service worker)', 'serviceWorker' in navigator], ['Install as app', true],
  ];
  $('#support').innerHTML = items.map(([n, ok]) => `<li class="${ok ? 'yes' : 'no'}">${ok ? '✓' : '✕'} ${n}</li>`).join('');
}

function updateConnUI() {
  const { state } = printer;
  const pill = $('#connPill');
  pill.className = 'pill' + (state === 'connected' ? ' ok' : state === 'connecting' ? ' busy' : '');
  $('#connText').textContent = state === 'connected' ? printer.name : state === 'connecting' ? 'Connecting…' : 'Not connected';
  $('#connStatus').textContent = state === 'connected' ? `Connected · ${printer.name} · ${KIND_NAME[printer.kind]}` : state === 'connecting' ? 'Connecting…' : 'Not connected';
  $('#btnDisc').disabled = state === 'disconnected';
  for (const id of ['btnBLE', 'btnUSB', 'btnSerial', 'btnSPP', 'btnSim', 'btnReconnect']) $('#' + id).disabled = state !== 'disconnected';
  refreshDerived();
}

printer.addEventListener('state', async () => {
  updateConnUI();
  if (printer.connected) {
    const id = printer.identity();
    if (id) { settings.last = id; saveSettings(settings); }
    const waiting = (await db.all('jobs')).filter((j) => j.status !== 'done').length;
    if (waiting && settings.autoFlush) flushQueue();
    else if (waiting) toast(`${waiting} job${waiting > 1 ? 's' : ''} waiting`, { action: 'Print all', fn: flushQueue });
  }
});

const REASONS = {
  ble: 'Web Bluetooth is not available here. Use Chrome or Edge (Android / desktop) over HTTPS — on iPhone use the Bluefy browser.',
  usb: 'WebUSB is not available in this browser (try Chrome or Edge).',
  serial: 'Web Serial is not available in this browser (try Chrome or Edge on desktop).',
};
async function connect(kind) {
  try {
    if (kind === 'ble') await printer.connectBLE();
    else if (kind === 'usb') await printer.connectUSB();
    else if (kind === 'serial') await printer.connectSerial('serial');
    else if (kind === 'spp') await printer.connectSerial('spp');
    toast(`Connected to ${printer.name}`);
  } catch (e) {
    if (e.name === 'NotFoundError' || /cancel/i.test(e.message)) toast('No printer selected');
    else if (e.name === 'SecurityError' || e.name === 'TypeError') toast(REASONS[kind === 'spp' ? 'serial' : kind] || e.message, { err: true });
    else toast(e.message, { err: true });
    log(`✗ ${e.name}: ${e.message}`, 'err');
  }
}
$('#btnBLE').onclick = () => connect('ble');
$('#btnUSB').onclick = () => connect('usb');
$('#btnSerial').onclick = () => connect('serial');
$('#btnSPP').onclick = () => connect('spp');
$('#btnSim').onclick = () => { printer.connectSim(); toast('Demo printer connected'); };
$('#btnDisc').onclick = () => printer.disconnect();
$('#btnReconnect').onclick = async () => {
  if (!settings.last) return toast('No printer remembered yet');
  toast((await printer.reconnect(settings.last)) ? 'Reconnected' : 'Could not reconnect silently — use a connect button', { err: false });
};
$('#clearLog').onclick = () => { $('#console').innerHTML = ''; logLines.length = 0; };

// ---------------------------------------------------------------- diagnostics

$('#page-printer').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-test]'); if (!b) return;
  const t = b.dataset.test;
  if (!needPrinter()) return;
  if (t === 'feed') return sendBytes(new EscPos(cfg).init({ native: false }).feed(8).bytes(), 'Fed 8 lines');
  const blocks = {
    page: () => testPageBlocks(cfg),
    unicode: () => unicodeTestBlocks(),
    ruler: () => [textBlock(`Width check: ${cfg.dots} dots`, { align: 'center' }), { t: 'pattern', kind: 'ruler' }],
    gradient: () => [textBlock('Darkness steps 0-100%', { align: 'center' }), { t: 'pattern', kind: 'gradient' }],
    checker: () => [textBlock('Dead-dot check', { align: 'center' }), { t: 'pattern', kind: 'checker' }],
  }[t]();
  const job = await createJob(`Diagnostics: ${t}`, blocks, { copies: 1, force: t === 'unicode' ? 'raster' : undefined });
  await runJob(job);
});

// ---------------------------------------------------------------- data

$('#exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
  a.download = 'myprint-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async (e) => {
  try {
    const obj = JSON.parse(await e.target.files[0].text());
    settings = deepMerge(freshSettings(), obj);
    cfg = deriveCfg(settings); saveSettings(settings); fillAll(); schedulePreview();
    toast('Settings imported');
  } catch { toast('That file is not a valid settings export', { err: true }); }
  e.target.value = '';
};
$('#resetBtn').onclick = () => {
  if (!confirm('Reset all settings and the current draft? Queued jobs and templates are kept.')) return;
  resetAll(); location.reload();
};

// ================================================================ network, install, service worker

function updateNet() {
  const on = navigator.onLine;
  const pill = $('#netPill');
  pill.className = 'pill ' + (on ? 'ok' : 'off');
  pill.lastElementChild.textContent = on ? 'Online' : 'Offline';
}
addEventListener('online', () => { updateNet(); toast('Back online'); });
addEventListener('offline', () => { updateNet(); toast('You are offline — printing still works'); });

let installEvt;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').hidden = true; };
addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Installed'); });

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller)
          toast('A new version is ready', { action: 'Update', fn: () => nw.postMessage('SKIP_WAITING') });
      });
    });
  }).catch((e) => log(`Service worker: ${e.message}`, 'err'));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}

// ================================================================ boot

Object.assign(printer.link, settings.link);
fillAll();
renderItems();
renderTemplates();
renderSupport();
updateNet();
updateConnUI();
setKind(draft.kind);
if (draft.image.src) $('#imgName').textContent = draft.image.name || 'Saved image';
$('#appInfo').textContent = `MyPrint 1.0 · ${matchMedia('(display-mode: standalone)').matches ? 'running as installed app' : 'running in browser'} · data stays on this device`;
renderJobs();
if (settings.autoReconnect && settings.last) printer.reconnect(settings.last);
