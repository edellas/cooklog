// Genera le icone PNG dell'app partendo dall'SVG (richiede Playwright: npm i -g playwright).
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "img");
const fulmine = '<path d="M36 8 16 36h14l-4 20 22-30H34l2-18z" fill="#fbbf24"/>';
const normale = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#1d4ed8"/>${fulmine}</svg>`;
// Maskable: sfondo pieno e simbolo nella "zona sicura" centrale (80%).
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1d4ed8"/><g transform="translate(32 32) scale(0.72) translate(-32 -32)">${fulmine}</g></svg>`;
// Apple: niente angoli arrotondati (li applica iOS).
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1d4ed8"/><g transform="translate(32 32) scale(0.85) translate(-32 -32)">${fulmine}</g></svg>`;

const browser = await playwright.chromium.launch();
const page = await browser.newPage();
for (const [nome, svg, lato] of [
  ["icona-192.png", normale, 192],
  ["icona-512.png", normale, 512],
  ["icona-maskable-512.png", maskable, 512],
  ["icona-180.png", apple, 180],
  ["favicon-32.png", normale, 32],
]) {
  await page.setViewportSize({ width: lato, height: lato });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${lato}" height="${lato}" `)}</body></html>`,
  );
  await page.screenshot({ path: path.join(dir, nome), omitBackground: true });
  console.log("creata", nome);
}
await browser.close();
