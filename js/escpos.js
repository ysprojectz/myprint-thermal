// ESC/POS engine: text encoding, native text layout and command builder.
// Pure JS (no DOM) so it can be unit-tested in Node.

const HIGH_850 =
  'ÇüéâäàåçêëèïîìÄÅ' + 'ÉæÆôöòûùÿÖÜø£Ø×ƒ' + 'áíóúñÑªº¿®¬½¼¡«»' + '░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤' + 'ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀' + 'ÓßÔÒõÕµþÞÚÛÙýÝ¯´' + '­±‗¾¶§÷¸°¨·¹³²■ ';

// ESC t n values (Epson numbering, shared by most generic 58mm printers)
export const CODEPAGES = {
  PC850: { id: 2, label: 'PC850 Multilingual (matches self-test)' },
  PC858: { id: 19, label: 'PC858 Multilingual + Euro' },
  WPC1252: { id: 16, label: 'Windows-1252 Latin' },
};

const TABLES = {};
function table(cp) {
  if (TABLES[cp]) return TABLES[cp];
  let hi;
  if (cp === 'PC850') hi = HIGH_850;
  else if (cp === 'PC858') hi = HIGH_850.slice(0, 85) + '€' + HIGH_850.slice(86);
  else hi = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 128 }, (_, i) => 128 + i));
  const m = new Map();
  [...hi].forEach((ch, i) => m.set(ch, 128 + i));
  return (TABLES[cp] = m);
}

const REPL = {
  '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '*',
  ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '\t': '    ', '\r': '',
};

/** Rewrites `str` so every char exists in the codepage. `lossy` = something had no equivalent. */
export function normalizeForCodepage(str, cp = 'PC850') {
  const map = table(cp);
  let out = '';
  let lossy = false;
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    if (ch === '\n' || (c >= 0x20 && c < 0x7f)) out += ch;
    else if (c >= 0x80 && map.has(ch)) out += ch;
    else if (ch in REPL) out += REPL[ch];
    else {
      lossy = true;
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += base !== ch && /^[\x20-\x7e]+$/.test(base) ? base : '?';
    }
  }
  return { str: out, lossy };
}

export function encodeText(str, cp = 'PC850') {
  const { str: s, lossy } = normalizeForCodepage(str, cp);
  const map = table(cp);
  const out = [];
  for (const ch of s) out.push(ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : map.get(ch) ?? 0x3f);
  return { bytes: Uint8Array.from(out), lossy };
}

const utf8 = (s) => new TextEncoder().encode(String(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, Math.round(Number(v) || 0)));

// ---------------------------------------------------------------- command builder

export class EscPos {
  constructor(cfg) {
    this.cfg = cfg;
    this.parts = [];
    this.st = { align: 0, bold: 0, ul: 0, w: 1, h: 1, inv: 0 };
  }
  cmd(...b) { this.parts.push(Uint8Array.from(b)); return this; }
  put(u8) { this.parts.push(u8); return this; }
  bytes() {
    const len = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }

  init({ native = true } = {}) {
    const c = this.cfg;
    this.cmd(0x1b, 0x40); // ESC @
    if (native) {
      this.cmd(0x1b, 0x74, CODEPAGES[c.codepage]?.id ?? 2); // ESC t n
      this.cmd(0x1b, 0x4d, c.font === 'B' ? 1 : 0); // ESC M n
      if (c.margin > 0) {
        const w = c.dots - 2 * c.margin;
        this.cmd(0x1d, 0x4c, c.margin & 255, c.margin >> 8); // GS L
        this.cmd(0x1d, 0x57, w & 255, w >> 8); // GS W
      }
    }
    if (c.densityOn) this.cmd(0x1b, 0x37, 7, Math.round(40 + c.density * 1.6), 2); // ESC 7 n1 n2 n3
    return this;
  }

  style({ align = 'left', bold = false, ul = false, w = 1, h = 1, inv = false } = {}) {
    const st = this.st;
    const a = { left: 0, center: 1, right: 2 }[align] ?? 0;
    if (a !== st.align) { this.cmd(0x1b, 0x61, a); st.align = a; }
    if (+bold !== st.bold) { this.cmd(0x1b, 0x45, +bold); st.bold = +bold; }
    if (+ul !== st.ul) { this.cmd(0x1b, 0x2d, +ul); st.ul = +ul; }
    if (w !== st.w || h !== st.h) { this.cmd(0x1d, 0x21, ((w - 1) << 4) | (h - 1)); st.w = w; st.h = h; }
    if (+inv !== st.inv) { this.cmd(0x1d, 0x42, +inv); st.inv = +inv; }
    return this;
  }

