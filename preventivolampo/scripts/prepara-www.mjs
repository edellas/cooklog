// Prepara la cartella mobile/www che Capacitor mette dentro le app iOS e Android: la stessa app web di
// public/, senza il sito di vendita e senza il service worker (nell'app i file sono già sul telefono).
// Uso: node scripts/prepara-www.mjs   (lo lanciano anche "npm run www" e "npm run sync" in mobile/)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pubblica = path.join(radice, "public");
const mobile = path.join(radice, "mobile");
const www = path.join(mobile, "www");

const { CONFIG } = await import(path.join(pubblica, "js", "config.js"));
const sito = new URL(CONFIG.sito).origin;

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

// Solo ciò che serve all'app (e alla pagina del cliente, per la firma al tavolo).
for (const voce of ["app.html", "accetta.html", "css", "fonts", "js", "vendor"]) {
  cpSync(path.join(pubblica, voce), path.join(www, voce), { recursive: true });
}
rmSync(path.join(www, "css", "sito.css"), { force: true });
rmSync(path.join(www, "js", "sito.js"), { force: true });
mkdirSync(path.join(www, "img"));
cpSync(path.join(pubblica, "img", "icona.svg"), path.join(www, "img", "icona.svg"));

// Il cuore di Capacitor (modulo ES senza dipendenze): nativo.js lo carica solo dentro l'app.
const core = path.join(mobile, "node_modules", "@capacitor", "core");
if (!existsSync(path.join(core, "dist", "index.js"))) {
  console.error("Manca @capacitor/core: esegui prima npm install in mobile/");
  process.exit(1);
}
cpSync(path.join(core, "dist", "index.js"), path.join(www, "vendor", "capacitor-core.js"));
cpSync(path.join(core, "LICENSE"), path.join(www, "vendor", "LICENSE-capacitor.txt"));

// Pagine: niente manifest né icone da "installare", e la CSP lascia parlare l'app con il sito
// (verifica della licenza) oltre che con sé stessa.
function adatta(html) {
  return html
    .replace(/\s*<link rel="manifest"[^>]*>/, "")
    .replace(/\s*<meta name="apple-mobile-web-app-[^>]*>/g, "")
    .replace(/\s*<meta name="mobile-web-app-capable"[^>]*>/, "")
    .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, "")
    .replace(/connect-src 'self'/, `connect-src 'self' ${sito}`)
    .replace(/\s*worker-src 'self';/, "")
    .replace(/\s*manifest-src 'self';/, "");
}
const app = adatta(readFileSync(path.join(pubblica, "app.html"), "utf8"));
writeFileSync(path.join(www, "app.html"), app);
writeFileSync(path.join(www, "index.html"), app);
writeFileSync(path.join(www, "accetta.html"), adatta(readFileSync(path.join(pubblica, "accetta.html"), "utf8")));

// Controllo: nessun riferimento a file che nell'app non ci sono.
const mancanti = [];
for (const pagina of ["index.html", "accetta.html"]) {
  const html = readFileSync(path.join(www, pagina), "utf8");
  for (const [, rif] of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) {
    if (!existsSync(path.join(www, rif))) mancanti.push(`${pagina}: ${rif}`);
  }
}
for (const f of readdirSync(path.join(www, "js"))) {
  const js = readFileSync(path.join(www, "js", f), "utf8");
  for (const m of js.matchAll(/from "\.\/([^"]+)"|import\("\.\/([^"]+)"\)/g)) {
    const rif = m[1] || m[2];
    if (!existsSync(path.join(www, "js", rif))) mancanti.push(`js/${f}: ${rif}`);
  }
}
if (mancanti.length) {
  console.error("Riferimenti a file mancanti:\n" + mancanti.join("\n"));
  process.exit(1);
}
console.log(`Pronta ${path.relative(radice, www)} (link per i clienti su ${sito})`);
