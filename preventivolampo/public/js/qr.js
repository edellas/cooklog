// Codici QR (libreria qrcode-generator, MIT, in vendor/). Il testo viene codificato in UTF-8.
import qrcode from "../vendor/qrcode.js";

export function matriceQr(testo, livello = "M") {
  const qr = qrcode(0, livello);
  // La libreria legge un byte per carattere: si passa il testo già convertito in byte UTF-8.
  const byte = new TextEncoder().encode(String(testo));
  let binario = "";
  for (const b of byte) binario += String.fromCharCode(b);
  qr.addData(binario, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

// Rettangoli orizzontali (righe di moduli neri consecutivi): meno elementi da disegnare.
export function rettangoliQr(matrice) {
  const out = [];
  matrice.forEach((riga, r) => {
    let c = 0;
    while (c < riga.length) {
      if (!riga[c]) {
        c++;
        continue;
      }
      const inizio = c;
      while (c < riga.length && riga[c]) c++;
      out.push({ x: inizio, y: r, w: c - inizio });
    }
  });
  return out;
}

export function svgQr(testo, { margine = 4, etichetta = "Codice QR" } = {}) {
  const m = matriceQr(testo);
  const lato = m.length + margine * 2;
  const d = rettangoliQr(m)
    .map((q) => `M${q.x + margine} ${q.y + margine}h${q.w}v1h-${q.w}z`)
    .join("");
  const nome = String(etichetta).replace(/[<>&"']/g, "");
  return `<svg viewBox="0 0 ${lato} ${lato}" role="img" aria-label="${nome}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${lato}" height="${lato}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
