// Ponte verso il telefono quando PreventivoLampo gira come app nativa (iOS e Android, con Capacitor).
// Sul web non carica niente: ogni funzione risponde "non disponibile" e l'app usa il browser come sempre.

// Lo stesso controllo che fa Capacitor: il ponte nativo è già nella pagina prima di qualsiasi script.
export const attiva = Boolean(globalThis.androidBridge || globalThis.webkit?.messageHandlers?.bridge);
export const piattaforma = !attiva ? "web" : globalThis.androidBridge ? "android" : "ios";

let core = null;
const plugin = new Map();

// Il plugin, o null se in questa app non c'è (così ogni chiamata ha la sua alternativa web).
// Attenzione: i plugin di Capacitor sono Proxy che rispondono a qualunque metodo, anche a "then". Restituiti
// da una funzione async verrebbero scambiati per promesse: per questo viaggiano dentro un contenitore { p }.
async function usa(nome) {
  if (!attiva) return null;
  core ??= import("../vendor/capacitor-core.js");
  const moduli = await core;
  const { Capacitor } = moduli;
  if (!Capacitor.isPluginAvailable(nome)) return null;
  if (!plugin.has(nome)) plugin.set(nome, { p: moduli[nome] || Capacitor.registerPlugin(nome) });
  return plugin.get(nome);
}

const annullato = (err) => /cancel|annull|dismiss/i.test(`${err?.message || ""} ${err?.code || ""}`);

// ------------------------------------------------------------------
// Link per i clienti: devono portare al sito, non all'indirizzo interno dell'app
// ------------------------------------------------------------------
export function basePubblica(sito) {
  return String(sito).replace(/\/*$/, "/");
}

// ------------------------------------------------------------------
// File: PDF, calendario, copie dei dati, Excel
// ------------------------------------------------------------------
const TIPI = { pdf: "application/pdf", ics: "text/calendar", csv: "text/csv", json: "application/json" };
const tipoDi = (nome, blob) => blob?.type?.split(";")[0] || TIPI[String(nome).split(".").pop().toLowerCase()] || "";

async function inBase64(blob) {
  const byte = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < byte.length; i += 0x8000) s += String.fromCharCode(...byte.subarray(i, i + 0x8000));
  return btoa(s);
}

async function scriviTemporaneo(blob, nome) {
  const fs = (await usa("Filesystem"))?.p;
  if (!fs) return null;
  const pulito =
    String(nome)
      .replace(/[^\w.-]+/g, "_")
      .slice(-120) || "file";
  const { uri } = await fs.writeFile({
    path: `condivisi/${pulito}`,
    data: await inBase64(blob),
    directory: "CACHE",
    recursive: true,
  });
  return uri;
}

// Foglio "Condividi" del telefono: WhatsApp, email, Salva in File/Drive... false se l'utente lo chiude.
export async function condividiFile(blob, nome, { titolo = nome, testo = "" } = {}) {
  const share = (await usa("Share"))?.p;
  const uri = share && (await scriviTemporaneo(blob, nome));
  if (!uri) throw new Error("Condivisione non disponibile su questo telefono");
  try {
    await share.share({ title: titolo, text: testo || undefined, files: [uri], dialogTitle: titolo });
    return true;
  } catch (err) {
    if (annullato(err)) return false; // ha chiuso il foglio: non è un errore
    throw err;
  }
}

// Apre il file con l'app del telefono (il PDF nel lettore PDF), oppure lo condivide se non si può.
export async function apriFile(blob, nome) {
  const opener = (await usa("FileOpener"))?.p;
  const uri = opener && (await scriviTemporaneo(blob, nome));
  if (!uri) return condividiFile(blob, nome);
  try {
    await opener.open({ filePath: uri, contentType: tipoDi(nome, blob), openWithDefault: true });
    return true;
  } catch {
    return condividiFile(blob, nome);
  }
}

export async function condividiTesto({ titolo = "", testo = "", url } = {}) {
  const share = (await usa("Share"))?.p;
  if (!share) return false;
  try {
    await share.share({ title: titolo || undefined, text: testo || undefined, url, dialogTitle: titolo || undefined });
  } catch (err) {
    if (!annullato(err)) throw err;
  }
  return true;
}

// ------------------------------------------------------------------
// Link esterni (WhatsApp, telefono, email, siti): li apre l'app giusta del telefono
// ------------------------------------------------------------------
function esterno(href) {
  try {
    const u = new URL(href, location.href);
    if (["tel:", "mailto:", "sms:", "whatsapp:"].includes(u.protocol)) return u.href;
    if ((u.protocol === "https:" || u.protocol === "http:") && u.origin !== location.origin) return u.href;
  } catch {
    /* indirizzo non valido: lo gestisce il browser */
  }
  return null;
}

