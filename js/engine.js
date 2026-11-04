// Turns blocks into a preview canvas + printer bytes, choosing native ESC/POS text or graphic mode.
import { layoutNative, layoutLossy, buildNative, buildRasterJob, columns } from './escpos.js';
import { prepareBlocks, renderRaster, renderNativePreview, attachPreviewCanvases, packCanvas, blackRatio } from './render.js';

const HEAD_DOTS = 384; // printable dots of a 58 mm head (48 mm)

// `apply` values are copied into settings.paper when the preset is chosen.
export const PAPER_PRESETS = {
  58: { label: '58 mm roll — 384 dots (your printer)', dots: 384, apply: { media: 'continuous', labelH: 0, lineSpacing: 30 } },
  5025: { label: '50 × 25 mm label — length 50, height 25', dots: 384, apply: { media: 'diecut', labelW: 50, labelH: 25, lineSpacing: 20 }, feed: 0 },
  label: { label: 'Custom label size (width × height mm)…', dots: 384, apply: { media: 'diecut', lineSpacing: 20 }, feed: 0 },
  80: { label: '80 mm roll — 576 dots', dots: 576, apply: { media: 'continuous', labelH: 0, lineSpacing: 30 } },
  76: { label: '76 mm roll — 512 dots', dots: 512, apply: { media: 'continuous', labelH: 0, lineSpacing: 30 } },
  50: { label: '50 mm roll — 368 dots', dots: 368, apply: { media: 'continuous', labelH: 0, lineSpacing: 30 } },
  38: { label: '38 mm mini roll — 256 dots', dots: 256, apply: { media: 'continuous', labelH: 0, lineSpacing: 30 } },
  custom: { label: 'Custom width…', dots: 384 },
};

export function deriveCfg(s) {
  const preset = PAPER_PRESETS[s.paper.preset] || PAPER_PRESETS[58];
  let dots = preset.dots;
  if (s.paper.preset === 'custom') dots = s.paper.dots;
  if (s.paper.preset === 'label') dots = Math.min(HEAD_DOTS, Math.floor(((s.paper.labelW || 50) * 8) / 8) * 8); // 8 dots per mm
  return {
    dots: Math.max(64, Math.min(1152, Math.round(dots / 8) * 8)),
    margin: Math.max(0, Math.round(s.paper.margin || 0)),
    media: s.paper.media || 'continuous', labelH: s.paper.labelH || 0,
    lineSpacing: s.paper.lineSpacing || 30, topFeed: s.paper.topFeed || 0,
    font: s.font, mode: s.mode, codepage: s.codepage,
    feed: s.feed, cut: s.cut, drawer: s.drawer, buzzer: !!s.buzzer,
    translit: !!s.translit, codeRaster: s.qrEngine === 'raster',
    densityOn: s.densityOn, density: s.density,
    imageCmd: s.imageCmd, strip: s.strip, threshold: s.threshold,
    rasterFont: s.raster.font, rasterSize: s.raster.size, lineGap: s.raster.lineGap,
  };
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
    mode = 'raster'; canvas = renderRaster(blocks, cfg); build = () => buildRasterJob(packCanvas(canvas, 128), cfg);
  }
  const data = build();
  const feedMm = ((cfg.feed + cfg.topFeed) * cfg.lineSpacing) / 8;
  const stats = { bytes: data.length, rows: canvas.height, mm: Math.round(canvas.height / 8 + feedMm), duty: blackRatio(canvas) };
  return { mode, lossy, cols: columns(cfg), canvas, bytes: () => data, stats };
}
