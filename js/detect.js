// Printer identification and automatic configuration.
// Three sources, strongest first: (1) values the printer reports (BLE Device Information, ESC/POS GS I / DLE EOT),
// (2) a pasted self-test sheet, (3) the model database / your saved profile. Every fact carries its source so the UI
// can be honest about what was read and what was only inferred.

const MODELS = [
  { re: /5806|MHT-?P?58|PT-?(210|260)|MPT-?II|\b58\s?mm|POS-?58|RPP-?02|GP-?58|P58/i, label: '58 mm mobile thermal printer', preset: '58', head: 384 },
  { re: /8003|MHT-?P?80|\b80\s?mm|POS-?80|GP-?80|TM-?T20|RPP-?300|P80/i, label: '80 mm thermal printer', preset: '80', head: 576 },
];

const KEYS = ['Version', 'Font', 'Code type', 'Char type', 'Language', 'Interface', 'Baudrate', 'Baud rate', 'Sleep time', 'CMD Type', 'Command set',
  'Page mode', 'Print mode', 'Speed', 'Print temperature', 'Print depth', 'Quality lev', 'Quality', 'Black label', 'Clear buf', 'Passive buzzer',
  'BT Mul Conn', 'BT multi-connection', 'BT BROADCAST', 'BT broadcast', 'Power'];

/** Parses the text of a printer self-test sheet ("Key<tab/colon/spaces>Value" per line). */
export function parseSelfTest(text) {
  const fields = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const key = KEYS.slice().sort((a, b) => b.length - a.length).find((k) => line.toLowerCase().startsWith(k.toLowerCase()));
    if (!key) continue;
    const value = line.slice(key.length).replace(/^[\s:\t]+/, '').trim();
    if (value) fields.push([key, value]);
  }
  const get = (...ks) => fields.find(([k]) => ks.some((x) => x.toLowerCase() === k.toLowerCase()))?.[1];
  const patch = {};
  const lang = get('Language'), baud = get('Baudrate', 'Baud rate'), depth = get('Print depth'), ver = get('Version');
  if (lang) patch.codepage = /858/.test(lang) ? 'PC858' : /1252/.test(lang) ? 'WPC1252' : /850/.test(lang) ? 'PC850' : undefined;
  if (baud && /^\d+$/.test(baud)) patch.baud = +baud;
  if (depth && /\d+/.test(depth)) patch.density = +depth.match(/\d+/)[0];
  if (ver) { const m = MODELS.find((x) => x.re.test(ver)); if (m) Object.assign(patch, { preset: m.preset, head: m.head, model: m.label }); }
  if (/disable/i.test(get('Black label') || '')) patch.media = 'continuous';
  patch.buzzer = /enable/i.test(get('Passive buzzer') || '');
  return { fields, patch };
}

/**
 * Builds the list of facts shown to the user and the settings patch to apply.
 * `info` comes from Printer.probe(); `selfTest` from parseSelfTest(); `saved` is the app's remembered profile.
 */
export function inferConfig(info, selfTest, saved = {}) {
  const facts = [], patch = {};
  const add = (label, value, source) => { if (value !== undefined && value !== null && value !== '') facts.push({ label, value: String(value), source }); };

  add('Bluetooth name', info?.name, 'read');
  for (const [k, v] of Object.entries(info?.dis || {})) add(k[0].toUpperCase() + k.slice(1), v, 'read');
  for (const [k, v] of Object.entries(info?.id || {})) add(k[0].toUpperCase() + k.slice(1) + ' (ESC/POS)', v, 'read');
  if (info?.battery != null) add('Battery', `${info.battery}%`, 'read');
  if (info?.status?.paper) add('Paper sensor', { ok: 'paper present', low: 'paper running low', out: 'OUT OF PAPER' }[info.status.paper], 'read');
  if (info?.status?.online !== undefined) add('Printer status', info.status.online ? 'online' : 'offline / cover open', 'read');

  const text = [info?.name, ...Object.values(info?.dis || {}), ...Object.values(info?.id || {}), selfTest?.fields.find(([k]) => k === 'Version')?.[1]].join(' ');
  const model = MODELS.find((m) => m.re.test(text));
  if (selfTest?.fields.length) for (const [k, v] of selfTest.fields) add(k, v, 'self-test');

  if (selfTest?.patch.preset) { patch.preset = selfTest.patch.preset; patch.head = selfTest.patch.head; add('Paper width', `${selfTest.patch.preset} mm head (${selfTest.patch.head} dots)`, 'self-test'); }
  else if (model) { patch.preset = model.preset; patch.head = model.head; add('Paper width', `${model.preset} mm head (${model.head} dots)`, 'inferred from the model name'); }
  else { patch.preset = saved.preset || '58'; patch.head = saved.head || 384; add('Paper width', `${patch.preset} mm head (${patch.head} dots)`, 'default — most mobile printers are 58 mm'); }

  patch.codepage = selfTest?.patch.codepage || saved.codepage || 'PC850';
  add('Codepage', patch.codepage, selfTest?.patch.codepage ? 'self-test' : 'default — PC850 as on your self-test');
  patch.baud = selfTest?.patch.baud || saved.baud || 115200;
  add('Serial baud rate', patch.baud, selfTest?.patch.baud ? 'self-test' : 'default');
  if (selfTest?.patch.density) { patch.density = selfTest.patch.density; add('Print darkness level', selfTest.patch.density, 'self-test'); }
  if (selfTest?.patch.buzzer) patch.buzzer = true;
  return { facts, patch, replied: !!info?.replied || !!(info && (Object.keys(info.dis).length || info.battery != null)), model: model?.label || selfTest?.patch.model };
}
