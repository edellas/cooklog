// Test dell'app nativa (iOS/Android) senza telefono: la cartella mobile/www (quella che finisce nelle app)
// gira in Chromium con un finto ponte Capacitor che registra ogni chiamata ai plugin del telefono.
// Così si verifica che l'app usi davvero condivisione, file, notifiche, tasto Indietro, link in arrivo,
// acquisti nello store e copia di sicurezza, con gli stessi dati che manderebbe ad Android e iOS.
// Uso: node scripts/prepara-www.mjs && node tests/nativo.e2e.mjs   (richiede playwright)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
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
const www = path.join(radice, "mobile", "www");
if (!existsSync(path.join(www, "vendor", "capacitor-core.js"))) {
  console.error("Manca mobile/www: esegui prima node scripts/prepara-www.mjs");
  process.exit(1);
}
const SITO = "https://preventivolampo.it";
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
  const file = path.join(www, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(www) || !existsSync(file)) return res.writeHead(404).end("404");
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

// ------------------------------------------------------------------
// Il finto telefono: ponte Capacitor con i plugin dell'app (stessi nomi e metodi dei pacchetti veri)
// ------------------------------------------------------------------
function telefonoFinto() {
  window.androidBridge = { postMessage() {} };
  const metodi = {
    App: ["getLaunchUrl", "minimizeApp", "exitApp"],
    Filesystem: ["writeFile", "readFile", "deleteFile"],
    Share: ["share", "canShare"],
    FileOpener: ["open"],
    AppLauncher: ["openUrl", "canOpenUrl"],
    Haptics: ["impact", "notification", "vibrate"],
    SplashScreen: ["hide", "show"],
    SystemBars: ["setStyle", "show", "hide"],
    Clipboard: ["write", "read"],
    KeepAwake: ["keepAwake", "allowSleep"],
    Contacts: ["pickContact"],
    SpeechRecognition: ["start", "stop", "checkPermissions", "requestPermissions"],
    CapacitorCalendar: ["createEventWithPrompt"],
    LocalNotifications: ["schedule", "cancel", "getPending", "checkPermissions", "requestPermissions", "createChannel"],
    Purchases: ["configure", "getOfferings", "purchasePackage", "restorePurchases", "getCustomerInfo"],
  };
  const registro = () => JSON.parse(sessionStorage.getItem("__registro") || "[]");
  const corto = (v) =>
    JSON.parse(
      JSON.stringify(v ?? null, (k, x) =>
        typeof x === "string" && (k === "data" ? x.length > 120 : x.length > 20000) ? `<${x.length}>` : x,
      ),
    );
  const fs = (o) => `__fs:${o.directory}:${o.path}`;
  const cliente = {
    entitlements: { active: { pro: { expirationDate: "2027-10-07T10:00:00Z" } } },
    managementURL: "https://play.google.com/store/account/subscriptions",
  };
  const risposte = {
    "App.getLaunchUrl": () => ({}),
    "Filesystem.writeFile": (o) => {
      localStorage.setItem(fs(o), o.data);
      return { uri: `file:///${o.directory.toLowerCase()}/${o.path}` };
    },
    "Filesystem.readFile": (o) => {
      const data = localStorage.getItem(fs(o));
      if (data == null) throw new Error("File does not exist.");
      return { data };
    },
    "LocalNotifications.checkPermissions": () => ({ display: sessionStorage.getItem("__notifiche") || "prompt" }),
    "LocalNotifications.requestPermissions": () => {
      sessionStorage.setItem("__notifiche", "granted");
      return { display: "granted" };
    },
    "LocalNotifications.getPending": () => ({
      notifications: JSON.parse(sessionStorage.getItem("__inattesa") || "[]"),
    }),
    "LocalNotifications.schedule": (o) => {
      sessionStorage.setItem("__inattesa", JSON.stringify(o.notifications.map((n) => ({ id: n.id }))));
      sessionStorage.setItem("__programmati", JSON.stringify(o.notifications));
      return { notifications: o.notifications.map((n) => ({ id: n.id })) };
    },
    "LocalNotifications.cancel": () => {
      sessionStorage.setItem("__inattesa", "[]");
      sessionStorage.setItem("__programmati", "[]");
      return {};
    },
    "SpeechRecognition.checkPermissions": () => ({ speechRecognition: "granted" }),
    "Contacts.pickContact": () => ({
      contact: {
        contactId: "1",
        name: { display: "Marta Rossi" },
        phones: [{ type: "mobile", number: "+39 333 999 8888" }],
        emails: [{ type: "home", address: "marta@example.com" }],
      },
    }),
    "Purchases.getCustomerInfo": () => ({ customerInfo: { entitlements: { active: {} } } }),
    "Purchases.getOfferings": () => ({
      current: {
        annual: { identifier: "$rc_annual", packageType: "ANNUAL", product: { priceString: "79,99 €" } },
        monthly: { identifier: "$rc_monthly", packageType: "MONTHLY", product: { priceString: "9,99 €" } },
        lifetime: null,
      },
    }),
    "Purchases.purchasePackage": () => ({ productIdentifier: "pro_annuale", customerInfo: cliente }),
    "Purchases.restorePurchases": () => ({ customerInfo: cliente }),
  };
  const ascolti = {};
  window.__emetti = (plugin, evento, dati) => (ascolti[`${plugin}.${evento}`] || []).forEach((cb) => cb(dati));
  window.Capacitor = {
    PluginHeaders: Object.entries(metodi).map(([name, m]) => ({
      name,
      methods: [
        ...m.map((x) => ({ name: x, rtype: "promise" })),
        { name: "addListener", rtype: "callback" },
        { name: "removeListener", rtype: "promise" },
        { name: "removeAllListeners", rtype: "promise" },
      ],
    })),
    nativePromise(plugin, metodo, opzioni) {
      sessionStorage.setItem(
        "__registro",
        JSON.stringify([...registro(), { plugin, metodo, opzioni: corto(opzioni) }]),
      );
      const r = risposte[`${plugin}.${metodo}`];
      return Promise.resolve().then(() => (typeof r === "function" ? r(opzioni) : (r ?? {})));
    },
    nativeCallback(plugin, metodo, opzioni, callback) {
      if (metodo === "addListener") {
        (ascolti[`${plugin}.${opzioni.eventName}`] ||= []).push(callback);
        sessionStorage.setItem(
          "__registro",
          JSON.stringify([...registro(), { plugin, metodo, opzioni: corto(opzioni) }]),
        );
      }
      return String(Math.random());
    },
  };
}