  line(text, style) {
    this.style(style);
    this.put(encodeText(text, this.cfg.codepage).bytes);
    return this.cmd(0x0a);
  }

  feed(n) { return n > 0 ? this.cmd(0x1b, 0x64, clamp(n, 0, 255)) : this; } // ESC d n

  qr(data, { size = 6, ec = 'M' } = {}) {
    const d = utf8(data);
    const len = d.length + 3;
    this.cmd(0x1d, 0x28, 0x6b, 4, 0, 49, 65, 50, 0); // model 2
    this.cmd(0x1d, 0x28, 0x6b, 3, 0, 49, 67, clamp(size, 1, 16)); // module size
    this.cmd(0x1d, 0x28, 0x6b, 3, 0, 49, 69, 48 + ({ L: 0, M: 1, Q: 2, H: 3 }[ec] ?? 1)); // error correction
    this.cmd(0x1d, 0x28, 0x6b, len & 255, len >> 8, 49, 80, 48).put(d); // store
    this.cmd(0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48); // print
    return this.cmd(0x0a);
  }

  barcode(data, { format = 'CODE128', height = 60, width = 2, hri = true } = {}) {
    const m = { UPC: 65, EAN13: 67, EAN8: 68, CODE39: 69, ITF: 70, CODE128: 73 }[format] ?? 73;
    this.cmd(0x1d, 0x48, hri ? 2 : 0).cmd(0x1d, 0x68, clamp(height, 1, 255)).cmd(0x1d, 0x77, clamp(width, 2, 6));
    const d = utf8(format === 'CODE128' ? '{B' + data : data);
    this.cmd(0x1d, 0x6b, m, d.length).put(d);
    return this.cmd(0x0a);
  }

  /** 1-bit packed bitmap {w,h,wBytes,data} -> GS v 0 (default) or ESC * 24-dot bands. */
  raster(p) {
    const { imageCmd = 'gsv0', strip = 96 } = this.cfg;
    if (imageCmd === 'escstar') return this._escStar(p);
    for (let y = 0; y < p.h; y += strip) {
      const rows = Math.min(strip, p.h - y);
      this.cmd(0x1d, 0x76, 0x30, 0, p.wBytes & 255, p.wBytes >> 8, rows & 255, rows >> 8);
      this.put(p.data.subarray(y * p.wBytes, (y + rows) * p.wBytes));
    }
    return this;
  }

  _escStar(p) {
    this.cmd(0x1b, 0x33, 24); // ESC 3 24: line spacing = band height
    for (let y = 0; y < p.h; y += 24) {
      this.cmd(0x1b, 0x2a, 33, p.w & 255, p.w >> 8);
      const col = new Uint8Array(p.w * 3);
      for (let x = 0; x < p.w; x++)
        for (let b = 0; b < 3; b++) {
          let v = 0;
          for (let k = 0; k < 8; k++) {
            const yy = y + b * 8 + k;
            if (yy < p.h && (p.data[yy * p.wBytes + (x >> 3)] >> (7 - (x & 7))) & 1) v |= 0x80 >> k;
          }
          col[x * 3 + b] = v;
        }
      this.put(col).cmd(0x0a);
    }
    return this.cmd(0x1b, 0x32); // ESC 2: default line spacing
  }

  cut(mode) {
    if (mode === 'full') return this.cmd(0x1d, 0x56, 0x41, 0x00);
    if (mode === 'partial') return this.cmd(0x1d, 0x56, 0x42, 0x00);
    return this;
  }
  drawer() { return this.cmd(0x1b, 0x70, 0x00, 0x19, 0xfa); }

  finish() {
    const c = this.cfg;
    this.style(); // reset alignment/bold/size
    this.feed(c.feed);
    if (c.drawer) this.drawer();
    return this.cut(c.cut);
  }
}

// ---------------------------------------------------------------- native layout

