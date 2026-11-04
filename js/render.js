// Canvas renderer: blocks -> 1-bit bitmap (for graphic mode + preview), image dithering, QR/barcode drawing.
import { normalizeForCodepage } from './escpos.js';

const FONTS = {
  sans: '"Segoe UI","Helvetica Neue",Arial,"Noto Sans","Noto Sans Tamil","Noto Sans Devanagari","Nirmala UI",sans-serif',
  mono: '"SF Mono",Menlo,Consolas,"Courier New",monospace',
  serif: 'Georgia,"Times New Roman","Noto Serif",serif',
};

const newCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

// ---------------------------------------------------------------- bitmap helpers

export function binarize(canvas, threshold = 140) {
  const ctx = ctx2d(canvas);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = lum < threshold ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

/** Packs a canvas into 1bpp rows (1 = black), width padded to a multiple of 8. */
export function packCanvas(canvas, threshold = 128) {
  const { width: w, height: h } = canvas;
  const wBytes = Math.ceil(w / 8);
  const px = ctx2d(canvas).getImageData(0, 0, w, h).data;
  const data = new Uint8Array(wBytes * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < threshold) data[y * wBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  return { w, h, wBytes, data };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** gray: Float32Array 0..255. Returns Uint8Array, 1 = black. */
function dither(gray, w, h, mode, th) {
  const out = new Uint8Array(w * h);
  if (mode === 'bayer') {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) out[y * w + x] = gray[y * w + x] < (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) * 16 ? 1 : 0;
    return out;
  }
  const kernels = {
    floyd: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
    atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
  }[mode];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const black = old < (kernels ? 128 : th);
      out[i] = black ? 1 : 0;
      if (!kernels) continue;
      const err = old - (black ? 0 : 255);
      for (const [dx, dy, f] of kernels) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny < h) gray[ny * w + nx] += err * f;
      }
    }
  return out;
}

function bwCanvas(bits, w, h) {
  const c = newCanvas(w, h);
  const ctx = ctx2d(c);
  const id = ctx.createImageData(w, h);
  for (let i = 0; i < bits.length; i++) {
    const v = bits[i] ? 0 : 255;
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------- image / pattern preparation

const cache = new Map();
const hold = (key, v) => {
  cache.set(key, v);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return v;
};

async function loadImage(src) {
  const im = new Image();
  im.src = src;
  await im.decode();
  return im;
}

async function imageToBW(b, cw) {
  const im = await loadImage(b.src);
  const w = Math.max(8, Math.round((cw * (b.scale || 100)) / 100));
  const h = Math.max(1, Math.round((im.naturalHeight * w) / im.naturalWidth));
  const c = newCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  const br = (b.brightness || 0) * 2.55;
  const ct = b.contrast || 0;
  const f = (259 * (ct + 255)) / (255 * (259 - ct));
  for (let i = 0; i < gray.length; i++) {
    const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const v = Math.min(255, Math.max(0, f * (lum - 128) + 128 + br));
    gray[i] = b.invert ? 255 - v : v;
  }
  return bwCanvas(dither(gray, w, h, b.dither || 'atkinson', b.threshold || 128), w, h);
}

function patternCanvas(kind, cw) {
  if (kind === 'gradient') {
    const h = 56, steps = 8, c = newCanvas(cw, h), ctx = ctx2d(c);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, h);
    const sw = cw / steps, gray = new Float32Array(cw * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < cw; x++) gray[y * cw + x] = 255 * (1 - Math.floor(x / sw) / (steps - 1));
    return bwCanvas(dither(gray, cw, h, 'bayer', 128), cw, h);
  }
  if (kind === 'checker') { // dead-heater-dot check: solid band, 1-dot lines, checkerboard
    const h = 72, c = newCanvas(cw, h), ctx = ctx2d(c);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, h);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, 16);
    for (let x = 0; x < cw; x += 2) ctx.fillRect(x, 24, 1, 16);
    for (let y = 48; y < h; y += 4) for (let x = 0; x < cw; x += 8) ctx.fillRect(x + (((y - 48) / 4) % 2) * 4, y, 4, 4);
    return c;
  }
  // ruler: 8 dots = 1 mm at 203 dpi
  const h = 54, c = newCanvas(cw, h), ctx = ctx2d(c);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, h);
  ctx.fillStyle = '#000'; ctx.font = '700 16px sans-serif'; ctx.textBaseline = 'top';
  ctx.fillRect(0, 0, cw, 2);
  for (let mm = 0; mm * 8 < cw; mm++) {
    const len = mm % 10 === 0 ? 24 : mm % 5 === 0 ? 16 : 8;
    ctx.fillRect(mm * 8, 2, 1, len);
    if (mm % 10 === 0 && mm) ctx.fillText(String(mm / 10), mm * 8 + 3, 28);
  }
  ctx.fillRect(0, h - 3, 3, 3); ctx.fillRect(cw - 3, h - 3, 3, 3); // edge markers
  return c;
}

