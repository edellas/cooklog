// Genera le icone PNG dell'app (web, iPhone, Android, store) partendo dal simbolo: un lampo giallo su un
// quadrato color inchiostro, come in DESIGN.md. Richiede Playwright: npm i -g playwright.
// Uso: node scripts/genera-icone.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const INCHIOSTRO = "#1a1d21";
const LAMPO = "#ffc21a";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "img");
const fulmine = `<path d="M36.5 7 15 36h14.5l-4 21L49 27H34.5z" fill="${LAMPO}"/>`;
const scala = (k) => `<g transform="translate(32 32) scale(${k}) translate(-32 -32)">${fulmine}</g>`;
const normale = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${INCHIOSTRO}"/>${fulmine}</svg>`;
// Maskable (Android e PWA): sfondo pieno e simbolo nella "zona sicura" centrale.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${INCHIOSTRO}"/>${scala(0.72)}</svg>`;
// Apple e store: quadrato pieno senza trasparenza, gli angoli li arrotonda il sistema.
const pieno = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${INCHIOSTRO}"/>${scala(0.85)}</svg>`;
// App mobile (Capacitor): primo piano dell'icona adattiva Android (solo il lampo, nella zona sicura),
// il suo sfondo, e la schermata di avvio con il simbolo al centro su fondo carta (o scuro).
const primoPiano = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${scala(0.6)}</svg>`;
const sfondo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${INCHIOSTRO}"/></svg>`;
const avvio = (fondo) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fondo}"/><g transform="translate(32 32) scale(0.14) translate(-32 -32)"><rect width="64" height="64" rx="14" fill="${INCHIOSTRO}"/>${fulmine}</g></svg>`;

const mobile = path.join(dir, "..", "..", "mobile", "assets");
mkdirSync(mobile, { recursive: true });
writeFileSync(path.join(dir, "icona.svg"), normale + "\n");
const browser = await playwright.chromium.launch();
const page = await browser.newPage();
for (const [nome, svg, lato, trasparente, cartella = dir] of [
  ["icona-192.png", normale, 192, true],
  ["icona-512.png", normale, 512, true],
  ["icona-maskable-512.png", maskable, 512, false],
  ["icona-180.png", pieno, 180, false],
  ["favicon-32.png", normale, 32, true],
  ["icon-only.png", pieno, 1024, false, mobile],
  ["icon-foreground.png", primoPiano, 1024, true, mobile],
  ["icon-background.png", sfondo, 1024, false, mobile],
  ["splash.png", avvio("#f4f2ed"), 2732, false, mobile],
  ["splash-dark.png", avvio("#131518"), 2732, false, mobile],
]) {
  await page.setViewportSize({ width: lato, height: lato });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${lato}" height="${lato}" `)}</body></html>`,
  );
  await page.screenshot({ path: path.join(cartella, nome), omitBackground: trasparente });
  console.log("creata", nome);
}
await browser.close();
