// Built-in black & white clipart for the Mini Photo template (ported from Thermal Print Studio).
// Each drawing is high-contrast line art that prints cleanly at 203 dpi.

const base = (ctx, w, h, width = 4) => {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = width; ctx.textAlign = 'center';
};
const caption = (ctx, w, y, t, size = 16) => { ctx.font = `bold ${size}px "Courier New", monospace`; ctx.fillText(t, w / 2, y); };
const circle = (ctx, x, y, r, fill) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); fill ? ctx.fill() : ctx.stroke(); };

export const CLIPART = {
  camera: {
    name: 'Retro cam',
    draw(ctx, w, h) {
      base(ctx, w, h, 5);
      const cx = w / 2, cy = h / 2 - 8;
      ctx.strokeRect(cx - 75, cy - 42, 150, 96);
      ctx.fillRect(cx - 52, cy - 56, 36, 14);
      circle(ctx, cx, cy + 6, 32); circle(ctx, cx, cy + 6, 14, true);
      ctx.strokeRect(cx + 36, cy - 30, 24, 14);
      caption(ctx, w, h - 16, 'SNAPSHOT MEMORY');
    },
  },
  airplane: {
    name: 'Vacation',
    draw(ctx, w, h) {
      base(ctx, w, h);
      const cx = w / 2;
      circle(ctx, cx, 92, 62);
      caption(ctx, w, 66, 'BON VOYAGE!', 22);
      ctx.beginPath(); ctx.moveTo(cx - 42, 105); ctx.lineTo(cx + 42, 82); ctx.lineTo(cx + 12, 118); ctx.closePath(); ctx.fill();
      caption(ctx, w, 184, 'ADVENTURE AWAITS', 15);
    },
  },
  coffee: {
    name: 'Coffee break',
    draw(ctx, w, h) {
      base(ctx, w, h);
      const cx = w / 2;
      for (const o of [-22, 0, 22]) {
        ctx.beginPath(); ctx.moveTo(cx + o, 60); ctx.bezierCurveTo(cx + o - 12, 42, cx + o + 12, 32, cx + o, 16); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(cx + 50, 112, 22, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 50, 72, 100, 80); ctx.strokeRect(cx - 50, 72, 100, 80);
      ctx.fillStyle = '#000'; ctx.fillRect(cx - 50, 88, 100, 12);
      ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(cx - 75, 154); ctx.lineTo(cx + 75, 154); ctx.stroke();
      caption(ctx, w, 186, 'BUT FIRST, COFFEE');
    },
  },
  cat: {
    name: 'Desk cat',
    draw(ctx, w, h) {
      base(ctx, w, h);
      const cx = w / 2;
      circle(ctx, cx, 95, 52);
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(cx + s * 45, 62); ctx.lineTo(cx + s * 52, 18); ctx.lineTo(cx + s * 16, 44); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + s * 20, 85, 8, Math.PI, 0); ctx.stroke();
      }
      circle(ctx, cx, 98, 5, true);
      caption(ctx, w, 182, 'PURR-FECT DAY');
    },
  },
  robot: {
    name: 'Tech bot',
    draw(ctx, w, h) {
      base(ctx, w, h);
      const cx = w / 2;
      ctx.beginPath(); ctx.moveTo(cx, 14); ctx.lineTo(cx, 38); ctx.stroke();
      circle(ctx, cx, 12, 6, true);
      ctx.strokeRect(cx - 52, 38, 104, 76);
      circle(ctx, cx - 22, 68, 10); circle(ctx, cx + 22, 68, 10);
      ctx.strokeRect(cx - 32, 92, 64, 12); ctx.strokeRect(cx - 64, 122, 128, 42);
      caption(ctx, w, 186, 'GEEK MODE ACTIVE', 15);
    },
  },
  home: {
    name: 'Sweet home',
    draw(ctx, w, h) {
      base(ctx, w, h, 5);
      const cx = w / 2;
      ctx.beginPath(); ctx.moveTo(cx, 24); ctx.lineTo(cx - 68, 82); ctx.lineTo(cx + 68, 82); ctx.closePath(); ctx.stroke();
      ctx.strokeRect(cx - 50, 82, 100, 72); ctx.fillRect(cx - 14, 114, 28, 40);
      ctx.strokeRect(cx - 38, 96, 18, 18); ctx.strokeRect(cx + 20, 96, 18, 18);
      caption(ctx, w, 184, 'HOME SWEET HOME');
    },
  },
};

export function clipartDataUrl(key, w = 288, h = 200) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  (CLIPART[key] || CLIPART.camera).draw(c.getContext('2d'), w, h);
  return c.toDataURL('image/png');
}
