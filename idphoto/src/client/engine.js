// Photo processing pipeline. Everything runs locally in the browser:
// 1. face landmarks (MediaPipe FaceLandmarker) -> eyes, chin, roll, expression
// 2. upright "work" crop around the head
// 3. person segmentation (MediaPipe selfie multiclass) refined with a guided filter
// 4. crown detection from the hair/face mask
import { FilesetResolver, FaceLandmarker, ImageSegmenter } from '../vendor/vision_bundle.mjs';

const MAX_SOURCE = 3000; // px, long side of the decoded photo
const MASK_MAX = 1024; // px, long side of the segmentation/refinement pass
const WORK_MAX_HEAD = 900; // px, max chin-crown height kept in the work image

let modelsPromise = null;

export function loadModels(base) {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(base + 'vendor/wasm');
      const make = async (delegate) => {
        const landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: base + 'models/face_landmarker.task', delegate },
          runningMode: 'IMAGE',
          numFaces: 2,
          outputFaceBlendshapes: true,
        });
        const segmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: base + 'models/selfie_multiclass_256x256.tflite', delegate },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        return { landmarker, segmenter };
      };
      // CPU is the most predictable across phones; GPU only as a fallback.
      try {
        return await make('CPU');
      } catch (err) {
        console.warn('CPU delegate failed, trying GPU', err);
        return await make('GPU');
      }
    })();
    modelsPromise.catch(() => (modelsPromise = null));
  }
  return modelsPromise;
}

export async function decodeImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fallback (older Safari, HEIC handled by the OS picker, etc.)
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bitmap.width;
  const h = bitmap.height;
  const s = Math.min(1, MAX_SOURCE / Math.max(w, h));
  const canvas = makeCanvas(Math.round(w * s), Math.round(h * s));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return canvas;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const LM = { chin: 152, forehead: 10, faceLeft: 234, faceRight: 454, nose: 1, irisA: 468, irisB: 473 };

function pick(landmarks, i, w, h) {
  const p = landmarks[i];
  return { x: p.x * w, y: p.y * h };
}

function blendshapeMap(result) {
  const map = {};
  const cats = result.faceBlendshapes?.[0]?.categories || [];
  for (const c of cats) map[c.categoryName] = c.score;
  return map;
}

/**
 * Full analysis of a decoded photo. Returns null `face` when no face is found.
 */
export async function analyze(source, models) {
  const W = source.width;
  const H = source.height;
  const result = models.landmarker.detect(source);
  const faces = result.faceLandmarks || [];
  if (faces.length === 0) return { faces: 0 };
  const lm = faces[0];
  const p = (k) => pick(lm, LM[k], W, H);
  let eyeL = p('irisA');
  let eyeR = p('irisB');
  if (eyeL.x > eyeR.x) [eyeL, eyeR] = [eyeR, eyeL];
  const chin = p('chin');
  const forehead = p('forehead');
  const faceL = p('faceLeft');
  const faceR = p('faceRight');
  const nose = p('nose');
  const roll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);
  const M = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };
  const F = Math.hypot(chin.x - forehead.x, chin.y - forehead.y); // face length
  const faceW = Math.hypot(faceR.x - faceL.x, faceR.y - faceL.y);

  // Upright work region around the head, relative to the eye midpoint, in units of F.
  const region = { left: -1.5, right: 1.5, top: -1.5, bottom: 2.1 };
  // Keep enough pixels for a 600 dpi print, but don't go crazy on huge photos.
  const ws = Math.min(1, WORK_MAX_HEAD / (1.45 * F));
  const workW = Math.round((region.right - region.left) * F * ws);
  const workH = Math.round((region.bottom - region.top) * F * ws);
  const ox = -region.left * F * ws;
  const oy = -region.top * F * ws;
  const work = makeCanvas(workW, workH);
  const wctx = work.getContext('2d');
  wctx.imageSmoothingQuality = 'high';
  wctx.translate(ox, oy);
  wctx.scale(ws, ws);
  wctx.rotate(-roll);
  wctx.translate(-M.x, -M.y);
  wctx.drawImage(source, 0, 0);

  const cos = Math.cos(-roll);
  const sin = Math.sin(-roll);
  const toWork = (pt) => {
    const dx = pt.x - M.x;
    const dy = pt.y - M.y;
    return { x: (dx * cos - dy * sin) * ws + ox, y: (dx * sin + dy * cos) * ws + oy };
  };
  const fromWork = (pt) => {
    const dx = (pt.x - ox) / ws;
    const dy = (pt.y - oy) / ws;
    return { x: dx * cos + dy * sin + M.x, y: -dx * sin + dy * cos + M.y };
  };
  const w = {
    eyeL: toWork(eyeL),
    eyeR: toWork(eyeR),
    chin: toWork(chin),
    forehead: toWork(forehead),
    faceL: toWork(faceL),
    faceR: toWork(faceR),
    nose: toWork(nose),
  };

  const seg = segment(work, models.segmenter);
  const crownY = findCrown(seg, w, F * ws);
  const eyeY = (w.eyeL.y + w.eyeR.y) / 2;
  const centerX = (w.eyeL.x + w.eyeR.x) / 2;

  const blend = blendshapeMap(result);
  const quality = assessQuality(work, w, seg, F * ws);
  return {
    faces: faces.length,
    work,
    alpha: seg.alphaCanvas,
    cutout: buildCutout(work, seg.alphaCanvas),
    face: { crownY, chinY: w.chin.y, eyeY, centerX },
    points: w,
    rollDeg: (roll * 180) / Math.PI,
    // Rough yaw: nose offset from the face oval centre, relative to face width.
    yaw: (w.nose.x - (w.faceL.x + w.faceR.x) / 2) / (faceW * ws),
    blend,
    headPx: (w.chin.y - crownY) / ws, // in original photo pixels
    sourceSize: { w: W, h: H },
    crownClipped: fromWork({ x: centerX, y: crownY }).y < 4,
    quality,
  };
}