export async function apriEsterno(url) {
  const launcher = (await usa("AppLauncher"))?.p;
  if (launcher) {
    try {
      await launcher.openUrl({ url });
      return true;
    } catch {
      /* nessuna app per questo link: ci prova la pagina */
    }
  }
  location.href = url;
  return false;
}

// ------------------------------------------------------------------
// Tasto Indietro di Android, link aperti dall'esterno, notifiche toccate
// ------------------------------------------------------------------
export async function alTastoIndietro(fn) {
  const app = (await usa("App"))?.p;
  await app?.addListener("backButton", (ev) => fn(Boolean(ev?.canGoBack)));
}

export async function riduci() {
  await (await usa("App"))?.p.minimizeApp();
}

// Un link dell'app toccato in WhatsApp (conferma firmata, avviso di pagamento) apre l'app.
export async function alLinkAperto(fn) {
  const app = (await usa("App"))?.p;
  if (!app) return;
  await app.addListener("appUrlOpen", (ev) => ev?.url && fn(ev.url));
  const lancio = await app.getLaunchUrl().catch(() => null);
  if (!lancio?.url) return;
  // L'app riaperta (o ricaricata) non deve rielaborare lo stesso link due volte.
  try {
    if (globalThis.sessionStorage.getItem("pl-link-avvio") === lancio.url) return;
    globalThis.sessionStorage.setItem("pl-link-avvio", lancio.url);
  } catch {
    /* senza sessionStorage si elabora comunque */
  }
  fn(lancio.url);
}

export async function alTornoInPrimoPiano(fn) {
  const app = (await usa("App"))?.p;
  await app?.addListener("resume", () => fn());
}

// ------------------------------------------------------------------
// Aspetto: barre di sistema e schermata di avvio
// ------------------------------------------------------------------
export async function barre(scuro) {
  // "DARK" = icone chiare per uno sfondo scuro.
  await (await usa("SystemBars"))?.p.setStyle({ style: scuro ? "DARK" : "LIGHT" }).catch(() => {});
}

export async function pronto() {
  await (await usa("SplashScreen"))?.p.hide({ fadeOutDuration: 200 }).catch(() => {});
}

// ------------------------------------------------------------------
// Vibrazione, appunti, schermo acceso
// ------------------------------------------------------------------
// I due schemi di ui.js: successo [16, 50, 28] ed errore [36, 60, 36].
export function vibra(schema) {
  usa("Haptics")
    .then((u) => {
      const h = u?.p;
      if (!h) return;
      if (Array.isArray(schema)) return h.notification({ type: schema[0] > 30 ? "ERROR" : "SUCCESS" });
      return h.impact({ style: Number(schema) >= 25 ? "MEDIUM" : "LIGHT" });
    })
    .catch(() => {});
}

export async function copia(testo) {
  const c = (await usa("Clipboard"))?.p;
  if (!c) return false;
  try {
    await c.write({ string: String(testo) });
    return true;
  } catch {
    return false;
  }
}

export async function incolla() {
  const c = (await usa("Clipboard"))?.p;
  if (!c) return null;
  try {
    const r = await c.read();
    return typeof r?.value === "string" ? r.value : "";
  } catch {
    return "";
  }
}

