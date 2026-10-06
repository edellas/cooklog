// Genera le immagini della landing: screenshot dell'app, esempio di PDF e immagine di condivisione (og.png).
// Richiede Playwright e pdftoppm (poppler-utils). Uso: node scripts/genera-screenshot.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, mkdtempSync, renameSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const pubblica = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const img = path.join(pubblica, "img");
const tmp = mkdtempSync(path.join(tmpdir(), "pl-shot-"));
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(pubblica, decodeURIComponent(url.pathname));
  if (!file.startsWith(pubblica) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

const browser = await playwright.chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  acceptDownloads: true,
  locale: "it-IT",
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const fermo = () => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));

await page.goto(`${BASE}/app.html`);
await page.click('[data-m="idraulico"]');
await page.click('[data-action="onb-avanti"]');
await page.fill("#b-nome", "Idraulica Rossi di Mario Rossi");
await page.fill("#b-tel", "333 1234567");
await page.fill("#b-piva", "01234567890");
await page.fill("#b-citta", "Bergamo");
await page.check('input[name="b-iva"][value="10"]');
await page.click('[data-action="fine-benvenuto"]');
await page.waitForSelector("#righe");

// Licenza dimostrativa solo per gli screenshot (mostra la versione Pro con firma).
await page.evaluate(
  () =>
    new Promise((ok) => {
      const r = indexedDB.open("preventivolampo");
      r.onsuccess = () => {
        const t = r.result.transaction("kv", "readwrite");
        t.objectStore("kv").put({
          chiave: "licenza",
          valore: { chiave: "DEMO", valida: true, verificataIl: Date.now(), email: "" },
        });
        t.oncomplete = ok;
      };
    }),
);
await page.reload();
await page.waitForSelector("#righe");

await page.fill('[data-campo="cliente.nome"]', "Giulia Bianchi");
await page.fill('[data-campo="cliente.telefono"]', "347 7654321");
await page.fill('[data-campo="oggetto"]', "Sostituzione miscelatore e disostruzione scarico bagno");
for (const cerca of ["Sostituzione miscelatore", "Miscelatore lavabo", "Disostruzione", "Materiale di consumo"]) {
  await page.click('[data-action="dal-listino"]');
  await page.fill("#cerca-listino", cerca);
  await page.click(".voce-listino >> nth=0");
}
await page.locator('[data-r="costo"]').first().fill("52");
await page.click('[data-action="aggiungi-riga"]');
await page.locator('[data-r="descrizione"]').last().fill("Sostituzione sifone lavabo");
await page.locator('[data-r="prezzo"]').last().fill("45");
await page.locator('[data-action="opzionale"]').last().click();
await page.fill('[data-campo="acconto.valore"]', "30");
await page.waitForTimeout(600);
await page.evaluate(() => {
  const h = [...document.querySelectorAll(".card h2")].find((x) => x.textContent.startsWith("Voci"));
  window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 76);
  document.getElementById("toast").className = "";
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(img, "screen-editor.png") });

// Link di accettazione e pagina del cliente
await page.click('[data-action="invia"]');
await page.waitForSelector('[data-action="invio-link"]');
const link = new URL(await page.getAttribute('[data-action="invio-link"]', "href")).searchParams
  .get("text")
  .match(/https?:\/\/\S+/)[0];
await page.keyboard.press("Escape");
const cliente = await context.newPage();
await cliente.goto(link);
await cliente.waitForSelector('[data-azione="accetta"]');
await cliente.locator(".cp-opz").first().click();
await cliente.evaluate(() => window.scrollTo(0, 0));
await cliente.waitForTimeout(300);
await cliente.screenshot({ path: path.join(img, "screen-cliente.png") });
await cliente.close();

// Firma e PDF
await page.click('[data-action="firma"]');
await fermo();
const box = await page.locator("#canvas-firma").boundingBox();
await page.mouse.move(box.x + 20, box.y + box.height * 0.65);
await page.mouse.down();
const punti = [
  [0.05, 0.65],
  [0.12, 0.3],
  [0.18, 0.7],
  [0.25, 0.35],
  [0.3, 0.68],
  [0.38, 0.45],
  [0.45, 0.6],
  [0.55, 0.4],
  [0.62, 0.62],
  [0.72, 0.42],
  [0.85, 0.55],
  [0.95, 0.5],
];
for (const [x, y] of punti) await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
await page.mouse.up();
await page.click('[data-action="firma-conferma"]');
await page.waitForTimeout(400);
await page.click('[data-action="menu-preventivo"]');
const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="scarica-pdf"]')]);
const pdf = path.join(tmp, "esempio.pdf");
await download.saveAs(pdf);
execSync(`pdftoppm -r 100 -png -singlefile "${pdf}" "${path.join(tmp, "esempio")}"`);
renameSync(path.join(tmp, "esempio.png"), path.join(img, "esempio-pdf.png"));

// Immagine di condivisione 1200x630 (WhatsApp, Facebook, LinkedIn)
const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const b64 = (f) => "data:image/png;base64," + readFileSync(path.join(img, f)).toString("base64");
await og.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:linear-gradient(135deg,#1e3a8a,#2563eb 45%,#7c3aed);font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;overflow:hidden">
  <div style="padding:0 0 0 70px;width:640px;color:#fff">
    <div style="display:flex;align-items:center;gap:14px;font-weight:800;font-size:34px"><img src="${b64("icona-192.png")}" width="58" height="58" style="border-radius:14px">PreventivoLampo</div>
    <div style="font-size:60px;font-weight:900;line-height:1.04;letter-spacing:-2px;margin:28px 0 22px">Preventivi dal telefono. Il cliente firma online.</div>
    <div style="font-size:27px;color:#dbe5ff">PDF e link su WhatsApp in 60 secondi. Prova gratis.</div>
  </div>
  <img src="${b64("screen-cliente.png")}" style="width:300px;margin-left:30px;margin-top:150px;transform:rotate(-4deg);border-radius:34px;border:9px solid #0b1220;box-shadow:0 30px 60px rgba(0,0,0,.4)">
</body></html>`);
await og.screenshot({ path: path.join(img, "og.png") });

await browser.close();
server.close();
console.log("Immagini aggiornate in", img);
