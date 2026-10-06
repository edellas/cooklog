// Modalità anteprima: serve solo alla pagina dimostrativa pubblicata su claude.ai.
// Viene pubblicata come js/anteprima.js accanto ai file veri dell'app e fa da punto di ingresso:
// prepara l'ambiente e poi carica app.js (o accetta.js sulla pagina del cliente).
//
// La cornice di claude.ai blocca download, finestre nuove e service worker, quindi qui:
// - all'apertura carica dati di esempio (preventivi, clienti, listino), se l'archivio è vuoto;
// - i PDF si aprono in un visualizzatore dentro la pagina invece di essere scaricati;
// - "Prova come il cliente" apre la pagina di accettazione nella stessa finestra e
//   "Torna all'app" riporta la conferma firmata all'artigiano, senza passare da WhatsApp;
// - una barra in alto permette di ricaricare l'esempio, ricominciare da zero e provare Pro.
import { db } from "./store.js";
import * as core from "./core.js";
import { trovaMestiere, vociListino } from "./mestieri.js";
import { codificaTratti, decodificaTratti, trattiInPng } from "./firma.js";

const PDFJS = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/",
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/",
];
const paginaCliente = document.body.classList.contains("pagina-cliente");
document.documentElement.lang = "it";

const memoria = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* archiviazione non disponibile */
    }
  },
};

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ------------------------------------------------------------------
// Stile della barra e del visualizzatore (usa i token dell'app)
// ------------------------------------------------------------------
const stile = document.createElement("style");
stile.textContent = `
:root { --plb-bg: #0f172a; --plb-fg: #f1f5f9; --plb-linea: rgba(241, 245, 249, 0.28); --plb-hover: rgba(241, 245, 249, 0.12); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --plb-bg: #1c2433; } }
:root[data-theme="dark"] { --plb-bg: #1c2433; }
.pl-barra { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 7px 16px; background: var(--plb-bg); color: var(--plb-fg); font-size: 12.5px; font-weight: 600; }
.pl-barra b { flex: none; letter-spacing: 0.07em; text-transform: uppercase; font-size: 10.5px; padding: 3px 7px; border-radius: 99px; background: var(--amber); color: #111; }
.pl-barra span { flex: 1; min-width: 0; opacity: 0.8; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-barra button { flex: none; border: 1px solid var(--plb-linea); background: transparent; color: var(--plb-fg); border-radius: 9px; padding: 5px 9px; font: inherit; cursor: pointer; }
.pl-barra button:hover { background: var(--plb-hover); }
.pl-barra button[aria-pressed="true"] { background: var(--amber); border-color: var(--amber); color: #111; }
@media (max-width: 520px) { .pl-barra .lungo { display: none; } }
.pl-visore { position: fixed; inset: 0; z-index: 400; background: var(--bg); display: flex; flex-direction: column; }
.pl-visore header { display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px; border-bottom: 1px solid var(--line); background: var(--surface); }
.pl-visore header strong { flex: 1; min-width: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-visore .pagine { flex: 1; overflow: auto; padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 14px; align-items: center; }
.pl-visore canvas { width: 100%; max-width: 820px; height: auto; background: #fff; border-radius: 6px; box-shadow: var(--sh-2); }
.pl-visore .nota { max-width: 560px; margin: 0; color: var(--muted); font-size: 13.5px; text-align: center; }
.pl-visore .messaggio { max-width: 560px; width: 100%; white-space: pre-line; overflow-wrap: anywhere; }
.pl-visore .btn { max-width: 560px; width: 100%; justify-content: center; text-align: center; }
.pl-entra { margin-bottom: 6px; }
`;
document.head.appendChild(stile);

