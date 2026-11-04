// Doodle pad for the "Doodle & Memo" template. Pointer events cover mouse, touch and pen.

export const SKETCH_W = 384, SKETCH_H = 224;

export function blankSketch() {
  const c = document.createElement('canvas');
  c.width = SKETCH_W; c.height = SKETCH_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
  ctx.fillStyle = '#000'; ctx.font = 'bold 16px "Courier New", monospace'; ctx.textAlign = 'center';
  ctx.fillText('SIGN OR SKETCH HERE', c.width / 2, 80);
  ctx.beginPath(); ctx.moveTo(40, 150); ctx.lineTo(c.width - 40, 150); ctx.stroke();
  return c.toDataURL('image/png');
}

/** Attaches drawing to `canvas`; `tool` is {size, eraser}; onChange(dataUrl) fires when a stroke ends. */
export function initSketch(canvas, dataUrl, tool, onChange) {
  const ctx = canvas.getContext('2d');
  const paint = (url) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(im, 0, 0, canvas.width, canvas.height); res(); };
    im.src = url;
  });
  paint(dataUrl || blankSketch());

  let drawing = false, lx = 0, ly = 0;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.onpointerdown = (e) => { drawing = true; [lx, ly] = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); };
  canvas.onpointermove = (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.strokeStyle = tool.eraser ? '#fff' : '#000';
    ctx.lineWidth = tool.eraser ? tool.size * 3 : tool.size;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke();
    [lx, ly] = [x, y];
  };
  const end = () => { if (drawing) { drawing = false; onChange(canvas.toDataURL('image/png')); } };
  canvas.onpointerup = canvas.onpointercancel = end;

  return {
    clear() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); onChange(canvas.toDataURL('image/png')); },
    stamp(label) {
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeRect(canvas.width / 2 - 80, canvas.height / 2 - 22, 160, 40);
      ctx.font = 'bold 20px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, canvas.width / 2, canvas.height / 2 - 1);
      onChange(canvas.toDataURL('image/png'));
    },
  };
}