export async function schermoAcceso(acceso) {
  const k = (await usa("KeepAwake"))?.p;
  if (!k) return false;
  try {
    await (acceso ? k.keepAwake() : k.allowSleep());
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Rubrica: il cliente scelto dai contatti del telefono
// ------------------------------------------------------------------
export async function scegliContatto() {
  const c = (await usa("Contacts"))?.p;
  if (!c) return null;
  try {
    const { contact } = await c.pickContact({ projection: { name: true, phones: true, emails: true } });
    if (!contact) return null;
    const n = contact.name || {};
    const tel = (contact.phones || []).find((p) => p.isPrimary) || (contact.phones || [])[0];
    return {
      nome: (n.display || [n.given, n.family].filter(Boolean).join(" ") || "").trim(),
      telefono: (tel?.number || "").trim(),
      email: ((contact.emails || [])[0]?.address || "").trim(),
    };
  } catch (err) {
    if (annullato(err)) return null;
    throw err;
  }
}

// ------------------------------------------------------------------
// Dettatura: lo stesso modo di usarla della Web Speech API (quella che l'app usa nel browser)
// ------------------------------------------------------------------
export class RiconoscimentoNativo {
  constructor() {
    this.lang = "it-IT";
    this.interimResults = true;
    this.continuous = true;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this._testo = "";
    this._finito = false;
    this._annullato = false;
    this._ascolti = [];
  }

  async start() {
    const sr = (await usa("SpeechRecognition"))?.p;
    if (!sr) return this._errore("service-not-allowed");
    try {
      let permesso = await sr.checkPermissions();
      if (permesso.speechRecognition !== "granted") permesso = await sr.requestPermissions();
      if (permesso.speechRecognition !== "granted") return this._errore("not-allowed");
      this._ascolti = await Promise.all([
        sr.addListener("partialResults", (ev) => {
          const t = (ev?.matches || [])[0];
          if (!t || this._finito) return;
          this._testo = t;
          this._risultato(false);
        }),
        sr.addListener("listeningState", (ev) => {
          if (ev?.state === "stopped") this._fine();
        }),
        sr.addListener("error", (ev) => {
          const c = `${ev?.code || ""} ${ev?.message || ""}`;
          this._errore(
            /permission|denied|not.?allowed/i.test(c)
              ? "not-allowed"
              : /speech|match|timeout/i.test(c)
                ? "no-speech"
                : "network",
          );
        }),
      ]);
      await sr.start({ language: this.lang, partialResults: true, popup: false, maxResults: 1 });
    } catch (err) {
      this._errore(/permission|denied/i.test(err?.message || "") ? "not-allowed" : "network");
    }
  }

  async stop() {
    try {
      await (await usa("SpeechRecognition"))?.p.stop();
    } catch {
      /* già fermo */
    }
    this._fine();
  }

  abort() {
    this._annullato = true;
    this.stop();
  }

  _risultato(finale) {
    const voce = [{ transcript: this._testo }];
    voce.isFinal = finale;
    this.onresult?.({ results: [voce] });
  }

  _errore(codice) {
    if (this._finito) return;
    this.onerror?.({ error: codice });
    this._fine();
  }

  _fine() {
    if (this._finito) return;
    this._finito = true;
    if (this._testo && !this._annullato) this._risultato(true);
    for (const a of this._ascolti) a?.remove?.();
    this.onend?.();
  }
}

// ------------------------------------------------------------------
// Calendario: l'evento si apre già compilato nell'app Calendario del telefono
// ------------------------------------------------------------------
export async function creaEvento({
  titolo,
  inizio,
  fine,
  tuttoIlGiorno,
  luogo,
  descrizione,
  avvisoMinuti,
  settimanale,
}) {
  const cal = (await usa("CapacitorCalendar"))?.p;
  if (!cal) return false;
  try {
    await cal.createEventWithPrompt({
      title: titolo,
      startDate: inizio.getTime(),
      endDate: fine.getTime(),
      isAllDay: Boolean(tuttoIlGiorno),
      location: luogo || undefined,
      description: descrizione || undefined,
      alerts: Number.isFinite(avvisoMinuti) ? [avvisoMinuti] : undefined,
      recurrence: settimanale ? { frequency: "weekly", interval: 1 } : undefined,
    });
  } catch (err) {
    if (!annullato(err)) throw err;
  }
  return true;
}

// ------------------------------------------------------------------
// Avvisi locali (promemoria): programmati dal telefono, senza server
// ------------------------------------------------------------------
export async function statoAvvisi(chiedi = false) {
  const ln = (await usa("LocalNotifications"))?.p;
  if (!ln) return "non-disponibili";
  let s = await ln.checkPermissions();
  if (s.display !== "granted" && chiedi) s = await ln.requestPermissions();
  return s.display;
}

let canalePronto = false;
export async function programmaAvvisi(lista) {
  const ln = (await usa("LocalNotifications"))?.p;
  if (!ln || (await ln.checkPermissions()).display !== "granted") return false;
  if (piattaforma === "android" && !canalePronto) {
    await ln.createChannel({
      id: "promemoria",
      name: "Promemoria",
      description: "Pagamenti da controllare, lavori di domani, clienti da richiamare",
      importance: 4,
      visibility: 1,
    });
    canalePronto = true;
  }
  const { notifications: inAttesa = [] } = await ln.getPending();
  if (inAttesa.length) await ln.cancel({ notifications: inAttesa.map((n) => ({ id: n.id })) });
  if (!lista.length) return true;
  await ln.schedule({
    notifications: lista.map((a) => ({
      id: a.id,
      title: a.titolo,
      body: a.testo,
      largeBody: a.testo,
      schedule: a.ogniSettimana
        ? { on: a.ogniSettimana, allowWhileIdle: true }
        : { at: a.quando, allowWhileIdle: true },
      extra: { rotta: a.rotta },
      channelId: "promemoria",
      // Un promemoria può arrivare con qualche minuto di ritardo. Con l'orario esatto Android 12+ aprirebbe
      // la schermata "Sveglie e promemoria" a ogni riprogrammazione.
      isExactNotification: false,
      smallIcon: "ic_stat_lampo",
      iconColor: "#FFC21A",
      autoCancel: true,
    })),
  });
  return true;
}

export async function alToccoAvviso(fn) {
  const ln = (await usa("LocalNotifications"))?.p;
  await ln?.addListener("localNotificationActionPerformed", (ev) => {
    const rotta = ev?.notification?.extra?.rotta;
    if (typeof rotta === "string" && rotta.startsWith("#/")) fn(rotta);
  });
}

// ------------------------------------------------------------------
// Copia di sicurezza dei dati nella memoria dell'app (iOS e Android possono svuotare quella del browser)
// ------------------------------------------------------------------
const COPIE = ["preventivolampo-copia-1.json", "preventivolampo-copia-2.json"];
let prossimaCopia = 0;

export async function salvaCopia(dati) {
  const fs = (await usa("Filesystem"))?.p;
  if (!fs) return false;
  // Due file a turno: se il telefono si spegne mentre scrive, l'altro resta buono.
  const path = COPIE[prossimaCopia];
  prossimaCopia = 1 - prossimaCopia;
  await fs.writeFile({ path, data: JSON.stringify(dati), directory: "LIBRARY", encoding: "utf8" });
  return true;
}

export async function leggiCopia() {
  const fs = (await usa("Filesystem"))?.p;
  if (!fs) return null;
  let migliore = null;
  for (const [i, path] of COPIE.entries()) {
    try {
      const { data } = await fs.readFile({ path, directory: "LIBRARY", encoding: "utf8" });
      const dati = JSON.parse(data);
      if (dati?.app === "preventivolampo" && (!migliore || String(dati.esportatoIl) > String(migliore.esportatoIl))) {
        migliore = dati;
        prossimaCopia = 1 - i; // la prossima scrittura va sull'altro file
      }
    } catch {
      /* file assente o danneggiato */
    }
  }
  return migliore;
}

// ------------------------------------------------------------------
// Acquisti nell'app (App Store e Google Play, tramite RevenueCat)
// ------------------------------------------------------------------
let negozioPronto = null;
function negozio(chiave) {
  if (!attiva || !chiave) return Promise.resolve(null);
  negozioPronto ??= (async () => {
    const u = await usa("Purchases"); // il contenitore { p }, non il plugin (vedi usa)
    if (!u) return null;
    await u.p.configure({ apiKey: chiave });
    return u;
  })().catch(() => {
    negozioPronto = null;
    return null;
  });
  return negozioPronto;
}

// Ognuna restituisce null se gli acquisti nell'app non ci sono (chiave mancante o plugin assente).
export async function negozioCliente(chiave) {
  const u = await negozio(chiave);
  return u ? (await u.p.getCustomerInfo()).customerInfo : null;
}
export async function negozioOfferte(chiave) {
  const u = await negozio(chiave);
  return u ? u.p.getOfferings() : null;
}
export async function negozioAcquista(chiave, pacchetto) {
  const u = await negozio(chiave);
  return u ? (await u.p.purchasePackage({ aPackage: pacchetto })).customerInfo : null;
}
export async function negozioRipristina(chiave) {
  const u = await negozio(chiave);
  return u ? (await u.p.restorePurchases()).customerInfo : null;
}

// ------------------------------------------------------------------
// Installazione: link esterni, window.open e tastiera passano dal telefono
// ------------------------------------------------------------------
export function installa() {
  if (!attiva) return;
  document.documentElement.classList.add("nativa", `nativa-${piattaforma}`);
  // Un link esterno toccato: lo apre l'app giusta (WhatsApp, Telefono, Mail, browser) e non la WebView.
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest?.("a[href]");
      if (!a || a.hasAttribute("download")) return;
      const url = esterno(a.getAttribute("href"));
      if (!url) return;
      e.preventDefault();
      apriEsterno(url);
    },
    true,
  );
  const apriOriginale = window.open?.bind(window);
  window.open = (url, ...resto) => {
    if (!url) return null; // l'anteprima del PDF si apre con apriFile
    const u = esterno(String(url));
    if (u) {
      apriEsterno(u);
      return null;
    }
    return apriOriginale ? apriOriginale(url, ...resto) : null;
  };
}
