// Crea i file che dicono ad Android e iOS: "i link https://<sito>/app.html li apre l'app PreventivoLampo".
// Così la conferma firmata o l'avviso di pagamento toccati in WhatsApp aprono subito l'app (e non il browser,
// dove i preventivi non ci sono). Senza questi file funziona lo stesso, con un passaggio in più: la pagina
// web mostra il pulsante "Apri nell'app".
//
// Uso (poi ripubblica il sito):
//   ANDROID_SHA256="AB:CD:..." IOS_TEAM_ID="ABCDE12345" node scripts/genera-link-app.mjs
//
// ANDROID_SHA256: impronte SHA-256 dei certificati di firma, separate da virgola. In Play Console:
//   Configurazione > Integrità dell'app > Firma dell'app (copia quella della "chiave di firma dell'app").
// IOS_TEAM_ID: il Team ID dell'account sviluppatore Apple (developer.apple.com > Membership).
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { appId } = JSON.parse(readFileSync(path.join(radice, "mobile", "capacitor.config.json"), "utf8"));
const impronte = String(process.env.ANDROID_SHA256 || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const team = String(process.env.IOS_TEAM_ID || "").trim();
const errori = [];
if (impronte.some((f) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)))
  errori.push("ANDROID_SHA256 deve essere come AB:CD:...: 32 coppie esadecimali separate da due punti");
if (team && !/^[A-Z0-9]{10}$/.test(team)) errori.push("IOS_TEAM_ID deve essere di 10 caratteri (lettere e cifre)");
if (!impronte.length && !team) errori.push("Indica almeno ANDROID_SHA256 o IOS_TEAM_ID");
if (errori.length) {
  console.error(errori.join("\n"));
  process.exit(1);
}

const cartella = path.join(radice, "public", ".well-known");
mkdirSync(cartella, { recursive: true });
if (impronte.length) {
  const assetlinks = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: appId, sha256_cert_fingerprints: impronte },
    },
  ];
  writeFileSync(path.join(cartella, "assetlinks.json"), JSON.stringify(assetlinks, null, 2) + "\n");
  console.log("Creato public/.well-known/assetlinks.json");
}
if (team) {
  const aasa = {
    applinks: {
      details: [
        {
          appIDs: [`${team}.${appId}`],
          components: [{ "/": "/app.html", comment: "Conferme firmate e avvisi di pagamento dei clienti" }],
        },
      ],
    },
  };
  writeFileSync(path.join(cartella, "apple-app-site-association"), JSON.stringify(aasa, null, 2) + "\n");
  console.log("Creato public/.well-known/apple-app-site-association");
}
console.log("Ora ripubblica il sito: i file devono rispondere su https://<il tuo dominio>/.well-known/");
