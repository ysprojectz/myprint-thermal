// Turns blocks into a preview canvas + printer bytes, choosing native ESC/POS text or graphic mode.
import { layoutNative, layoutLossy, buildNative, buildRasterJob, columns } from './escpos.js';
import { renderDesign, trimCanvas, padToHead } from './designer.js';
import { prepareBlocks, renderRaster, renderNativePreview, attachPreviewCanvases, packCanvas, blackRatio } from './render.js';

// Printer head width presets (printable dots at 203 dpi = 8 dots per mm).
export const PAPER_PRESETS = {
  58: { label: '58 mm head — 384 dots (your printer)', dots: 384 },
  80: { label: '80 mm head — 576 dots', dots: 576 },
  76: { label: '76 mm head — 512 dots', dots: 512 },
  50: { label: '50 mm head — 368 dots', dots: 368 },
  38: { label: '38 mm head — 256 dots', dots: 256 },
  custom: { label: 'Custom head width…', dots: 384 },
};

// [length, height] in mm. LENGTH runs across the label (the print-head direction), HEIGHT runs along the paper feed.
export const LABEL_PRESETS = [[50, 25], [40, 30], [40, 20], [30, 20], [48, 30], [48, 50], [25, 50]];

export function headDots(s) {
  return s.paper.preset === 'custom' ? s.paper.dots : (PAPER_PRESETS[s.paper.preset] || PAPER_PRESETS[58]).dots;
}

export function deriveCfg(s) {
  const head = Math.max(64, Math.min(1152, Math.round(headDots(s) / 8) * 8));
  const label = s.paper.type === 'label';
  // Label: design area is exactly length x height; narrower than the head => centred on the head.
  const dots = label ? Math.max(64, Math.min(head, Math.floor((s.paper.labelW || 50) * 8 / 8) * 8)) : head;
  return {
    type: label ? 'label' : 'roll', pageDots: head, dots, offset: label ? Math.floor((head - dots) / 16) * 8 : 0,
    margin: Math.max(0, Math.round(s.paper.margin || 0)),
    labelL: label ? s.paper.labelW : 0, labelH: label ? s.paper.labelH || 25 : 0,
    media: label ? (s.paper.media === 'continuous' ? 'diecut' : s.paper.media || 'diecut') : 'continuous',
    lineSpacing: s.paper.lineSpacing || 30, topFeed: s.paper.topFeed || 0,
    font: s.font, mode: s.mode, codepage: s.codepage,
    feed: s.feed, cut: s.cut, drawer: s.drawer, buzzer: !!s.buzzer,
    translit: !!s.translit, codeRaster: s.qrEngine === 'raster',
    densityOn: s.densityOn, density: s.density,
    imageCmd: s.imageCmd, strip: s.strip, threshold: s.threshold,
    rasterFont: s.raster.font, rasterSize: s.raster.size, lineGap: s.raster.lineGap,
  };
}

/** Size in dots of the designer canvas for the chosen paper. */
export function designSize(design, cfg) {
  return { W: cfg.dots, H: cfg.type === 'label' ? Math.round(cfg.labelH * 8) : Math.round((design.heightMm || 80) * 8) };
}

function statsOf(data, canvas, cfg) {
  const feedMm = ((cfg.feed + cfg.topFeed) * cfg.lineSpacing) / 8;
  return { bytes: data.length, rows: canvas.height, mm: Math.round(canvas.height / 8 + feedMm), duty: blackRatio(canvas) };
}

/** Canvas designer -> same result shape as compile(). Rolls are trimmed to the content; labels keep their fixed size. */
export async function compileDesign(design, cfg) {
  const size = designSize(design, cfg);
  let canvas = await renderDesign(design, size);
  if (cfg.type !== 'label' && design.trim) canvas = trimCanvas(canvas);
  const data = buildRasterJob(packCanvas(padToHead(canvas, cfg.pageDots), 128), cfg);
  return { mode: 'raster', lossy: false, cols: columns(cfg), canvas, bytes: () => data, stats: statsOf(data, canvas, cfg) };
}

/**
 * compile(blocks, cfg, forceMode?) -> { mode, lossy, canvas, bytes(), stats }
 * `auto` uses native text unless some character does not exist in the codepage (₹, Tamil, …).
 * stats = { bytes, rows, mm, duty } — duty is the share of black dots, a proxy for thermal-head load.
 */
export async function compile(blocks, cfg, forceMode) {
  await prepareBlocks(blocks, cfg);
  const want = forceMode || cfg.mode;
  let layout = null;
  let lossy = false;
  if (want !== 'raster') {
    layout = layoutNative(blocks, cfg);
    lossy = layoutLossy(layout, cfg.codepage);
  }
  let mode, canvas, build;
  if (layout && (want === 'native' || !lossy)) {
    attachPreviewCanvases(layout);
    mode = 'native'; canvas = renderNativePreview(layout, cfg); build = () => buildNative(layout, cfg);
  } else {
    mode = 'raster'; canvas = renderRaster(blocks, cfg); build = () => buildRasterJob(packCanvas(padToHead(canvas, cfg.pageDots), 128), cfg);
  }
  const data = build();
  const stats = statsOf(data, canvas, cfg);
  return { mode, lossy, cols: columns(cfg), canvas, bytes: () => data, stats };
}