// ------------------------------------------------------------------
// Dati di esempio (chiaramente marcati come esempio)
// ------------------------------------------------------------------
const AZIENDA_ESEMPIO = {
  onboarded: true,
  mestiere: "idraulico",
  ragioneSociale: "Idraulica Esempio di Mario Rossi",
  indirizzo: "Via Roma 1",
  cap: "24121",
  citta: "Bergamo",
  provincia: "BG",
  piva: "01234567890",
  telefono: "333 1234567",
  email: "info@idraulicaesempio.it",
  iban: "IT60 X054 2811 1010 0000 0123 456",
  intestatarioIban: "Mario Rossi",
  regime: "ordinario",
  ivaDefault: 10,
  giorniRicontatto: 3,
  validitaGiorni: 30,
  pagamento: "Acconto del 30% all'accettazione, saldo a fine lavori tramite bonifico bancario.",
  condizioni:
    "Il preventivo comprende esclusivamente le voci indicate. Eventuali lavori aggiuntivi o imprevisti saranno concordati e preventivati a parte.",
};

function trattiFirma(seme) {
  const tratti = [];
  let x = 70;
  for (let s = 0; s < 3; s++) {
    const punti = [];
    const larghezza = 180 + ((seme * (s + 3)) % 90);
    for (let k = 0; k <= 30; k++) {
      const t = k / 30;
      punti.push({ x: x + t * larghezza, y: 230 + Math.sin(t * Math.PI * (2 + s) + seme) * (60 - s * 12) - t * 40 });
    }
    tratti.push(punti);
    x += larghezza + 30;
  }
  return decodificaTratti(codificaTratti(tratti));
}

