// Test end-to-end nel browser vero (Chromium via Playwright).
// Avvia un server statico su public/, simula un artigiano e un suo cliente su due "telefoni" diversi
// e controlla PDF, accettazione online, sicurezza (XSS, link manomessi, CSP) e funzionamento offline.
// Uso: node tests/e2e.mjs   (richiede playwright, pdftotext e pdfimages)
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
const { comprimi, decomprimi } = await import(path.join(pubblica, "js", "link.js"));

// Server statico minimale + /api/licenza con un finto provider.
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
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
const num = (n) => `${ANNO}-${String(n).padStart(3, "0")}`;

const browser = await playwright.chromium.launch();
const errori = [];

// Ogni "telefono" è un contesto separato (archivio separato), con controllo di errori JS e violazioni CSP.
async function nuovoTelefono(opzioni = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
    locale: "it-IT",
    ...opzioni,
  });
  await context.exposeBinding("__segnalaCSP", (_, v) => errori.push("CSP: " + v));
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__segnalaCSP(`${e.violatedDirective} ${e.blockedURI} ${location.pathname}`),
    );
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errori.push("JS: " + e.message));
  page.on("console", (m) => m.type() === "error" && errori.push("console: " + m.text()));
  page.on("dialog", (d) => {
    errori.push("dialog inatteso: " + d.message());
    d.dismiss();
  });
  return { context, page };
}

const artigiano = await nuovoTelefono();
const page = artigiano.page;
const context = artigiano.context;
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const cliente = await nuovoTelefono({ reducedMotion: "reduce" });

function testoPdf(file) {
  return execSync(`pdftotext -layout "${file}" -`).toString();
}
function immaginiPdf(file) {
  return execSync(`pdfimages -list "${file}"`).toString().trim().split("\n").length - 2;
}

async function scaricaPdfDalMenu(nome, p = page) {
  await p.click('[data-action="menu-preventivo"]');
  const [download] = await Promise.all([p.waitForEvent("download"), p.click('[data-action="scarica-pdf"]')]);
  const file = path.join(tmp, nome);
  await download.saveAs(file);
  return file;
}

// Attende che i fogli a comparsa abbiano finito di scorrere: si disegna sulla posizione definitiva.
async function attendiAnimazioni(p) {
  await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}

async function firma(p, selettore) {
  await p.locator(selettore).waitFor();
  await attendiAnimazioni(p);
  const box = await p.locator(selettore).boundingBox();
  await p.mouse.move(box.x + 20, box.y + box.height * 0.7);
  await p.mouse.down();
  for (let k = 0; k <= 36; k++) {
    await p.mouse.move(box.x + 20 + k * 8, box.y + box.height * (0.5 + 0.25 * Math.sin(k / 3)));
  }
  await p.mouse.up();
}

// Ogni pulsante e link deve avere un nome leggibile (testo o aria-label) e ogni immagine un alt.
async function controllaAccessibilita(p, dove) {
  const problemi = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a[href], [role=button]")) {
      if (el.closest("[hidden], .nascosto")) continue;
      const nome = (el.getAttribute("aria-label") || el.textContent || "").trim();
      if (!nome) out.push(el.outerHTML.slice(0, 120));
    }
    for (const img of document.querySelectorAll("img"))
      if (!img.hasAttribute("alt")) out.push(img.outerHTML.slice(0, 120));
    for (const i of document.querySelectorAll("input:not([type=hidden]):not([type=file]), select, textarea")) {
      const etichetta = i.getAttribute("aria-label") || i.placeholder || i.closest("label")?.textContent?.trim();
      if (!etichetta) out.push(i.outerHTML.slice(0, 120));
    }
    return out;
  });
  assert.deepEqual(problemi, [], `accessibilità (${dove}):\n${problemi.join("\n")}`);
}

const passi = [];
const passo = async (nome, fn) => {
  await fn();
  passi.push(nome);
  console.log("ok -", nome);
};

let linkAccettazione;
let linkConferma;
let creati = 0;