const browser = await playwright.chromium.launch();
const errori = [];
async function nuovoTelefono({ nativo = true, config = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "it-IT",
    acceptDownloads: true,
  });
  if (nativo) await context.addInitScript(telefonoFinto);
  await context.exposeBinding("__segnalaCSP", (_, v) => errori.push("CSP: " + v));
  await context.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__segnalaCSP(`${e.violatedDirective} ${e.blockedURI} ${location.pathname}`),
    ),
  );
  // Il sito pubblico (verifica licenza) e la configurazione con le chiavi dello store, se servono.
  await context.route(`${SITO}/**`, (route) => {
    const req = route.request();
    if (req.url() === `${SITO}/api/licenza`) {
      if (req.method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" },
        });
      const { chiave } = JSON.parse(req.postData() || "{}");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ valida: chiave === "PL-VALIDA-1234", email: "m***@example.com" }),
      });
    }
    errori.push("richiesta al sito non prevista: " + req.url());
    return route.abort();
  });
  if (config)
    await context.route(`${BASE}/js/config.js`, (route) =>
      route.fulfill({ contentType: "text/javascript", body: config }),
    );
  const page = await context.newPage();
  page.on("pageerror", (e) => errori.push("JS: " + e.message));
  page.on("console", (m) => m.type() === "error" && errori.push("console: " + m.text()));
  page.on("popup", (p) => errori.push("finestra aperta invece dell'app del telefono: " + p.url()));
  return { context, page };
}

const registro = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem("__registro") || "[]"));
const chiamate = async (p, plugin, metodo) =>
  (await registro(p)).filter((c) => c.plugin === plugin && (!metodo || c.metodo === metodo));
