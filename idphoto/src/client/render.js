// Turns an analysis + spec + user adjustments into output canvases/files.
import { computePlacement, layoutSheet, mmToPx, digitalSize } from './geometry.js';
import { makeCanvas } from './engine.js';

/**
 * Builds the subject layer: the upright work image with brightness applied and,
 * unless the original background is kept, the refined alpha matte.
 */
export function buildLayer(analysis, { keepBackground = false, brightness = 0 } = {}) {
  const { work, cutout } = analysis;
  const layer = makeCanvas(work.width, work.height);
  const ctx = layer.getContext('2d', { willReadFrequently: true });
  if (keepBackground) ctx.drawImage(work, 0, 0);
  else ctx.putImageData(cutout, 0, 0);
  if (brightness) {
    const img = ctx.getImageData(0, 0, layer.width, layer.height);
    const d = img.data;
    // Gamma-like lift/lower that keeps whites from clipping.
    const g = Math.pow(2, -brightness);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, g));
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
    ctx.putImageData(img, 0, 0);
  }
  return layer;
}

/** Renders one photo of `out` pixel size. Returns {canvas, placement}. */
export function renderPhoto(analysis, layer, spec, out, adjust, bgColor) {
  const placement = computePlacement(analysis.face, spec, out, adjust);
  const canvas = makeCanvas(out.w, out.h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, out.w, out.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(placement.scale, 0, 0, placement.scale, placement.tx, placement.ty);
  drawScaled(ctx, layer, placement.scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, placement };
}

// Large downscales look aliased with a single drawImage on some browsers:
// halve progressively until the remaining factor is <= 2.
function drawScaled(ctx, layer, scale) {
  let src = layer;
  let s = scale;
  while (s < 0.5 && src.width > 64) {
    const half = makeCanvas(src.width / 2, src.height / 2);
    const hctx = half.getContext('2d');
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(src, 0, 0, half.width, half.height);
    s *= 2;
    ctx.scale(src.width / half.width, src.height / half.height);
    src = half;
  }
  ctx.drawImage(src, 0, 0);
}

export function addWatermark(canvas, text) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const size = Math.max(12, Math.round(Math.min(w, h) / 9));
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, size / 18);
  const step = size * 2.2;
  for (let y = -h; y <= h; y += step) {
    for (let x = -w; x <= w; x += size * text.length * 0.75) {
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
  return canvas;
}

export const SHEETS = {
  '10x15': { w: 101.6, h: 152.4 }, // 4x6 in: what every photo lab / kiosk prints
  a4: { w: 210, h: 297 },
};

/** Print sheet with as many copies as fit, plus thin cut guides. */
export function renderSheet(analysis, layer, spec, adjust, bgColor, sheetKey = '10x15', dpi = 300) {
  const sheet = SHEETS[sheetKey];
  const layout = layoutSheet(sheet, { w: spec.widthMm, h: spec.heightMm }, sheetKey === 'a4' ? { margin: 8 } : {});
  const W = mmToPx(layout.sheetW, dpi);
  const H = mmToPx(layout.sheetH, dpi);
  const pw = mmToPx(spec.widthMm, dpi);
  const ph = mmToPx(spec.heightMm, dpi);
  const { canvas: photo } = renderPhoto(analysis, layer, spec, { w: pw, h: ph }, adjust, bgColor);
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const px = (mm) => (mm / 25.4) * dpi;
  for (const pos of layout.positions) ctx.drawImage(photo, Math.round(px(pos.x)), Math.round(px(pos.y)));
  // Cut guides: short grey ticks around each photo, outside the photo area.
  ctx.strokeStyle = '#9a9a9a';
  ctx.lineWidth = Math.max(1, dpi / 300);
  const tick = px(1.5);
  for (const pos of layout.positions) {
    const x0 = Math.round(px(pos.x));
    const y0 = Math.round(px(pos.y));
    const x1 = x0 + pw;
    const y1 = y0 + ph;
    ctx.beginPath();
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      ctx.moveTo(x, y - (y === y0 ? tick : -tick));
      ctx.lineTo(x, y);
      ctx.moveTo(x - (x === x0 ? tick : -tick), y);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return { canvas, layout };
}

export function renderDigital(analysis, layer, spec, adjust, bgColor) {
  return renderPhoto(analysis, layer, spec, digitalSize(spec), adjust, bgColor);
}

/** JPEG blob under `maxKB`, highest quality that fits; DPI written in the JFIF header. */
export async function toJpeg(canvas, { maxKB = 2000, dpi = 300 } = {}) {
  let lo = 0.5;
  let hi = 0.95;
  let best = await blobOf(canvas, hi);
  if (best.size > maxKB * 1024) {
    best = null;
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2;
      const b = await blobOf(canvas, q);
      if (b.size <= maxKB * 1024) {
        best = b;
        lo = q;
      } else hi = q;
    }
    if (!best) best = await blobOf(canvas, 0.4);
  }
  return setJpegDpi(best, dpi);
}

function blobOf(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Patches the JFIF APP0 density fields so print dialogs use the right size.
export async function setJpegDpi(blob, dpi) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // SOI FFD8, APP0 FFE0, length(2), 'JFIF\0', version(2), units(1), Xdensity(2), Ydensity(2)
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[3] === 0xe0 && buf[6] === 0x4a && buf[7] === 0x46) {
    buf[13] = 1;
    buf[14] = (dpi >> 8) & 0xff;
    buf[15] = dpi & 0xff;
    buf[16] = (dpi >> 8) & 0xff;
    buf[17] = dpi & 0xff;
  }
  return new Blob([buf], { type: 'image/jpeg' });
}
