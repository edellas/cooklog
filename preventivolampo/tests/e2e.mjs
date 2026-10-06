// Test end-to-end nel browser vero (Chromium via Playwright).
// Avvia un server statico su public/, simula un artigiano che usa l'app e controlla i PDF generati.
// Uso: node tests/e2e.mjs   (richiede playwright e pdftotext)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pubblica = path.join(radice, "public");
const tmp = mkdtempSync(path.join(tmpdir(), "pl-e2e-"));
const { gestisciRichiesta } = await import(path.join(radice, "lib", "licenza.mjs"));

// Server statico minimale + /api/licenza con un finto provider.
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain",
};
const finto = async (url, init) => {
  const corpo = JSON.parse(init.body);
  if (corpo.key === "PL-VALIDA-1234") {
    return new Response(
      JSON.stringify({ status: "granted", expires_at: null, customer: { email: "mario.rossi@example.com" } }),
      { status: 200 },
    );
  }
  return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/licenza") {
    const corpo = await new Promise((r) => {
      let d = "";
      req.on("data", (c) => (d += c));
      req.on("end", () => r(d));
    });
    const risposta = await gestisciRichiesta(
      new Request("http://localhost/api/licenza", {
        method: req.method,
        headers: { "content-type": "application/json" },
        body: req.method === "POST" ? corpo : undefined,
      }),
      { LICENZE_PROVIDER: "polar", POLAR_ORGANIZATION_ID: "org-test" },
      finto,
    );
    res.writeHead(risposta.status, Object.fromEntries(risposta.headers));
    res.end(await risposta.text());
    return;
  }
  let file = path.join(pubblica, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
  if (!file.startsWith(pubblica) || !existsSync(file)) {
    res.writeHead(404);
    res.end("404");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;
const ANNO = new Date().getFullYear();

const browser = await playwright.chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  acceptDownloads: true,
  locale: "it-IT",
});
const page = await context.newPage();
const errori = [];
page.on("pageerror", (e) => errori.push(e.message));
page.on("console", (m) => m.type() === "error" && errori.push(m.text()));
page.on("dialog", (d) => d.accept());

function testoPdf(file) {
  return execSync(`pdftotext -layout "${file}" -`).toString();
}

async function scaricaPdfDalMenu(nome) {
  await page.click('[data-action="menu-preventivo"]');
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="scarica-pdf"]')]);
  const file = path.join(tmp, nome);
  await download.saveAs(file);
  return file;
}

const passi = [];
const passo = async (nome, fn) => {
  await fn();
  passi.push(nome);
  console.log("ok -", nome);
};