function frameCanvas(c, style) {
  const pad = style === 'polaroid' ? 14 : 6;
  const out = newCanvas(c.width + pad * 2, c.height + pad * 2 + (style === 'polaroid' ? 10 : 0));
  const ctx = ctx2d(out);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.strokeStyle = '#000'; ctx.lineWidth = style === 'polaroid' ? 4 : 2;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, out.width - ctx.lineWidth, out.height - ctx.lineWidth);
  ctx.drawImage(c, pad, pad);
  return out;
}

function qrCanvas(b, cw) {
  const q = qrMatrix(b.data, b.ec);
  const n = q.getModuleCount();
  const mod = Math.max(1, Math.min(Math.round(b.size || 6), Math.floor(cw / n)));
  const c = newCanvas(n * mod, n * mod);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) ctx.fillRect(k * mod, r * mod, mod, mod);
  return c;
}

export async function prepareBlocks(blocks, cfg) {
  const cw = cfg.dots - 2 * cfg.margin;
  for (const b of blocks) {
    let src;
    if (b.t === 'image' && b.src) {
      const key = [b.src.length, b.src.slice(-48), cw, b.scale, b.dither, b.brightness, b.contrast, b.threshold, b.invert, b.frame].join('|');
      src = cache.get(key) || hold(key, await (async () => { const bw = await imageToBW(b, cw); return b.frame && b.frame !== 'none' ? frameCanvas(bw, b.frame) : bw; })());
    } else if (b.t === 'pattern') {
      const key = `p|${b.kind}|${cw}`;
      src = cache.get(key) || hold(key, patternCanvas(b.kind, cw));
    } else if (cfg.codeRaster && b.data && (b.t === 'qr' || b.t === 'barcode')) {
      src = b.t === 'qr' ? qrCanvas(b, cw) : barcodeCanvas(b, cw); // "raster engine": identical dots on every printer
    } else continue;
    // padded to full content width so alignment is baked in (printers differ on ESC a + raster)
    const full = newCanvas(cw, src.height);
    const ctx = ctx2d(full);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, src.height);
    const x = b.align === 'center' || b.t === 'pattern' ? Math.round((cw - src.width) / 2) : b.align === 'right' ? cw - src.width : 0;
    ctx.drawImage(src, x, 0);
    b._img = { canvas: src, x, packed: packCanvas(full) };
  }
}

// ---------------------------------------------------------------- QR / barcode

function qrMatrix(data, ec = 'M') {
  /* global qrcode */
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const q = qrcode(0, ec);
  q.addData(String(data));
  q.make();
  return q;
}

function drawQR(ctx, b, m, cw, y, draw) {
  let q;
  try { q = qrMatrix(b.data, b.ec); } catch { return textFallback(ctx, 'QR: data too long', m, cw, y, draw); }
  const n = q.getModuleCount();
  const mod = Math.max(1, Math.min(Math.round(b.size || 6), Math.floor(cw / n)));
  const size = n * mod;
  const x = m + (b.align === 'left' ? 0 : b.align === 'right' ? cw - size : Math.round((cw - size) / 2));
  if (draw) {
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(x + c * mod, y + r * mod, mod, mod);
  }
  return size;
}

function barcodeCanvas(b, cw) {
  /* global JsBarcode */
  for (let width = Math.max(1, Math.round(b.width || 2)); width >= 1; width--) {
    const c = document.createElement('canvas');
    try {
      JsBarcode(c, String(b.data), {
        format: b.format || 'CODE128', width, height: b.height || 60, displayValue: b.hri !== false,
        margin: 0, fontSize: 18, textMargin: 3, background: '#ffffff', lineColor: '#000000', font: 'monospace',
      });
    } catch {
      throw new Error(`"${b.data}" is not valid for ${b.format || 'CODE128'}`);
    }
    if (c.width <= cw || width === 1) return c;
  }
}