try {
  await passo("primo avvio porta al benvenuto", async () => {
    await page.goto(`${BASE}/app.html`);
    await page.waitForSelector("text=Che lavoro fai?");
    assert.match(page.url(), /#\/benvenuto/);
    await controllaAccessibilita(page, "benvenuto");
  });

  await passo("onboarding in 2 passi: mestiere, dati, IVA", async () => {
    await page.click('[data-m="idraulico"]');
    await page.click('[data-action="onb-avanti"]');
    await page.fill("#b-nome", "Idraulica Rossi di Mario Rossi");
    await page.fill("#b-tel", "333 1234567");
    await page.fill("#b-piva", "01234567890");
    await page.fill("#b-citta", "Bergamo");
    // indietro e avanti non perdono i dati inseriti
    await page.click('[data-action="onb-indietro"]');
    await page.click('[data-action="onb-avanti"]');
    assert.equal(await page.inputValue("#b-nome"), "Idraulica Rossi di Mario Rossi");
    await page.check('input[name="b-iva"][value="10"]');
    await page.click('[data-action="fine-benvenuto"]');
    await page.waitForSelector(`text=N. ${num(1)}`);
    creati++;
  });

  await passo("impostazioni pagamento: IBAN e link per l'acconto (solo https)", async () => {
    const editor = page.url();
    await page.goto(`${BASE}/app.html#/impostazioni`);
    await page.fill('[data-az="iban"]', "IT60 X054 2811 1010 0000 0123 456");
    await page.fill('[data-az="linkPagamento"]', "javascript:alert(1)");
    await page.locator('[data-az="linkPagamento"]').blur();
    await page.waitForSelector("text=deve iniziare con https://");
    await page.fill('[data-az="linkPagamento"]', "https://paypal.me/idraulicarossi");
    await page.locator('[data-az="linkPagamento"]').blur();
    await page.goto(editor);
    await page.waitForSelector(`text=N. ${num(1)}`);
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
    await controllaAccessibilita(page, "editor");
  });

  await passo("guadagno stimato dal costo dei materiali, visibile solo all'artigiano", async () => {
    const materiale = page.locator(".riga", { has: page.locator('[data-r="costo"]') }).first();
    await materiale.locator('[data-r="costo"]').fill("52");
    await page.waitForSelector("#margine");
    assert.match(await page.textContent("#margine"), /€ 168,00/);
  });

  await passo("voce facoltativa: proposta al cliente ma esclusa dal totale", async () => {
    await page.click('[data-action="aggiungi-riga"]');
    const ultima = page.locator(".riga").last();
    await ultima.locator('[data-r="descrizione"]').fill("Sostituzione sifone");
    await ultima.locator('[data-r="prezzo"]').fill("45");
    await page.waitForFunction(() => document.querySelector("#tot-valore").textContent === "€ 291,50");
    await ultima.locator('[data-action="opzionale"]').click();
    await page.waitForFunction(() => document.querySelector("#tot-valore").textContent === "€ 242,00");
    assert.match(await page.textContent("#riepilogo"), /1 voce facoltativa/);
    await page.screenshot({ path: path.join(tmp, "editor.png") });
  });

  await passo("PDF gratuito: totali, facoltative a parte, link di accettazione, nessun costo", async () => {
    const pdf = await scaricaPdfDalMenu("p1.pdf");
    const t = testoPdf(pdf);
    for (const atteso of [
      "PREVENTIVO",
      `N. ${num(1)}`,
      "Idraulica Rossi di Mario Rossi",
      "P.IVA 01234567890",
      "Giulia Bianchi",
      "Miscelatore lavabo monocomando",
      "IVA 10%",
      "€ 242,00",
      "€ 72,60",
      "€ 169,40",
      "VOCI FACOLTATIVE",
      "Sostituzione sifone",
      "Accetta e firma online",
      "Creato gratis con PreventivoLampo",
    ]) {
      assert.ok(t.includes(atteso), `nel PDF manca: ${atteso}\n---\n${t}`);
    }
    assert.ok(!/guadagno|costo/i.test(t), "costi e guadagno non devono finire nel PDF");
    assert.ok(readFileSync(pdf, "latin1").includes("/accetta.html#z"), "il PDF deve contenere il link di accettazione");
  });

  await passo("invio: link di accettazione per WhatsApp, stato inviato", async () => {
    await page.click('[data-action="invia"]');
    await page.waitForSelector('[data-action="invio-link"]');
    const href = await page.getAttribute('[data-action="invio-link"]', "href");
    const u = new URL(href);
    assert.equal(u.hostname, "wa.me");
    assert.equal(u.pathname, "/393477654321");
    const testo = u.searchParams.get("text");
    assert.match(testo, /Buongiorno Giulia Bianchi/);
    assert.match(testo, /voce facoltativa/);
    linkAccettazione = testo.match(/https?:\/\/\S+/)[0];
    assert.ok(linkAccettazione.startsWith(`${BASE}/accetta.html#z`));
    await page.click('[data-action="invio-copia-link"]');
    await page.waitForSelector("text=Messaggio con link copiato");
    const appunti = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(appunti.includes(linkAccettazione));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('[data-campo="stato"]').value === "inviato");
  });

  await passo("cliente (altro telefono): vede il preventivo, aggiunge la facoltativa, firma", async () => {
    const c = cliente.page;
    await c.goto(linkAccettazione);
    await c.waitForSelector("text=Idraulica Rossi di Mario Rossi");
    assert.match(await c.textContent("h1"), /Sostituzione miscelatore/);
    assert.equal(await c.textContent("#cp-totale"), "€ 242,00");
    await controllaAccessibilita(c, "pagina cliente");
    await c.screenshot({ path: path.join(tmp, "cliente.png") });
    await c.locator(".cp-opz", { hasText: "Sostituzione sifone" }).click();
    await c.waitForFunction(() => document.querySelector("#cp-totale").textContent === "€ 291,50");
    await c.click('[data-azione="accetta"]');
    await c.waitForSelector("#acc-firma");
    // senza firma e senza spunta non si può confermare
    await c.click('[data-azione="conferma"]');
    await c.waitForSelector("text=Firma nel riquadro");
    await firma(c, "#acc-firma");
    await c.click('[data-azione="conferma"]');
    await c.waitForSelector("text=Spunta la casella");
    await c.check("#acc-ok");
    await c.click('[data-azione="conferma"]');
    await c.waitForSelector("text=Preventivo accettato");
    assert.match(await c.textContent(".cp-successo"), /€ 291,50/);
    const successo = await c.textContent(".cp-successo");
    assert.match(successo, /Acconto: € 87,45/);
    assert.match(successo, /IT60 X054 2811 1010 0000 0123 456/);
    assert.equal(
      await c.getAttribute("text=Paga online >> xpath=ancestor-or-self::a", "href"),
      "https://paypal.me/idraulicarossi",
    );
    const href = await c.getAttribute("#cp-invia-wa", "href");
    const u = new URL(href);
    assert.equal(u.pathname, "/393331234567");
    const testo = u.searchParams.get("text");
    assert.match(testo, /Ho aggiunto: Sostituzione sifone/);
    linkConferma = testo.match(/https?:\/\/\S+/)[0];
    assert.ok(linkConferma.startsWith(`${BASE}/app.html#/accettazione?d=z`));
    assert.ok(linkConferma.length < 4000, `link di conferma lungo ${linkConferma.length}`);
  });

  await passo("cliente: PDF firmato scaricabile e conferma ritrovata riaprendo il link", async () => {
    const c = cliente.page;
    const [download] = await Promise.all([c.waitForEvent("download"), c.click('[data-azione="pdf"]')]);
    const file = path.join(tmp, "cliente-firmato.pdf");
    await download.saveAs(file);
    const t = testoPdf(file);
    assert.ok(t.includes("€ 291,50"), t);
    assert.ok(t.includes("Firmato da Giulia Bianchi online"), t);
    assert.ok(immaginiPdf(file) >= 1, "manca l'immagine della firma");
    await c.reload();
    await c.waitForSelector("text=Preventivo accettato");
  });

  await passo("artigiano: riceve la conferma, verifica l'impronta e la registra", async () => {
    await page.goto(linkConferma);
    await page.waitForSelector("text=Giulia Bianchi ha accettato");
    assert.match(await page.textContent("main"), /esattamente/);
    assert.match(await page.textContent("main"), /Sostituzione sifone/);
    assert.match(await page.textContent("main"), /€ 291,50/);
    await page.click('[data-action="registra-accettazione"]');
    await page.waitForSelector("text=Accettato online");
    assert.equal(await page.inputValue('[data-campo="stato"]'), "accettato");
    assert.equal(await page.textContent("#tot-valore"), "€ 291,50");
    const t = testoPdf(await scaricaPdfDalMenu("p1-online.pdf"));
    assert.ok(t.includes("Firmato da Giulia Bianchi online"));
    assert.ok(!t.includes("VOCI FACOLTATIVE"), "la facoltativa scelta ora è inclusa");
    // riaprire la stessa conferma non la registra due volte
    await page.goto(linkConferma);
    await page.waitForSelector("text=già registrata");
  });

  await passo("sicurezza: un link con prezzi manomessi viene segnalato all'artigiano", async () => {
    const codice = linkAccettazione.split("#")[1];
    const dati = JSON.parse(await decomprimi(codice));
    dati.r[0][3] = 1; // il miscelatore a 1 €
    const c = cliente.page;
    await c.goto(`${BASE}/accetta.html#${await comprimi(JSON.stringify(dati))}`);
    await c.waitForSelector('[data-azione="accetta"]');
    await c.click('[data-azione="accetta"]');
    await firma(c, "#acc-firma");
    await c.check("#acc-ok");
    await c.click('[data-azione="conferma"]');
    await c.waitForSelector("#cp-invia-wa");
    const testo = new URL(await c.getAttribute("#cp-invia-wa", "href")).searchParams.get("text");
    await page.goto(testo.match(/https?:\/\/\S+/)[0]);
    await page.waitForSelector("text=non corrispondono");
  });

  await passo("sicurezza: XSS e link javascript: nel preventivo non vengono eseguiti", async () => {
    const ostile = {
      v: 1,
      id: "x",
      n: "<b>1</b>",
      d: "2026-10-06",
      vg: 3650,
      az: { r: '<img src=x onerror="window.__xss=1">', t: "333", pay: "javascript:window.__xss=1", ib: "IT00X" },
      cl: { n: "<script>window.__xss=1</script>" },
      o: "<svg onload=window.__xss=1>",
      r: [['<img src=x onerror="window.__xss=1">', 1, "cad", 100, 0, 22, "man", 0]],
      ac: ["perc", 30],
      rg: "o",
      pg: "<a href=javascript:window.__xss=1>paga</a>",
      nt: "",
      wm: 1,
    };
    const c = cliente.page;
    await c.goto(`${BASE}/accetta.html#${await comprimi(JSON.stringify(ostile))}`);
    await c.waitForSelector('[data-azione="accetta"]');
    assert.ok(
      (await c.textContent("body")).includes('<img src=x onerror="window.__xss=1">'),
      "il testo va mostrato com'è",
    );
    await c.click('[data-azione="accetta"]');
    await firma(c, "#acc-firma");
    await c.check("#acc-ok");
    await c.click('[data-azione="conferma"]');
    await c.waitForSelector("text=Preventivo accettato");
    assert.equal(await c.evaluate(() => window.__xss), undefined, "codice iniettato eseguito!");
    assert.equal(await c.locator('a[href^="javascript"]').count(), 0);
    assert.equal(await c.locator("text=Paga online").count(), 0, "un link di pagamento non https non va mostrato");
  });

  await passo("pagina cliente: link danneggiato e preventivo scaduto", async () => {
    const c = cliente.page;
    await c.goto(`${BASE}/accetta.html#zQUJD`);
    await c.waitForSelector("text=Non riesco ad aprire");
    const tagliato = linkAccettazione.slice(0, linkAccettazione.length - 30);
    await c.goto(`${BASE}/accetta.html#abc`);
    await c.goto(tagliato);
    await c.waitForSelector("text=Non riesco ad aprire");
    const scaduto = {
      v: 1,
      id: "y",
      n: "9",
      d: "2020-01-01",
      vg: 30,
      az: { r: "Ditta" },
      cl: {},
      r: [["Voce", 1, "cad", 10, 0, 22, "man", 0]],
    };
    await c.goto(`${BASE}/accetta.html#${await comprimi(JSON.stringify(scaduto))}`);
    await c.waitForSelector("text=Scaduto il");
    assert.equal(await c.isDisabled('[data-azione="accetta"]'), true);
  });

  await passo("limite piano gratuito: al 4° preventivo compare il paywall", async () => {
    for (let n = 2; n <= 4; n++) {
      await page.goto(`${BASE}/app.html#/nuovo`);
      await page.waitForSelector(`text=N. ${num(n)}`);
      creati++;
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
    await page.locator(".voce-lista", { hasText: num(2) }).click();
    await page.waitForSelector(`text=N. ${num(2)}`);
    await scaricaPdfDalMenu("p2-bis.pdf");
  });

  await passo("da ricontattare: promemoria con messaggio WhatsApp pronto", async () => {
    await page.goto(`${BASE}/app.html#/`);
    await page.locator(".voce-lista", { hasText: num(3) }).click();
    await page.waitForSelector(`text=N. ${num(3)}`);
    await page.fill('[data-campo="cliente.nome"]', "Luca Verdi");
    await page.fill('[data-campo="cliente.telefono"]', "3201112222");
    await page.selectOption('[data-campo="stato"]', "inviato");
    await page.click(".back");
    await page.waitForSelector(".voce-lista");
    // simula un invio di 5 giorni fa
    await page.evaluate(
      (numero) =>
        new Promise((ok) => {
          const r = indexedDB.open("preventivolampo");
          r.onsuccess = () => {
            const t = r.result.transaction("preventivi", "readwrite");
            const os = t.objectStore("preventivi");
            os.getAll().onsuccess = (e) => {
              const p = e.target.result.find((x) => x.numero === numero);
              p.inviatoIl = Date.now() - 5 * 86400000;
              os.put(p);
            };
            t.oncomplete = ok;
          };
        }),
      num(3),
    );
    await page.reload();
    await page.waitForSelector("text=Da ricontattare");
    await page.evaluate(() => {
      window.open = (u) => {
        window.__aperto = u;
        return null;
      };
    });
    await page.click('[data-action="ricontatta"]');
    const aperto = await page.evaluate(() => window.__aperto);
    assert.match(aperto, /^https:\/\/wa\.me\/393201112222\?text=/);
    assert.match(decodeURIComponent(aperto), /Ha avuto modo di vederlo/);
    await page.waitForFunction(() => !document.body.textContent.includes("Da ricontattare"));
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

  await passo("Pro: firma sul posto, foto del lavoro nel PDF, niente dicitura gratuita", async () => {
    await page.goto(`${BASE}/app.html#/`);
    await page.locator(".voce-lista", { hasText: num(2) }).click();
    await page.waitForSelector(`text=N. ${num(2)}`);
    await page.setInputFiles("#input-foto", [
      path.join(pubblica, "img", "icona-512.png"),
      path.join(pubblica, "img", "og.png"),
    ]);
    await page.waitForFunction(() => document.querySelectorAll(".foto-griglia figure").length === 2);
    await page.click('[data-action="firma"]');
    await firma(page, "#canvas-firma");
    await page.click('[data-action="firma-conferma"]');
    await page.waitForSelector("text=Firmato da");
    assert.equal(await page.inputValue('[data-campo="stato"]'), "accettato");
    const pdf = await scaricaPdfDalMenu("p2-pro.pdf");
    const t = testoPdf(pdf);
    assert.ok(!t.includes("Creato gratis"), "il PDF Pro non deve avere la dicitura gratuita");
    assert.ok(t.includes("DOCUMENTAZIONE FOTOGRAFICA"));
    assert.ok(t.includes("su dispositivo"));
    assert.ok(immaginiPdf(pdf) >= 3, "firma + 2 foto");
    // togli una foto
    await page.click('[data-action="togli-foto"] >> nth=0');
    await page.waitForFunction(() => document.querySelectorAll(".foto-griglia figure").length === 1);
  });

  await passo("calcolatore metri quadri per stanza", async () => {
    await page.goto(`${BASE}/app.html#/nuovo`);
    await page.waitForSelector(`text=N. ${num(5)}`);
    creati++;
    await page.click('[data-action="aggiungi-riga"]');
    await page.locator('[data-r="descrizione"]').last().fill("Tinteggiatura pareti e soffitto");
    await page.selectOption('.riga >> nth=0 >> [data-r="um"]', "mq");
    await page.click('[data-action="calcolatore"]');
    await page.fill('[data-st="lunghezza"]', "4");
    await page.fill('[data-st="larghezza"]', "3");
    await page.fill('[data-st="altezza"]', "2,7");
    await page.check('[data-st="soffitto"]');
    await page.fill('[data-st="detrazioni"]', "2");
    await page.waitForFunction(() => document.querySelector("#calc-totale").textContent === "47,8 mq");
    await page.click('[data-action="calc-aggiungi"]');
    await page.locator('[data-st="lunghezza"]').last().fill("2");
    await page.locator('[data-st="larghezza"]').last().fill("2");
    await page.waitForFunction(() => document.querySelector("#calc-totale").textContent === "69,4 mq");
    await page.click('[data-action="calc-usa"]');
    assert.equal(await page.inputValue('.riga >> nth=0 >> [data-r="qta"]'), "69,4");
  });

  await passo("regime forfettario: niente IVA, dicitura di legge e bollo", async () => {
    await page.goto(`${BASE}/app.html#/impostazioni`);
    await controllaAccessibilita(page, "impostazioni");
    await page.selectOption('[data-az="regime"]', "forfettario");
    await page.waitForSelector('[data-az="addebitaBollo"]');
    await page.goto(`${BASE}/app.html#/nuovo`);
    await page.waitForSelector(`text=N. ${num(6)}`);
    creati++;
    await page.click('[data-action="aggiungi-riga"]');
    await page.locator('[data-r="descrizione"]').last().fill("Consulenza tecnica");
    await page.locator('[data-r="prezzo"]').last().fill("300");
    await page.waitForFunction(() => document.querySelector("#tot-valore").textContent === "€ 302,00");
    const t = testoPdf(await scaricaPdfDalMenu("p6-forf.pdf"));
    assert.ok(t.includes("190/2014"), "manca la dicitura del forfettario");
    assert.ok(t.includes("Imposta di bollo"), "manca il bollo");
    assert.ok(!t.includes("IVA 22%"), "nel forfettario non deve comparire l'IVA");
  });

  await passo("molte voci: il PDF va su più pagine con numerazione", async () => {
    await page.goto(`${BASE}/app.html#/nuovo`);
    await page.waitForSelector(`text=N. ${num(7)}`);
    creati++;
    for (let k = 0; k < 40; k++) await page.click('[data-action="aggiungi-riga"]');
    const descrizioni = page.locator('[data-r="descrizione"]');
    for (let k = 0; k < 40; k++)
      await descrizioni
        .nth(k)
        .fill(`Voce numero ${k + 1} con una descrizione abbastanza lunga da andare a capo nella tabella`);
    await page.waitForTimeout(600);
    const t = testoPdf(await scaricaPdfDalMenu("p7-lungo.pdf"));
    assert.ok(t.includes("Pagina 2 di"), "il PDF lungo deve avere più pagine");
    assert.ok(t.includes("Voce numero 40"));
  });

  await passo("dati persistenti dopo il ricaricamento", async () => {
    await page.reload();
    await page.goto(`${BASE}/app.html#/`);
    await page.waitForSelector(".voce-lista");
    assert.equal(await page.locator(".voce-lista").count(), creati);
    await controllaAccessibilita(page, "dashboard");
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
    await page.waitForSelector("text=Accettato online");
    const t = testoPdf(await scaricaPdfDalMenu("offline.pdf"));
    assert.ok(t.includes("€ 291,50"), "PDF offline non corretto");
    await context.setOffline(false);
  });

  await passo("backup esportabile senza licenza", async () => {
    await page.goto(`${BASE}/app.html#/impostazioni`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="backup-esporta"]')]);
    const file = path.join(tmp, "backup.json");
    await download.saveAs(file);
    const dati = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(dati.preventivi.length, creati);
    assert.ok(!dati.kv.some((r) => r.chiave === "licenza"), "la licenza non deve finire nel backup");
  });

  await passo("backup: reimportazione con conferma e conteggio", async () => {
    await page.goto(`${BASE}/app.html#/impostazioni`);
    await page.setInputFiles("#file-backup", path.join(tmp, "backup.json"));
    await page.click('[data-esito="si"]');
    await page.waitForSelector(`text=Backup importato: ${creati} preventivi`);
    await page.waitForSelector("#lista-prev");
    assert.equal(await page.locator(".voce-lista").count(), creati);
  });

  await passo("schermo stretto (360 px): nessuna pagina esce dai bordi", async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    for (const h of ["#/", "#/clienti", "#/listino", "#/impostazioni", "#/pro"]) {
      await page.goto(`${BASE}/app.html${h}`);
      await page.waitForTimeout(250);
      const largo = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(largo <= 0, `${h} esce di ${largo}px`);
    }
    await page
      .locator(".voce-lista", { hasText: "Giulia Bianchi" })
      .click()
      .catch(async () => {
        await page.goto(`${BASE}/app.html#/`);
        await page.locator(".voce-lista", { hasText: "Giulia Bianchi" }).click();
      });
    await page.waitForSelector("#righe");
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      "editor troppo largo",
    );
    await cliente.page.setViewportSize({ width: 360, height: 740 });
    await cliente.page.goto(linkAccettazione);
    await cliente.page.waitForSelector('.cp-successo, [data-azione="accetta"]');
    assert.ok(
      (await cliente.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      "pagina cliente troppo larga",
    );
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await passo("link modello dalle pagine SEO apre un preventivo precompilato", async () => {
    await page.goto(`${BASE}/app.html?mestiere=elettricista&modello=1`);
    await page.waitForSelector(`text=N. ${num(8)}`);
    assert.equal(await page.inputValue('[data-campo="oggetto"]'), "Adeguamento impianto elettrico appartamento");
    assert.equal(await page.locator(".riga").count(), 5);
  });

  await passo("elimina con conferma personalizzata (niente finestre del browser)", async () => {
    await page.click('[data-action="menu-preventivo"]');
    await page.click('[data-action="elimina-preventivo"]');
    await page.click('[data-esito="si"]');
    await page.waitForSelector("#lista-prev");
    assert.equal(await page.locator(".voce-lista", { hasText: num(8) }).count(), 0);
  });

  await passo("sicurezza: un backup costruito per attaccare l'app non esegue codice", async () => {
    const xss = '<img src=x onerror="window.__xss=1">';
    const file = path.join(tmp, "backup-ostile.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      file,
      JSON.stringify({
        app: "preventivolampo",
        preventivi: [
          { id: '"><svg onload=window.__xss=1>', righe: [] },
          {
            id: "ostile-1",
            numero: xss,
            data: "2026-10-06",
            stato: "inviato",
            cliente: { nome: xss, telefono: "javascript:alert(1)" },
            oggetto: xss,
            righe: [{ descrizione: xss, qta: 1, prezzo: 10, iva: 22, um: xss }],
            firma: { img: "javascript:alert(1)", nome: xss, data: "x" },
            foto: [{ id: "f", img: "javascript:alert(1)" }],
          },
        ],
        clienti: [{ id: "c", nome: xss }],
        listino: [{ id: "l", descrizione: xss, um: xss, prezzo: 1 }],
        kv: [
          {
            chiave: "azienda",
            valore: {
              onboarded: true,
              ragioneSociale: xss,
              logo: "javascript:alert(1)",
              colore: "red;}</style><script>window.__xss=1</script>",
            },
          },
        ],
      }),
    );
    await page.goto(`${BASE}/app.html#/impostazioni`);
    await page.setInputFiles("#file-backup", file);
    await page.click('[data-esito="si"]');
    await page.waitForSelector("#lista-prev");
    for (const h of ["#/", "#/clienti", "#/listino", "#/impostazioni"]) {
      await page.goto(`${BASE}/app.html${h}`);
      await page.waitForTimeout(200);
    }
    await page.goto(`${BASE}/app.html#/`);
    await page.locator(".voce-lista").first().click();
    await page.waitForSelector("#righe");
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__xss), undefined, "codice iniettato eseguito!");
    assert.equal(await page.locator('img[src^="javascript"]').count(), 0);
  });

  assert.deepEqual(errori, [], "errori nella pagina:\n" + errori.join("\n"));
  console.log(`\nTutti i ${passi.length} passi superati. File in ${tmp}`);
} catch (err) {
  await page.screenshot({ path: path.join(tmp, "errore.png"), fullPage: true }).catch(() => {});
  await cliente.page.screenshot({ path: path.join(tmp, "errore-cliente.png"), fullPage: true }).catch(() => {});
  console.error("\nFALLITO:", err.message, "\nScreenshot:", path.join(tmp, "errore.png"));
  if (errori.length) console.error("Errori:", errori);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