// --- segmentation ---------------------------------------------------------

function segment(work, segmenter) {
  const s = Math.min(1, MASK_MAX / Math.max(work.width, work.height));
  const mw = Math.round(work.width * s);
  const mh = Math.round(work.height * s);
  const small = makeCanvas(mw, mh);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(work, 0, 0, mw, mh);
  const img = sctx.getImageData(0, 0, mw, mh);

  const res = segmenter.segment(small);
  const masks = res.confidenceMasks;
  // selfie_multiclass: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 others
  const bg = masks[0].getAsFloat32Array();
  const hairConf = masks[1].getAsFloat32Array();
  const faceSkin = masks[3].getAsFloat32Array();
  const n = mw * mh;
  const fg = new Float32Array(n);
  const head = new Float32Array(n);
  const hair = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    // Pixels outside the original photo are transparent: force background there.
    const a = d[i * 4 + 3] / 255;
    fg[i] = (1 - bg[i]) * a;
    head[i] = (hairConf[i] + faceSkin[i]) * a;
    hair[i] = hairConf[i] * a;
  }
  if (res.close) res.close();
  else masks.forEach((m) => m.close());

  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = d[i * 4] / 255;
    G[i] = d[i * 4 + 1] / 255;
    B[i] = d[i * 4 + 2] / 255;
  }
  const r = Math.max(2, Math.round(Math.max(mw, mh) / 160));
  const refined = guidedFilterColor(R, G, B, fg, mw, mh, r, 2e-4);
  // Hair keeps a soft matte, everything else (shoulders, ears, chin) gets a crisp edge.
  const hairSoft = boxFilter(hair, mw, mh, r * 2);
  for (let i = 0; i < n; i++) {
    const h = Math.min(1, hairSoft[i] * 1.5);
    const lo = 0.36 - 0.14 * h;
    const hi = 0.64 + 0.14 * h;
    const v = (refined[i] - lo) / (hi - lo);
    refined[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  const alphaCanvas = makeCanvas(mw, mh);
  const actx = alphaCanvas.getContext('2d');
  const out = actx.createImageData(mw, mh);
  for (let i = 0; i < n; i++) {
    out.data[i * 4] = 255;
    out.data[i * 4 + 1] = 255;
    out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = Math.round(refined[i] * 255);
  }
  actx.putImageData(out, 0, 0);
  return { alphaCanvas, fg: refined, head, mw, mh, scale: s, img };
}

// Subject layer at work resolution: alpha from the matte, and edge colours
// replaced by an estimate of the nearby foreground colour so the old background
// (a red curtain, a yellow wall...) doesn't bleed into hair and shoulder edges.
function buildCutout(work, alphaCanvas) {
  const W = work.width;
  const H = work.height;
  const n = W * H;
  const ac = makeCanvas(W, H);
  const actx = ac.getContext('2d', { willReadFrequently: true });
  actx.imageSmoothingQuality = 'high';
  actx.drawImage(alphaCanvas, 0, 0, W, H);
  const aData = actx.getImageData(0, 0, W, H).data;
  const img = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H);
  const d = img.data;
  const alpha = new Float32Array(n);
  const wgt = new Float32Array(n);
  const wr = new Float32Array(n);
  const wg = new Float32Array(n);
  const wb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (aData[i * 4 + 3] / 255) * (d[i * 4 + 3] / 255);
    alpha[i] = a;
    const w = a > 0.97 ? 1 : a ** 8;
    wgt[i] = w;
    wr[i] = d[i * 4] * w;
    wg[i] = d[i * 4 + 1] * w;
    wb[i] = d[i * 4 + 2] * w;
  }
  const rad = Math.max(3, Math.round(Math.max(W, H) * 0.012));
  const blur = (x) => boxFilter(boxFilter(x, W, H, rad), W, H, rad);
  const bw = blur(wgt);
  const br = blur(wr);
  const bgc = blur(wg);
  const bb = blur(wb);
  const out = new ImageData(W, H);
  const o = out.data;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    let r = d[i * 4];
    let g = d[i * 4 + 1];
    let b = d[i * 4 + 2];
    if (a < 0.995 && bw[i] > 1e-4) {
      const k = a * a;
      r = (br[i] / bw[i]) * (1 - k) + r * k;
      g = (bgc[i] / bw[i]) * (1 - k) + g * k;
      b = (bb[i] / bw[i]) * (1 - k) + b * k;
    }
    o[i * 4] = r;
    o[i * 4 + 1] = g;
    o[i * 4 + 2] = b;
    o[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

// Box filter (running sums) used by the guided filter.
function boxFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      const add = src[row + Math.min(w - 1, x + r + 1)];
      const sub = src[row + Math.max(0, x - r)];
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      acc += add - sub;
    }
  }
  return out;
}

