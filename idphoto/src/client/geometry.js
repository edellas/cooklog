// Pure geometry helpers shared by the browser app and the Node unit tests.
// All physical sizes are in millimetres, all image coordinates in pixels.

export const MM_PER_INCH = 25.4;

export const mmToPx = (mm, dpi) => Math.round((mm / MM_PER_INCH) * dpi);

const mid = ([a, b]) => (a + b) / 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Head height we aim for: slightly below the middle of the allowed range so that
// big hair or a small crown-detection error never pushes it over the maximum.
export function targetHeadMm(spec) {
  const [lo, hi] = spec.head;
  return lo + (hi - lo) * 0.45;
}

// Where the crown (top of the head) should sit, in mm from the top edge, for a
// head of `headMm`. `eyeRatio` is (eyes - crown) / (chin - crown) of the subject.
export function targetCrownTopMm(spec, headMm, eyeRatio) {
  if (spec.eyes) {
    const eyeFromTop = spec.heightMm - mid(spec.eyes);
    const crownTop = eyeFromTop - eyeRatio * headMm;
    return clamp(crownTop, 1, spec.heightMm - headMm - 1);
  }
  if (spec.top) return mid(spec.top);
  // No explicit rule: leave a bit more room below the chin (shoulders) than above.
  return Math.max(1, (spec.heightMm - headMm) * 0.42);
}

/**
 * Computes how the subject must be scaled/translated into an output image.
 * @param face   {crownY, chinY, eyeY, centerX} in source pixels (upright image)
 * @param spec   document spec ({widthMm, heightMm, head, eyes?, top?})
 * @param out    {w, h} output size in pixels
 * @param adjust {zoom, dxMm, dyMm} user fine-tuning
 * @returns {scale, tx, ty, pxPerMm, measures}
 *   outX = srcX * scale + tx ; outY = srcY * scale + ty
 */
export function computePlacement(face, spec, out, adjust = {}) {
  const zoom = adjust.zoom ?? 1;
  const dxMm = adjust.dxMm ?? 0;
  const dyMm = adjust.dyMm ?? 0;
  // The output may have a different aspect ratio than the paper size (e.g. China
  // digital 354x472 vs 33x48 mm print). Height is the reference dimension.
  const pxPerMm = out.h / spec.heightMm;
  const headSrc = Math.max(1, face.chinY - face.crownY);
  const eyeRatio = clamp((face.eyeY - face.crownY) / headSrc, 0.2, 0.8);
  const baseHeadMm = targetHeadMm(spec);
  const headMm = baseHeadMm * zoom;
  const scale = (headMm * pxPerMm) / headSrc;
  // Zoom keeps the eyes roughly in place instead of the crown.
  const crownTopMm = targetCrownTopMm(spec, baseHeadMm, eyeRatio) - eyeRatio * (headMm - baseHeadMm) + dyMm;
  const crownOutY = crownTopMm * pxPerMm;
  const centerOutX = out.w / 2 + dxMm * pxPerMm;
  const tx = centerOutX - face.centerX * scale;
  const ty = crownOutY - face.crownY * scale;
  return { scale, tx, ty, pxPerMm, measures: measure(face, spec, out, { scale, tx, ty, pxPerMm }) };
}

// Physical measurements of a placement, used for the compliance checklist.
export function measure(face, spec, out, { scale, ty, pxPerMm }) {
  const crownY = face.crownY * scale + ty;
  const chinY = face.chinY * scale + ty;
  const eyeY = face.eyeY * scale + ty;
  const heightMm = out.h / pxPerMm;
  return {
    headMm: (chinY - crownY) / pxPerMm,
    topMarginMm: crownY / pxPerMm,
    eyeFromBottomMm: heightMm - eyeY / pxPerMm,
    chinFromBottomMm: heightMm - chinY / pxPerMm,
  };
}

// Checks measurements against the spec; returns a list of {key, ok, value, range}.
export function checkMeasures(m, spec, tolerance = 0.15) {
  const checks = [];
  const within = (v, [lo, hi]) => v >= lo - tolerance && v <= hi + tolerance;
  checks.push({ key: 'head', ok: within(m.headMm, spec.head), value: m.headMm, range: spec.head });
  if (spec.eyes) checks.push({ key: 'eyes', ok: within(m.eyeFromBottomMm, spec.eyes), value: m.eyeFromBottomMm, range: spec.eyes });
  if (spec.top) checks.push({ key: 'top', ok: within(m.topMarginMm, spec.top), value: m.topMarginMm, range: spec.top });
  else checks.push({ key: 'top', ok: m.topMarginMm >= 0.8, value: m.topMarginMm, range: null });
  return checks;
}

/**
 * Packs as many photos as possible on a sheet. Tries both orientations and a few
 * gap sizes, keeping the layout with most photos (ties: the larger gap).
 * @returns {sheetW, sheetH, cols, rows, gap, count, positions:[{x,y}]} in mm
 */
export function layoutSheet(sheet, photo, { margin = 2, gaps = [3, 2, 1, 0] } = {}) {
  let best = null;
  for (const [sw, sh] of [[sheet.w, sheet.h], [sheet.h, sheet.w]]) {
    for (const gap of gaps) {
      // With zero gap we also allow zero margin: photo labs print edge to edge.
      const m = gap === 0 ? 0 : margin;
      const cols = Math.floor((sw - 2 * m + gap) / (photo.w + gap) + 1e-9);
      const rows = Math.floor((sh - 2 * m + gap) / (photo.h + gap) + 1e-9);
      const count = cols * rows;
      if (count < 1) continue;
      if (!best || count > best.count || (count === best.count && gap > best.gap)) {
        best = { sheetW: sw, sheetH: sh, cols, rows, gap, count };
      }
    }
  }
  if (!best) return null;
  const gridW = best.cols * photo.w + (best.cols - 1) * best.gap;
  const gridH = best.rows * photo.h + (best.rows - 1) * best.gap;
  const x0 = (best.sheetW - gridW) / 2;
  const y0 = (best.sheetH - gridH) / 2;
  best.positions = [];
  for (let r = 0; r < best.rows; r++) {
    for (let c = 0; c < best.cols; c++) {
      best.positions.push({ x: x0 + c * (photo.w + best.gap), y: y0 + r * (photo.h + best.gap) });
    }
  }
  return best;
}

// Output pixel size for the digital file of a spec.
export function digitalSize(spec) {
  if (spec.digital) return { w: spec.digital.w, h: spec.digital.h };
  return { w: mmToPx(spec.widthMm, 600), h: mmToPx(spec.heightMm, 600) };
}