function creaEsempio() {
  const ora = Date.now();
  const giorno = 864e5;
  const m = trovaMestiere("idraulico");
  const listino = vociListino(m).map((v) => ({
    id: core.uid(),
    ...v,
    iva: 10,
    costo: v.tipo === "mat" ? Math.round(v.prezzo * 0.6) : 0,
  }));
  const voce = (descr) => listino.find((v) => v.descrizione === descr);
  const clienti = [];
  const preventivi = [];
  let progressivo = 0;

  function aggiungi(giorniFa, cliente, oggetto, voci, extra = {}) {
    const d = new Date(ora - giorniFa * giorno);
    const anno = d.getFullYear();
    progressivo++;
    const c = { id: core.uid(), createdAt: d.getTime(), updatedAt: d.getTime(), ...cliente };
    clienti.push(c);
    const p = core.preventivoVuoto(
      AZIENDA_ESEMPIO,
      { anno, progressivo, numero: `${anno}-${String(progressivo).padStart(3, "0")}` },
      core.oggiISO(d),
    );
    Object.assign(p, {
      clienteId: c.id,
      cliente: {
        nome: c.nome,
        indirizzo: c.indirizzo || "",
        citta: c.citta || "",
        cfpiva: "",
        telefono: c.telefono || "",
        email: "",
      },
      oggetto,
      righe: voci.map(([descr, qta, opzionale]) =>
        core.rigaVuota(10, { ...voce(descr), qta, opzionale: Boolean(opzionale) }),
      ),
      acconto: { tipo: "perc", valore: 30 },
      tempi: "2 giorni lavorativi dall'accettazione",
      createdAt: d.getTime(),
      updatedAt: d.getTime(),
      ...extra,
    });
    preventivi.push(p);
    return p;
  }

  const firma = (nome, giorniFa, seme, online = false) => ({
    img: trattiInPng(trattiFirma(seme)),
    nome,
    luogo: "Bergamo",
    data: new Date(ora - giorniFa * giorno).toISOString(),
    online,
  });

  aggiungi(
    150,
    { nome: "Condominio Via Verdi 12", indirizzo: "Via Verdi 12", citta: "24121 Bergamo (BG)", telefono: "035 123456" },
    "Sostituzione colonna di scarico condominiale",
    [
      ["Diritto di chiamata / uscita", 1],
      ["Manodopera idraulico", 8],
      ["Materiale di consumo (raccordi, guarnizioni, teflon)", 3],
    ],
    { stato: "accettato", inviatoIl: ora - 149 * giorno, firma: firma("Amministratore", 147, 2) },
  );
  aggiungi(
    110,
    { nome: "Paolo Conti", citta: "Seriate (BG)", telefono: "347 1110001" },
    "Sostituzione scaldabagno elettrico",
    [
      ["Installazione scaldabagno elettrico 80 L (manodopera)", 1],
      ["Scaldabagno elettrico 80 L", 1],
    ],
    { stato: "rifiutato", inviatoIl: ora - 109 * giorno },
  );
  aggiungi(
    70,
    { nome: "Anna Ferri", citta: "Bergamo", telefono: "347 1110002" },
    "Ricerca e riparazione perdita cucina",
    [
      ["Ricerca perdita con rilevatore", 1],
      ["Manodopera idraulico", 2],
      ["Materiale di consumo (raccordi, guarnizioni, teflon)", 1],
    ],
    { stato: "accettato", inviatoIl: ora - 69 * giorno, firma: firma("Anna Ferri", 68, 5) },
  );
  aggiungi(
    35,
    { nome: "Marco Galli", citta: "Dalmine (BG)", telefono: "347 1110003" },
    "Sostituzione cassetta WC esterna",
    [
      ["Diritto di chiamata / uscita", 1],
      ["Sostituzione cassetta di scarico WC esterna", 1],
    ],
    { stato: "accettato", inviatoIl: ora - 34 * giorno, firma: firma("Marco Galli", 33, 7) },
  );
  aggiungi(
    6,
    { nome: "Luca Verdi", citta: "Bergamo", telefono: "320 1112222" },
    "Sostituzione miscelatore e disostruzione scarico",
    [
      ["Sostituzione miscelatore lavabo (manodopera)", 1],
      ["Miscelatore lavabo monocomando", 1],
      ["Disostruzione scarico lavello", 1],
    ],
    { stato: "inviato", inviatoIl: ora - 5 * giorno },
  );
  aggiungi(
    2,
    { nome: "Sara Neri", citta: "Treviolo (BG)", telefono: "320 1113333" },
    "Bagno ospiti: sostituzione sifone e cassetta",
    [
      ["Sostituzione sifone lavabo", 1],
      ["Sostituzione cassetta di scarico WC esterna", 1],
      ["Materiale di consumo (raccordi, guarnizioni, teflon)", 1],
    ],
    { stato: "inviato", inviatoIl: ora - 1 * giorno },
  );
  aggiungi(
    1,
    { nome: "Giulia Bianchi", indirizzo: "Via Garibaldi 8", citta: "24122 Bergamo (BG)", telefono: "347 7654321" },
    "Sostituzione miscelatore e riparazione scarico bagno",
    [
      ["Diritto di chiamata / uscita", 1],
      ["Sostituzione miscelatore lavabo (manodopera)", 1],
      ["Miscelatore lavabo monocomando", 1],
      ["Sostituzione sifone lavabo", 1],
    ],
    {
      stato: "accettato",
      inviatoIl: ora - 1 * giorno,
      firma: firma("Giulia Bianchi", 0, 3, true),
      accettazioneOnline: { il: ora - 3600e3, hash: "esempio", facoltativeAggiunte: ["Sostituzione sifone lavabo"] },
    },
  );
  aggiungi(
    0,
    { nome: "Davide Russo", citta: "Bergamo", telefono: "347 1114444" },
    "Installazione nuovo scaldabagno 80 L",
    [
      ["Diritto di chiamata / uscita", 1],
      ["Installazione scaldabagno elettrico 80 L (manodopera)", 1],
      ["Scaldabagno elettrico 80 L", 1],
      ["Ricerca perdita con rilevatore", 1, true],
    ],
  );
  return { listino, clienti, preventivi };
}

async function svuota() {
  for (const s of ["preventivi", "clienti", "listino", "kv"]) await db.svuota(s);
}

async function caricaEsempio() {
  await svuota();
  const { listino, clienti, preventivi } = creaEsempio();
  await db.set("azienda", AZIENDA_ESEMPIO);
  for (const v of listino) await db.salva("listino", v);
  for (const c of clienti) await db.salva("clienti", c);
  for (const p of preventivi) await db.salva("preventivi", p);
  memoria.set("pl-anteprima-modo", "esempio");
}

