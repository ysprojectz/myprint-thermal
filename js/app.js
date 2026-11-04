import { loadSettings, saveSettings, loadDraft, saveDraft, resetAll, freshSettings, deepMerge, db } from './store.js';
import { compile, compileDesign, deriveCfg, designSize, headDots, PAPER_PRESETS, LABEL_PRESETS } from './engine.js';
import { CODEPAGES, EscPos, parseHex, hexDump, columns } from './escpos.js';
import { Printer, LINK_PROFILES, support } from './printer.js';
import { TEMPLATES } from './templates.js';
import { initSketch, blankSketch } from './sketch.js';
import { Editor, STARTERS, drawRulers, FONT_NAMES, DPM } from './designer.js';
import { parseSelfTest, inferConfig } from './detect.js';
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
  if (kind === 'canvas') ensureEditor();
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
  $$('[data-show-when]').forEach((el) => (el.hidden = settings.paper.preset !== el.dataset.showWhen));
  $('#rollLabel').textContent = `Label roll: ${settings.roll.remaining} / ${settings.roll.size}`;
  $('#paper').dataset.tint = settings.tint;
  $('#copies').textContent = draft.copies || 1;
  const mm = (cfg.dots / 8).toFixed(0);
  $('#layoutInfo').textContent = `${cfg.dots} dots (${mm} mm at 203 dpi) · ${columns(cfg)} native columns with font ${cfg.font} · ${cfg.dots - 2 * cfg.margin} dots usable after margins.`;
  updateSetupUI();
  $('#printLabel').textContent = busy ? 'Printing…' : 'Print';
  $('#printBtn').title = printer.connected ? 'Print now' : 'Printer not connected — the job will be saved to the queue';
  document.documentElement.dataset.theme = settings.theme === 'auto' ? '' : settings.theme;
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
}

let saveTimer;
function persistDraft() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDraft(draft), 300); }

