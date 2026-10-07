// Riquadro firma condiviso (app e pagina di accettazione).
// La firma è salvata come tratti vettoriali: pochi byte, quindi può viaggiare dentro un link.
// Coordinate normalizzate: x 0..1000, y 0..400 (proporzioni 2,5:1).

export const LARGHEZZA = 1000;
export const ALTEZZA = 400;
const MAX_TRATTI = 80;
const MAX_PUNTI = 4000;

function distanzaDaSegmento(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ramer-Douglas-Peucker: elimina i punti che non cambiano la forma del tratto.
export function semplifica(punti, eps = 1.5) {
  if (punti.length < 3) return punti.slice();
  const tieni = new Uint8Array(punti.length);
  tieni[0] = tieni[punti.length - 1] = 1;
  const pila = [[0, punti.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop();
    let max = 0;
    let indice = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distanzaDaSegmento(punti[k], punti[i], punti[j]);
      if (d > max) {
        max = d;
        indice = k;
      }
    }
    if (max > eps && indice > 0) {
      tieni[indice] = 1;
      pila.push([i, indice], [indice, j]);
    }
  }
  return punti.filter((_, k) => tieni[k]);
}

// Tratti [[{x,y}...]] -> array compatti con coordinate intere a differenze: [[x0,y0,dx1,dy1,...], ...]
export function codificaTratti(tratti) {
  let totale = 0;
  const out = [];
  for (const tratto of tratti.slice(0, MAX_TRATTI)) {
    const pts = semplifica(tratto).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    if (!pts.length) continue;
    totale += pts.length;
    if (totale > MAX_PUNTI) break;
    const arr = [pts[0].x, pts[0].y];
    for (let k = 1; k < pts.length; k++) arr.push(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    out.push(arr);
  }
  return out;
}

// Inverso di codificaTratti, con limiti rigidi perché i dati possono arrivare da un link.
export function decodificaTratti(codificati) {
  const tratti = [];
  let totale = 0;
  for (const arr of (Array.isArray(codificati) ? codificati : []).slice(0, MAX_TRATTI)) {
    if (!Array.isArray(arr) || arr.length < 2) continue;
    let x = 0;
    let y = 0;
    const pts = [];
    for (let k = 0; k + 1 < arr.length; k += 2) {
      const a = Number(arr[k]);
      const b = Number(arr[k + 1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) break;
      x = k === 0 ? a : x + a;
      y = k === 0 ? b : y + b;
      pts.push({ x: Math.min(Math.max(x, 0), LARGHEZZA), y: Math.min(Math.max(y, 0), ALTEZZA) });
      if (++totale > MAX_PUNTI) break;
    }
    if (pts.length) tratti.push(pts);
    if (totale > MAX_PUNTI) break;
  }
  return tratti;
}

export function disegnaTratti(ctx, tratti, w, h, colore = "#0b1f4d") {
  const sx = w / LARGHEZZA;
  const sy = h / ALTEZZA;
  ctx.strokeStyle = colore;
  ctx.fillStyle = colore;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.6, w / 300);
  for (const t of tratti) {
    if (t.length === 1) {
      ctx.beginPath();
      ctx.arc(t[0].x * sx, t[0].y * sy, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(t[0].x * sx, t[0].y * sy);
    for (let k = 1; k < t.length - 1; k++) {
      const mx = ((t[k].x + t[k + 1].x) / 2) * sx;
      const my = ((t[k].y + t[k + 1].y) / 2) * sy;
      ctx.quadraticCurveTo(t[k].x * sx, t[k].y * sy, mx, my);
    }
    const ultimo = t[t.length - 1];
    ctx.lineTo(ultimo.x * sx, ultimo.y * sy);
    ctx.stroke();
  }
}

export function trattiInPng(tratti, w = 750, h = 300) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  disegnaTratti(c.getContext("2d"), tratti, w, h);
  return c.toDataURL("image/png");
}

export function lunghezzaTratti(tratti) {
  let l = 0;
  for (const t of tratti) for (let k = 1; k < t.length; k++) l += Math.hypot(t[k].x - t[k - 1].x, t[k].y - t[k - 1].y);
  return l;
}

// Riquadro sul quadro logico 1000x400 con la stessa scala sui due assi: un riquadro più alto
// (per esempio 2:1, più comodo col dito) occupa la fascia centrale del quadro e la firma non si
// deforma quando la si ridisegna a 2,5:1 (PDF, app). A 2,5:1 la corrispondenza è quella di sempre.
function vistaDi(r) {
  const s = Math.max(r.width / LARGHEZZA, r.height / ALTEZZA) || 1;
  return { s, ox: (LARGHEZZA - r.width / s) / 2, oy: (ALTEZZA - r.height / s) / 2 };
}

const copiaTratti = (v) =>
  (Array.isArray(v) ? v : [])
    .filter((t) => Array.isArray(t) && t.length)
    .map((t) => t.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })));

// Collega un <canvas> al disegno con dito/penna/mouse.
// Opzioni: alCambio() a fine tratto e dopo cancella/imposta; tratti: firma da ripristinare;
// colore: inchiostro (stringa o funzione che lo restituisce), altrimenti quello predefinito.
export function creaPadFirma(canvas, { alCambio, tratti: iniziali, colore } = {}) {
  const ctx = canvas.getContext("2d");
  let tratti = copiaTratti(iniziali);
  let corrente = null;
  let vista = { s: 1, ox: 0, oy: 0 };

  function ridimensiona() {
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    vista = vistaDi(r);
    ridisegna();
  }

  function ridisegna() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const k = canvas.width / Math.max(1, LARGHEZZA - 2 * vista.ox); // pixel del canvas per unità logica
    ctx.translate(-vista.ox * k, -vista.oy * k);
    const inchiostro = typeof colore === "function" ? colore() : colore;
    disegnaTratti(ctx, tratti, LARGHEZZA * k, ALTEZZA * k, inchiostro || undefined);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function punto(e) {
    const r = canvas.getBoundingClientRect();
    const v = vistaDi(r);
    return {
      x: Math.min(Math.max(v.ox + (e.clientX - r.left) / v.s, 0), LARGHEZZA),
      y: Math.min(Math.max(v.oy + (e.clientY - r.top) / v.s, 0), ALTEZZA),
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    corrente = [punto(e)];
    tratti.push(corrente);
    ridisegna();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!corrente) return;
    const eventi = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of eventi.length ? eventi : [e]) corrente.push(punto(ev));
    ridisegna();
  });
  const fine = () => {
    if (corrente) alCambio?.();
    corrente = null;
  };
  canvas.addEventListener("pointerup", fine);
  canvas.addEventListener("pointercancel", fine);
  canvas.addEventListener("pointerleave", fine);

  ridimensiona();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(ridimensiona) : null;
  ro?.observe(canvas);

  return {
    cancella() {
      tratti = [];
      ridisegna();
      alCambio?.();
    },
    // Sostituisce la firma (per esempio con quella fatta nel riquadro grande).
    imposta(nuovi) {
      tratti = copiaTratti(nuovi);
      corrente = null;
      ridisegna();
      alCambio?.();
    },
    // Una firma vera ha una certa lunghezza: evita "firme" fatte con un tocco.
    valida: () => lunghezzaTratti(tratti) > 400,
    tratti: () => tratti,
    codificata: () => codificaTratti(tratti),
    png: (w = 750, h = 300) => trattiInPng(decodificaTratti(codificaTratti(tratti)), w, h),
    distruggi: () => ro?.disconnect(),
  };
}