// ------------------------------------------------------------------
// Visualizzatore PDF dentro la pagina (i download sono bloccati)
// ------------------------------------------------------------------
function caricaScript(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error("Impossibile caricare " + src));
    document.head.appendChild(s);
  });
}

let pdfjs = null;
async function caricaDa(base) {
  await caricaScript(base + "pdf.min.js");
  // Il "worker" di pdf.js gira nella pagina stessa: i worker da altri siti non sono permessi.
  await caricaScript(base + "pdf.worker.min.js");
  globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
  return globalThis.pdfjsLib;
}
function caricaPdfJs() {
  if (!pdfjs) {
    pdfjs = caricaDa(PDFJS[0])
      .catch(() => caricaDa(PDFJS[1]))
      .catch((err) => {
        pdfjs = null;
        throw err;
      });
  }
  return pdfjs;
}

function apriVisore(titolo, nota) {
  chiudiVisore();
  const v = document.createElement("div");
  v.className = "pl-visore";
  v.id = "pl-visore";
  v.setAttribute("role", "dialog");
  v.setAttribute("aria-label", titolo);
  v.innerHTML = `<header><strong>${esc(titolo)}</strong><button class="btn small" id="pl-chiudi-visore">Chiudi</button></header>
    <div class="pagine"><p class="nota">${esc(nota)}</p></div>`;
  document.body.appendChild(v);
  document.getElementById("pl-chiudi-visore").addEventListener("click", chiudiVisore);
  return v.querySelector(".pagine");
}

function chiudiVisore() {
  document.getElementById("pl-visore")?.remove();
}

async function mostraPdf(blob, nome) {
  const pagine = apriVisore(
    nome,
    "Anteprima del PDF. Nell'app pubblicata questo file si scarica o si condivide su WhatsApp.",
  );
  try {
    const lib = await caricaPdfJs();
    const doc = await lib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const larghezza = Math.min(pagine.clientWidth - 32, 820);
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const scala = (larghezza / base.width) * Math.min(window.devicePixelRatio || 1, 2);
      const vista = pagina.getViewport({ scale: scala });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vista.width);
      canvas.height = Math.floor(vista.height);
      canvas.setAttribute("aria-label", `Pagina ${n} di ${doc.numPages}`);
      pagine.appendChild(canvas);
      await pagina.render({ canvasContext: canvas.getContext("2d"), viewport: vista }).promise;
    }
  } catch {
    pagine.innerHTML = `<p class="nota">Il PDF "${esc(nome)}" è stato creato (${Math.round(blob.size / 1024)} KB), ma in questa anteprima non si riesce a mostrarlo. Nell'app pubblicata si apre normalmente.</p>`;
  }
}

function avviso(titolo, testo) {
  const pagine = apriVisore(titolo, testo);
  pagine.style.justifyContent = "center";
}

// I download partono con <a download href="blob:...">.click(): qui li intercettiamo.
// I blob si ricordano alla creazione dell'indirizzo, così non serve rileggerli con fetch.
const blobCreati = new Map();
const creaUrlOriginale = URL.createObjectURL;
const revocaUrlOriginale = URL.revokeObjectURL;
URL.createObjectURL = function (oggetto) {
  const url = creaUrlOriginale.call(URL, oggetto);
  if (oggetto instanceof Blob) blobCreati.set(url, oggetto);
  return url;
};
URL.revokeObjectURL = function (url) {
  blobCreati.delete(url);
  return revocaUrlOriginale.call(URL, url);
};

const clickOriginale = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (this.hasAttribute("download") && /^blob:/.test(this.href)) {
    const nome = this.download || "file";
    const blob = blobCreati.get(this.href);
    if (!blob) avviso("File non disponibile", "Riprova dall'app.");
    else if (blob.type === "application/pdf" || /\.pdf$/i.test(nome)) mostraPdf(blob, nome);
    else
      avviso(
        "File non scaricabile nell'anteprima",
        `Nell'app pubblicata questo pulsante salva il file "${nome}" sul telefono.`,
      );
    return;
  }
  return clickOriginale.call(this);
};