function drawBarcode(ctx, b, m, cw, y, draw) {
  const c = barcodeCanvas(b, cw);
  const w = Math.min(c.width, cw);
  const x = m + (b.align === 'left' ? 0 : b.align === 'right' ? cw - w : Math.round((cw - w) / 2));
  if (draw) ctx.drawImage(c, x, y, w, c.height * (w / c.width));
  return c.height * (w / c.width);
}

function textFallback(ctx, text, m, cw, y, draw) {
  if (draw) { ctx.fillStyle = '#000'; ctx.font = '16px sans-serif'; ctx.textBaseline = 'top'; ctx.fillText(text, m, y); }
  return 20;
}

// ---------------------------------------------------------------- graphic (raster) mode

function wrapPx(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      let w = word;
      while (ctx.measureText(w).width > maxW && [...w].length > 1) { // hard-break very long words
        let n = [...w].length;
        while (n > 1 && ctx.measureText([...w].slice(0, n).join('')).width > maxW) n--;
        if (cur) { out.push(cur); cur = ''; }
        out.push([...w].slice(0, n).join(''));
        w = [...w].slice(n).join('');
      }
      const next = cur ? cur + ' ' + w : w;
      if (!cur || ctx.measureText(next).width <= maxW) cur = next;
      else { out.push(cur); cur = w; }
    }
    out.push(cur);
  }
  return out;
}

function paintRaster(ctx, blocks, cfg, draw) {
  const W = cfg.dots, m = cfg.margin, cw = W - 2 * m;
  const base = cfg.rasterSize, fam = FONTS[cfg.rasterFont] || FONTS.sans;
  const lh = (s) => Math.round(base * s * cfg.lineGap);
  const font = (s, bold) => { ctx.font = `${bold ? 700 : 400} ${base * s}px ${fam}`; ctx.textBaseline = 'top'; };
  const xAt = (align, w) => m + (align === 'center' ? Math.round((cw - w) / 2) : align === 'right' ? cw - w : 0);
  let y = 4;
  for (const b of blocks) {
    const s = Math.min(4, Math.max(1, b.size || 1)) * (b.font === 'B' ? 0.78 : 1);
    switch (b.t) {
      case 'text': {
        font(s, b.bold);
        const vs = b.tall ? 2 : 1; // double-height text
        for (const line of wrapPx(ctx, b.text, cw)) {
          const w = ctx.measureText(line).width, x = xAt(b.align, w), off = Math.round((lh(s) - base * s) / 2), H = lh(s) * vs;
          if (draw) {
            if (b.inv) { ctx.fillStyle = '#000'; ctx.fillRect(m, y, cw, H); }
            ctx.fillStyle = b.inv ? '#fff' : '#000';
            ctx.save(); ctx.translate(0, y); ctx.scale(1, vs); ctx.fillText(line, x, off); ctx.restore();
            if (b.ul) ctx.fillRect(x, y + H - 3, w, 2);
          }
          y += H;
        }
        break;
      }
      case 'cols': {
        font(s, b.bold);
        const cells = b.cells || [], n = Math.max(1, cells.length), step = cw / n;
        if (draw) { ctx.fillStyle = '#000'; cells.forEach((c, i) => ctx.fillText(String(c), m + i * step, y + Math.round((lh(s) - base * s) / 2))); }
        y += lh(s);
        break;
      }
      case 'box': {
        font(s, b.bold);
        const lines = wrapPx(ctx, b.text, cw - 24), H = lines.length * lh(s) + 16;
        if (draw) {
          ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(m + 1, y + 2, cw - 2, H - 4);
          ctx.fillStyle = '#000'; lines.forEach((l, i) => ctx.fillText(l, m + 12, y + 8 + i * lh(s) + Math.round((lh(s) - base * s) / 2)));
        }
        y += H + 4;
        break;
      }
      case 'row': {
        font(s, b.bold);
        const right = String(b.right ?? ''), rw = ctx.measureText(right).width;
        const lines = wrapPx(ctx, b.left, Math.max(40, cw - rw - 12));
        lines.forEach((line, i) => {
          if (draw) {
            ctx.fillStyle = '#000';
            ctx.fillText(line, m, y + Math.round((lh(s) - base * s) / 2));
            if (i === 0) ctx.fillText(right, m + cw - rw, y + Math.round((lh(s) - base * s) / 2));
          }
          y += lh(s);
        });
        break;
      }
      case 'hr': {
        const st = b.style || 'dash';
        if (draw) {
          ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
          ctx.setLineDash(st === 'dash' ? [8, 6] : st === 'dot' ? [2, 4] : []);
          const ys = st === 'double' ? [y + 4, y + 9] : [y + 6];
          for (const yy of ys) { ctx.beginPath(); ctx.moveTo(m, yy); ctx.lineTo(m + cw, yy); ctx.stroke(); }
          ctx.setLineDash([]);
        }
        y += st === 'double' ? 16 : 14;
        break;
      }
      case 'qr': if (b.data) y += drawQR(ctx, b, m, cw, y + 4, draw) + 10; break;
      case 'barcode': if (b.data) y += drawBarcode(ctx, b, m, cw, y + 4, draw) + 10; break;
      case 'image': case 'pattern':
        if (b._img) {
          if (draw) ctx.drawImage(b._img.canvas, m + b._img.x, y + 2);
          y += b._img.canvas.height + 6;
        }
        break;
      case 'feed': y += lh(1) * (b.n || 1); break;
    }
  }
  return y;
}

