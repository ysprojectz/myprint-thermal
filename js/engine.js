// Turns blocks into a preview canvas + printer bytes, choosing native ESC/POS text or graphic mode.
import { layoutNative, layoutLossy, buildNative, buildRasterJob, columns } from './escpos.js';
import { prepareBlocks, renderRaster, renderNativePreview, attachPreviewCanvases, packCanvas } from './render.js';

export const PAPER_PRESETS = {
  58: { label: '58 mm (384 dots / 48 mm printable)', dots: 384 },
  80: { label: '80 mm (576 dots / 72 mm printable)', dots: 576 },
  76: { label: '76 mm (512 dots / 64 mm printable)', dots: 512 },
  custom: { label: 'Custom…', dots: 384 },
};

export function deriveCfg(s) {
  const preset = PAPER_PRESETS[s.paper.preset];
  const dots = s.paper.preset === 'custom' ? s.paper.dots : preset.dots;
  return {
    dots: Math.max(64, Math.min(1152, Math.round(dots / 8) * 8)),
    margin: Math.max(0, Math.round(s.paper.margin || 0)),
    font: s.font, mode: s.mode, codepage: s.codepage,
    feed: s.feed, cut: s.cut, drawer: s.drawer,
    densityOn: s.densityOn, density: s.density,
    imageCmd: s.imageCmd, strip: s.strip, threshold: s.threshold,
    rasterFont: s.raster.font, rasterSize: s.raster.size, lineGap: s.raster.lineGap,
  };
}

/**
 * compile(blocks, cfg, forceMode?) -> { mode: 'native'|'raster', lossy, canvas, bytes() }
 * `auto` uses native text unless some character does not exist in the codepage (₹, Tamil, …).
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
  if (layout && (want === 'native' || !lossy)) {
    attachPreviewCanvases(layout);
    return { mode: 'native', lossy, cols: columns(cfg), canvas: renderNativePreview(layout, cfg), bytes: () => buildNative(layout, cfg) };
  }
  const canvas = renderRaster(blocks, cfg);
  return { mode: 'raster', lossy, cols: columns(cfg), canvas, bytes: () => buildRasterJob(packCanvas(canvas, 128), cfg) };
}