// I numeri dei dati di esempio sono inventati ma potrebbero esistere: nell'anteprima nessun link
// WhatsApp, email, telefono o SMS parte davvero. Il messaggio viene mostrato nella pagina e,
// se si vuole provarlo, si apre WhatsApp senza destinatario (lo sceglie chi prova).
function mostraWhatsApp(indirizzo) {
  const testo = new URL(indirizzo).searchParams.get("text") || "";
  const pagine = apriVisore(
    "Messaggio WhatsApp",
    "Nell'app questo messaggio si apre in WhatsApp verso il numero del cliente, già scritto e pronto da inviare.",
  );
  pagine.insertAdjacentHTML(
    "beforeend",
    `<div class="card messaggio">${esc(testo)}</div>
     <a class="btn wa" data-pl-esterno href="https://wa.me/?text=${encodeURIComponent(testo)}" target="_blank" rel="noopener noreferrer">Aprilo in WhatsApp (scegli tu il destinatario)</a>`,
  );
}

let clickSilenzioso = false;
window.addEventListener(
  "click",
  (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("data-pl-esterno")) return;
    const href = a.getAttribute("href") || "";
    if (/^https:\/\/wa\.me\//.test(a.href)) {
      // Il default si blocca; l'evento prosegue, così l'app registra comunque l'invio.
      e.preventDefault();
      if (!clickSilenzioso) mostraWhatsApp(a.href);
    } else if (/^mailto:/i.test(href)) {
      e.preventDefault();
      avviso("Email", "Nell'app questo pulsante apre la tua app di posta con il messaggio già scritto.");
    } else if (/^(tel|sms):/i.test(href)) {
      e.preventDefault();
      avviso("Chiamata", "Nell'app questo pulsante chiama il numero o apre gli SMS del telefono.");
    }
  },
  true,
);

// window.open: senza indirizzo (anteprima PDF) restituisce null, così l'app passa al visualizzatore.
const openOriginale = window.open;
window.open = function (url, ...resto) {
  if (!url) return null;
  if (/^https:\/\/wa\.me\//.test(String(url))) {
    mostraWhatsApp(String(url));
    return null;
  }
  return openOriginale.call(window, url, ...resto);
};

// ------------------------------------------------------------------
// Giro completo nella stessa finestra: artigiano -> cliente -> artigiano
// ------------------------------------------------------------------
function vaiA(pagina, chiave, codice) {
  if (memoria.set(chiave, codice)) location.href = pagina;
  else location.href = `${pagina}#${chiave === "pl-anteprima-apri" ? codice : "/accettazione?d=" + codice}`;
}

function aggiungiPulsantiDemo() {
  const linkWa = document.querySelector('[data-action="invio-link"]');
  if (linkWa && !document.getElementById("pl-come-cliente")) {
    const b = document.createElement("button");
    b.id = "pl-come-cliente";
    b.className = "btn primary block pl-entra";
    b.textContent = "Prova come il cliente (anteprima)";
    linkWa.parentElement.parentElement.insertBefore(b, linkWa.parentElement);
    b.addEventListener("click", () => {
      const testo = new URL(linkWa.href).searchParams.get("text") || "";
      const link = linkWa.closest("[data-link]")?.dataset.link || (testo.match(/https?:\/\/\S+/) || [""])[0];
      const codice = link.split("#")[1];
      if (!codice) return;
      // Fa scattare l'azione dell'app (preventivo segnato come inviato) senza aprire WhatsApp.
      clickSilenzioso = true;
      try {
        clickOriginale.call(linkWa);
      } finally {
        clickSilenzioso = false;
      }
      setTimeout(() => vaiA("accetta.html", "pl-anteprima-apri", codice), 400);
    });
  }
  const conferma = document.getElementById("cp-invia-wa");
  if (conferma && !document.getElementById("pl-torna-app")) {
    const b = document.createElement("button");
    b.id = "pl-torna-app";
    b.className = "btn primary big block";
    b.textContent = "Torna all'app come artigiano (anteprima)";
    conferma.insertAdjacentElement("afterend", b);
    b.addEventListener("click", () => {
      const testo = new URL(conferma.href).searchParams.get("text") || "";
      const link = (testo.match(/https?:\/\/\S+/) || [""])[0];
      const codice = link.split("?d=")[1];
      if (codice) vaiA("app.html", "pl-anteprima-conferma", codice);
    });
  }
}