export function wrap(text, width) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let cur = '';
    for (const w of para.split(' ')) {
      let word = [...w];
      while (word.length > width) {
        if (cur) { out.push(cur); cur = ''; }
        out.push(word.slice(0, width).join(''));
        word = word.slice(width);
      }
      const ws = word.join('');
      if (!cur) cur = ws;
      else if ([...cur].length + 1 + word.length <= width) cur += ' ' + ws;
      else { out.push(cur); cur = ws; }
    }
    out.push(cur);
  }
  return out;
}

export function cellWidth(cfg) { return cfg.font === 'B' ? 9 : 12; }
export function columns(cfg) { return Math.max(8, Math.floor((cfg.dots - 2 * cfg.margin) / cellWidth(cfg))); }

/** blocks -> printer-ready ops with all wrapping resolved to character cells. */
export function layoutNative(blocks, cfg) {
  const cols = columns(cfg);
  const ops = [];
  const lineOp = (text, b, s) =>
    ops.push({ k: 'line', text, align: b.align || 'left', bold: !!b.bold, ul: !!b.ul, inv: !!b.inv, w: s, h: s });
  for (const b of blocks) {
    const s = clamp(b.size || 1, 1, 4);
    const width = Math.max(1, Math.floor(cols / s));
    switch (b.t) {
      case 'text':
        for (const l of wrap(b.text, width)) lineOp(l, b, s);
        break;
      case 'row': {
        const right = String(b.right ?? '');
        const rl = [...right].length;
        const ls = wrap(b.left, Math.max(1, width - rl - 1));
        const first = ls[0] ?? '';
        const pad = Math.max(1, width - [...first].length - rl);
        lineOp(first + ' '.repeat(pad) + right, { ...b, align: 'left' }, s);
        for (const l of ls.slice(1)) lineOp(l, { ...b, align: 'left' }, s);
        break;
      }
      case 'hr': {
        const ch = { dash: '- ', solid: '-', double: '=', dot: '.' }[b.style || 'dash'];
        lineOp(ch.repeat(Math.ceil(cols / ch.length)).slice(0, cols), {}, 1);
        break;
      }
      case 'qr': case 'barcode':
        if (b.data) ops.push({ k: b.t, ...b });
        break;
      case 'image': case 'pattern':
        if (b._img) ops.push({ k: 'image', packed: b._img.packed });
        break;
      case 'feed': ops.push({ k: 'feed', n: b.n || 1 }); break;
      case 'cut': ops.push({ k: 'cut' }); break;
    }
  }
  return { ops, cols, cell: cellWidth(cfg) };
}

export function layoutLossy(layout, cp) {
  return layout.ops.some((o) => o.k === 'line' && normalizeForCodepage(o.text, cp).lossy);
}

export function buildNative(layout, cfg) {
  const e = new EscPos(cfg).init();
  for (const o of layout.ops) {
    if (o.k === 'line') e.line(o.text, o);
    else if (o.k === 'qr') e.style({ align: o.align }).qr(o.data, o);
    else if (o.k === 'barcode') e.style({ align: o.align }).barcode(o.data, o);
    else if (o.k === 'image') e.style().raster(o.packed);
    else if (o.k === 'feed') e.feed(o.n);
    else if (o.k === 'cut') e.cut(cfg.cut === 'none' ? 'partial' : cfg.cut);
  }
  return e.finish().bytes();
}

export function buildRasterJob(packed, cfg) {
  return new EscPos(cfg).init({ native: false }).raster(packed).finish().bytes();
}

// ---------------------------------------------------------------- raw hex helper

/** "1B 40 \"Hello\" 0A" -> bytes */
export function parseHex(src) {
  const out = [];
  for (const m of String(src).matchAll(/"([^"]*)"|\b([0-9a-fA-F]{2})\b/g)) {
    if (m[1] !== undefined) out.push(...utf8(m[1]));
    else out.push(parseInt(m[2], 16));
  }
  return Uint8Array.from(out);
}

export function hexDump(u8, max = 512) {
  const lines = [];
  for (let i = 0; i < Math.min(u8.length, max); i += 16) {
    const row = [...u8.subarray(i, i + 16)];
    lines.push(
      i.toString(16).padStart(4, '0') + '  ' +
      row.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47) + '  ' +
      row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    );
  }
  if (u8.length > max) lines.push(`… ${u8.length - max} more bytes`);
  return lines.join('\n');
}