try {
  await passo("primo avvio porta al benvenuto", async () => {
    await page.goto(`${BASE}/app.html`);
    await page.waitForSelector("text=Che lavoro fai?");
    assert.match(page.url(), /#\/benvenuto/);
  });

  await passo("onboarding idraulico crea listino e primo preventivo", async () => {
    await page.click('[data-m="idraulico"]');
    await page.fill("#b-nome", "Idraulica Rossi di Mario Rossi");
    await page.fill("#b-tel", "333 1234567");
    await page.fill("#b-piva", "01234567890");
    await page.fill("#b-citta", "Bergamo");
    await page.selectOption("#b-iva", "10");
    await page.click('[data-action="fine-benvenuto"]');
    await page.waitForSelector(`text=N. ${ANNO}-001`);
  });

  await passo("compila cliente e voci, totale corretto", async () => {
    await page.fill('[data-campo="cliente.nome"]', "Giulia Bianchi");
    await page.fill('[data-campo="cliente.telefono"]', "347 7654321");
    await page.fill('[data-campo="oggetto"]', "Sostituzione miscelatore e riparazione scarico bagno");
    await page.click('[data-action="dal-listino"]');
    await page.fill("#cerca-listino", "miscelatore lavabo mono");
    await page.click(".voce-listino >> nth=0");
    await page.click('[data-action="dal-listino"]');
    await page.fill("#cerca-listino", "Diritto");
    await page.click(".voce-listino >> nth=0");
    await page.click('[data-action="aggiungi-riga"]');
    const ultima = page.locator(".riga").last();
    await ultima.locator('[data-r="descrizione"]').fill("Manodopera idraulico");
    await ultima.locator('[data-r="qta"]').fill("2,5");
    await ultima.locator('[data-r="prezzo"]').fill("38");
    // 85 + 40 + 95 = 220 imponibile, IVA 10% = 22 -> 242
    await page.waitForFunction(() => document.querySelector("#tot-valore").textContent === "€ 242,00");
    await page.fill('[data-campo="acconto.valore"]', "30");
    await page.screenshot({ path: path.join(tmp, "editor.png"), fullPage: false });
  });

  let pdf1;
  await passo("PDF gratuito: contenuti, totali e dicitura piano gratuito", async () => {
    pdf1 = await scaricaPdfDalMenu("p1.pdf");
    const t = testoPdf(pdf1);
    for (const atteso of [
      "PREVENTIVO",
      `N. ${ANNO}-001`,
      "Idraulica Rossi di Mario Rossi",
      "P.IVA 01234567890",
      "Giulia Bianchi",
      "Sostituzione miscelatore",
      "Miscelatore lavabo monocomando",
      "€ 85,00",
      "IVA 10%",
      "€ 22,00",
      "€ 242,00",
      "Acconto all'accettazione",
      "€ 72,60",
      "Saldo a fine lavori",
      "€ 169,40",
      "PER ACCETTAZIONE",
      "Creato gratis con PreventivoLampo",
    ]) {
      assert.ok(t.includes(atteso), `nel PDF manca: ${atteso}\n---\n${t}`);
    }
  });

  await passo("il cliente viene salvato e lo stato resta bozza dopo il download", async () => {
    await page.click(".back");
    await page.waitForSelector(".voce-lista");
    assert.ok((await page.textContent(".voce-lista")).includes("Giulia Bianchi"));
    await page.click('a[data-tab="clienti"]');
    await page.waitForSelector("text=Giulia Bianchi");
  });

  await passo("limite piano gratuito: al 4° preventivo compare il paywall", async () => {
    for (let n = 2; n <= 4; n++) {
      await page.goto(`${BASE}/app.html#/nuovo`);
      await page.waitForSelector(`text=N. ${ANNO}-00${n}`);
      await page.click('[data-action="aggiungi-riga"]');
      await page.locator('[data-r="descrizione"]').last().fill(`Lavoro ${n}`);
      await page.locator('[data-r="prezzo"]').last().fill("100");
      await page.waitForTimeout(500);
      if (n < 4) {
        await scaricaPdfDalMenu(`p${n}.pdf`);
      } else {
        await page.click('[data-action="menu-preventivo"]');
        await page.click('[data-action="scarica-pdf"]');
        await page.waitForSelector("text=preventivi gratuiti di");
      }
    }
    // Riesportare un preventivo già esportato resta consentito.
    await page.goto(`${BASE}/app.html#/`);
    await page.click("text=Lavoro 2 >> xpath=ancestor::a", { timeout: 2000 }).catch(async () => {
      await page.locator(".voce-lista", { hasText: `${ANNO}-002` }).click();
    });
    await page.waitForSelector(`text=N. ${ANNO}-002`);
    await scaricaPdfDalMenu("p2-bis.pdf");
  });

  await passo("attivazione licenza: codice errato rifiutato, codice valido attiva Pro", async () => {
    await page.goto(`${BASE}/app.html#/pro`);
    await page.fill("#chiave", "CODICE-SBAGLIATO");
    await page.click('[data-action="attiva-licenza"]');
    await page.waitForSelector("text=non riconosciuto");
    await page.fill("#chiave", "PL-VALIDA-1234");
    await page.click('[data-action="attiva-licenza"]');
    await page.waitForSelector("text=Pro attivo");
  });

  await passo("Pro: firma del cliente e PDF senza dicitura gratuita", async () => {
    await page.goto(`${BASE}/app.html#/`);
    await page.locator(".voce-lista", { hasText: "Giulia Bianchi" }).click();
    await page.waitForSelector(`text=N. ${ANNO}-001`);
    await page.click('[data-action="firma"]');
    const canvas = page.locator("#canvas-firma");
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 30, box.y + box.height * 0.7);
    await page.mouse.down();
    for (let k = 0; k <= 30; k++) {
      await page.mouse.move(box.x + 30 + k * 8, box.y + box.height * (0.5 + 0.25 * Math.sin(k / 3)));
    }
    await page.mouse.up();
    await page.click('[data-action="firma-conferma"]');
    await page.waitForSelector("text=Firmato da Giulia Bianchi");
    assert.equal(await page.inputValue('[data-campo="stato"]'), "accettato");
    const pdf = await scaricaPdfDalMenu("p1-firmato.pdf");
    const t = testoPdf(pdf);
    assert.ok(!t.includes("Creato gratis"), "il PDF Pro non deve avere la dicitura gratuita");
    assert.ok(t.includes("Firmato da Giulia Bianchi"), "manca la firma nel PDF");
    const immagini = execSync(`pdfimages -list "${pdf}"`).toString().trim().split("\n").length - 2;
    assert.ok(immagini >= 1, "il PDF firmato deve contenere l'immagine della firma");
  });

  await passo("regime forfettario: niente IVA, dicitura di legge e bollo", async () => {
    await page.goto(`${BASE}/app.html#/impostazioni`);
    await page.selectOption('[data-az="regime"]', "forfettario");
    await page.waitForSelector('[data-az="addebitaBollo"]');
    await page.goto(`${BASE}/app.html#/nuovo`);
    await page.waitForSelector(`text=N. ${ANNO}-005`);
    await page.click('[data-action="aggiungi-riga"]');
    await page.locator('[data-r="descrizione"]').last().fill("Consulenza tecnica");
    await page.locator('[data-r="prezzo"]').last().fill("300");
    await page.waitForFunction(() => document.querySelector("#tot-valore").textContent === "€ 302,00");
    const t = testoPdf(await scaricaPdfDalMenu("p5-forf.pdf"));
    assert.ok(t.includes("190/2014"), "manca la dicitura del forfettario");
    assert.ok(t.includes("Imposta di bollo"), "manca il bollo");
    assert.ok(!t.includes("IVA 22%"), "nel forfettario non deve comparire l'IVA");
  });

  await passo("molte voci: il PDF va su più pagine con numerazione", async () => {
    await page.goto(`${BASE}/app.html#/nuovo`);
    await page.waitForSelector(`text=N. ${ANNO}-006`);
    for (let k = 0; k < 40; k++) await page.click('[data-action="aggiungi-riga"]');
    const descrizioni = page.locator('[data-r="descrizione"]');
    for (let k = 0; k < 40; k++)
      await descrizioni
        .nth(k)
        .fill(
          `Voce numero ${k + 1} con una descrizione abbastanza lunga da andare a capo nella tabella del preventivo`,
        );
    await page.waitForTimeout(600);
    const t = testoPdf(await scaricaPdfDalMenu("p6-lungo.pdf"));
    assert.ok(t.includes("Pagina 2 di"), "il PDF lungo deve avere più pagine");
    assert.ok(t.includes("Voce numero 40"));
  });

  await passo("dati persistenti dopo il ricaricamento", async () => {
    await page.reload();
    await page.goto(`${BASE}/app.html#/`);
    await page.waitForSelector(".voce-lista");
    assert.equal(await page.locator(".voce-lista").count(), 6);
    await page.screenshot({ path: path.join(tmp, "lista.png") });
    await page.goto(`${BASE}/app.html#/impostazioni`);
    assert.equal(await page.inputValue('[data-az="regime"]'), "forfettario", "le impostazioni devono restare salvate");
  });

  await passo("funziona offline: senza rete l'app si apre e crea PDF", async () => {
    await page.goto(`${BASE}/app.html#/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector(".voce-lista");
    await page.locator(".voce-lista", { hasText: "Giulia Bianchi" }).click();
    await page.waitForSelector("text=Firmato da Giulia Bianchi");
    const t = testoPdf(await scaricaPdfDalMenu("offline.pdf"));
    assert.ok(t.includes("€ 242,00"), "PDF offline non corretto");
    await context.setOffline(false);
  });

  await passo("backup esportabile", async () => {
    await page.goto(`${BASE}/app.html#/impostazioni`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="backup-esporta"]')]);
    const file = path.join(tmp, "backup.json");
    await download.saveAs(file);
    const dati = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(dati.preventivi.length, 6);
    assert.ok(!dati.kv.some((r) => r.chiave === "licenza"), "la licenza non deve finire nel backup");
  });

  await passo("link modello dalle pagine SEO apre un preventivo precompilato", async () => {
    await page.goto(`${BASE}/app.html?mestiere=elettricista&modello=1`);
    await page.waitForSelector(`text=N. ${ANNO}-007`);
    assert.equal(await page.inputValue('[data-campo="oggetto"]'), "Adeguamento impianto elettrico appartamento");
    assert.equal(await page.locator(".riga").count(), 5);
  });

  assert.deepEqual(errori, [], "errori JavaScript nella pagina:\n" + errori.join("\n"));
  console.log(`\nTutti i ${passi.length} passi superati. File in ${tmp}`);
} catch (err) {
  await page.screenshot({ path: path.join(tmp, "errore.png"), fullPage: true }).catch(() => {});
  console.error("\nFALLITO:", err.message, "\nScreenshot:", path.join(tmp, "errore.png"));
  if (errori.length) console.error("Errori JS:", errori);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