function onSettingChanged(path) {
  if (path === 'paper.preset') {
    const pr = PAPER_PRESETS[settings.paper.preset];
    if (settings.paper.preset !== 'custom') settings.paper.dots = pr.dots;
    if (pr.apply) { Object.assign(settings.paper, pr.apply); settings.feed = pr.feed ?? 3; fillAll(); } // label presets set media, height, spacing, tear feed
  }
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
    if (el.closest('#studioForm')) {
      if (el.type === 'range') el.closest('label').querySelector('output').textContent = el.value;
      else if (el.type === 'checkbox' || el.tagName === 'SELECT') renderStudioForm(); // conditional fields may appear/disappear
    }
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

// ================================================================ studio templates

let sketchCtl = null;
const sketchTool = { size: 3, eraser: false };
const studioData = () => draft.studio.data[draft.studio.tpl];

function renderTplGrid() {
  $('#tplGrid').innerHTML = Object.entries(TEMPLATES)
    .map(([k, t]) => `<button class="tpl${k === draft.studio.tpl ? ' on' : ''}" data-tpl="${k}" role="option" aria-selected="${k === draft.studio.tpl}"><i>${t.icon}</i><span><b>${esc(t.name)}</b><small>${esc(t.sub)}</small></span></button>`)
    .join('');
}

function fieldHtml(f, d, path) {
  const w = f.wide ? ' wide' : '';
  const v = d[f.k];
  const bind = `data-d="${path(f.k)}"`;
  switch (f.type) {
    case 'text': return `<label class="f${w}"><span>${esc(f.label)}</span><input ${bind} value="${esc(v)}"></label>`;
    case 'area': return `<label class="f${w}"><span>${esc(f.label)}</span><textarea ${bind} rows="${f.rows || 4}" spellcheck="false">${esc(v)}</textarea></label>`;
    case 'check': return `<label class="check${w}"><input type="checkbox" ${bind} ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'range': return `<label class="f${w}"><span>${esc(f.label)} <output>${esc(v)}</output></span><input type="range" min="${f.min}" max="${f.max}" ${bind} value="${esc(v)}"></label>`;
    case 'select': return `<label class="f${w}"><span>${esc(f.label)}</span><select ${bind}>${f.options.map(([val, lab]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select></label>`;
    case 'button': return `<div class="f wide"><button type="button" class="btn" data-act="${f.action}">${esc(f.label)}</button></div>`;
    case 'file': return `<label class="drop f wide"><input type="file" accept="image/*" data-file="${f.k}" hidden><b>${esc(f.label)}</b><span class="muted">${esc(d[f.nameK] || 'PNG, JPG, WebP — converted to black & white dots')}</span></label>`;
    case 'sketch': return `<div class="sketch-wrap"><span class="muted">${esc(f.label)}</span><canvas id="sketchCanvas" width="384" height="224"></canvas>
      <div class="sketch-tools"><button type="button" class="chip-btn on" data-sk="pen">Pen</button><button type="button" class="chip-btn" data-sk="eraser">Eraser</button>
      <input type="range" min="1" max="12" value="${sketchTool.size}" data-sk="size" aria-label="Brush size"><button type="button" class="chip-btn" data-sk="clear">Clear</button>
      ${['APPROVED', 'TODO', 'DONE', 'URGENT'].map((t) => `<button type="button" class="chip-btn" data-stamp="${t}">${t}</button>`).join('')}</div></div>`;
    case 'list': return `<div class="f list"><span>${esc(f.label)}</span><div class="lrows" data-list="${f.k}">${(v || []).map((it, i) => `<div class="lrow" data-i="${i}">${f.cols.map((c) => {
      if (c.type === 'check') return `<input type="checkbox" data-l="${c.k}" ${it[c.k] ? 'checked' : ''} aria-label="done">`;
      if (c.type === 'select') return `<select data-l="${c.k}">${c.options.map(([val, lab]) => `<option value="${esc(val)}"${val === it[c.k] ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
      return `<input type="text" data-l="${c.k}" class="${c.flex ? 'flex' : ''}" value="${esc(it[c.k])}">`;
    }).join('')}${f.fixed ? '' : '<button type="button" class="x" data-rm aria-label="Remove"><svg class="ic"><use href="#i-x"/></svg></button>'}</div>`).join('')}</div>
      ${f.fixed ? '' : `<button type="button" class="btn ghost" data-add="${f.k}">${esc(f.add || '+ Add')}</button>`}</div>`;
    default: return '';
  }
}

function renderStudioForm() {
  const key = draft.studio.tpl, T = TEMPLATES[key], d = studioData();
  $('#studioTitle').textContent = `Editing: ${T.name}`;
  $('#studioForm').innerHTML = T.fields.filter((f) => !f.show || f.show(d)).map((f) => fieldHtml(f, d, (k) => `studio.data.${key}.${k}`)).join('');
  const sk = $('#sketchCanvas');
  if (sk && !d.canvasDataUrl) d.canvasDataUrl = blankSketch(); // so the blank pad prints even before the first stroke
  sketchCtl = sk ? initSketch(sk, d.canvasDataUrl, sketchTool, (url) => { d.canvasDataUrl = url; persistDraft(); schedulePreview(); }) : null;
}

function selectTemplate(key) {
  draft.studio.tpl = key;
  renderTplGrid(); renderStudioForm(); persistDraft(); schedulePreview();
}

$('#tplGrid').onclick = (e) => { const b = e.target.closest('[data-tpl]'); if (b) selectTemplate(b.dataset.tpl); };

const studioForm = $('#studioForm');
studioForm.addEventListener('input', (e) => {
  const row = e.target.closest('.lrow');
  if (row) {
    const list = row.closest('[data-list]').dataset.list;
    studioData()[list][+row.dataset.i][e.target.dataset.l] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    persistDraft(); schedulePreview();
  } else if (e.target.dataset.sk === 'size') sketchTool.size = +e.target.value;
});
studioForm.addEventListener('click', (e) => {
  const d = studioData(), T = TEMPLATES[draft.studio.tpl];
  const rm = e.target.closest('[data-rm]'), add = e.target.closest('[data-add]'), sk = e.target.closest('[data-sk]'), st = e.target.closest('[data-stamp]'), act = e.target.closest('[data-act]');
  if (rm) { d[rm.closest('[data-list]').dataset.list].splice(+rm.closest('.lrow').dataset.i, 1); renderStudioForm(); persistDraft(); schedulePreview(); }
  else if (add) { d[add.dataset.add].push(clone(T.fields.find((f) => f.k === add.dataset.add).blank)); renderStudioForm(); persistDraft(); schedulePreview(); }
  else if (st) sketchCtl?.stamp(st.dataset.stamp);
  else if (sk) {
    const m = sk.dataset.sk;
    if (m === 'clear') sketchCtl?.clear();
    else if (m === 'pen' || m === 'eraser') {
      sketchTool.eraser = m === 'eraser';
      $$('[data-sk="pen"],[data-sk="eraser"]').forEach((b) => b.classList.toggle('on', b.dataset.sk === m));
    }
  } else if (act && act.dataset.act.startsWith('preset:')) {
    settings.paper.preset = act.dataset.act.slice(7);
    onSettingChanged('paper.preset'); fillAll();
    toast('Paper set to 50 × 25 mm label');
  }
});
studioForm.addEventListener('change', async (e) => {
  const f = e.target.dataset.file;
  if (!f) return;
  try {
    const { url, name } = await compressImage(e.target.files[0]);
    const d = studioData();
    d[f] = url; d[TEMPLATES[draft.studio.tpl].fields.find((x) => x.k === f).nameK] = name;
    renderStudioForm(); persistDraft(); schedulePreview();
  } catch { toast('Could not read that image', { err: true }); }
});

$('#presetSave').onclick = () => {
  const key = draft.studio.tpl;
  saveBlob(new Blob([JSON.stringify({ app: 'myprint', template: key, data: studioData() }, null, 2)], { type: 'application/json' }), `myprint-${key}-preset.json`);
};
$('#presetLoad').onclick = () => $('#presetFile').click();
$('#presetFile').onchange = async (e) => {
  try {
    const o = JSON.parse(await e.target.files[0].text());
    if (!TEMPLATES[o.template] || typeof o.data !== 'object') throw new Error('bad preset');
    draft.studio.data[o.template] = deepMerge(TEMPLATES[o.template].defaults(), o.data);
    selectTemplate(o.template);
    toast('Preset loaded');
  } catch { toast('That file is not a MyPrint template preset', { err: true }); }
  e.target.value = '';
};
$('#presetReset').onclick = () => { draft.studio.data[draft.studio.tpl] = TEMPLATES[draft.studio.tpl].defaults(); renderStudioForm(); persistDraft(); schedulePreview(); };

// ================================================================ image input

async function compressImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('not an image');
  const src = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = src;
    await im.decode();
    const w0 = im.naturalWidth || 512, h0 = im.naturalHeight || 512, k = Math.min(1, 1024 / w0);
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/jpeg', 0.92), name: file.name, w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(src); }
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ================================================================ blocks + preview

function currentBlocks() {
  switch (draft.kind) {
    case 'receipt': return receiptBlocks(draft.receipt, settings.shop);
    case 'text': return markupBlocks(draft.text.body, draft.text);
    case 'code': return draft.code.data ? codeBlocks(draft.code) : [];
    case 'image': return imageBlocks(draft.image);
    case 'studio': return TEMPLATES[draft.studio.tpl].build(studioData(), { cfg });
    default: return []; // canvas is handled by compileDesign
  }
}

function jobLabel() {
  switch (draft.kind) {
    case 'receipt': return `Receipt ${receiptNumber(settings.shop, draft.receipt)}`;
    case 'text': return draft.text.body.split('\n').find((l) => l.trim())?.replace(/^[#>< ]+/, '').slice(0, 40) || 'Text';
    case 'code': return `${draft.code.type === 'qr' ? 'QR' : 'Barcode'}: ${draft.code.data.slice(0, 30)}`;
    case 'image': return draft.image.name || 'Image';
    case 'studio': return TEMPLATES[draft.studio.tpl].name;
    case 'canvas': return cfg.type === 'label' ? `Label ${cfg.labelL}×${cfg.labelH} mm` : 'Canvas design';
    default: return 'Raw';
  }
}

let previewTimer, previewSeq = 0, lastComp = null;

/** css px per printer dot for the chosen zoom (8 dots = 1 mm; 96 css dpi => 0.4724 px/dot at true size). */
function viewScale(W, zoom) {
  const avail = Math.max(120, $('#stage').clientWidth - 44), mm = 96 / 25.4 / DPM;
  return zoom === 'fit' ? Math.min(avail / W, 2.4) : zoom === 'actual' ? mm : Number(zoom) * mm;
}

function clearTelemetry() {
  for (const id of ['telSpec', 'telLen', 'telBytes', 'telHeat']) $('#' + id).textContent = '—';
  $('#heatWarn').hidden = $('#labelWarn').hidden = $('#labelGuide').hidden = true;
}

// Telemetry: payload size, estimated paper length, head load (share of black dots) and label-overflow warning.
function updateTelemetry(comp, canvas) {
  const st = comp.stats, duty = Math.round(st.duty * 100), hot = duty > 35;
  $('#telSpec').textContent = `${cfg.dots} dots · ${columns(cfg, 'A')} cols A / ${columns(cfg, 'B')} cols B`;
  $('#telLen').textContent = cfg.labelH ? `Length ~${st.mm} mm of ${cfg.labelH} mm label` : `Paper ~${st.mm} mm (${(st.mm / 10).toFixed(1)} cm)`;
  $('#telBytes').textContent = `Payload ${st.bytes} B (${(st.bytes / 1024).toFixed(1)} KB)`;
  const heat = $('#telHeat');
  heat.className = 'chip ' + (hot ? 'hot' : 'cool');
  heat.textContent = `Head duty ${duty}% ${hot ? '(high)' : '(cool)'}`;
  $('#heatWarn').hidden = !hot;
  const over = cfg.labelH > 0 && st.rows / 8 > cfg.labelH + 0.5;
  const warn = $('#labelWarn');
  warn.hidden = !over;
  if (over) warn.innerHTML = `<b>Content is ~${Math.round(st.rows / 8)} mm but the label is ${cfg.labelH} mm.</b> It will spill onto the next sticker — shorten the text, use font B, or pick a taller label.`;
  const guide = $('#labelGuide');
  guide.hidden = !(cfg.labelH > 0 && cfg.labelH * 8 < canvas.height);
  if (!guide.hidden) guide.style.top = cfg.labelH * 8 * (canvas.getBoundingClientRect().width / canvas.width) + 'px';
}
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }

async function renderPreview() {
  const seq = ++previewSeq;
  const err = $('#prevErr'), canvas = $('#prevCanvas'), hexEl = $('#prevHex');
  err.hidden = true;
  if (draft.kind === 'raw') {
    const bytes = parseHex(draft.raw.hex);
    lastComp = null; clearTelemetry();
    canvas.hidden = true; hexEl.hidden = false;
    hexEl.textContent = bytes.length ? hexDump(bytes) : '(no bytes)';
    $('#modeChip').textContent = 'Raw bytes';
    $('#sizeChip').textContent = `${bytes.length} bytes`;
    return;
  }
  canvas.hidden = false; hexEl.hidden = true;
  const paperEl = $('#paper');
  paperEl.classList.toggle('label-shape', cfg.type === 'label');
  if (draft.kind === 'canvas') {
    paperEl.classList.remove('static'); paperEl.classList.toggle('draw-mode', editor?.tool !== 'select'); paperEl.classList.toggle('select-mode', editor?.tool === 'select');
    try {
      ensureEditor();
      await editor.redraw();
      const comp = await compileDesign(clone(draft.design), cfg);
      if (seq !== previewSeq) return;
      lastComp = comp; updateTelemetry(comp, canvas);
      $('#modeChip').textContent = 'Canvas · graphic';
      $('#sizeChip').textContent = `${editor.size.W} × ${editor.size.H} dots · ${(editor.size.W / DPM).toFixed(0)} × ${(editor.size.H / DPM).toFixed(0)} mm`;
    } catch (e) { err.textContent = e.message; err.hidden = false; }
    return;
  }
  paperEl.classList.add('static');
  { const ov = $('#overlay'); ov.width = ov.height = 1; ov.style.width = ov.style.height = '1px'; }
  try {
    const blocks = currentBlocks();
    const comp = await compile(blocks, cfg);
    if (seq !== previewSeq) return;
    canvas.width = comp.canvas.width; canvas.height = comp.canvas.height;
    canvas.getContext('2d').drawImage(comp.canvas, 0, 0);
    const sc = viewScale(comp.canvas.width, $('#zoomSel').value);
    canvas.style.width = Math.round(comp.canvas.width * sc) + 'px'; canvas.style.height = Math.round(comp.canvas.height * sc) + 'px';
    drawRulers($('#rulerTop'), $('#rulerLeft'), comp.canvas.width, comp.canvas.height, sc);
    lastComp = comp;
    updateTelemetry(comp, canvas);
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
    const comp = job.design ? await compileDesign(clone(job.design), cfg) : await compile(clone(job.blocks), cfg, job.force);
    const one = comp.bytes();
    const bytes = job.copies > 1 ? concat(Array.from({ length: job.copies }, () => one)) : one;
    await printer.write(bytes, { onProgress: setProgress });
    Object.assign(job, { status: 'done', doneAt: Date.now(), error: null, mode: comp.mode });
    await db.put('jobs', job);
    await trimHistory();
    if (cfg.media !== 'continuous' && settings.roll.remaining > 0) { settings.roll.remaining = Math.max(0, settings.roll.remaining - (job.copies || 1)); saveSettings(settings); refreshDerived(); }
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

function snapshot() {
  if (draft.kind === 'studio') return { kind: 'studio', tpl: draft.studio.tpl, data: clone(studioData()) };
  if (draft.kind === 'canvas') return { kind: 'canvas', data: clone(draft.design) };
  if (['receipt', 'text'].includes(draft.kind)) return { kind: draft.kind, data: clone(draft[draft.kind]) };
  return null;
}

function restoreSnapshot(snap) {
  if (!snap) return toast('This job has no editable copy');
  if (snap.kind === 'studio') { draft.studio.tpl = snap.tpl; draft.studio.data[snap.tpl] = clone(snap.data); renderTplGrid(); renderStudioForm(); }
  else if (snap.kind === 'canvas') { draft.design = clone(snap.data); editor?.select(null); editor?.resetHistory(); }
  else { draft[snap.kind] = clone(snap.data); if (snap.kind === 'receipt') renderItems(); }
  fillAll(); setKind(snap.kind); go('print');
  toast('Loaded into the editor');
}

async function archiveCurrent() {
  if (draft.kind === 'raw') return toast('Nothing to archive');
  let blocks = [], design = null;
  try {
    if (draft.kind === 'canvas') { design = clone(draft.design); await compileDesign(clone(design), cfg); }
    else { blocks = currentBlocks(); await compile(clone(blocks), cfg); }
  } catch (e) { return toast(e.message, { err: true }); }
  if (draft.kind !== 'canvas' && !blocks.length) return toast('Nothing to archive yet');
  const now = Date.now();
  await db.put('jobs', { id: uid(), ts: now, doneAt: now, label: jobLabel(), blocks: clone(blocks), design, copies: 1, status: 'saved', snap: snapshot() });
  toast('Archived in History — print it any time');
  renderJobs();
}

async function printCurrent(forceQueue = false) {
  if (draft.kind === 'raw') {
    const bytes = parseHex(draft.raw.hex);
    if (!bytes.length) return toast('Nothing to send');
    return sendBytes(bytes);
  }
  let blocks = [], design = null;
  try {
    if (draft.kind === 'canvas') {
      design = clone(draft.design);
      if (!design.objects.length && !design.ink) return toast('Add something to the canvas first');
      await compileDesign(clone(design), cfg);
    } else { blocks = currentBlocks(); await compile(clone(blocks), cfg); }
  } catch (e) { return toast(e.message, { err: true }); }
  if (draft.kind !== 'canvas' && !blocks.length) return toast('Nothing to print yet');
  const job = await createJob(jobLabel(), clone(blocks), { snap: snapshot(), design });
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
  if (draft.kind === 'canvas') return (await compileDesign(clone(draft.design), cfg)).bytes();
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

// ---------------------------------------------------------------- preview tools (paperless export, OS print, hex view)

$('#archiveBtn').onclick = archiveCurrent;

$('#savePng').onclick = () => {
  const c = $('#prevCanvas');
  if (c.hidden || !c.width) return toast('Nothing to export yet');
  const o = document.createElement('canvas');
  o.width = c.width * 2; o.height = c.height * 2; // 2x, nearest-neighbour so dots stay crisp
  const x = o.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, o.width, o.height);
  o.toBlob((b) => { saveBlob(b, `myprint-${draft.kind === 'studio' ? draft.studio.tpl : draft.kind}-${Date.now()}.png`); toast('PNG saved'); });
};

$('#osPrint').onclick = () => {
  const c = $('#prevCanvas');
  if (c.hidden || !c.width) return toast('Nothing to print yet');
  const mm = (cfg.dots / 8).toFixed(1);
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.append(f);
  f.contentDocument.write(`<!doctype html><title>MyPrint</title><style>@page{margin:0;size:${mm}mm auto}body{margin:0}img{display:block;width:${mm}mm;image-rendering:pixelated}</style><img src="${c.toDataURL()}">`);
  f.contentDocument.close();
  const im = f.contentDocument.querySelector('img');
  const go_ = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000); };
  im.complete ? go_() : (im.onload = go_);
};

let hexBytes = new Uint8Array();
$('#hexBtn').onclick = async () => {
  try {
    hexBytes = await currentBytes();
    const shown = Math.min(hexBytes.length, 2400);
    let t = 'Uint8Array([\n  ';
    for (let i = 0; i < shown; i++) t += '0x' + hexBytes[i].toString(16).padStart(2, '0').toUpperCase() + (i < hexBytes.length - 1 ? ', ' : '') + ((i + 1) % 12 === 0 ? '\n  ' : '');
    if (hexBytes.length > shown) t += `\n  /* … +${hexBytes.length - shown} more bytes — use Download .bin for the full payload */`;
    $('#hexOut').value = t + '\n])';
    $('#hexLen').textContent = `· ${hexBytes.length} bytes`;
    $('#hexDlg').showModal();
  } catch (e) { toast(e.message, { err: true }); }
};
$('#hexClose').onclick = () => $('#hexDlg').close();
$('#hexDl').onclick = () => saveBlob(new Blob([hexBytes], { type: 'application/octet-stream' }), 'myprint-job.bin');
$('#hexCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#hexOut').value); toast('Copied'); } catch { toast('Copy failed — select the text manually', { err: true }); } };

// ---------------------------------------------------------------- hardware macros, roll tracker, darkness presets

const MACROS = {
  feed3: [[0x1b, 0x64, 3], 'Fed 3 lines'], beep: [[0x1e], 'Beep sent (0x1E — model specific)'],
  cut: [[0x1d, 0x56, 0x42, 0], 'Cut command sent'], init: [[0x1b, 0x40], 'Printer reset (ESC @)'],
  gap: [[0x1d, 0x0c], 'Advanced to the next label gap (GS FF)'],
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-macro]');
  if (b) sendBytes(Uint8Array.from(MACROS[b.dataset.macro][0]), MACROS[b.dataset.macro][1]);
  const d = e.target.closest('[data-density]');
  if (d) { settings.densityOn = true; settings.density = +d.dataset.density; fillAll(); onSettingChanged('density'); toast(`Darkness level ${settings.density} on`); }
});
$('#rollReset').onclick = () => { settings.roll.remaining = settings.roll.size; saveSettings(settings); refreshDerived(); toast('Label roll reset'); };

// ================================================================ jobs page

async function renderJobs() {
  const all = (await db.all('jobs')).sort((a, b) => b.ts - a.ts);
  const queue = all.filter((j) => j.status === 'queued').sort((a, b) => a.ts - b.ts);
  const hist = all.filter((j) => j.status !== 'queued').sort((a, b) => b.doneAt - a.doneAt);
  const badge = $('#jobBadge');
  badge.hidden = !queue.length; badge.textContent = queue.length;
  $('#flushBtn').disabled = !queue.length;
  const li = (j, actions) => `<li data-id="${j.id}"><div class="meta"><b>${esc(j.label)}</b><small class="${j.error ? 'fail' : ''}">${j.error ? 'Failed: ' + esc(j.error) : fmtTime(j.doneAt || j.ts)}${j.copies > 1 ? ` · ×${j.copies}` : ''}${j.status === 'saved' ? ' · archived' : j.mode ? ' · ' + j.mode : ''}</small></div>${actions}</li>`;
  $('#queueList').innerHTML = queue.length
    ? queue.map((j) => li(j, `<button class="btn" data-act="print">Print</button>${j.snap ? '<button class="btn ghost" data-act="edit">Edit</button>' : ''}<button class="btn ghost danger" data-act="del">Delete</button>`)).join('')
    : '<li class="empty">Nothing waiting.</li>';
  $('#historyList').innerHTML = hist.length
    ? hist.map((j) => li(j, `<button class="btn" data-act="again">Print</button>${j.snap ? '<button class="btn ghost" data-act="edit">Edit</button>' : ''}<button class="btn ghost danger" data-act="del">✕</button>`)).join('')
    : '<li class="empty">No printed jobs yet.</li>';
}

$('#page-jobs').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const job = (await db.all('jobs')).find((j) => j.id === b.closest('li').dataset.id);
  if (!job) return;
  if (b.dataset.act === 'del') { await db.del('jobs', job.id); renderJobs(); }
  else if (b.dataset.act === 'edit') restoreSnapshot(job.snap);
  else if (b.dataset.act === 'print') await runJob(job);
  else if (b.dataset.act === 'again') await runJob({ ...clone(job), id: uid(), ts: Date.now(), status: 'queued', doneAt: null });
});

async function flushQueue() {
  if (!needPrinter()) return;
  const queue = (await db.all('jobs')).filter((j) => j.status === 'queued').sort((a, b) => a.ts - b.ts);
  for (const job of queue) if (!(await runJob(job))) break;
}
$('#flushBtn').onclick = flushQueue;
$('#clearHistory').onclick = async () => {
  for (const j of (await db.all('jobs')).filter((x) => x.status !== 'queued')) await db.del('jobs', j.id);
  renderJobs();
};

// ================================================================ printer page

const PROFILE = [
  ['Version', '5806-6605'], ['Font', '1.15'], ['Code type', 'codepage'], ['Char type', 'U24'], ['Language', 'PC850 [multiple]'],
  ['Interface', 'USB & Bluetooth'], ['Baud rate', '115200'], ['Sleep time', '14400 s'], ['Command set', 'ESC'], ['Page mode', '0'],
  ['Print mode', 'S'], ['Speed', '1'], ['Print depth', '38 level'], ['Quality', '4 level'], ['Black label', 'disabled'],
  ['Passive buzzer', 'enabled'], ['BT multi-connection', 'enabled'], ['BT broadcast', '32'],
];
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
    runDetect();
    const waiting = (await db.all('jobs')).filter((j) => j.status === 'queued').length;
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

// ================================================================ canvas designer

let editor = null;
let statsTimer;
function ensureEditor() {
  if (editor) return editor;
  editor = new Editor(
    { display: $('#prevCanvas'), overlay: $('#overlay'), rulerTop: $('#rulerTop'), rulerLeft: $('#rulerLeft'), stage: $('#stage') },
    {
      design: () => draft.design,
      size: () => designSize(draft.design, cfg),
      changed: (quick) => { persistDraft(); if (!quick) { clearTimeout(statsTimer); statsTimer = setTimeout(refreshCanvasStats, 350); } },
      selected: (o) => renderProps(o),
      active: () => draft.kind === 'canvas' && $('#page-print').classList.contains('on'),
      edit: () => $('#pText')?.focus(),
    },
  );
  editor.resetHistory();
  $('#starter').innerHTML = Object.entries(STARTERS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
  return editor;
}

async function refreshCanvasStats() {
  if (draft.kind !== 'canvas') return;
  try { const comp = await compileDesign(clone(draft.design), cfg); lastComp = comp; updateTelemetry(comp, $('#prevCanvas')); $('#prevErr').hidden = true; }
  catch (e) { $('#prevErr').textContent = e.message; $('#prevErr').hidden = false; }
}

function setTool(tool) {
  ensureEditor();
  editor.tool = tool === 'eraser' ? 'pen' : tool; // pen & eraser both draw on the ink layer
  editor.pen.eraser = tool === 'eraser';
  $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  $('#penRow').hidden = tool === 'select';
  $('#paper').classList.toggle('draw-mode', tool !== 'select');
  $('#paper').classList.toggle('select-mode', tool === 'select');
  if (tool !== 'select') editor.select(null);
  editor.drawOverlay();
}

$('#addBar').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]'), tool = e.target.closest('[data-tool]');
  ensureEditor();
  if (tool) return setTool(editor.tool !== 'select' && editor.pen.eraser === (tool.dataset.tool === 'eraser') ? 'select' : tool.dataset.tool);
  if (!add) return;
  setTool('select');
  if (add.dataset.add === 'image') $('#imgAdd').click(); else editor.add(add.dataset.add);
});
$('#penRow').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tool]');
  if (t) setTool(t.dataset.tool);
  if (e.target.id === 'inkClear') editor.clearInk();
});
$('#penSize').oninput = (e) => { ensureEditor().pen.size = +e.target.value; $('#penOut').textContent = e.target.value; };

async function addImageFile(file) {
  try {
    const { url, w, h } = await compressImage(file);
    ensureEditor();
    const { W, H } = editor.size, k = Math.min((W * 0.7) / w, H / h > 0 ? (H * 0.9) / h : 1);
    editor.add('image', { src: url, w: Math.round(w * k), h: Math.round(h * k), natW: w, natH: h });
    toast('Image added — rotate, resize and optimise it in the panel');
  } catch { toast('Could not read that image', { err: true }); }
}
$('#imgAdd').onchange = (e) => { if (e.target.files[0]) addImageFile(e.target.files[0]); e.target.value = ''; };

$('#alignBar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  ensureEditor();
  if (b.dataset.align) return editor.align(b.dataset.align);
  ({ front: () => editor.order('front'), back: () => editor.order('back'), dup: () => editor.duplicate(), del: () => editor.remove(), undo: () => editor.undo(), redo: () => editor.redo() })[b.dataset.act]?.();
});
$('#snapChk').onchange = (e) => { ensureEditor().snap = e.target.checked; };
$('#zoomSel').onchange = (e) => { if (draft.kind === 'canvas') ensureEditor().setZoom(e.target.value); else schedulePreview(); };
$('#applyStarter').onclick = () => {
  ensureEditor();
  draft.design.objects = STARTERS[$('#starter').value].build(editor.size);
  editor.select(null); editor.resetHistory(); persistDraft(); editor.redraw(); toast('Starter applied');
};
$('#clearCanvas').onclick = () => { ensureEditor(); draft.design.objects = []; draft.design.ink = null; editor.ink = null; editor.select(null); editor.resetHistory(); persistDraft(); editor.redraw(); };

// ----- properties panel for the selected object

const mmv = (v) => (v / DPM).toFixed(1);
function renderProps(o) {
  const box = $('#props');
  if (!o) { box.innerHTML = '<p class="hint">Tap an object on the paper to edit it, or add one above. Drag to move, drag a corner to resize, drag the round knob to rotate. Arrow keys nudge (Shift = 1 mm).</p>'; return; }
  const num = (k, label, v, min, max, step = 0.5) => `<label class="f"><span>${label}</span><input type="number" data-p="${k}" data-mm="1" min="${min}" max="${max}" step="${step}" value="${mmv(v)}"></label>`;
  const rng = (k, label, v, min, max) => `<label class="f"><span>${label} <output>${v}</output></span><input type="range" data-p="${k}" min="${min}" max="${max}" value="${v}"></label>`;
  const chk = (k, label, v) => `<label class="check"><input type="checkbox" data-p="${k}" ${v ? 'checked' : ''}> ${label}</label>`;
  const sel = (k, label, v, opts) => `<label class="f"><span>${label}</span><select data-p="${k}">${opts.map(([a, b]) => `<option value="${a}"${a === v ? ' selected' : ''}>${b}</option>`).join('')}</select></label>`;
  const txt = (k, label, v, area) => `<label class="f wide"><span>${label}</span>${area ? `<textarea id="pText" data-p="${k}" rows="3">${esc(v)}</textarea>` : `<input data-p="${k}" value="${esc(v)}">`}</label>`;
  let h = `<h3>${{ text: 'Text', image: 'Image', qr: 'QR code', barcode: 'Barcode', rect: 'Box', ellipse: 'Circle', line: 'Line' }[o.t]}</h3><div class="fields">`;
  if (o.t === 'text') h += txt('text', 'Text', o.text, true) + sel('font', 'Font', o.font, Object.entries(FONT_NAMES)) + rng('size', 'Size (dots)', o.size, 10, 140) + sel('align', 'Align', o.align, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]) + chk('bold', 'Bold', o.bold) + chk('italic', 'Italic', o.italic) + chk('inv', 'White on black', o.inv);
  if (o.t === 'image')
    h += `<div class="wide chips"><button class="chip-btn" data-pa="r90-">⟲ Rotate 90°</button><button class="chip-btn" data-pa="r90+">⟳ Rotate 90°</button><button class="chip-btn" data-pa="flipH">⇋ Flip</button><button class="chip-btn" data-pa="flipV">⇅ Flip</button><button class="chip-btn" data-pa="fit">Fit width</button><button class="chip-btn" data-pa="swap">Replace…</button></div>`
      + sel('dither', 'Dithering', o.dither, [['atkinson', 'Atkinson (logos, crisp)'], ['floyd', 'Floyd–Steinberg (photos)'], ['bayer', 'Halftone'], ['threshold', 'Threshold (line art)']])
      + chk('auto', 'Auto-optimise (stretch tones)', o.auto) + rng('brightness', 'Brightness', o.brightness, -100, 100) + rng('contrast', 'Contrast', o.contrast, -100, 100) + chk('invert', 'Invert', o.invert);
  if (o.t === 'qr') h += txt('data', 'Content', o.data) + sel('ec', 'Error correction', o.ec, [['L', 'L · 7%'], ['M', 'M · 15%'], ['Q', 'Q · 25%'], ['H', 'H · 30%']]);
  if (o.t === 'barcode') h += txt('data', 'Value', o.data) + sel('format', 'Format', o.format, [['CODE128', 'Code 128'], ['CODE39', 'Code 39'], ['EAN13', 'EAN-13'], ['UPC', 'UPC-A'], ['ITF', 'ITF']]) + chk('hri', 'Show text under bars', o.hri);
  if (['rect', 'ellipse', 'line'].includes(o.t)) h += rng('lw', 'Line thickness', o.lw, 1, 16) + (o.t === 'line' ? chk('arrow', 'Arrow head', o.arrow) : chk('fill', 'Filled', o.fill));
  h += '</div><h3>Position &amp; size (mm)</h3><div class="fields">' + num('x', 'X →', o.x, -50, 400) + num('y', 'Y ↓', o.y, -50, 600) + (o.t === 'text' ? '' : num('w', 'Width', o.w, 1, 400)) + (o.t === 'text' ? num('w', 'Box width', o.w, 3, 400) : o.t === 'qr' ? '' : num('h', 'Height', o.h, 0, 600)) + rng('rot', 'Rotation °', Math.round(o.rot), 0, 359) + '</div><div class="chips"><button class="chip-btn" data-pa="rot-">⟲ 90°</button><button class="chip-btn" data-pa="rot+">⟳ 90°</button></div>';
  box.innerHTML = h;
}

$('#props').addEventListener('input', (e) => {
  const k = e.target.dataset.p; if (!k || !editor?.sel) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' || e.target.type === 'number' ? Number(e.target.value) : e.target.value;
  if (e.target.dataset.mm) v = Math.round(v * DPM);
  if (e.target.type === 'range') e.target.closest('label').querySelector('output').textContent = e.target.value;
  editor.update({ [k]: v }, e.target.type === 'range' && k === 'rot');
  clearTimeout(editor.pt2); editor.pt2 = setTimeout(() => editor.commit(), 500);
});
$('#props').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pa]'); if (!b || !editor?.sel) return;
  const a = b.dataset.pa;
  if (a === 'r90-') editor.rotate90(-1); else if (a === 'r90+') editor.rotate90(1);
  else if (a === 'rot-') editor.update({ rot: (editor.sel.rot + 270) % 360 }); else if (a === 'rot+') editor.update({ rot: (editor.sel.rot + 90) % 360 });
  else if (a === 'flipH') editor.flip('h'); else if (a === 'flipV') editor.flip('v');
  else if (a === 'fit') editor.fit();
  else if (a === 'swap') { $('#imgAdd').onchange = async (ev) => { const f = ev.target.files[0]; ev.target.value = ''; $('#imgAdd').onchange = (x) => { if (x.target.files[0]) addImageFile(x.target.files[0]); x.target.value = ''; }; if (f) { const { url } = await compressImage(f); editor.update({ src: url }); } }; $('#imgAdd').click(); return; }
  commitProps();
});
function commitProps() { renderProps(editor.sel); editor.commit(); }

// ================================================================ setup wizard (steps 1 and 2)

const PRINT_TYPES = [
  { k: 'receipt', name: 'Receipt / invoice', sub: 'Items, tax, total, QR', icon: '🧾', kind: 'receipt', paper: 'roll' },
  { k: 'label', name: 'Label / sticker', sub: 'Product, address, name tag', icon: '🏷️', kind: 'canvas', paper: 'label', starter: 'product' },
  { k: 'slip', name: 'Slips & templates', sub: 'To-do, trip, Wi-Fi QR…', icon: '🗒️', kind: 'studio' },
  { k: 'photo', name: 'Photo & art', sub: 'Import, rotate, optimise', icon: '🖼️', kind: 'canvas', image: true },
  { k: 'canvas', name: 'Free canvas', sub: 'Text, QR, shapes, drawing', icon: '🎨', kind: 'canvas' },
  { k: 'text', name: 'Notes / text', sub: 'Quick markup text', icon: '📝', kind: 'text', paper: 'roll' },
];

function paperText() {
  return cfg.type === 'label' ? `Label ${cfg.labelL} × ${cfg.labelH} mm` : `${settings.paper.preset === 'custom' ? (headDots(settings) / 8).toFixed(0) : settings.paper.preset} mm roll`;
}

function updateSetupUI() {
  $$('#paperType button').forEach((b) => b.classList.toggle('on', b.dataset.ptype === settings.paper.type));
  $('#rollPanel').hidden = settings.paper.type === 'label';
  $('#labelPanel').hidden = settings.paper.type !== 'label';
  $('#dgL').textContent = `Length ${settings.paper.labelW} mm`;
  $('#dgH').textContent = `Height ${settings.paper.labelH} mm`;
  $$('#labelChips button').forEach((b) => b.classList.toggle('on', +b.dataset.l === settings.paper.labelW && +b.dataset.h === settings.paper.labelH));
  const headMm = headDots(settings) / 8;
  $('#labelNote').textContent = settings.paper.labelW > headMm
    ? `Your printer head prints ${headMm} mm across, so a ${settings.paper.labelW} mm length is printed ${headMm} mm wide (the outer ${((settings.paper.labelW - headMm) / 2).toFixed(1)} mm cannot be printed).`
    : `Design area: ${settings.paper.labelW} × ${settings.paper.labelH} mm = ${cfg.dots} × ${Math.round(settings.paper.labelH * 8)} dots, centred on the ${headMm} mm head.`;
  $$('#ptypeGrid .tpl').forEach((b) => b.classList.toggle('on', b.dataset.pt === settings.printType));
  const pt = PRINT_TYPES.find((t) => t.k === settings.printType);
  const sum = $('#paperSummary');
  sum.innerHTML = `<span>📄 <b>${esc(paperText())}</b></span><span>${pt ? pt.icon + ' ' + esc(pt.name) : ''}</span><span class="muted">${cfg.dots} × ${cfg.type === 'label' ? Math.round(cfg.labelH * 8) : 'auto'} dots</span><button type="button" data-goto="printer">Change</button>`;
  $('#paperInfo').textContent = `${paperText()} · rulers in mm`;
  $('#rollHeightF').hidden = $('#trimF').hidden = cfg.type === 'label';
}

$('#paperSummary').addEventListener('click', (e) => { if (e.target.closest('[data-goto]')) go('printer'); });
$('#labelChips').innerHTML = LABEL_PRESETS.map(([l, h]) => `<button class="chip-btn" data-l="${l}" data-h="${h}">${l} × ${h} mm</button>`).join('');
$('#ptypeGrid').innerHTML = PRINT_TYPES.map((t) => `<button class="tpl" data-pt="${t.k}"><i>${t.icon}</i><span><b>${esc(t.name)}</b><small>${esc(t.sub)}</small></span></button>`).join('');

function setPaperType(type) {
  settings.paper.type = type;
  if (type === 'label') { if (settings.paper.media === 'continuous') settings.paper.media = 'diecut'; settings.paper.lineSpacing = 20; settings.feed = 0; }
  else { settings.paper.media = 'continuous'; settings.paper.lineSpacing = 30; settings.feed = 3; }
  fillAll(); onSettingChanged('paper.type');
}
$('#paperType').onclick = (e) => { const b = e.target.closest('[data-ptype]'); if (b) setPaperType(b.dataset.ptype); };
$('#labelChips').onclick = (e) => {
  const b = e.target.closest('[data-l]'); if (!b) return;
  settings.paper.labelW = +b.dataset.l; settings.paper.labelH = +b.dataset.h;
  if (settings.paper.type !== 'label') setPaperType('label'); else { fillAll(); onSettingChanged('paper.labelW'); }
};
$('#ptypeGrid').onclick = (e) => {
  const b = e.target.closest('[data-pt]'); if (!b) return;
  const t = PRINT_TYPES.find((x) => x.k === b.dataset.pt);
  settings.printType = t.k;
  if (t.paper && settings.paper.type !== t.paper) { setPaperType(t.paper); toast(`Paper set to ${t.paper === 'label' ? 'label' : 'roll'}`); }
  saveSettings(settings);
  setKind(t.kind);
  if (t.starter && !draft.design.objects.length) { ensureEditor(); draft.design.objects = STARTERS[t.starter].build(editor.size); editor.resetHistory(); }
  updateSetupUI();
  toast(`${t.name} selected`);
};
$('#toDesign').onclick = () => {
  settings.setupDone = true; saveSettings(settings);
  go('print');
  if (settings.printType === 'photo' && draft.kind === 'canvas' && !draft.design.objects.some((o) => o.t === 'image')) $('#imgAdd').click();
};

// ----- step 1: ask the printer who it is and configure from the answer

let lastSelfTest = null;
const SRC_CLASS = { read: 'read', 'self-test': 'self-test' };

async function runDetect(selfTest) {
  if (selfTest) lastSelfTest = selfTest;
  const box = $('#detectBox');
  box.hidden = false;
  $('#detectSummary').textContent = printer.connected ? 'Asking the printer what it is…' : 'Not connected — using the remembered profile.';
  let info = { name: printer.name || settings.last?.name || '', kind: printer.kind, dis: {}, id: {}, status: {}, battery: null, replied: false };
  if (printer.connected) { try { info = await printer.probe(); } catch (e) { log(`Probe failed: ${e.message}`, 'err'); } }
  const res = inferConfig(info, lastSelfTest, { preset: settings.paper.preset, codepage: settings.codepage, baud: settings.link.baud });
  const pt = res.patch;
  if (PAPER_PRESETS[pt.preset]) settings.paper.preset = pt.preset;
  settings.codepage = pt.codepage;
  settings.link.baud = pt.baud;
  if (pt.density) settings.density = pt.density;
  Object.assign(printer.link, settings.link);
  cfg = deriveCfg(settings); saveSettings(settings); fillAll(); schedulePreview();
  $('#detectTable').innerHTML = res.facts.map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(f.value)}</td><td class="src ${SRC_CLASS[f.source] || ''}">${esc(f.source)}</td></tr>`).join('');
  const applied = `${settings.paper.preset === 'custom' ? (headDots(settings) / 8).toFixed(0) : settings.paper.preset} mm head (${headDots(settings)} dots), ${settings.codepage}, ${settings.link.baud} baud`;
  $('#detectSummary').innerHTML = `${res.replied ? '✓ The printer reported its details.' : 'This printer did not report details over Bluetooth (common for mobile printers), so the settings below come from its name, your self-test and sensible defaults.'} <b>Configured automatically:</b> ${esc(applied)}. Now choose your paper in step 2.`;
  log(`Auto-configured: ${applied}`);
}
$('#btnDetect').onclick = () => runDetect();
$('#btnParseSelf').onclick = () => {
  const parsed = parseSelfTest($('#selfTestText').value);
  if (!parsed.fields.length) return toast('No self-test values found — use one “Name  value” per line', { err: true });
  runDetect(parsed); toast(`Read ${parsed.fields.length} values from the self-test`);
};
$('#applyProfile').onclick = () => { $('#selfTestText').value = PROFILE.map(([k, v]) => `${k}\t${v}`).join('\n'); $('#btnParseSelf').click(); };

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
renderTplGrid();
renderStudioForm();
renderTemplates();
renderSupport();
updateNet();
updateConnUI();
if (!['canvas', 'receipt', 'studio', 'text', 'raw'].includes(draft.kind)) draft.kind = 'canvas';
setKind(draft.kind);
$('#appInfo').textContent = `MyPrint 2.0 · ${matchMedia('(display-mode: standalone)').matches ? 'running as installed app' : 'running in browser'} · data stays on this device`;
renderJobs();
if (settings.autoReconnect && settings.last) printer.reconnect(settings.last);
go(settings.setupDone ? 'print' : 'printer');