export function renderRaster(blocks, cfg) {
  const h = paintRaster(ctx2d(newCanvas(cfg.dots, 8)), blocks, cfg, false);
  const c = newCanvas(cfg.dots, Math.ceil(h) + 8);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  paintRaster(ctx, blocks, cfg, true);
  return binarize(c, cfg.threshold);
}

// ---------------------------------------------------------------- native text preview (cell grid)

export function renderNativePreview(layout, cfg) {
  const { ops, cell } = layout;
  const W = cfg.dots, m = cfg.margin, cw = W - 2 * m;
  const pitch = cfg.lineSpacing || 30; // ESC 3 n line pitch in dots (default 30)
  const probe = ctx2d(newCanvas(10, 10));
  probe.font = '100px monospace';
  const glyphPx = (cellW) => (cellW / (probe.measureText('M').width / 100));

  const run = (ctx, draw) => {
    let y = 4;
    for (const o of ops) {
      if (o.k === 'line') {
        const cellW = (o.font === 'B' ? 9 : cell) * o.w, h = pitch * o.h;
        const text = [...normalizeForCodepage(o.text, cfg.codepage).str];
        const w = text.length * cellW;
        const x0 = m + (o.align === 'center' ? Math.round((cw - w) / 2) : o.align === 'right' ? cw - w : 0);
        if (draw) {
          if (o.inv) { ctx.fillStyle = '#000'; ctx.fillRect(x0, y, w, h); }
          ctx.fillStyle = o.inv ? '#fff' : '#000';
          const px = glyphPx(cellW);
          ctx.font = `${o.bold ? 700 : 400} ${px}px monospace`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'center';
          ctx.save(); ctx.translate(0, y + h / 2); ctx.scale(1, o.h / o.w); // double-height text
          text.forEach((ch, i) => ctx.fillText(ch, x0 + i * cellW + cellW / 2, 0));
          ctx.restore();
          ctx.textAlign = 'left';
          if (o.ul) ctx.fillRect(x0, y + h - 4, w, 2);
        }
        y += h;
      } else if (o.k === 'qr') y += drawQR(ctx, o, m, cw, y + 4, draw) + 10;
      else if (o.k === 'barcode') y += drawBarcode(ctx, o, m, cw, y + 4, draw) + 10;
      else if (o.k === 'image') {
        if (draw) ctx.drawImage(o.canvas, m, y + 2);
        y += o.canvas.height + 6;
      } else if (o.k === 'feed') y += pitch * o.n;
    }
    return y;
  };
  // preview needs the bitmap canvas of images: reuse the packed padded version via blocks' _img
  const h = run(ctx2d(newCanvas(W, 8)), false);
  const c = newCanvas(W, Math.ceil(h) + 8);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  run(ctx, true);
  return binarize(c, 140);
}

/** Native image ops only carry packed bits; give the preview a drawable canvas. */
export function attachPreviewCanvases(layout) {
  for (const o of layout.ops) {
    if (o.k !== 'image' || o.canvas) continue;
    const p = o.packed, c = newCanvas(p.w, p.h), ctx = ctx2d(c), id = ctx.createImageData(p.w, p.h);
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const v = (p.data[y * p.wBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255, i = (y * p.w + x) * 4;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
      }
    ctx.putImageData(id, 0, 0);
    o.canvas = c;
  }
}

/** Share of black dots (0..1) in a binarized canvas — a proxy for thermal head load. */
export function blackRatio(canvas) {
  const d = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
  return n / (d.length / 4);
}