// He et al. guided filter: edge-aware upsampling of a coarse mask using the photo.
export function guidedFilter(I, p, w, h, r, eps) {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const mI = boxFilter(I, w, h, r);
  const mp = boxFilter(p, w, h, r);
  const mIp = boxFilter(Ip, w, h, r);
  const mII = boxFilter(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxFilter(a, w, h, r);
  const mb = boxFilter(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

// Colour guided filter (He et al.), 3x3 covariance per pixel: follows edges
// that are visible in colour but not in brightness (dark suit on a red curtain).
export function guidedFilterColor(R, G, B, p, w, h, r, eps) {
  const n = w * h;
  const bf = (x) => boxFilter(x, w, h, r);
  const prod = (a, b) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = a[i] * b[i];
    return o;
  };
  const mR = bf(R);
  const mG = bf(G);
  const mB = bf(B);
  const mp = bf(p);
  const mRp = bf(prod(R, p));
  const mGp = bf(prod(G, p));
  const mBp = bf(prod(B, p));
  const vRR = bf(prod(R, R));
  const vRG = bf(prod(R, G));
  const vRB = bf(prod(R, B));
  const vGG = bf(prod(G, G));
  const vGB = bf(prod(G, B));
  const vBB = bf(prod(B, B));
  const aR = new Float32Array(n);
  const aG = new Float32Array(n);
  const aB = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cR = mRp[i] - mR[i] * mp[i];
    const cG = mGp[i] - mG[i] * mp[i];
    const cB = mBp[i] - mB[i] * mp[i];
    const rr = vRR[i] - mR[i] * mR[i] + eps;
    const rg = vRG[i] - mR[i] * mG[i];
    const rb = vRB[i] - mR[i] * mB[i];
    const gg = vGG[i] - mG[i] * mG[i] + eps;
    const gb = vGB[i] - mG[i] * mB[i];
    const bb = vBB[i] - mB[i] * mB[i] + eps;
    // Inverse of the symmetric 3x3 matrix [[rr,rg,rb],[rg,gg,gb],[rb,gb,bb]].
    const i00 = gg * bb - gb * gb;
    const i01 = gb * rb - rg * bb;
    const i02 = rg * gb - gg * rb;
    const i11 = rr * bb - rb * rb;
    const i12 = rb * rg - rr * gb;
    const i22 = rr * gg - rg * rg;
    const det = rr * i00 + rg * i01 + rb * i02;
    const inv = 1 / det;
    aR[i] = (cR * i00 + cG * i01 + cB * i02) * inv;
    aG[i] = (cR * i01 + cG * i11 + cB * i12) * inv;
    aB[i] = (cR * i02 + cG * i12 + cB * i22) * inv;
    b[i] = mp[i] - aR[i] * mR[i] - aG[i] * mG[i] - aB[i] * mB[i];
  }
  const maR = bf(aR);
  const maG = bf(aG);
  const maB = bf(aB);
  const mb = bf(b);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = maR[i] * R[i] + maG[i] * G[i] + maB[i] * B[i] + mb[i];
  return q;
}

// Top of the head: first row (from the top) where the hair/face mask covers
// enough of a band centred on the face. Bounded by anatomy so a hat, a wall
// mis-segmented as hair or a bald head can't produce absurd results.
function findCrown(seg, w, Fw) {
  const { mw, mh, scale: s } = seg;
  const cx = ((w.eyeL.x + w.eyeR.x) / 2) * s;
  const half = Math.max(2, Math.abs(w.faceR.x - w.faceL.x) * 0.3 * s);
  const x0 = Math.max(0, Math.round(cx - half));
  const x1 = Math.min(mw - 1, Math.round(cx + half));
  const foreheadY = w.forehead.y;
  // Anatomical bounds (work px): skull top is ~0.15-0.6 face lengths above landmark 10.
  const minY = foreheadY - 0.6 * Fw;
  const maxY = foreheadY - 0.12 * Fw;
  let found = -1;
  const limit = Math.min(mh - 1, Math.round((foreheadY / 1) * s));
  for (let y = 0; y <= limit; y++) {
    let acc = 0;
    for (let x = x0; x <= x1; x++) {
      const i = y * mw + x;
      acc += Math.max(seg.head[i], seg.fg[i] * 0.8);
    }
    if (acc / (x1 - x0 + 1) > 0.5) {
      found = y / s;
      break;
    }
  }
  if (found < 0) found = foreheadY - 0.3 * Fw;
  return Math.min(maxY, Math.max(minY, found, 0));
}

// --- quality checks ---------------------------------------------------------

function assessQuality(work, w, seg, Fw) {
  const { mw, mh, scale: s, img } = seg;
  const d = img.data;
  // Face brightness: sample the cheeks/forehead area between the eyes and the chin.
  const left = Math.round(Math.min(w.faceL.x, w.faceR.x) * s);
  const right = Math.round(Math.max(w.faceL.x, w.faceR.x) * s);
  const top = Math.round(w.forehead.y * s);
  const bottom = Math.round(w.chin.y * s);
  const midX = Math.round(((w.eyeL.x + w.eyeR.x) / 2) * s);
  let sumL = 0;
  let nL = 0;
  let sumR = 0;
  let nR = 0;
  for (let y = Math.max(0, top); y < Math.min(mh, bottom); y += 2) {
    for (let x = Math.max(0, left); x < Math.min(mw, right); x += 2) {
      const i = y * mw + x;
      if (seg.head[i] < 0.5) continue;
      const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      if (x < midX) {
        sumL += lum;
        nL++;
      } else {
        sumR += lum;
        nR++;
      }
    }
  }
  const mL = nL ? sumL / nL : 0;
  const mR = nR ? sumR / nR : 0;
  const brightness = (mL + mR) / 2;
  const unevenness = Math.abs(mL - mR) / Math.max(1, brightness);
  // Sharpness: variance of the Laplacian over the face box.
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  const g = (x, y) => {
    const i = (y * mw + x) * 4;
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  };
  for (let y = Math.max(1, top); y < Math.min(mh - 1, bottom); y++) {
    for (let x = Math.max(1, left); x < Math.min(mw - 1, right); x++) {
      const lap = 4 * g(x, y) - g(x - 1, y) - g(x + 1, y) - g(x, y - 1) - g(x, y + 1);
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  const sharpness = n ? sum2 / n - (sum / n) ** 2 : 0;
  return { brightness, unevenness, sharpness, facePxInMask: Fw * s };
}
