// Genera l'immagine di condivisione (og.png, 1200x630: WhatsApp, Facebook, LinkedIn) con una schermata vera
// della pagina che vede il cliente. Richiede Playwright. Uso: node scripts/genera-screenshot.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { creaLinkAccettazione } from "../public/js/link.js";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const pubblica = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const img = path.join(pubblica, "img");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(pubblica, decodeURIComponent(url.pathname));
  if (!file.startsWith(pubblica) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const oggi = new Date();
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prev = {
  id: "esempio-og",
  numero: `${oggi.getFullYear()}-004`,
  data: iso(oggi),
  validitaGiorni: 30,
  regime: "ordinario",
  cliente: { nome: "Giulia Bianchi", indirizzo: "Via Roma 1", citta: "Bergamo" },
  oggetto: "Sostituzione scaldabagno",
  righe: [
    { descrizione: "Scaldabagno elettrico 80 L", qta: 1, um: "cad", prezzo: 220, sconto: 0, iva: 10, tipo: "mat" },
    { descrizione: "Installazione scaldabagno", qta: 1, um: "cad", prezzo: 140, sconto: 0, iva: 10, tipo: "man" },
    { descrizione: "Materiale di consumo", qta: 1, um: "a corpo", prezzo: 25, sconto: 0, iva: 10, tipo: "mat" },
    {
      descrizione: "Sostituzione sifone lavabo",
      qta: 1,
      um: "cad",
      prezzo: 45,
      sconto: 0,
      iva: 10,
      tipo: "man",
      opzionale: true,
    },
  ],
  scontoGlobale: 0,
  acconto: { tipo: "perc", valore: 30 },
  pagamento: "Bonifico bancario.",
  note: "",
};
const azienda = {
  ragioneSociale: "Idraulica Rossi",
  piva: "01234567890",
  telefono: "333 1234567",
  citta: "Bergamo",
  provincia: "BG",
  iban: "IT60X0542811101000000123456",
  colore: "#1a1d21",
};
const { url } = await creaLinkAccettazione(BASE, prev, azienda, { pro: true });

const browser = await playwright.chromium.launch();
const telefono = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
await telefono.goto(url);
await telefono.waitForSelector('[data-azione="accetta"]');
await telefono.evaluate(() => document.fonts.ready);
await telefono.screenshot({ path: path.join(img, "screen-cliente.png") });

const b64 = (f, tipo = "image/png") => `data:${tipo};base64,` + readFileSync(f).toString("base64");
const font = b64(path.join(pubblica, "fonts", "archivo-latin.woff2"), "font/woff2");
const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.setContent(`<html><head><style>
  @font-face { font-family: Archivo; src: url(${font}) format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #ffc21a; color: #1a1d21;
    font-family: Archivo, system-ui, sans-serif; display: flex; align-items: center; }
  .testo { padding-left: 72px; width: 650px; }
  .marchio { display: flex; align-items: center; gap: 14px; font-weight: 800; font-size: 32px; font-stretch: 112%; }
  h1 { font-size: 66px; line-height: 1.02; font-weight: 800; font-stretch: 112%; letter-spacing: -1px; margin: 30px 0 22px; }
  p { font-size: 28px; line-height: 1.3; margin: 0; max-width: 560px; }
  .tel { margin-left: 26px; margin-top: 170px; width: 330px; border-radius: 40px; border: 10px solid #1a1d21;
    background: #1a1d21; transform: rotate(-3deg); box-shadow: 0 24px 50px rgba(26, 29, 33, 0.3); overflow: hidden; }
  .tel img { display: block; width: 100%; border-radius: 30px; }
</style></head><body>
  <div class="testo">
    <div class="marchio"><img src="${b64(path.join(img, "icona-192.png"))}" width="56" height="56">PreventivoLampo</div>
    <h1>Il preventivo che il cliente firma subito.</h1>
    <p>Dal telefono in 60 secondi, su WhatsApp. Il cliente firma col dito e paga l'acconto.</p>
  </div>
  <div class="tel"><img src="${b64(path.join(img, "screen-cliente.png"))}"></div>
</body></html>`);
await og.evaluate(() => document.fonts.ready);
await og.screenshot({ path: path.join(img, "og.png") });

await browser.close();
server.close();
console.log("Immagini aggiornate in", img);