async function aspettaChiamata(p, plugin, metodo, prova = () => true) {
  for (let i = 0; i < 100; i++) {
    const trovate = (await chiamate(p, plugin, metodo)).filter((c) => prova(c.opzioni || {}));
    if (trovate.length) return trovate.at(-1);
    await p.waitForTimeout(100);
  }
  throw new Error(`Nessuna chiamata ${plugin}.${metodo}: ${JSON.stringify((await registro(p)).slice(-8))}`);
}
const emetti = (p, plugin, evento, dati) => p.evaluate((a) => window.__emetti(...a), [plugin, evento, dati]);
const programmati = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem("__programmati") || "[]"));
async function attendiAnimazioni(p) {
  await p.waitForFunction(() => !document.querySelector(".overlay.entra"));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}
async function firma(p, sel) {
  await p.locator(sel).waitFor();
  await attendiAnimazioni(p);
  const box = await p.locator(sel).boundingBox();
  await p.mouse.move(box.x + 20, box.y + box.height * 0.7);
  await p.mouse.down();
  for (let k = 0; k <= 36; k++)
    await p.mouse.move(box.x + 20 + k * 8, box.y + box.height * (0.5 + 0.25 * Math.sin(k / 3)));
  await p.mouse.up();
}
async function benvenuto(p) {
  await p.goto(`${BASE}/`);
  await p.click('[data-m="idraulico"]');
  await p.click('[data-action="onb-avanti"]');
  await p.fill("#b-nome", "Idraulica Rossi di Mario Rossi");
  await p.fill("#b-tel", "333 1234567");
  await p.fill("#b-citta", "Bergamo");
  await p.check('input[name="b-iva"][value="10"]');
  await p.click('[data-action="onb-dati"]');
  await p.waitForSelector("text=Facciamo il primo preventivo");
}

const passi = [];
const passo = async (nome, fn) => {
  await fn();
  passi.push(nome);
  console.log("ok -", nome);
};

const { context, page } = await nuovoTelefono();
let linkPubblico = "";
let idPreventivo = "";
let copiePrima = 0;