new MutationObserver(aggiungiPulsantiDemo).observe(document.body, { childList: true, subtree: true });

// ------------------------------------------------------------------
// Barra dell'anteprima
// ------------------------------------------------------------------
// Le azioni che cancellano i dati chiedono un secondo tocco (le finestre di conferma del browser
// nella cornice non compaiono).
function conDoppioTocco(pulsante, azione) {
  const etichetta = pulsante.textContent;
  let timer = null;
  pulsante.addEventListener("click", () => {
    if (!timer) {
      pulsante.textContent = "Sicuro? Tocca ancora";
      timer = setTimeout(() => {
        timer = null;
        pulsante.textContent = etichetta;
      }, 3000);
      return;
    }
    clearTimeout(timer);
    azione();
  });
}

async function barra() {
  const b = document.createElement("div");
  b.className = "pl-barra";
  b.setAttribute("role", "region");
  b.setAttribute("aria-label", "Comandi dell'anteprima");
  if (paginaCliente) {
    b.innerHTML = `<b>Anteprima</b><span>Vista del cliente</span><button id="pl-app">Torna all'app</button>`;
    document.body.prepend(b);
    document.getElementById("pl-app").addEventListener("click", () => (location.href = "app.html"));
    return;
  }
  const lic = await db.get("licenza", null);
  const pro = Boolean(lic && lic.valida);
  b.innerHTML = `<b>Anteprima</b><span><span class="lungo">Dati di esempio, salvati solo in questo browser</span></span>
    <button id="pl-esempio" title="Rimette i preventivi di esempio" aria-label="Ricarica i dati di esempio">↺ Esempio</button>
    <button id="pl-zero" title="Cancella tutto e riparte dalla configurazione iniziale">Da zero</button>
    <button id="pl-pro" aria-pressed="${pro}" title="Attiva o disattiva il piano Pro in questa anteprima">${pro ? "Pro attivo ✓" : "Prova Pro"}</button>`;
  document.body.prepend(b);
  conDoppioTocco(document.getElementById("pl-esempio"), async () => {
    await caricaEsempio();
    location.hash = "#/";
    location.reload();
  });
  conDoppioTocco(document.getElementById("pl-zero"), async () => {
    await svuota();
    memoria.set("pl-anteprima-modo", "vuoto");
    location.hash = "#/benvenuto";
    location.reload();
  });
  document.getElementById("pl-pro").addEventListener("click", async () => {
    await db.set(
      "licenza",
      pro ? null : { chiave: "ANTEPRIMA", valida: true, scadenza: null, email: "anteprima", verificataIl: Date.now() },
    );
    location.reload();
  });
}

// ------------------------------------------------------------------
// Avvio
// ------------------------------------------------------------------
async function avvio() {
  if (paginaCliente) {
    const codice = memoria.get("pl-anteprima-apri");
    if (codice) {
      memoria.del("pl-anteprima-apri");
      history.replaceState(null, "", "#" + codice);
    }
    await barra();
    await import("./accetta.js");
    return;
  }
  const conferma = memoria.get("pl-anteprima-conferma");
  if (conferma) {
    memoria.del("pl-anteprima-conferma");
    history.replaceState(null, "", "#/accettazione?d=" + conferma);
  }
  try {
    const azienda = await db.get("azienda", null);
    if (!azienda && memoria.get("pl-anteprima-modo") !== "vuoto") await caricaEsempio();
  } catch {
    /* archivio non disponibile: l'app mostrerà il suo messaggio */
  }
  await barra().catch(() => {});
  await import("./app.js");
}

avvio();