try {
  await passo(
    "avvio nell'app: schermata di avvio chiusa, barre del tema, ascolto di Indietro, link e avvisi",
    async () => {
      await page.goto(`${BASE}/`);
      await page.waitForSelector("text=Che lavoro fai?");
      await aspettaChiamata(page, "SplashScreen", "hide");
      await aspettaChiamata(page, "SystemBars", "setStyle", (o) => o.style === "LIGHT");
      await aspettaChiamata(page, "App", "addListener", (o) => o.eventName === "backButton");
      await aspettaChiamata(page, "App", "addListener", (o) => o.eventName === "appUrlOpen");
      await aspettaChiamata(page, "App", "getLaunchUrl");
      await aspettaChiamata(
        page,
        "LocalNotifications",
        "addListener",
        (o) => o.eventName === "localNotificationActionPerformed",
      );
      assert.ok(await page.evaluate(() => document.documentElement.classList.contains("nativa-android")));
      // niente service worker nell'app: i file sono già sul telefono
      assert.equal(
        await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.())?.length || 0),
        0,
      );
    },
  );

  await passo("primo preventivo: cliente dalla rubrica del telefono e voci dettate a voce", async () => {
    await benvenuto(page);
    await page.click('[data-action="fine-benvenuto"][data-modo="vuoto"]');
    await page.waitForSelector('[data-action="da-rubrica"]');
    idPreventivo = page.url().match(/#\/p\/([^?]+)/)[1];
    await page.click('[data-action="da-rubrica"]');
    await aspettaChiamata(page, "Contacts", "pickContact", (o) => o.projection?.name && o.projection?.phones);
    await page.waitForFunction(() => document.querySelector('[data-campo="cliente.nome"]').value === "Marta Rossi");
    assert.equal(await page.inputValue('[data-campo="cliente.telefono"]'), "+39 333 999 8888");
    await page.fill('[data-campo="oggetto"]', "Sostituzione miscelatore cucina");
    await page.click('[data-action="detta-righe"]');
    await page.waitForSelector("text=Sto ascoltando...");
    await aspettaChiamata(page, "SpeechRecognition", "start", (o) => o.language === "it-IT" && o.partialResults);
    await emetti(page, "SpeechRecognition", "partialResults", { matches: ["sostituzione miscelatore 85 euro"] });
    await page.waitForFunction(() => /miscelatore/.test(document.querySelector("#parziale")?.textContent || ""));
    await page.click('[data-action="detta-fine"]');
    await aspettaChiamata(page, "SpeechRecognition", "stop");
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-r="descrizione"]')].some((i) => /miscelatore/i.test(i.value)),
    );
    const prezzo = page.locator('[data-r="prezzo"]').first();
    if (!(await prezzo.inputValue())) await prezzo.fill("85");
    await page.waitForTimeout(500);
  });

  await passo("PDF: si apre nel lettore del telefono (file temporaneo, niente download)", async () => {
    await page.click('[data-action="menu-preventivo"]');
    await attendiAnimazioni(page);
    await page.click('#foglio [data-action="anteprima"]');
    const aperto = await aspettaChiamata(page, "FileOpener", "open");
    assert.equal(aperto.opzioni.contentType, "application/pdf");
    assert.match(aperto.opzioni.filePath, /^file:\/\/\/cache\/condivisi\/.+\.pdf$/);
    const scritto = await aspettaChiamata(page, "Filesystem", "writeFile", (o) => o.directory === "CACHE");
    assert.match(scritto.opzioni.data, /^<\d+>$/, "il PDF viaggia in base64");
  });

  await passo(
    "invio: link per il cliente sul sito pubblico, WhatsApp aperto dal telefono, avvisi attivati",
    async () => {
      await page.click('[data-action="invia"]');
      await page.waitForSelector("#invio-wa");
      await attendiAnimazioni(page);
      const href = await page.getAttribute("#invio-wa", "href");
      assert.ok(href.startsWith("https://wa.me/393339998888?text="), href);
      linkPubblico = new URL(href).searchParams.get("text").match(/https?:\/\/\S+/)[0];
      assert.ok(
        linkPubblico.startsWith(`${SITO}/accetta.html#z`),
        `il cliente deve ricevere il link del sito: ${linkPubblico}`,
      );
      // "Come lo vede lui" resta nell'app: la pagina del cliente è anche sul telefono
      const guarda = page.locator('[data-action="guarda-cliente"]');
      assert.ok((await guarda.getAttribute("href")).startsWith(`${BASE}/accetta.html#z`));
      assert.equal(await guarda.getAttribute("target"), null);
      await page.click("#invio-wa");
      const wa = await aspettaChiamata(page, "AppLauncher", "openUrl", (o) => o.url?.startsWith("https://wa.me/"));
      assert.equal(wa.opzioni.url, href);
      await page.waitForSelector("text=Ecco cosa succede adesso");
      await attendiAnimazioni(page);
      await page.click('[data-action="attiva-avvisi"]');
      await aspettaChiamata(page, "LocalNotifications", "requestPermissions");
      await aspettaChiamata(page, "LocalNotifications", "schedule");
      const avvisi = await programmati(page);
      const risposta = avvisi.find((a) => a.title === "Marta Rossi non ha ancora risposto");
      assert.ok(risposta, JSON.stringify(avvisi));
      assert.equal(risposta.extra.rotta, `#/p/${idPreventivo}`);
      assert.equal(risposta.smallIcon, "ic_stat_lampo");
    // niente orario esatto: Android 12+ altrimenti chiederebbe il permesso "Sveglie e promemoria" ogni volta
    assert.equal(risposta.isExactNotification, false);
      assert.ok(Date.parse(risposta.schedule.at) > Date.now());
      await aspettaChiamata(page, "LocalNotifications", "createChannel", (o) => o.id === "promemoria");
      await aspettaChiamata(page, "Haptics", "notification", (o) => o.type === "SUCCESS");
    },
  );

  await passo("altri modi: il PDF va nel foglio Condividi del telefono", async () => {
    await page.waitForSelector("#foglio", { state: "detached" });
    await page.click('[data-action="invia"]');
    await page.waitForSelector(".altri-modi");
    await attendiAnimazioni(page);
    await page.click(".altri-modi > summary");
    await page.click('[data-action="invio-condividi"]');
    const condiviso = await aspettaChiamata(page, "Share", "share", (o) => o.files?.length === 1);
    assert.match(condiviso.opzioni.files[0], /^file:\/\/\/cache\/condivisi\/.+\.pdf$/);
    assert.match(condiviso.opzioni.text, /Marta Rossi/);
    await page.waitForSelector("#foglio", { state: "detached" });
  });

  await passo("conferma del cliente toccata in WhatsApp: l'app si apre sulla firma da registrare", async () => {
    // il cliente firma dal suo telefono (browser, senza app)
    const { context: c2, page: cliente } = await nuovoTelefono({ nativo: false });
    await cliente.goto(`${BASE}/accetta.html#${linkPubblico.split("#")[1]}`);
    await cliente.click('[data-azione="accetta"]');
    await firma(cliente, "#acc-firma");
    await cliente.check("#acc-ok");
    await cliente.click('[data-azione="conferma"]');
    await cliente.waitForSelector("#cp-invia-wa");
    const testo = new URL(await cliente.getAttribute("#cp-invia-wa", "href")).searchParams.get("text");
    const d = testo.match(/\?d=([A-Za-z0-9_-]+)/)[1];
    await c2.close();
    // sul telefono dell'artigiano il link del sito apre l'app (App Links / Universal Links)
    await emetti(page, "App", "appUrlOpen", { url: `${SITO}/app.html#/accettazione?d=${d}` });
    await page.waitForSelector('[data-action="registra-accettazione"]');
    assert.match(await page.textContent("main"), /Marta Rossi ha accettato/);
    assert.match(await page.textContent("main"), /esattamente/);
    // anche con lo schema dell'app (pulsante "Apri nell'app" della pagina web)
    await page.goto(`${BASE}/#/p/${idPreventivo}`);
    await page.waitForSelector('[data-action="invia"]');
    await emetti(page, "App", "appUrlOpen", { url: `preventivolampo://app.html#/accettazione?d=${d}` });
    await page.waitForSelector('[data-action="registra-accettazione"]');
  });

  await passo("firma al tavolo: pagina del cliente dentro l'app, schermo acceso, firma registrata", async () => {
    await page.goto(`${BASE}/#/p/${idPreventivo}`);
    await page.click('[data-action="invia"]');
    await page.waitForSelector(".invio-tavolo");
    await attendiAnimazioni(page);
    await Promise.all([page.waitForURL(/\/accetta\.html\?presenta=1#z/), page.click(".invio-tavolo")]);
    assert.ok(page.url().startsWith(`${BASE}/accetta.html`), "la firma al tavolo resta nell'app: " + page.url());
    await page.waitForSelector('[data-azione="esci-presenta"]');
    await aspettaChiamata(page, "KeepAwake", "keepAwake");
    await page.click('[data-azione="accetta"]');
    await firma(page, "#acc-firma");
    await page.check("#acc-ok");
    await page.click('[data-azione="conferma"]');
    await page.waitForSelector("text=Fatto, grazie Marta Rossi!");
    await Promise.all([page.waitForURL(/\/app\.html#\/accettazione/), page.click('[data-azione="registra-qui"]')]);
    await aspettaChiamata(page, "KeepAwake", "allowSleep");
    await page.click('[data-action="registra-accettazione"]');
    await page.waitForSelector("text=Marta Rossi ha firmato!");
    await attendiAnimazioni(page);
    await page.click('.festa [data-action="chiudi-foglio"]');
    await page.waitForSelector("text=Firmato sul posto da Marta Rossi");
  });

  await passo("data di inizio: l'evento si apre già compilato nel Calendario del telefono", async () => {
    // firmato: voci bloccate, ma la data si fissa dal riquadro in alto
    await page.click('.banner.ok [data-action="fissa-data"]');
    await page.waitForSelector("#app-data");
    await attendiAnimazioni(page);
    const domani = await page.inputValue("#app-data");
    await page.selectOption("#app-fascia", "pomeriggio");
    await page.click('[data-action="app-salva"]');
    await page.waitForSelector('.banner.ok [data-action="appuntamento-ics"]');
    await page.click('.banner.ok [data-action="appuntamento-ics"]');
    const evento = await aspettaChiamata(page, "CapacitorCalendar", "createEventWithPrompt");
    const inizio = new Date(evento.opzioni.startDate);
    assert.equal(inizio.getHours(), 14);
    assert.equal(
      `${inizio.getFullYear()}-${String(inizio.getMonth() + 1).padStart(2, "0")}-${String(inizio.getDate()).padStart(2, "0")}`,
      domani,
    );
    assert.equal(evento.opzioni.isAllDay, false);
    assert.match(evento.opzioni.title, /Marta Rossi/);
    // e la sera prima arriva l'avviso del lavoro
    await page.waitForFunction(
      () =>
        JSON.parse(sessionStorage.getItem("__programmati") || "[]").some(
          (a) => a.title === "Domani: lavoro da Marta Rossi",
        ),
      null,
      { timeout: 10000 },
    );
  });

  await passo("tasto Indietro di Android: chiude il foglio, poi torna alla home, dalla home riduce l'app", async () => {
    await page.click('[data-action="menu-preventivo"]');
    await page.waitForSelector("#foglio");
    await emetti(page, "App", "backButton", { canGoBack: true });
    await page.waitForSelector("#foglio", { state: "detached" });
    await emetti(page, "App", "backButton", { canGoBack: false });
    await page.waitForFunction(() => location.hash === "#/" || location.hash === "");
    await page.waitForSelector("text=Da fare");
    await emetti(page, "App", "backButton", { canGoBack: false });
    await aspettaChiamata(page, "App", "minimizeApp");
  });

  await passo("avviso toccato: si apre la pagina giusta", async () => {
    await emetti(page, "LocalNotifications", "localNotificationActionPerformed", {
      actionId: "tap",
      notification: { id: 1, extra: { rotta: `#/p/${idPreventivo}?sez=incassi` } },
    });
    await page.waitForFunction((id) => location.hash.startsWith(`#/p/${id}`), idPreventivo);
    await page.waitForSelector("#sezione-incassi:not([hidden])");
    // una rotta strana nell'avviso viene ignorata
    await emetti(page, "LocalNotifications", "localNotificationActionPerformed", {
      notification: { extra: { rotta: "javascript:alert(1)" } },
    });
    await page.waitForTimeout(300);
    assert.ok(page.url().includes(`#/p/${idPreventivo}`));
  });

  await passo("impostazioni: avvisi del venerdì, privacy aperta nel browser del telefono", async () => {
    await page.goto(`${BASE}/#/impostazioni`);
    await page.click('details[data-sez="promemoria"] > summary');
    assert.equal(await page.isChecked("#pref-avvisi"), true);
    await page.check("#pref-avvisi-conti");
    await page.waitForFunction(() =>
      JSON.parse(sessionStorage.getItem("__programmati") || "[]").some(
        (a) => a.schedule?.on?.weekday === 6 && a.schedule.on.hour === 17 && a.schedule.on.minute === 30,
      ),
    );
    await page.click("text=Privacy");
    await aspettaChiamata(page, "AppLauncher", "openUrl", (o) => o.url === `${SITO}/privacy.html`);
    assert.ok(page.url().includes("#/impostazioni"), "la pagina dell'app non deve cambiare");
  });

  await passo(
    "Pro senza acquisti configurati: nessun prezzo né pagamento esterno, codice dal sito verificato",
    async () => {
      await page.goto(`${BASE}/#/pro`);
      await page.waitForSelector("text=non sono ancora attivi");
      const testo = await page.textContent("main");
      assert.ok(!/9,90|79 €|Scegli/.test(testo), "nell'app niente prezzi del sito: " + testo);
      assert.equal(await page.locator('[data-action="checkout"]').count(), 0);
      copiePrima = (await chiamate(page, "Filesystem", "writeFile")).filter(
        (c) => c.opzioni.directory === "LIBRARY",
      ).length;
      await page.fill("#chiave", "PL-VALIDA-1234");
      const [richiesta] = await Promise.all([
        page.waitForRequest((r) => r.url() === `${SITO}/api/licenza` && r.method() === "POST"),
        page.click('[data-action="attiva-licenza"]'),
      ]);
      assert.equal(JSON.parse(richiesta.postData()).chiave, "PL-VALIDA-1234");
      await page.waitForSelector("text=Pro attivo");
    },
  );

  await passo("copia di sicurezza: se il telefono svuota la memoria del browser, i dati tornano", async () => {
    // la copia scritta dopo l'attivazione di Pro (si aggiorna 2,5 secondi dopo l'ultima modifica)
    await page.waitForFunction(
      (n) =>
        JSON.parse(sessionStorage.getItem("__registro") || "[]").filter(
          (c) => c.plugin === "Filesystem" && c.metodo === "writeFile" && c.opzioni?.directory === "LIBRARY",
        ).length > n,
      copiePrima,
      { timeout: 10000 },
    );
    const ultima = (await chiamate(page, "Filesystem", "writeFile"))
      .filter((c) => c.opzioni.directory === "LIBRARY")
      .at(-1);
    assert.match(ultima.opzioni.path, /^preventivolampo-copia-[12]\.json$/);
    assert.equal(ultima.opzioni.encoding, "utf8");
    await page.goto(`${BASE}/img/icona.svg`);
    await page.evaluate(
      () =>
        new Promise((ok, ko) => {
          const r = indexedDB.deleteDatabase("preventivolampo");
          r.onsuccess = ok;
          r.onerror = ko;
          r.onblocked = () => ko(new Error("archivio ancora aperto"));
        }),
    );
    await page.goto(`${BASE}/`);
    await page.waitForSelector("text=Ho ripreso i tuoi preventivi");
    await page.waitForSelector(".voce-lista >> text=Marta Rossi");
    // anche la licenza Pro
    await page.goto(`${BASE}/#/pro`);
    await page.waitForSelector("text=Pro attivo");
  });

  await passo("acquisti nello store (RevenueCat): prezzi dallo store, acquisto, gestione abbonamento", async () => {
    const config = readFileSync(path.join(www, "js", "config.js"), "utf8").replace(
      'revenuecatAndroid: ""',
      'revenuecatAndroid: "goog_prova"',
    );
    assert.ok(config.includes("goog_prova"));
    const { context: c3, page: p3 } = await nuovoTelefono({ config });
    await benvenuto(p3);
    await p3.click('[data-action="fine-benvenuto"][data-modo="home"]');
    await p3.waitForSelector("text=Nuovo preventivo");
    await aspettaChiamata(p3, "Purchases", "configure", (o) => o.apiKey === "goog_prova");
    await p3.goto(`${BASE}/#/pro`);
    await p3.waitForSelector("text=79,99 €");
    assert.match(await p3.textContent("#piani"), /Annuale[\s\S]*79,99 €[\s\S]*Mensile[\s\S]*9,99 €/);
    assert.match(await p3.textContent("main"), /Paghi con il tuo account Google Play/);
    await p3.click('[data-pacchetto="$rc_annual"]');
    const acquisto = await aspettaChiamata(p3, "Purchases", "purchasePackage");
    assert.equal(acquisto.opzioni.aPackage.identifier, "$rc_annual");
    await p3.waitForSelector("text=Pro attivo · Google Play");
    await p3.click("text=Gestisci abbonamento");
    await aspettaChiamata(
      p3,
      "AppLauncher",
      "openUrl",
      (o) => o.url === "https://play.google.com/store/account/subscriptions",
    );
    await c3.close();
  });

  assert.deepEqual(errori, [], "errori nell'app:\n" + errori.join("\n"));
  console.log(`\nTutti i ${passi.length} passi dell'app nativa superati.`);
} catch (err) {
  await page.screenshot({ path: path.join(tmpdir(), "pl-errore-nativo.png"), fullPage: true }).catch(() => {});
  console.error("Screenshot:", path.join(tmpdir(), "pl-errore-nativo.png"));
  console.error("\nFALLITO:", err.message, "\nErrori raccolti:\n" + errori.join("\n"));
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close();
  server.close();
}
