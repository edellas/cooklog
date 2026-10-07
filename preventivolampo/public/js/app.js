import { CONFIG } from "./config.js";
import { db } from "./store.js";
import * as core from "./core.js";
import { MESTIERI, trovaMestiere, vociListino } from "./mestieri.js";
import { isPro, verifica, rivalidaSeServe } from "./licenza.js";
import { ICONE, ICONE_MESTIERI } from "./icone.js";
import {
  $,
  $$,
  esc,
  immagineSicura,
  vibra,
  toast,
  apriFoglio,
  chiudiFoglio,
  titoloFoglio,
  chiedi,
  avatar,
  VIBRA,
  transizione,
  copiaTesto,
} from "./ui.js";
import { creaPadFirma, decodificaTratti, trattiInPng } from "./firma.js";
import { comprimiImmagine, MAX_FOTO } from "./foto.js";
import {
  creaLinkAccettazione,
  leggiConferma,
  applicaConferma,
  verificaImpronta,
  voceDaConferma,
  dataDaConferma,
  giorniSaldoDi,
  urlSicuro,
  creaLinkRichiesta,
  leggiAvviso,
} from "./link.js";
import * as inc from "./incassi.js";
import { svgQr } from "./qr.js";

// ------------------------------------------------------------------
// Stato
// ------------------------------------------------------------------
const AZIENDA_DEFAULT = {
  onboarded: false,
  mestiere: "",
  ragioneSociale: "",
  indirizzo: "",
  cap: "",
  citta: "",
  provincia: "",
  piva: "",
  cf: "",
  telefono: "",
  email: "",
  pec: "",
  sito: "",
  iban: "",
  intestatarioIban: "",
  linkPagamento: "",
  tipoAnticipo: "acconto", // "caparra" = caparra confirmatoria (art. 1385 c.c.)
  accontoDefault: 30, // % chiesta all'accettazione nei nuovi preventivi
  giorniSaldo: 0, // giorni dalla fine lavori per pagare il saldo (0 = a fine lavori)
  tassoMoraPrivati: "", // tasso legale (art. 1284 c.c.), facoltativo
  tassoMoraImprese: "", // tasso del D.Lgs. 231/2002 per clienti con partita IVA, facoltativo
  linkRecensioni: "",
  regime: "ordinario",
  ivaDefault: 22,
  addebitaBollo: true,
  fraseForfettario: core.FRASE_FORFETTARIO,
  prefisso: "",
  validitaGiorni: 30,
  giorniRicontatto: 3,
  pagamento: "Bonifico bancario.",
  condizioni:
    "Il preventivo comprende esclusivamente le voci indicate. Eventuali lavori aggiuntivi o imprevisti saranno concordati e preventivati a parte.",
  colore: "#1d4ed8",
  logo: "",
};

const state = {
  azienda: { ...AZIENDA_DEFAULT },
  preventivi: [],
  clienti: [],
  listino: [],
  licenza: null,
  contatore: null,
  provaPresenta: false,
  pro: false,
  corrente: null, // preventivo aperto nell'editor
  filtro: "tutti",
  cerca: "",
  installEvento: null,
  passoOnb: 1,
  mestiereScelto: "",
  mestiereSuggerito: "",
  apriModello: false,
  compitiTutti: false,
  festa: null, // preventivo appena firmato: si festeggia all'apertura
  righeAperte: new Set(), // voci con i dettagli aperti
  altreAperte: new Set(), // preventivi con "Altre opzioni" aperte
  accontoAltro: new Set(), // preventivi con l'anticipo personalizzato in modifica
  sbloccati: new Set(), // preventivi firmati sbloccati apposta per modificarli
  senzaPrezzoOk: new Set(), // preventivi da mandare anche con voci a 0 €
  impAperte: new Set(), // sezioni aperte nelle impostazioni
};

const app = () => $("#app");
const preferenza = {
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
    } catch {
      /* archiviazione non disponibile */
    }
  },
};

// Numero -> testo per un campo input ("" se zero e vuoto è più comodo).
function numIn(n, vuotoSeZero = false) {
  const x = Number(n) || 0;
  if (vuotoSeZero && x === 0) return "";
  return String(core.round2(x)).replace(".", ",");
}

const euroCorto = (n) => core.formatEuro(n).replace(/,00$/, "");
const regimeDi = (prev) => (prev && prev.regime) || state.azienda.regime;
const forfettario = (prev) => regimeDi(prev) === "forfettario";

function totaliDi(prev) {
  return core.calcolaTotali(prev, {
    regime: regimeDi(prev),
    addebitaBollo: prev.addebitaBollo ?? state.azienda.addebitaBollo,
    ivaDefault: state.azienda.ivaDefault,
  });
}

// ------------------------------------------------------------------
// Incassi (vedi incassi.js): pagamenti, scadenze, solleciti
// ------------------------------------------------------------------
const opzioniIncasso = () => ({ oggi: core.oggiISO(), giorniSaldo: Number(state.azienda.giorniSaldo) || 0 });
const incassoDi = (prev) => inc.statoIncasso(prev, totaliDi(prev), opzioniIncasso());
const nomeAnticipo = (prev) => (prev.caparra ? "Caparra" : "Acconto");
const waLink = (tel, testo) => `https://wa.me/${core.telefonoWhatsApp(tel)}?text=${encodeURIComponent(testo)}`;
const nomeFile = (prefisso, prev, estensione) =>
  `${prefisso}-${String(prev.numero).replace(/[^\w-]+/g, "-")}.${estensione}`;

function incassoModificabile(prev) {
  prev.incasso = inc.normalizzaIncasso(prev.incasso);
  return prev.incasso;
}

// L'acconto concordato si fissa quando il cliente accetta: modifiche successive al preventivo
// non lo cambiano (e non fanno risultare "in ritardo" un acconto pagato per intero).
function fissaAccordo(prev) {
  const i = incassoModificabile(prev);
  if (i.accontoPattuito == null) i.accontoPattuito = totaliDi(prev).acconto;
  // Anche il termine del saldo resta quello firmato (quello del link, se il cliente ha firmato online).
  if (i.giorniSaldo == null) i.giorniSaldo = prev.link?.gs ?? giorniSaldoDi(prev, state.azienda);
}

function mostraIncassi(prev) {
  const i = inc.normalizzaIncasso(prev.incasso);
  return prev.stato === "accettato" || i.pagamenti.length > 0 || i.segnalazioni.some((x) => x.stato === "attesa");
}

function giornoMese(iso) {
  const d = new Date(iso + "T12:00:00");
  return { giorno: d.getDate(), mese: d.toLocaleDateString("it-IT", { month: "short" }).replace(".", "") };
}

function ivaRiga(prev) {
  return forfettario(prev) ? 0 : Number(state.azienda.ivaDefault) || 22;
}

// ------------------------------------------------------------------
// Statistiche anonime (Plausible / Umami) per capire il funnel
// ------------------------------------------------------------------
function traccia(nome, props = {}) {
  try {
    if (globalThis.plausible) globalThis.plausible(nome, { props });
    else if (globalThis.umami) globalThis.umami.track(nome, props);
  } catch {
    /* statistiche non disponibili */
  }
}

function caricaStatistiche() {
  const st = CONFIG.statistiche;
  if (!st || !st.src) return;
  if (st.src.includes("plausible")) {
    globalThis.plausible =
      globalThis.plausible ||
      function () {
        (globalThis.plausible.q = globalThis.plausible.q || []).push(arguments);
      };
  }
  const s = document.createElement("script");
  s.defer = true;
  s.src = st.src;
  for (const [k, v] of Object.entries(st.attributi || {})) s.setAttribute(k, v);
  document.head.appendChild(s);
}

// ------------------------------------------------------------------
// Persistenza
// ------------------------------------------------------------------
async function caricaTutto() {
  const [azienda, preventivi, clienti, listino, licenza, contatore, provaPresenta] = await Promise.all([
    db.get("azienda", null),
    db.tutti("preventivi"),
    db.tutti("clienti"),
    db.tutti("listino"),
    db.get("licenza", null),
    db.get("contatore", null),
    db.get("prova-presenta", false),
  ]);
  state.azienda = { ...AZIENDA_DEFAULT, ...(azienda || {}) };
  // Preventivi accettati prima del registro incassi: "da aggiornare", senza falsi scaduti.
  for (const p of preventivi) {
    if (p.stato === "accettato" && !("incasso" in p)) {
      p.incasso = { storico: true };
      await db.salva("preventivi", p);
    }
  }
  state.preventivi = preventivi;
  nelArchivio.clear();
  for (const p of preventivi) nelArchivio.add(p.id);
  state.clienti = clienti;
  state.listino = listino;
  state.licenza = licenza;
  state.contatore = contatore;
  state.provaPresenta = provaPresenta === true;
  state.pro = isPro(licenza, CONFIG);
}

const salvaAzienda = () => db.set("azienda", state.azienda);

// Salvataggio ritardato delle impostazioni, con "flush" per non perdere modifiche
// quando si cambia pagina subito dopo aver scritto.
let timerAzienda = null;
function salvaAziendaDopo() {
  clearTimeout(timerAzienda);
  timerAzienda = setTimeout(() => {
    timerAzienda = null;
    salvaAzienda();
  }, 300);
}
async function salvaAziendaSubito() {
  if (!timerAzienda) return;
  clearTimeout(timerAzienda);
  timerAzienda = null;
  await salvaAzienda();
}

// Più finestre aperte sull'app (l'app installata e un link aperto da WhatsApp nel browser) usano lo
// stesso archivio. Per non cancellare ciò che ha registrato l'altra finestra:
// 1. si salva solo un preventivo davvero modificato qui;
// 2. se nell'archivio c'è una versione più recente, prima di scrivere si uniscono pagamenti, avvisi,
//    solleciti, firma e accettazione;
// 3. le altre finestre vengono avvisate e ricaricano i dati quando tornano visibili.
const daSalvare = new Set();
const nelArchivio = new Set(); // preventivi già salvati almeno una volta (per riconoscere quelli eliminati altrove)
const canale = typeof BroadcastChannel === "function" ? new BroadcastChannel("preventivolampo") : null;

function unisciLista(mia, altra, chiave) {
  const viste = new Set(mia.map(chiave));
  return [...mia, ...altra.filter((x) => !viste.has(chiave(x)))];
}

function unisciVersione(prev, nelDb) {
  const a = inc.normalizzaIncasso(prev.incasso);
  const b = inc.normalizzaIncasso(nelDb.incasso);
  if (prev.incasso || nelDb.incasso) {
    const segnalazioni = unisciLista(a.segnalazioni, b.segnalazioni, (x) => x.rif + x.il).map((x) => {
      const altra = b.segnalazioni.find((y) => y.rif === x.rif && y.il === x.il);
      return altra && x.stato === "attesa" ? { ...x, stato: altra.stato } : x;
    });
    prev.incasso = {
      ...a,
      // I pagamenti eliminati in una delle due finestre non ricompaiono.
      pagamenti: unisciLista(a.pagamenti, b.pagamenti, (x) => x.id).filter(
        (x) => !a.pagamentiEliminati.includes(x.id) && !b.pagamentiEliminati.includes(x.id),
      ),
      pagamentiEliminati: [...new Set([...a.pagamentiEliminati, ...b.pagamentiEliminati])].slice(-200),
      solleciti: unisciLista(a.solleciti, b.solleciti, (x) => x.il),
      segnalazioni,
      fineLavori: a.fineLavori || b.fineLavori,
      accontoPattuito: a.accontoPattuito ?? b.accontoPattuito,
      recensioneChiestaIl: Math.max(a.recensioneChiestaIl || 0, b.recensioneChiestaIl || 0) || null,
      storico: a.storico && b.storico,
    };
  }
  if (!prev.firma && nelDb.firma) prev.firma = nelDb.firma;
  if (!prev.accettazioneOnline && nelDb.accettazioneOnline) {
    prev.accettazioneOnline = nelDb.accettazioneOnline;
    prev.stato = nelDb.stato;
    prev.righe = nelDb.righe; // le voci facoltative scelte dal cliente
  }
  if (!prev.accettatoIl && nelDb.accettatoIl) prev.accettatoIl = nelDb.accettatoIl;
  if (!prev.appuntamento && nelDb.appuntamento) prev.appuntamento = nelDb.appuntamento;
  if (nelDb.link && (!prev.link || (nelDb.link.il || 0) > (prev.link.il || 0))) prev.link = nelDb.link;
  prev.linkPrecedenti = [...new Set([...(prev.linkPrecedenti || []), ...(nelDb.linkPrecedenti || [])])].slice(0, 20);
  prev.inviatoIl = prev.inviatoIl || nelDb.inviatoIl || null;
  prev.ricontattatoIl = Math.max(prev.ricontattatoIl || 0, nelDb.ricontattatoIl || 0) || null;
}

async function salvaPreventivo(prev) {
  const nelDb = await db.leggi("preventivi", prev.id).catch(() => null);
  if (!nelDb && nelArchivio.has(prev.id)) {
    // Eliminato in un'altra finestra: non lo si ricrea.
    daSalvare.delete(prev.id);
    state.preventivi = state.preventivi.filter((p) => p.id !== prev.id);
    return;
  }
  if (nelDb && (nelDb.updatedAt || 0) > (prev.updatedAt || 0)) unisciVersione(prev, nelDb);
  prev.updatedAt = Math.max(Date.now(), (nelDb && nelDb.updatedAt + 1) || 0);
  await db.salva("preventivi", prev);
  nelArchivio.add(prev.id);
  daSalvare.delete(prev.id);
  const i = state.preventivi.findIndex((p) => p.id === prev.id);
  if (i >= 0) state.preventivi[i] = prev;
  else state.preventivi.push(prev);
  canale?.postMessage({ id: prev.id });
}

let timerSalva;
function salvaDopo(prev) {
  daSalvare.add(prev.id);
  clearTimeout(timerSalva);
  timerSalva = setTimeout(() => salvaPreventivo(prev), 400);
}

// Un'altra finestra ha salvato: se qualcosa è cambiato, si ricarica (salvando prima le modifiche fatte qui).
let controlloInCorso = null;
function controllaAggiornamenti() {
  if (document.visibilityState !== "visible" || !state.azienda.onboarded) return;
  controlloInCorso ||= (async () => {
    const nelDb = await db.tutti("preventivi");
    const conosciuti = new Map(state.preventivi.map((p) => [p.id, p.updatedAt || 0]));
    const cambiato =
      nelDb.length !== state.preventivi.length || nelDb.some((p) => (p.updatedAt || 0) > (conosciuti.get(p.id) ?? -1));
    if (!cambiato) return;
    clearTimeout(timerSalva);
    if (state.corrente && daSalvare.has(state.corrente.id)) await salvaPreventivo(state.corrente);
    await caricaTutto();
    state.corrente = null;
    await render();
    toast("Aggiornato con le modifiche fatte in un'altra finestra");
  })().finally(() => (controlloInCorso = null));
}
canale?.addEventListener("message", controllaAggiornamenti);

async function salvaClienteDa(prev) {
  const c = prev.cliente || {};
  const nome = (c.nome || "").trim();
  if (!nome) return;
  let rec =
    (prev.clienteId && state.clienti.find((x) => x.id === prev.clienteId)) ||
    state.clienti.find((x) => (x.nome || "").trim().toLowerCase() === nome.toLowerCase());
  rec = rec ? { ...rec } : { id: core.uid(), createdAt: Date.now() };
  for (const k of ["nome", "indirizzo", "citta", "cfpiva", "telefono", "email"]) {
    if (c[k] && String(c[k]).trim()) rec[k] = String(c[k]).trim();
  }
  rec.updatedAt = Date.now();
  await db.salva("clienti", rec);
  const i = state.clienti.findIndex((x) => x.id === rec.id);
  if (i >= 0) state.clienti[i] = rec;
  else state.clienti.push(rec);
  if (prev.clienteId !== rec.id) {
    prev.clienteId = rec.id;
    await salvaPreventivo(prev);
  }
}

// ------------------------------------------------------------------
// Router
// ------------------------------------------------------------------
function rotta() {
  const h = location.hash.slice(1) || "/";
  const i = h.indexOf("?");
  const percorso = i >= 0 ? h.slice(0, i) : h;
  const query = i >= 0 ? h.slice(i + 1) : "";
  const decodifica = (x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  };
  return { parti: percorso.split("/").filter(Boolean).map(decodifica), q: new URLSearchParams(query) };
}

function vai(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// I cambi di pagina vengono eseguiti uno alla volta: eventi ravvicinati (doppio tocco,
// hashchange consegnati in ritardo) non devono mai creare due preventivi con lo stesso numero.
// Nessuna pagina viene disegnata prima che i dati siano caricati dall'archivio.
let segnalaDatiPronti;
const datiPronti = new Promise((r) => (segnalaDatiPronti = r));
let codaRender = Promise.resolve();
function render() {
  codaRender = codaRender
    .then(() => datiPronti)
    .then(eseguiRender)
    .catch((err) => console.error(err));
  return codaRender;
}

const PAGINE_SENZA_ONBOARDING = new Set(["benvenuto", "pro", "accettazione", "pagamento"]);

async function eseguiRender() {
  clearTimeout(timerSalva);
  await salvaAziendaSubito();
  if (state.corrente && daSalvare.has(state.corrente.id)) {
    await salvaPreventivo(state.corrente);
    await salvaClienteDa(state.corrente);
  }
  chiudiFoglio(true);
  const { parti, q } = rotta();
  const pagina = parti[0] || "";
  if (!state.azienda.onboarded && !PAGINE_SENZA_ONBOARDING.has(pagina)) {
    vai("#/benvenuto");
    return;
  }
  // Un preventivo aperto per sbaglio e lasciato vuoto non resta in lista (e libera il suo numero).
  const lasciato = state.corrente;
  if (lasciato && vuotoDaButtare(lasciato) && !(pagina === "p" && parti[1] === lasciato.id)) {
    await eliminaPreventivo(lasciato);
  }
  state.corrente = null;
  const senzaTab = ["p", "benvenuto", "accettazione", "pagamento", "pro"].includes(pagina);
  document.body.classList.toggle("no-tabbar", senzaTab);
  $$(".tabbar a.tab").forEach((a) => a.classList.toggle("on", a.dataset.tab === (pagina || "lista")));

  await transizione(async () => {
    window.scrollTo(0, 0);
    if (pagina === "") return viewLista();
    if (pagina === "nuovo") return nuovoPreventivo(q);
    if (pagina === "p") return viewEditor(parti[1], q);
    if (pagina === "clienti") return viewClienti();
    if (pagina === "listino") return viewListino();
    if (pagina === "impostazioni") return viewImpostazioni();
    if (pagina === "pro") return viewPro(q);
    if (pagina === "benvenuto") return viewBenvenuto();
    if (pagina === "accettazione") return viewAccettazione(q);
    if (pagina === "pagamento") return viewAvviso(q);
    vai("#/");
  });
}

function vuotoDaButtare(p) {
  const c = p.cliente || {};
  return (
    p.stato === "bozza" &&
    !p.righe.length &&
    !String(c.nome || "").trim() &&
    !String(c.telefono || "").trim() &&
    !String(c.email || "").trim() &&
    !String(p.oggetto || "").trim() &&
    !(p.foto || []).length &&
    !(p.disponibilita || []).length &&
    !p.firma &&
    !p.inviatoIl
  );
}

async function eliminaPreventivo(prev) {
  clearTimeout(timerSalva);
  daSalvare.delete(prev.id);
  await db.elimina("preventivi", prev.id);
  nelArchivio.delete(prev.id);
  canale?.postMessage({ id: prev.id });
  state.preventivi = state.preventivi.filter((p) => p.id !== prev.id);
  if (state.corrente === prev) state.corrente = null;
}

function ombraTopbar() {
  const t = $(".topbar");
  if (t) t.classList.toggle("ombra", window.scrollY > 4);
}
window.addEventListener("scroll", ombraTopbar, { passive: true });

// ------------------------------------------------------------------
// Dashboard / lista preventivi
// ------------------------------------------------------------------
function nomeMese(chiave, lungo = false) {
  const [a, m] = chiave.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("it-IT", { month: lungo ? "long" : "short" }).replace(".", "");
}

function quando(ms) {
  if (!ms) return "";
  const giorni = inc.giorniTra(core.oggiISO(new Date(ms)), core.oggiISO());
  if (giorni <= 0) return "modificato oggi";
  if (giorni === 1) return "modificato ieri";
  return `modificato ${giorni} giorni fa`;
}

const piuGiorni = (n) => `${n} ${n === 1 ? "giorno" : "giorni"}`;

// La home risponde a "cosa devo fare adesso?": tutto ciò che chiede un'azione, in ordine di urgenza,
// con un solo verbo per riga.
function compitiOggi() {
  const oggi = core.oggiISO();
  const lista = [];
  const r = inc.daIncassare(state.preventivi, totaliDi, opzioniIncasso());
  for (const { prev, stato: s } of r.voci) {
    const nome = core.nomeCliente(prev.cliente);
    const id = esc(prev.id);
    if (s.segnalazioniAttesa.length) {
      lista.push({
        peso: 100,
        segno: "warn",
        icona: ICONE.campanella,
        titolo: `${nome} dice di aver pagato ${core.formatEuro(s.daVerificare)}`,
        sotto: "Controlla sul conto, poi conferma",
        azione: `<a class="btn small" href="#/p/${id}?sez=incassi">Controlla</a>`,
      });
    } else if (s.fase === "scaduto") {
      lista.push({
        peso: 90 + Math.min(s.giorniRitardo, 9),
        segno: "bad",
        icona: ICONE.attenzione,
        titolo: `${nome} ti deve ${core.formatEuro(s.importoScaduto)}`,
        sotto: `In ritardo da ${piuGiorni(s.giorniRitardo)}`,
        azione: `<a class="btn wa small" href="#/p/${id}?sez=incassi&azione=sollecito">Sollecita</a>`,
      });
    } else if (s.fase === "attesa-acconto" && s.accettato && s.prossima) {
      lista.push({
        peso: 60,
        segno: "warn",
        icona: ICONE.pagamento,
        titolo: `${nomeAnticipo(prev)} di ${nome}: ${core.formatEuro(s.prossima.importo)}`,
        sotto: s.scadenzaAcconto
          ? `Da ricevere entro il ${core.formatData(s.scadenzaAcconto)}`
          : "Da ricevere prima di iniziare",
        azione: `<a class="btn small" href="#/p/${id}?sez=incassi&azione=chiedi">Chiedi</a>`,
      });
    } else if (
      s.fase === "da-saldare" &&
      s.scadenzaSaldo &&
      inc.giorniTra(oggi, s.scadenzaSaldo) <= 3 &&
      s.residuo > 0.005
    ) {
      lista.push({
        peso: 55,
        segno: "penna",
        icona: ICONE.calendario,
        titolo: `Saldo di ${nome}: ${core.formatEuro(s.residuo)}`,
        sotto: `Scade il ${core.formatData(s.scadenzaSaldo)}`,
        azione: `<a class="btn small" href="#/p/${id}?sez=incassi&azione=chiedi">Chiedi</a>`,
      });
    }
  }
  for (const { prev, app: a } of inc.prossimiLavori(state.preventivi, { oggi, giorni: 1 })) {
    lista.push({
      peso: 80,
      segno: "ok",
      icona: ICONE.calendario,
      titolo: `${a.data === oggi ? "Oggi" : "Domani"}: ${core.nomeCliente(prev.cliente)}`,
      sotto: [inc.FASCE[a.fascia], prev.oggetto].filter(Boolean).join(" · "),
      azione: `<a class="btn small" href="#/p/${esc(prev.id)}">Apri</a>`,
    });
  }
  const bozze = state.preventivi
    .filter((p) => p.stato === "bozza" && (p.righe.length || (p.cliente?.nome || "").trim()))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 3);
  for (const p of bozze) {
    const nome = (p.cliente?.nome || "").trim();
    lista.push({
      peso: 70,
      segno: "",
      icona: ICONE.matita,
      titolo: nome ? `Finisci il preventivo per ${nome}` : "Finisci il preventivo",
      sotto: [p.oggetto || `N° ${p.numero}`, quando(p.updatedAt)].filter(Boolean).join(" · "),
      azione: `<a class="btn small" href="#/p/${esc(p.id)}">Continua</a>`,
    });
  }
  for (const x of core.daRicontattare(state.preventivi, Date.now(), Number(state.azienda.giorniRicontatto) || 3)) {
    const traGiorni = x.scadenza && !x.scaduto ? inc.giorniTra(oggi, x.scadenza) : null;
    const inScadenza = traGiorni !== null && traGiorni <= 3;
    lista.push({
      peso: (inScadenza ? 65 : 40) + Math.min(x.giorniDaInvio, 9),
      segno: inScadenza ? "warn" : "penna",
      icona: inScadenza ? ICONE.orologio : ICONE.telefono,
      titolo: inScadenza
        ? `Il preventivo di ${core.nomeCliente(x.prev.cliente)} scade ${traGiorni === 0 ? "oggi" : traGiorni === 1 ? "domani" : `fra ${traGiorni} giorni`}`
        : `${core.nomeCliente(x.prev.cliente)} non ha ancora risposto`,
      sotto: inScadenza
        ? `Ricordagli che i prezzi valgono fino al ${core.formatData(x.scadenza)} · ${euroCorto(totaliDi(x.prev).totale)}`
        : `Inviato ${x.giorniDaInvio === 1 ? "ieri" : `${x.giorniDaInvio} giorni fa`} · ${euroCorto(totaliDi(x.prev).totale)}`,
      azione: `<button class="btn wa small" data-action="ricontatta" data-id="${esc(x.prev.id)}">Scrivi</button>`,
    });
  }
  const link = urlSicuro(state.azienda.linkRecensioni);
  for (const { prev } of inc.daRecensire(state.preventivi, totaliDi, { oggi }).slice(0, 2)) {
    lista.push({
      peso: 20,
      segno: "ok",
      icona: ICONE.stella,
      titolo: `${core.nomeCliente(prev.cliente)} ha pagato tutto`,
      sotto: "È il momento giusto per chiedere una recensione",
      azione: link
        ? `<a class="btn wa small" href="${esc(waLink(prev.cliente.telefono, inc.messaggioRecensione(prev, state.azienda, link)))}" target="_blank" rel="noopener" data-action="recensione-chiesta" data-id="${esc(prev.id)}">Chiedi</a>`
        : `<a class="btn small" href="#/impostazioni">Imposta</a>`,
    });
  }
  const ultimaCopia = Number(preferenza.get("pl-ultima-copia")) || 0;
  if (state.preventivi.length >= 3 && Date.now() - ultimaCopia > 30 * 864e5) {
    lista.push({
      peso: 10,
      segno: "",
      icona: ICONE.scudo,
      titolo: "Salva una copia dei tuoi preventivi",
      sotto: ultimaCopia
        ? `Ultima copia il ${core.formatData(core.oggiISO(new Date(ultimaCopia)))}`
        : "Stanno solo su questo telefono: mettili al sicuro",
      azione: `<button class="btn small" data-action="backup-esporta">Salva</button>`,
    });
  }
  return lista.sort((a, b) => b.peso - a.peso);
}

function htmlCompito(c) {
  return `<div class="compito">
      <span class="segno ${c.segno}" aria-hidden="true">${c.icona}</span>
      <div class="corpo"><div class="t">${esc(c.titolo)}</div><div class="s">${esc(c.sotto)}</div></div>
      ${c.azione}
    </div>`;
}

function htmlDaFare(compiti) {
  const tutti = state.compitiTutti;
  const visibili = tutti ? compiti : compiti.slice(0, 5);
  return `<section class="card" id="da-fare">
      <div class="sezione-titolo"><h2>Da fare</h2>${compiti.length ? `<span class="badge nodot dx">${compiti.length}</span>` : ""}</div>
      ${
        compiti.length
          ? `<div class="compiti">${visibili.map(htmlCompito).join("")}</div>
             ${compiti.length > 5 ? `<button class="btn ghost block small" data-action="compiti-tutti">${tutti ? "Mostra meno" : `Mostra tutto (altre ${compiti.length - 5})`}</button>` : ""}`
          : `<div class="compito-vuoto">${ICONE.fatto}<span>Tutto in ordine: nessun pagamento in ritardo e nessun cliente da richiamare.</span></div>`
      }
      <button class="btn ghost block incolla" data-action="incolla-messaggio">${ICONE.casella}<span>Ti è arrivata una firma o un "ho pagato"? Incolla il messaggio</span></button>
    </section>`;
}

function htmlAgenda() {
  const oggi = core.oggiISO();
  const domani = core.aggiungiGiorni(oggi, 1);
  const lista = inc
    .prossimiLavori(state.preventivi, { oggi, giorni: 21 })
    .filter(({ app: a }) => a.data > domani)
    .slice(0, 3);
  if (!lista.length) return "";
  return `<section class="card">
    <div class="sezione-titolo"><h2>In agenda</h2></div>
    ${lista
      .map(({ prev, app: a }) => {
        const { giorno, mese } = giornoMese(a.data);
        return `<a class="ricontatto" href="#/p/${esc(prev.id)}">
        <span class="data-tile" aria-hidden="true"><b>${giorno}</b><small>${esc(mese)}</small></span>
        <div class="corpo"><div class="t">${esc(core.nomeCliente(prev.cliente))}</div>
          <div class="s">${esc(inc.testoAppuntamento(a))}${prev.oggetto ? ` · ${esc(prev.oggetto)}` : ""}</div></div>
        ${a.da === "cliente" ? `<span class="badge inviato nodot solo-largo">Scelta dal cliente</span>` : ""}
      </a>`;
      })
      .join("")}
  </section>`;
}

// Il piano gratuito si nota solo quando serve: con l'ultimo preventivo gratis del mese.
function htmlPiano() {
  if (state.pro) return "";
  const rimasti = core.pdfRimasti(state.contatore, CONFIG.pdfGratisAlMese);
  if (rimasti > 1) return "";
  const mese = new Date().toLocaleDateString("it-IT", { month: "long" });
  return `<div class="banner ${rimasti === 0 ? "warn" : "info"}"><span class="ico">${ICONE.info}</span>
    <div style="flex:1;min-width:0"><b>${rimasti === 0 ? `Hai usato i preventivi gratuiti di ${mese}` : `Ti resta 1 preventivo gratuito a ${mese}`}</b>
      <div class="small">Con Pro sono illimitati.</div></div>
    <a class="btn small" href="#/pro">Vedi Pro</a>
  </div>`;
}

function htmlMese() {
  const mese = core.meseCorrente();
  const delMese = state.preventivi.filter((p) => (p.data || "").startsWith(mese));
  const preventivato = delMese.reduce((s, p) => s + totaliDi(p).totale, 0);
  const accettati = delMese.filter((p) => p.stato === "accettato");
  const valoreAccettati = accettati.reduce((s, p) => s + totaliDi(p).totale, 0);
  const incassato = state.preventivi.reduce(
    (s, p) =>
      s +
      inc
        .normalizzaIncasso(p.incasso)
        .pagamenti.filter((x) => (x.data || "").startsWith(mese))
        .reduce((t, x) => t + x.importo, 0),
    0,
  );
  return `<section class="card">
    <div class="sezione-titolo"><h2>${esc(nomeMese(mese, true).replace(/^./, (c) => c.toUpperCase()))} in breve</h2>
      <button class="btn ghost small dx" data-action="andamento">Andamento</button></div>
    <div class="mese-riassunto">
      <div><b class="tnum">${esc(euroCorto(preventivato))}</b><span>${delMese.length === 1 ? "1 preventivo" : `${delMese.length} preventivi`}</span></div>
      <div><b class="tnum">${esc(euroCorto(valoreAccettati))}</b><span>${accettati.length === 1 ? "1 accettato" : `${accettati.length} accettati`}</span></div>
      <div><b class="tnum">${esc(euroCorto(incassato))}</b><span>incassati</span></div>
    </div>
  </section>`;
}

function foglioAndamento() {
  const st = core.statistiche(state.preventivi, (p) => totaliDi(p).totale);
  const max = Math.max(1, ...st.mesi.map((m) => m.preventivato));
  apriFoglio(
    `${titoloFoglio("Andamento degli ultimi 6 mesi", st.tassoAccettazione === null ? "" : `${st.tassoAccettazione}% dei preventivi decisi è stato accettato`)}
    <div class="grafico" style="height:150px" aria-label="Valore preventivato e accettato negli ultimi 6 mesi">
      ${st.mesi
        .map(
          (m) => `<div class="col">
        <span class="xsmall tnum" style="font-weight:650">${esc(euroCorto(m.preventivato))}</span>
        <div class="barra" style="height:${Math.max(4, Math.round((m.preventivato / max) * 100))}%"><i style="height:${m.preventivato ? Math.round((m.accettato / m.preventivato) * 100) : 0}%"></i></div>
        <span class="mese">${esc(nomeMese(m.mese))}</span></div>`,
        )
        .join("")}
    </div>
    <div class="row" style="gap:16px;margin-top:14px"><span class="row small" style="gap:6px"><i style="width:12px;height:12px;border-radius:3px;background:var(--surface-3)"></i>Preventivato</span><span class="row small" style="gap:6px"><i style="width:12px;height:12px;border-radius:3px;background:var(--ink)"></i>Accettato</span></div>`,
  );
}

const FILTRI = {
  tutti: "Tutti",
  bozza: "Da inviare",
  inviato: "In attesa",
  "da-incassare": "Da incassare",
  accettato: "Accettati",
  rifiutato: "Rifiutati",
};

function passaFiltro(p, f) {
  if (f === "tutti") return true;
  if (f === "da-incassare") return p.stato === "accettato" && incassoDi(p).residuo > 0.005;
  return p.stato === f;
}

function filtraLista() {
  const cerca = state.cerca.trim().toLowerCase();
  return state.preventivi
    .filter((p) => passaFiltro(p, state.filtro))
    .filter((p) => !cerca || [p.numero, p.oggetto, p.cliente && p.cliente.nome].join(" ").toLowerCase().includes(cerca))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

const BADGE_INCASSO = {
  scaduto: "In ritardo",
  "attesa-acconto": "Acconto da ricevere",
  "da-saldare": "Da saldare",
  "in-corso": "Lavori in corso",
  pagato: "Pagato",
};

function htmlVoci() {
  const lista = filtraLista();
  if (!lista.length)
    return `<div class="vuoto muted">${state.cerca.trim() ? "Nessun preventivo con queste parole." : "Nessun preventivo qui."}</div>`;
  return lista
    .map((p) => {
      const t = totaliDi(p);
      const fase = p.stato === "accettato" ? incassoDi(p).fase : "";
      return `<a class="voce-lista" href="#/p/${esc(p.id)}">
        ${avatar(core.nomeCliente(p.cliente))}
        <div class="corpo">
          <div class="t">${esc(core.nomeCliente(p.cliente))}</div>
          <div class="s">${esc(p.oggetto || "Senza titolo")}</div>
          <div class="s xsmall">N° ${esc(p.numero)} · ${esc(core.formatData(p.data))}${p.accettazioneOnline ? " · firmato online" : ""}</div>
        </div>
        <div class="dx"><span class="importo">${esc(core.formatEuro(t.totale))}</span>${
          BADGE_INCASSO[fase]
            ? `<span class="badge ${esc(fase)}">${esc(BADGE_INCASSO[fase])}</span>`
            : `<span class="badge ${esc(p.stato)}">${esc(core.STATI[p.stato] || "")}</span>`
        }</div>
      </a>`;
    })
    .join("");
}

function saluto() {
  const h = new Date().getHours();
  return h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
}

function viewLista() {
  const conta = {};
  for (const f of Object.keys(FILTRI)) conta[f] = state.preventivi.filter((p) => passaFiltro(p, f)).length;
  if (!FILTRI[state.filtro]) state.filtro = "tutti";
  const filtri = Object.entries(FILTRI)
    .filter(([f]) => f === "tutti" || conta[f] || state.filtro === f)
    .map(
      ([f, nome]) =>
        `<button class="chip ${state.filtro === f ? "on" : ""}" data-action="filtro" data-f="${f}">${esc(nome)}<span class="n">${conta[f] || 0}</span></button>`,
    )
    .join("");
  const bannerInstalla =
    state.installEvento && !preferenza.get("pl-installa-no")
      ? `<div class="banner info"><span class="ico">${ICONE.scarica}</span><div style="flex:1;min-width:0">Installa l'app: si apre con un tocco e funziona anche senza rete.</div><button class="btn small" data-action="installa">Installa</button></div>`
      : "";
  const ci = state.preventivi.length > 0;
  const compiti = ci ? compitiOggi() : [];
  const oggi = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  const sottotitolo = compiti.length
    ? `${compiti.length === 1 ? "Oggi hai 1 cosa da fare" : `Oggi hai ${compiti.length} cose da fare`}`
    : "Niente di urgente";
  const comeFunziona = `<section class="card">
      <div class="sezione-titolo"><h2>Come funziona</h2></div>
      <div class="compiti">
        <div class="compito"><span class="segno" aria-hidden="true">${ICONE.matita}</span><div class="corpo"><div class="t">Prepari il preventivo</div><div class="s">Dettalo a voce o scegli dai tuoi prezzi: ci vuole un minuto</div></div></div>
        <div class="compito"><span class="segno" aria-hidden="true">${ICONE.whatsapp}</span><div class="corpo"><div class="t">Lo mandi su WhatsApp</div><div class="s">Il cliente lo apre dal suo telefono, senza installare niente</div></div></div>
        <div class="compito"><span class="segno" aria-hidden="true">${ICONE.firma}</span><div class="corpo"><div class="t">Il cliente firma e paga l'acconto</div><div class="s">Ti arriva la conferma e l'app segue i pagamenti al posto tuo</div></div></div>
      </div>
    </section>`;

  app().innerHTML = `
    <header class="topbar">
      <div class="brand">${ICONE.logo}<span>${esc(state.azienda.ragioneSociale || CONFIG.nomeProdotto)}</span></div>
      ${state.pro ? `<span class="badge pro">PRO</span>` : `<a class="btn small ghost" href="#/pro">${ICONE.stella} Pro</a>`}
    </header>
    <main class="pagina">
      ${bannerInstalla}
      <div class="saluto"><h1>${esc(saluto())}</h1><p>${esc(oggi.replace(/^./, (c) => c.toUpperCase()))}${ci ? ` · ${esc(sottotitolo)}` : ""}</p></div>
      <a class="cta-nuovo" href="#/nuovo"><span class="ico">${ICONE.piu}</span><div><b>Nuovo preventivo</b><span>Dettalo a voce o scegli dai tuoi prezzi</span></div><span class="freccia" aria-hidden="true">${ICONE.avanti}</span></a>
      ${ci ? htmlDaFare(compiti) : comeFunziona}
      ${htmlAgenda()}
      ${htmlPiano()}
      ${
        ci
          ? `<div class="etichetta-sez">I tuoi preventivi</div>
             <input type="search" placeholder="Cerca per cliente, lavoro o numero" value="${esc(state.cerca)}" id="cerca-prev" aria-label="Cerca preventivi">
             <div class="chips">${filtri}</div>
             <div class="lista" id="lista-prev">${htmlVoci()}</div>
             ${htmlMese()}`
          : ""
      }
    </main>`;
  ombraTopbar();
  $("#cerca-prev")?.addEventListener("input", (e) => {
    state.cerca = e.target.value;
    $("#lista-prev").innerHTML = htmlVoci();
  });
  aggiornaBadgeApp(compiti.length);
}

// Il numero sull'icona dell'app (come WhatsApp) ricorda che c'è qualcosa da fare.
function aggiornaBadgeApp(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch {
    /* non supportato */
  }
}

// ------------------------------------------------------------------
// Nuovo preventivo
// ------------------------------------------------------------------
async function creaPreventivo({ cliente, modello } = {}) {
  const numerazione = core.prossimoNumero(state.preventivi, new Date().getFullYear(), state.azienda.prefisso);
  const prev = core.preventivoVuoto(state.azienda, numerazione);
  if (cliente) {
    prev.clienteId = cliente.id;
    prev.cliente = {
      nome: cliente.nome || "",
      indirizzo: cliente.indirizzo || "",
      citta: cliente.citta || "",
      cfpiva: cliente.cfpiva || "",
      telefono: cliente.telefono || "",
      email: cliente.email || "",
    };
  }
  if (modello) {
    prev.oggetto = modello.oggetto;
    prev.righe = vociListino(modello)
      .slice(0, 5)
      .map((v) => core.rigaVuota(ivaRiga(prev), v));
  }
  await salvaPreventivo(prev);
  return prev;
}

async function nuovoPreventivo(q) {
  const cliente = q.get("cliente") ? state.clienti.find((c) => c.id === q.get("cliente")) : null;
  const prev = await creaPreventivo({ cliente });
  history.replaceState(null, "", `#/p/${prev.id}`);
  viewEditor(prev.id);
}

// ------------------------------------------------------------------
// Editor
// ------------------------------------------------------------------
// Una riga: descrizione, quantità, unità e prezzo sempre in vista; il resto (tipo, IVA, extra,
// sconto, costo) in "Dettagli", con un segnale sulla riga quando non è quello di base.
function htmlRiga(r, i) {
  const forf = forfettario(state.corrente);
  const um = core.UNITA.includes(r.um) ? core.UNITA : [r.um, ...core.UNITA];
  const ivaBase = ivaRiga(state.corrente);
  const segni = [
    r.opzionale ? `<span class="badge warn nodot">Extra a scelta</span>` : "",
    r.tipo === "mat" ? `<span class="badge nodot bozza">Materiale</span>` : "",
    !forf && Number(r.iva) !== ivaBase ? `<span class="badge nodot bozza">IVA ${esc(r.iva)}%</span>` : "",
    r.sconto > 0 ? `<span class="badge nodot bozza">Sconto ${esc(core.formatQta(r.sconto))}%</span>` : "",
    !(core.parseNumero(r.prezzo) > 0) && String(r.descrizione || "").trim()
      ? `<span class="badge scaduto nodot">Manca il prezzo</span>`
      : "",
  ].join("");
  const aperta = state.righeAperte.has(r.id);
  return `<div class="riga ${r.opzionale ? "facoltativa" : ""}" data-i="${i}">
    <div class="riga-top">
      <textarea data-r="descrizione" rows="1" placeholder="Cosa fai o cosa fornisci" aria-label="Descrizione" enterkeyhint="next">${esc(r.descrizione)}</textarea>
      <button class="icon-btn" data-action="menu-riga" data-i="${i}" aria-label="Sposta, duplica o elimina la voce">${ICONE.altro}</button>
    </div>
    <div class="riga-grid">
      <label>Quantità<span class="qta-wrap"><input data-r="qta" inputmode="decimal" value="${numIn(r.qta)}" enterkeyhint="next">${
        r.um === "mq"
          ? `<button type="button" class="calc" data-action="calcolatore" data-i="${i}" aria-label="Calcola i metri quadri">${ICONE.righello}</button>`
          : ""
      }</span></label>
      <label>Unità<select data-r="um">${um.map((u) => `<option ${u === r.um ? "selected" : ""}>${esc(u)}</option>`).join("")}</select></label>
      <label>Prezzo €<input data-r="prezzo" inputmode="decimal" value="${numIn(r.prezzo, true)}" enterkeyhint="done"></label>
    </div>
    <div class="riga-piede">
    <details class="riga-dettagli" data-riga="${esc(r.id)}" ${aperta ? "open" : ""}>
      <summary>Dettagli</summary>
      <div class="stack">
        <div class="riga-extra">
          <div class="seg" role="group" aria-label="Tipo di voce">
            <button type="button" data-action="tipo-riga" data-i="${i}" data-tipo="man" class="${r.tipo === "man" ? "on" : ""}">Manodopera</button>
            <button type="button" data-action="tipo-riga" data-i="${i}" data-tipo="mat" class="${r.tipo === "mat" ? "on" : ""}">Materiale</button>
          </div>
          ${forf ? "" : `<select data-r="iva" aria-label="IVA">${core.ALIQUOTE_IVA.map((a) => `<option value="${a}" ${Number(r.iva) === a ? "selected" : ""}>IVA ${a}%</option>`).join("")}</select>`}
        </div>
        <button type="button" class="pill-opz ${r.opzionale ? "on" : ""}" data-action="opzionale" data-i="${i}" aria-pressed="${r.opzionale ? "true" : "false"}"><span class="pallino"></span>Extra a scelta del cliente</button>
        <div class="muted xsmall" style="margin-top:-4px">Non entra nel totale: il cliente può aggiungerlo quando firma.</div>
        <div class="row wrap">
          <label class="mini">Sconto %<input data-r="sconto" inputmode="decimal" placeholder="0" value="${numIn(r.sconto, true)}"></label>
          ${r.tipo === "mat" ? `<label class="mini" title="Quanto lo paghi tu: serve a calcolare il guadagno, il cliente non lo vede">${ICONE.lucchetto.replace("<svg", '<svg width="16" height="16"')}Il tuo costo €<input data-r="costo" inputmode="decimal" placeholder="0" value="${numIn(r.costo, true)}"></label>` : ""}
        </div>
      </div>
    </details>
    ${segni}<span class="riga-importo" data-importo="${i}">${core.formatEuro(core.importoRiga(r))}</span>
    </div>
  </div>`;
}

const Riconoscimento = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

function micBtn(target) {
  if (!Riconoscimento) return "";
  return `<button type="button" class="mic" data-action="detta-campo" data-target="${target}" aria-label="Detta a voce">${ICONE.mic}</button>`;
}

function htmlRighe(prev) {
  return (
    prev.righe.map((r, i) => htmlRiga(r, i)).join("") ||
    `<p class="muted" style="margin:4px 0 0">Nessuna voce: aggiungile con i pulsanti qui sotto, anche dettandole tutte insieme.</p>`
  );
}

const testoNumeroVoci = (n) => (n === 1 ? "1 voce" : `${n} voci`);

// Le voci del listino usate più spesso, a un tocco.
function htmlPiuUsate() {
  if (!state.listino.length) return "";
  const uso = new Map();
  for (const p of state.preventivi)
    for (const r of p.righe || []) {
      const k = String(r.descrizione || "")
        .trim()
        .toLowerCase();
      if (k) uso.set(k, (uso.get(k) || 0) + 1);
    }
  const voci = state.listino
    .map((v) => ({ v, n: uso.get(v.descrizione.trim().toLowerCase()) || 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  if (!voci.length) return "";
  return `<div class="piu-usate"><div class="muted xsmall">Le più usate</div><div class="row wrap" style="gap:8px">${voci
    .map(
      ({ v }) =>
        `<button type="button" class="chip" data-action="usa-voce" data-id="${esc(v.id)}">${ICONE.piu.replace("<svg", '<svg width="16" height="16" style="margin-right:4px"')}${esc(v.descrizione.length > 28 ? v.descrizione.slice(0, 26) + "…" : v.descrizione)}</button>`,
    )
    .join("")}</div></div>`;
}

function htmlFoto(prev) {
  const foto = (prev.foto || []).filter((f) => immagineSicura(f.img));
  const badge = state.pro ? "" : `<span class="badge pro dx">PRO</span>`;
  return `<div class="sezione-titolo"><div><h2>Foto del lavoro</h2><div class="muted xsmall">Finiscono in una pagina del PDF</div></div>${badge}</div>
    <div class="foto-griglia">
      ${foto
        .map(
          (
            f,
          ) => `<figure><img src="${immagineSicura(f.img)}" alt="${esc(f.didascalia || "Foto del lavoro")}" loading="lazy">
          <button class="togli" data-action="togli-foto" data-id="${esc(f.id)}" aria-label="Togli la foto">${ICONE.chiudi}</button></figure>`,
        )
        .join("")}
      ${
        foto.length < MAX_FOTO
          ? state.pro
            ? `<label class="aggiungi">${ICONE.foto}Aggiungi<input type="file" accept="image/*" multiple id="input-foto" hidden></label>`
            : `<button class="aggiungi" data-action="paywall" data-motivo="foto">${ICONE.foto}Aggiungi</button>`
          : ""
      }
    </div>`;
}

const SCELTE_ACCONTO = [0, 20, 30, 50];

function htmlAcconto(prev) {
  const t = totaliDi(prev);
  const a = prev.acconto || { tipo: "perc", valore: 0 };
  const perc = a.tipo !== "importo" ? Number(a.valore) || 0 : null;
  const altro = perc === null || !SCELTE_ACCONTO.includes(perc) || state.accontoAltro.has(prev.id);
  const nome = prev.caparra ? "caparra" : "acconto";
  const senzaIncasso = t.acconto > 0 && !inc.ibanValido(state.azienda.iban) && !urlSicuro(state.azienda.linkPagamento);
  return `<div class="sezione-titolo" style="margin:0"><h2>Anticipo quando accetta</h2></div>
    <div class="seg seg-pieno" role="group" aria-label="Anticipo all'accettazione">
      ${SCELTE_ACCONTO.map((v) => `<button type="button" data-action="acconto" data-v="${v}" class="${!altro && perc === v ? "on" : ""}" aria-pressed="${!altro && perc === v}">${v ? `${v}%` : "Nessuno"}</button>`).join("")}
      <button type="button" data-action="acconto" data-v="altro" class="${altro ? "on" : ""}" aria-pressed="${altro}">Altro</button>
    </div>
    ${
      altro
        ? `<div class="grid2">
        <label class="campo">Come<select data-campo="acconto.tipo">
          <option value="perc" ${a.tipo !== "importo" ? "selected" : ""}>Percentuale</option>
          <option value="importo" ${a.tipo === "importo" ? "selected" : ""}>Importo fisso €</option>
        </select></label>
        <label class="campo">${a.tipo === "importo" ? "Importo €" : "Percentuale %"}<input data-campo="acconto.valore" inputmode="decimal" placeholder="0" value="${numIn(a.valore, true)}"></label>
      </div>`
        : ""
    }
    <div class="small" id="acconto-testo">${
      t.acconto > 0
        ? `Il cliente paga <b class="tnum">${esc(core.formatEuro(t.acconto))}</b> di ${nome} quando accetta e <b class="tnum">${esc(core.formatEuro(t.saldo))}</b> a fine lavori.`
        : "Nessun anticipo: il cliente paga tutto a fine lavori."
    }</div>
    ${senzaIncasso ? `<a class="btn ghost small" href="#/impostazioni" style="align-self:flex-start;padding-inline:0">${ICONE.pagamento} Aggiungi il tuo IBAN: il cliente paga l'anticipo con un tocco</a>` : ""}`;
}

function riassuntoOpzioni(prev) {
  const parti = [`valido ${Number(prev.validitaGiorni) || 0} giorni`];
  const date = inc.normalizzaDisponibilita(prev.disponibilita).length;
  if (prev.appuntamento) parti.push("inizio fissato");
  else if (date) parti.push(date === 1 ? "1 data proposta" : `${date} date proposte`);
  const foto = (prev.foto || []).length;
  if (foto) parti.push(foto === 1 ? "1 foto" : `${foto} foto`);
  if (prev.caparra) parti.push("caparra");
  if (Number(prev.scontoGlobale) > 0) parti.push(`sconto ${core.formatQta(prev.scontoGlobale)}%`);
  if (prev.firma) parti.push("firmato");
  return parti.join(" · ");
}

function htmlCondizioni(prev) {
  return `<div class="sezione-titolo" style="margin:0"><h2>Condizioni</h2></div>
    <div class="grid2">
      <label class="campo">Sconto sul totale %<input data-campo="scontoGlobale" inputmode="decimal" placeholder="0" value="${numIn(prev.scontoGlobale, true)}"></label>
      <label class="campo">Valido per (giorni)<input data-campo="validitaGiorni" inputmode="numeric" value="${numIn(prev.validitaGiorni)}"></label>
    </div>
    <label class="campo">L'anticipo vale come
      <select data-campo="caparra">
        <option value="0" ${prev.caparra ? "" : "selected"}>Acconto: si scala dal prezzo</option>
        <option value="1" ${prev.caparra ? "selected" : ""}>Caparra confirmatoria: se il cliente si tira indietro la trattieni</option>
      </select>
    </label>
    <label class="campo">Tempi di esecuzione<input data-campo="tempi" placeholder="es. 3 giorni lavorativi dall'accettazione" value="${esc(prev.tempi)}"></label>
    <label class="campo">Come ti paga<textarea data-campo="pagamento" rows="2" placeholder="es. Bonifico bancario">${esc(prev.pagamento)}</textarea></label>
    <label class="campo">Note e condizioni<textarea data-campo="note" rows="3">${esc(prev.note)}</textarea></label>`;
}

const titoloEditor = (prev) => (prev.cliente.nome || "").trim() || prev.oggetto || "Nuovo preventivo";

// Firmato dal cliente: voci e prezzi non si cambiano per sbaglio.
const bloccato = (prev) =>
  prev.stato === "accettato" && Boolean(prev.firma || prev.accettazioneOnline) && !state.sbloccati.has(prev.id);

function htmlBarra(prev) {
  const forf = forfettario(prev);
  const t = totaliDi(prev);
  const s = prev.stato === "accettato" ? incassoDi(prev) : null;
  if (s && s.fase !== "storico" && s.residuo > 0.005) {
    return `<footer class="barra-totale">
      <div class="tot"><div class="xsmall">Da incassare</div><div class="big ${s.fase === "scaduto" ? "testo-bad" : ""}">${esc(core.formatEuro(s.residuo))}</div></div>
      <button class="btn primary" data-action="registra-pagamento">${ICONE.pagamento}<span>Pagamento ricevuto</span></button>
    </footer>`;
  }
  if (s && s.fase === "pagato") {
    return `<footer class="barra-totale">
      <div class="tot"><div class="xsmall" style="color:var(--ok);font-weight:650">Pagato tutto</div><div class="big" id="tot-valore">${core.formatEuro(t.totale)}</div></div>
      <button class="btn" data-action="anteprima">${ICONE.occhio}<span>Vedi PDF</span></button>
    </footer>`;
  }
  return `<footer class="barra-totale">
      <div class="tot"><div class="xsmall">${forf ? "Totale" : "Totale IVA incl."}</div><div class="big" id="tot-valore">${core.formatEuro(t.totale)}</div></div>
      <button class="btn" data-action="anteprima" aria-label="Guarda il PDF">${ICONE.occhio}<span>Vedi</span></button>
      <button class="btn primary" data-action="invia">${ICONE.invia}<span>${prev.stato === "bozza" ? "Invia" : "Rimanda"}</span></button>
    </footer>`;
}

function htmlStatoBtn(prev) {
  const nome = core.STATI[prev.stato];
  return `<button class="stato-btn ${esc(prev.stato)}" data-action="stato" aria-label="Stato: ${esc(nome)}. Tocca per cambiarlo">${esc(nome)}${ICONE.giu}</button>`;
}

// Dopo un invio lo stato cambia senza ridisegnare l'editor (il foglio di invio può essere ancora aperto).
function aggiornaStatoEditor(prev) {
  if (state.corrente?.id !== prev.id) return;
  const btn = $(".topbar .stato-btn");
  if (btn) btn.outerHTML = htmlStatoBtn(prev);
  const striscia = $("#striscia-stato");
  if (striscia) striscia.innerHTML = htmlStrisciaStato(prev);
  const barra = $(".barra-totale");
  if (barra) barra.outerHTML = htmlBarra(prev);
}

function htmlStrisciaStato(prev) {
  const nome = (prev.cliente.nome || "").trim() || "Il cliente";
  if (prev.stato === "inviato") {
    return `<div class="banner info"><span class="ico">${ICONE.campanella}</span><div style="flex:1;min-width:0"><b>${esc(nome)} ha accettato?</b>
      <div class="small">Se firma online ti arriva un suo messaggio con un link: toccalo e qui si aggiorna tutto. Se ti ha detto di sì di persona o al telefono, segnalo tu.</div>
      <div class="row wrap" style="margin-top:10px"><button class="btn small" data-action="imposta-stato" data-stato="accettato">${ICONE.check} Sì, ha accettato</button><button class="btn small ghost" data-action="imposta-stato" data-stato="rifiutato">No, ha rifiutato</button></div></div></div>`;
  }
  if (prev.stato === "rifiutato") {
    return `<div class="banner bad"><span class="ico">${ICONE.info}</span><div style="flex:1;min-width:0"><b>Il cliente ha rifiutato</b><div class="small">Puoi rimandarlo con prezzi diversi o riaprirlo.</div>
      <div class="row wrap" style="margin-top:10px"><button class="btn small" data-action="imposta-stato" data-stato="inviato">Riapri</button></div></div></div>`;
  }
  return "";
}

function htmlAccettato(prev) {
  if (prev.stato !== "accettato") return "";
  const chi = prev.firma?.nome || prev.cliente.nome || "il cliente";
  const quando = prev.firma?.data
    ? core.formatData(core.oggiISO(new Date(prev.firma.data)))
    : prev.accettatoIl
      ? core.formatData(prev.accettatoIl)
      : "";
  const aggiunte = prev.accettazioneOnline?.facoltativeAggiunte || [];
  const firmato = prev.firma || prev.accettazioneOnline;
  return `<div class="banner ok"><span class="ico">${ICONE.fatto}</span><div style="flex:1;min-width:0">
    <b>${firmato ? `${prev.firma?.sulPosto ? "Firmato sul posto" : prev.accettazioneOnline ? "Firmato online" : "Firmato"} da ${esc(chi)}` : "Accettato"}${quando ? ` il ${esc(quando)}` : ""}</b>
    ${aggiunte.length ? `<div class="small">Ha aggiunto: ${esc(aggiunte.join(", "))}</div>` : ""}
    ${(() => {
      // La data di inizio resta sempre a portata (il resto del preventivo firmato è bloccato).
      const app = inc.normalizzaAppuntamento(prev.appuntamento);
      return app
        ? `<div class="small accettato-data">${ICONE.calendario}<span>Inizio: <b>${esc(inc.testoAppuntamento(app))}</b></span><button class="btn small ghost" data-action="appuntamento-ics">Metti in calendario</button></div>`
        : "";
    })()}
    ${bloccato(prev) ? `<div class="small">Voci e prezzi sono bloccati, così non cambi per sbaglio quello che ha firmato.</div><button class="btn small ghost" data-action="sblocca" style="padding-inline:0;margin-top:4px">${ICONE.matita} Modifica comunque</button>` : ""}
  </div></div>`;
}

function viewEditor(id, q = new URLSearchParams()) {
  const prev = state.preventivi.find((p) => p.id === id);
  if (!prev) {
    toast("Preventivo non trovato");
    vai("#/");
    return;
  }
  state.corrente = prev;
  document.body.classList.add("no-tabbar");
  const c = prev.cliente;
  const fermo = bloccato(prev);
  caricaPdfLib().catch(() => {});
  import("./pdf.js").catch(() => {});
  const rubrica = "contacts" in navigator && "select" in (navigator.contacts || {});

  app().innerHTML = `
    <header class="topbar">
      <a class="back" href="#/" aria-label="Torna ai preventivi">${ICONE.indietro}</a>
      <div class="titolo"><strong id="titolo-editor">${esc(titoloEditor(prev))}</strong><div class="sopra">N° ${esc(prev.numero)}</div></div>
      ${htmlStatoBtn(prev)}
      <button class="icon-btn" data-action="menu-preventivo" aria-label="Altre azioni">${ICONE.altro}</button>
    </header>
    <main class="pagina">
      ${htmlBannerVariante(prev)}
      ${htmlAccettato(prev)}
      <div id="striscia-stato">${htmlStrisciaStato(prev)}</div>
      <section class="card stack" id="sezione-incassi" ${mostraIncassi(prev) ? "" : "hidden"}>${mostraIncassi(prev) ? htmlIncassi(prev) : ""}</section>
      ${htmlVariantiDi(prev)}
      <fieldset class="blocco-modifica" ${fermo ? "disabled" : ""}>
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><h2>Per chi è</h2>${rubrica ? `<button type="button" class="btn ghost small dx" data-action="da-rubrica">${ICONE.clienti} Dalla rubrica</button>` : ""}</div>
        <label class="campo">Nome del cliente<input data-campo="cliente.nome" list="lista-clienti" autocomplete="off" placeholder="es. Mario Bianchi" value="${esc(c.nome)}" enterkeyhint="next"></label>
        <datalist id="lista-clienti">${state.clienti.map((x) => `<option value="${esc(x.nome)}"></option>`).join("")}</datalist>
        <div class="grid2 stack-mobile">
          <label class="campo">Cellulare (WhatsApp)<input data-campo="cliente.telefono" type="tel" inputmode="tel" placeholder="es. 333 123 4567" value="${esc(c.telefono)}" enterkeyhint="next"></label>
          <label class="campo"><span>Email <span class="aiuto">facoltativa</span></span><input data-campo="cliente.email" type="email" placeholder="es. mario@email.it" value="${esc(c.email)}"></label>
        </div>
        <details ${c.indirizzo || c.cfpiva ? "open" : ""}>
          <summary>Indirizzo e dati fiscali</summary>
          <div class="stack">
            <label class="campo">Indirizzo<input data-campo="cliente.indirizzo" placeholder="es. Via Roma 12" value="${esc(c.indirizzo)}"></label>
            <label class="campo">CAP, città e provincia<input data-campo="cliente.citta" placeholder="es. 24121 Bergamo BG" value="${esc(c.citta)}"></label>
            <label class="campo">Codice fiscale o partita IVA<input data-campo="cliente.cfpiva" autocapitalize="characters" spellcheck="false" value="${esc(c.cfpiva)}"></label>
            <label class="check small"><input type="checkbox" data-campo="cliente.impresa" ${inc.clienteImpresa(c) ? "checked" : ""}> <span>È un'impresa o un ente pubblico (cambia il tasso degli interessi di mora; condomini e privati no)</span></label>
          </div>
        </details>
      </section>

      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><h2>Cosa c'è da fare</h2><span class="muted small dx" id="n-righe">${testoNumeroVoci(prev.righe.length)}</span></div>
        <label class="campo">Titolo del lavoro<span class="con-mic"><input data-campo="oggetto" placeholder="es. Rifacimento bagno" value="${esc(prev.oggetto)}">${micBtn("oggetto")}</span></label>
        <div id="righe">${htmlRighe(prev)}</div>
        <div id="parti-da">${htmlPartiDa(prev)}</div>
        <div class="azioni-righe">
          <button class="btn soft" data-action="dal-listino">${ICONE.listino}Dai miei prezzi</button>
          ${Riconoscimento ? `<button class="btn soft" data-action="detta-righe">${ICONE.mic}Detta a voce</button>` : `<button class="btn soft" data-action="aggiungi-riga" data-tipo="mat">${ICONE.piu}Materiale</button>`}
          <button class="btn soft" data-action="aggiungi-riga">${ICONE.matita}Scrivi a mano</button>
        </div>
        <div id="piu-usate">${htmlPiuUsate()}</div>
        <div class="riepilogo" id="riepilogo">${htmlRiepilogo(prev)}</div>
      </section>

      <section class="card stack" id="sezione-acconto">${htmlAcconto(prev)}</section>

      <details class="card altre-opzioni" id="altre-opzioni" ${state.altreAperte.has(prev.id) ? "open" : ""}>
        <summary><span class="corpo"><b>Altre opzioni</b><span class="small" id="riassunto-opzioni">${esc(riassuntoOpzioni(prev))}</span></span></summary>
        <div class="blocchi">
          <div class="blocco stack"><label class="campo"><span>Indirizzo del cantiere <span class="aiuto">se diverso da quello del cliente</span></span><input data-campo="luogo" placeholder="es. Via Verdi 3, Bergamo" value="${esc(prev.luogo)}"></label></div>
          <div class="blocco stack" id="sezione-date">${htmlDate(prev)}</div>
          <div class="blocco" id="sezione-foto">${htmlFoto(prev)}</div>
          <div class="blocco stack">${htmlCondizioni(prev)}</div>
          <div class="blocco stack" id="sezione-firma">${htmlFirma(prev)}</div>
        </div>
      </details>
      </fieldset>
    </main>
    ${htmlBarra(prev)}`;

  $$("textarea", app()).forEach(autoAltezza);
  collegaInputFoto();
  ombraTopbar();
  $("#altre-opzioni").addEventListener("toggle", (e) => {
    if (e.target.open) state.altreAperte.add(prev.id);
    else state.altreAperte.delete(prev.id);
  });
  if (q.get("sez") === "incassi") $("#sezione-incassi")?.scrollIntoView({ block: "start" });
  // Dalla home: "Sollecita" o "Chiedi" aprono subito il messaggio pronto.
  const azione = q.get("azione");
  if (azione === "sollecito" || azione === "chiedi") {
    history.replaceState(null, "", `#/p/${prev.id}?sez=incassi`);
    const s = incassoDi(prev);
    foglioSollecito(azione === "sollecito" ? inc.sollecitoSuggerito(s).livello : 0);
  }
  if (state.festa === prev.id) {
    state.festa = null;
    foglioFesta(prev);
  }
}

// Lavoro saldato: il secondo timbro, e il momento giusto per chiedere una recensione.
function foglioPagato(prev) {
  const t = totaliDi(prev);
  const link = urlSicuro(state.azienda.linkRecensioni);
  apriFoglio(
    `<div class="festa">
      <div class="timbro anima" aria-hidden="true">Pagato<small>${esc(core.formatData(core.oggiISO()))}</small></div>
      <h3>Lavoro pagato tutto</h3>
      <p class="muted" style="margin:0">${esc(core.nomeCliente(prev.cliente))} · <span class="tnum">${esc(core.formatEuro(t.totale))}</span></p>
      <div class="stack" style="width:100%;margin-top:8px">
        ${
          link
            ? `<a class="btn wa big block" href="${esc(waLink(prev.cliente.telefono, inc.messaggioRecensione(prev, state.azienda, link)))}" target="_blank" rel="noopener" data-action="recensione-chiesta" data-id="${esc(prev.id)}">${ICONE.stella} Chiedi una recensione</a>`
            : `<a class="btn big block" href="#/impostazioni">${ICONE.stella} Imposta il link per le recensioni</a>`
        }
        <button class="btn ghost block" data-action="chiudi-foglio">Fatto</button>
      </div>
    </div>`,
    { classe: "piccolo" },
  );
  vibra(VIBRA.successo);
}

// Il momento più bello: il cliente ha firmato. Un timbro, una vibrazione e il passo successivo.
function foglioFesta(prev) {
  const t = totaliDi(prev);
  const s = incassoDi(prev);
  const nome = prev.firma?.nome || core.nomeCliente(prev.cliente);
  const acconto = s.prossima && s.prossima.tipo === "acconto" && s.prossima.importo > 0 ? s.prossima : null;
  apriFoglio(
    `<div class="festa">
      <div class="timbro anima" aria-hidden="true">Accettato<small>${esc(core.formatData(core.oggiISO()))}</small></div>
      <h3>${esc(nome)} ha firmato!</h3>
      <p class="muted" style="margin:0">Preventivo n. ${esc(prev.numero)} · <span class="tnum">${esc(core.formatEuro(t.totale))}</span></p>
      <div class="stack" style="width:100%;margin-top:8px">
        ${
          acconto && prev.firma?.sulPosto && inc.ibanValido(state.azienda.iban)
            ? `<button class="btn primary big block" data-action="mostra-qr">${ICONE.qr} Fagli pagare ${prev.caparra ? "la caparra" : "l'acconto"} adesso</button>
               <p class="muted small" style="margin:-4px 0 4px;text-align:center">Inquadra il QR con l'app della banca: ${esc(core.formatEuro(acconto.importo))}, bonifico già compilato</p>`
            : acconto
              ? `<button class="btn wa big block" data-action="sollecito" data-livello="0">${ICONE.whatsapp} Chiedi ${prev.caparra ? "la caparra" : "l'acconto"} di ${esc(core.formatEuro(acconto.importo))}</button>`
              : ""
        }
        ${prev.appuntamento ? "" : `<button class="btn big block ${acconto ? "" : "primary"}" data-action="fissa-data">${ICONE.calendario} Fissa l'inizio dei lavori</button>`}
        <button class="btn ghost block" data-action="chiudi-foglio">Fatto</button>
      </div>
    </div>`,
    { classe: "piccolo" },
  );
  vibra(VIBRA.successo);
}

function foglioStato(prev) {
  const opzioni = [
    ["bozza", "Da inviare", "Lo stai ancora preparando"],
    ["inviato", "In attesa di risposta", "L'hai mandato al cliente"],
    ["accettato", "Accettato", "Ha detto sì: online, a voce o di persona"],
    ["rifiutato", "Rifiutato", "Ha detto no"],
  ];
  apriFoglio(
    `${titoloFoglio("A che punto è?", `Preventivo n. ${esc(prev.numero)}`)}
    <div class="lista-azioni">${opzioni
      .map(
        ([k, t, sotto]) =>
          `<button data-action="imposta-stato" data-stato="${k}" class="${prev.stato === k ? "principale" : ""}" aria-pressed="${prev.stato === k}"><span class="ico">${prev.stato === k ? ICONE.check : ""}</span><span class="corpo">${esc(t)}<small>${esc(sotto)}</small></span></button>`,
      )
      .join("")}</div>`,
    { classe: "piccolo" },
  );
}

async function impostaStato(prev, valore) {
  if (!core.STATI[valore]) return;
  chiudiFoglio(true);
  if (prev.stato === valore) return;
  prev.stato = valore;
  if (valore === "accettato") {
    if (!prev.accettatoIl) prev.accettatoIl = core.oggiISO();
    fissaAccordo(prev);
  } else if (prev.incasso) {
    prev.incasso.accontoPattuito = null;
  }
  if (valore === "inviato" && !prev.inviatoIl) prev.inviatoIl = Date.now();
  await salvaPreventivo(prev);
  viewEditor(prev.id);
  if (valore === "accettato") {
    toast("Accettato: ora qui segui i pagamenti", "ok");
    $("#sezione-incassi")?.scrollIntoView({ block: "start" });
  }
}

// ------------------------------------------------------------------
// Editor: incassi (pagamenti, scadenze, solleciti, QR, PDF di recupero)
// ------------------------------------------------------------------
function sottotitoloIncasso(prev, s) {
  if (!s.accettato) return "Il preventivo non risulta accettato";
  if (s.fase === "pagato") return "Tutto incassato";
  if (s.fase === "storico") return "Accettato prima del registro incassi";
  const p = s.prossima;
  if (!p) return "";
  if (p.tipo === "acconto")
    return p.data
      ? `${nomeAnticipo(prev)} ${core.formatEuro(p.importo)} entro il ${core.formatData(p.data)}`
      : `${nomeAnticipo(prev)} ${core.formatEuro(p.importo)} da ricevere`;
  return p.data
    ? `Saldo ${core.formatEuro(p.importo)} entro il ${core.formatData(p.data)}`
    : `Saldo ${core.formatEuro(p.importo)}: scade ${s.giorniSaldo ? `${s.giorniSaldo} giorni dopo la` : "alla"} fine dei lavori`;
}

function htmlIncassi(prev) {
  const s = incassoDi(prev);
  const a = state.azienda;
  const sug = inc.sollecitoSuggerito(s);
  const recensioni = urlSicuro(a.linkRecensioni);
  const scad = s.fase === "scaduto";
  const pro = state.pro ? "" : ` <span class="badge pro">PRO</span>`;
  const daIncassare = s.residuo > 0.005 && s.accettato && s.fase !== "storico";
  // Giorni di sollecito una volta sola (anche se generati più volte nello stesso giorno).
  const registroSolleciti = [
    ...new Map(
      s.solleciti.map((x) => {
        const giorno = core.oggiISO(new Date(x.il));
        const tipo =
          x.canale === "lettera" ? "lettera di messa in mora" : inc.LIVELLI_SOLLECITO[x.livello].toLowerCase();
        return [giorno + tipo, `${core.formatData(giorno)} (${tipo})`];
      }),
    ).values(),
  ];
  const livello = scad ? sug.livello : 0;
  const finitiILavori = !s.fineLavori && s.accettato && ["in-corso", "attesa-acconto"].includes(s.fase);
  const testoDate = s.fineLavori
    ? `Fine lavori ${core.formatData(s.fineLavori)} · saldo ${s.giorniSaldo ? `entro ${s.giorniSaldo} giorni` : "a fine lavori"}`
    : `Saldo ${s.giorniSaldo ? `entro ${s.giorniSaldo} giorni dalla fine dei lavori` : "a fine lavori"}`;
  return `<div class="sezione-titolo" style="margin:0"><div><h2>Pagamenti</h2><div class="muted xsmall">${esc(sottotitoloIncasso(prev, s))}</div></div><span class="badge ${esc(s.fase)} dx">${esc(inc.FASI[s.fase])}</span></div>
    <div class="inc-totali">
      <div><div class="muted xsmall">Incassato</div><b class="tnum">${esc(core.formatEuro(s.incassato))}</b></div>
      <div><div class="muted xsmall">Da incassare</div><b class="tnum ${scad ? "testo-bad" : ""}">${esc(core.formatEuro(s.residuo))}</b></div>
    </div>
    <div class="barra-limite" role="progressbar" aria-label="Quota incassata" aria-valuenow="${s.percentuale}" aria-valuemin="0" aria-valuemax="100"><i style="width:${s.percentuale}%"></i></div>
    ${s.segnalazioniAttesa
      .map(
        (
          x,
        ) => `<div class="banner info"><span class="ico">${ICONE.campanella}</span><div style="flex:1;min-width:0"><b>Il cliente dice di aver pagato ${esc(core.formatEuro(x.importo))}</b>
        <div class="small">${esc(inc.METODI[x.metodo])}${x.data ? ` · ${esc(core.formatData(x.data))}` : ""}${x.nota ? ` · ${esc(x.nota)}` : ""}. Controlla sul conto prima di confermare.</div>
        <div class="stack" style="margin-top:10px"><button class="btn primary block" data-action="segnalazione-ok" data-rif="${esc(x.rif)}" data-il="${x.il}">${ICONE.check} Sì, è arrivato: registra</button><button class="btn ghost block" data-action="segnalazione-no" data-rif="${esc(x.rif)}" data-il="${x.il}">Non è arrivato</button></div></div></div>`,
      )
      .join("")}
    ${scad ? `<div class="banner bad"><span class="ico">${ICONE.attenzione}</span><div><b>${esc(core.formatEuro(s.importoScaduto))} in ritardo</b>${esc(inc.descriviScadenza(s))}. Il primo messaggio è gentile, poi il tono sale.</div></div>` : ""}
    ${s.fase === "attesa-acconto" && s.accettato ? `<div class="banner warn"><span class="ico">${ICONE.scudo}</span><div>Inizia i lavori dopo aver ricevuto ${prev.caparra ? "la caparra" : "l'acconto"}: è la protezione migliore contro chi firma e poi non paga.</div></div>` : ""}
    ${!s.accettato ? `<div class="banner info"><span class="ico">${ICONE.info}</span><div>C'è un pagamento su un preventivo non ancora accettato: se il cliente ha accettato, segnalo dallo stato in alto e l'app seguirà le scadenze.</div></div>` : ""}
    ${s.fase === "storico" ? `<div class="banner info"><span class="ico">${ICONE.storico}</span><div>Accettato prima del registro dei pagamenti: segna quelli già ricevuti o la data di fine lavori e l'app seguirà le scadenze.</div></div>` : ""}
    <div class="prossimo-passo">
      ${
        finitiILavori && s.fase === "in-corso"
          ? `<button class="btn wa big block" data-action="lavori-finiti">${ICONE.whatsapp} Ho finito: chiedi il saldo</button>`
          : daIncassare && s.fase !== "in-corso"
            ? `<button class="btn wa big block" data-action="sollecito" data-livello="${livello}">${ICONE.whatsapp} ${esc(inc.AZIONI_SOLLECITO[livello])}</button>`
            : ""
      }
      ${finitiILavori && s.fase !== "in-corso" ? `<button class="btn block" data-action="lavori-finiti">${ICONE.fatto} Ho finito i lavori: chiedi il saldo</button>` : ""}
      ${
        daIncassare
          ? `<button class="btn block" data-action="mostra-qr" aria-label="Mostra il QR da far inquadrare al cliente">${ICONE.qr} Mostra il QR per pagare</button>`
          : `<div class="grid2">
        <button class="btn" data-action="registra-pagamento">${ICONE.pagamento} Pagamento ricevuto</button>
        <button class="btn" data-action="mostra-qr" aria-label="Mostra il QR da far inquadrare al cliente">${ICONE.qr} QR per il cliente</button>
      </div>`
      }
    </div>
    ${
      s.accettato && s.prossima && s.prossima.data && s.prossima.data >= core.oggiISO()
        ? `<button class="btn ghost block small" data-action="promemoria-scadenza">${ICONE.sveglia} Ricordami la scadenza del ${esc(core.formatData(s.prossima.data))} nel calendario</button>`
        : ""
    }
    ${
      s.pagamenti.length
        ? `<div><div class="muted xsmall">Pagamenti ricevuti</div><div class="inc-lista">${s.pagamenti
            .map(
              (
                x,
              ) => `<div class="inc-riga"><div class="corpo"><b class="tnum">${esc(core.formatEuro(x.importo))}</b> <span class="muted small">${esc(inc.METODI[x.metodo])} · ${esc(core.formatData(x.data))}</span>${x.nota ? `<div class="muted xsmall">${esc(x.nota)}</div>` : ""}</div>
              <button class="icon-btn" data-action="togli-pagamento" data-id="${esc(x.id)}" aria-label="Elimina pagamento di ${esc(core.formatEuro(x.importo))}">${ICONE.cestino}</button></div>`,
            )
            .join("")}</div></div>`
        : ""
    }
    <details class="date-incasso" ${s.fase === "storico" ? "open" : ""}>
      <summary>${esc(testoDate)} · cambia</summary>
      <div class="grid2 stack-mobile">
        <label class="campo">Fine lavori<input type="date" data-inc="fineLavori" value="${esc(s.fineLavori)}" max="${core.aggiungiGiorni(core.oggiISO(), 730)}"></label>
        <label class="campo">Saldo entro<select data-inc="giorniSaldo">${[0, 7, 15, 30, 60, 90]
          .map(
            (n) =>
              `<option value="${n}" ${s.giorniSaldo === n ? "selected" : ""}>${n === 0 ? "fine lavori" : `${n} giorni`}</option>`,
          )
          .join("")}</select></label>
      </div>
    </details>
    ${
      daIncassare && (scad || s.solleciti.length)
        ? `<details class="inc-recupero">
      <summary>Se non paga: lettera e dossier${pro}</summary>
      <div class="stack">
        ${registroSolleciti.length ? `<div class="muted xsmall">Solleciti mandati: ${esc(registroSolleciti.join(" · "))}</div>` : ""}
        ${scad ? `<button class="btn block" data-action="pdf-diffida">${ICONE.documento} Lettera di messa in mora (PDF)</button>` : ""}
        <button class="btn block" data-action="pdf-fascicolo">${ICONE.documento} Dossier del credito per l'avvocato (PDF)</button>
        <div class="muted xsmall">${esc(AVVISO_LEGALE)}</div>
      </div>
    </details>`
        : ""
    }
    ${
      s.fase === "pagato"
        ? `<div class="banner ok"><span class="ico">${ICONE.fatto}</span><div><b>Pagato tutto.</b>${s.eccedenza > 0 ? ` Hai registrato ${esc(core.formatEuro(s.eccedenza))} in più del totale: controlla i pagamenti.` : ""}</div></div>
      ${
        recensioni
          ? `<a class="btn wa block" href="${esc(waLink(prev.cliente.telefono, inc.messaggioRecensione(prev, a, recensioni)))}" target="_blank" rel="noopener" data-action="recensione-chiesta" data-id="${esc(prev.id)}">${ICONE.stella} ${s.recensioneChiestaIl ? "Chiedi di nuovo la recensione" : "Chiedi una recensione su WhatsApp"}</a>`
          : `<a class="btn ghost block" href="#/impostazioni">${ICONE.stella} Imposta il link per chiedere recensioni</a>`
      }`
        : ""
    }`;
}

function aggiornaIncassi() {
  incassiDaRidisegnare = false;
  const prev = state.corrente;
  const el = $("#sezione-incassi");
  if (!prev || !el) return;
  const mostra = mostraIncassi(prev);
  el.hidden = !mostra;
  // Le parti aperte a mano (date, "Se non paga") restano aperte dopo il ridisegno.
  const aperte = [...el.querySelectorAll("details[open]")].map((d) => d.className);
  el.innerHTML = mostra ? htmlIncassi(prev) : "";
  for (const d of el.querySelectorAll("details")) if (aperte.includes(d.className)) d.open = true;
  const barra = $(".barra-totale");
  if (barra) barra.outerHTML = htmlBarra(prev);
}

async function salvaIncasso(prev, messaggio, tipo = "ok") {
  prev.incasso = inc.normalizzaIncasso(prev.incasso);
  await salvaPreventivo(prev);
  aggiornaIncassi();
  if (messaggio) toast(messaggio, tipo);
}

function foglioPagamento() {
  const prev = state.corrente;
  const s = incassoDi(prev);
  const proposta = s.prossima ? s.prossima.importo : 0;
  const metodi = Object.entries(inc.METODI);
  const f = apriFoglio(
    `${titoloFoglio("Quanto hai ricevuto?", `Da incassare ${esc(core.formatEuro(s.residuo))}`)}
    <div class="stack">
      <div class="grid2">
        <label class="campo">Importo €<input id="pag-importo" inputmode="decimal" placeholder="0,00" value="${numIn(proposta, true)}" enterkeyhint="done"></label>
        <label class="campo">Data<input id="pag-data" type="date" value="${core.oggiISO()}"></label>
      </div>
      ${
        s.prossima && s.residuo > s.prossima.importo + 0.005
          ? `<div class="row wrap"><button type="button" class="chip" data-action="pag-importo" data-v="${s.prossima.importo}">${esc(s.prossima.tipo === "acconto" ? nomeAnticipo(prev) : "Saldo")} ${esc(core.formatEuro(s.prossima.importo))}</button><button type="button" class="chip" data-action="pag-importo" data-v="${s.residuo}">Tutto ${esc(core.formatEuro(s.residuo))}</button></div>`
          : ""
      }
      <div class="seg seg-pieno" role="radiogroup" aria-label="Come ti ha pagato">${metodi
        .map(
          ([k, v], n) =>
            `<button type="button" role="radio" data-action="pag-metodo" data-m="${k}" class="${n === 0 ? "on" : ""}" aria-checked="${n === 0}">${esc(v)}</button>`,
        )
        .join("")}</div>
      <input id="pag-nota" maxlength="300" placeholder="Nota facoltativa, es. numero CRO del bonifico" aria-label="Nota" data-no-focus="1">
      <button class="btn primary big block" data-action="pag-salva" id="pag-salva">${ICONE.check} Registra</button>
    </div>`,
  );
  let metodo = metodi[0][0];
  const aggiornaPulsante = () => {
    const v = inc.importoValido($("#pag-importo", f).value);
    $("#pag-salva", f).innerHTML = `${ICONE.check} ${v > 0 ? `Registra ${esc(core.formatEuro(v))}` : "Registra"}`;
  };
  aggiornaPulsante();
  $("#pag-importo", f).addEventListener("input", aggiornaPulsante);
  $("#pag-importo", f).addEventListener("keydown", (e) => {
    if (e.key === "Enter") azioni["pag-salva"]();
  });
  let registrato = false; // un doppio tocco non registra due volte lo stesso pagamento
  azioni["pag-importo"] = (el) => {
    $("#pag-importo", f).value = numIn(Number(el.dataset.v));
    aggiornaPulsante();
  };
  azioni["pag-metodo"] = (el) => {
    metodo = el.dataset.m;
    $$("[data-action=pag-metodo]", f).forEach((b) => {
      b.classList.toggle("on", b === el);
      b.setAttribute("aria-checked", String(b === el));
    });
  };
  azioni["pag-salva"] = async () => {
    if (registrato) return;
    const importo = inc.importoValido($("#pag-importo", f).value);
    if (!(importo > 0)) return toast("Scrivi quanto hai ricevuto");
    registrato = true;
    const data = $("#pag-data", f).value;
    const i = incassoModificabile(prev);
    i.storico = false;
    i.pagamenti.push({
      id: core.uid(),
      importo,
      data: inc.dataValida(data) ? data : core.oggiISO(),
      metodo: Object.hasOwn(inc.METODI, metodo) ? metodo : "altro",
      nota: $("#pag-nota", f).value.trim(),
    });
    chiudiFoglio();
    traccia("Pagamento registrato");
    await salvaIncasso(prev);
    const dopo = incassoDi(prev);
    if (dopo.fase === "pagato") return foglioPagato(prev);
    vibra();
    toast(`Registrato · restano ${core.formatEuro(dopo.residuo)}`, "ok");
  };
}

// Lo stesso bonifico può arrivare due volte: registrato a mano e poi segnalato dal cliente, o
// segnalato da due link diversi. Si cerca un pagamento con lo stesso importo vicino nel tempo.
function pagamentoSimile(i, importo, data, rif) {
  return (
    i.pagamenti.find(
      (x) =>
        x.rif !== rif &&
        Math.abs(x.importo - importo) < 0.005 &&
        Math.abs(inc.giorniTra(x.data, inc.dataValida(data) ? data : core.oggiISO())) <= 14,
    ) || null
  );
}

// Registra l'avviso del cliente come pagamento (o lo collega a un pagamento già inserito a mano).
function registraDaAvviso(i, seg, collegaA = null) {
  if (collegaA) {
    if (!collegaA.rif) collegaA.rif = seg.rif;
  } else if (!(seg.rif && i.pagamenti.some((x) => x.rif === seg.rif))) {
    i.pagamenti.push({
      id: core.uid(),
      importo: seg.importo,
      data: seg.data || core.oggiISO(),
      metodo: seg.metodo,
      nota: ["Segnalato dal cliente", seg.nota].filter(Boolean).join(": "),
      rif: seg.rif,
    });
  }
  i.storico = false;
  for (const x of i.segnalazioni) if (x.rif === seg.rif) x.stato = "confermata";
}

async function confermaSegnalazione(rif, il, arrivato) {
  const prev = state.corrente;
  const i = incassoModificabile(prev);
  const seg = i.segnalazioni.find((x) => x.rif === rif && x.il === il && x.stato === "attesa");
  if (!seg) return;
  if (!arrivato) {
    seg.stato = "respinta";
    return salvaIncasso(prev, "Segnato come non arrivato", "");
  }
  const simile = pagamentoSimile(i, seg.importo, seg.data, seg.rif);
  let collega = null;
  if (simile) {
    const stesso = await chiedi({
      titolo: `Hai già registrato ${core.formatEuro(simile.importo)} il ${core.formatData(simile.data)}`,
      testo: "È lo stesso pagamento che il cliente ti sta segnalando? Se sì, non viene contato due volte.",
      ok: "Sì, è lo stesso",
      annulla: "No, è un altro",
    });
    if (stesso) collega = simile;
  }
  registraDaAvviso(i, seg, collega);
  await salvaIncasso(prev, collega ? "Avviso collegato al pagamento già registrato" : "Pagamento registrato");
  if (incassoDi(prev).fase === "pagato") foglioPagato(prev);
}

const daChiedere = (prev, s) => inc.daChiedere(prev, s);

function foglioQr() {
  const prev = state.corrente;
  const a = state.azienda;
  if (!inc.ibanValido(a.iban))
    return toast(
      a.iban ? "L'IBAN nelle impostazioni non è valido: controllalo" : "Inserisci il tuo IBAN nelle impostazioni",
    );
  const s = incassoDi(prev);
  if (!(s.residuo > 0.005)) return toast("Non c'è nulla da incassare");
  const { importo, causale } = daChiedere(prev, s);
  const payload = inc.payloadEpc({ nome: a.intestatarioIban || a.ragioneSociale, iban: a.iban, importo, causale });
  if (!payload) return toast("Controlla nome e IBAN nelle impostazioni");
  apriFoglio(
    `${titoloFoglio("Fai inquadrare il QR al cliente", `${esc(core.formatEuro(importo))} · ${esc(causale)}`)}
    <div class="qr-grande">${svgQr(payload, { etichetta: `QR per pagare ${core.formatEuro(importo)} con bonifico` })}</div>
    <p class="muted small" style="text-align:center;margin:12px 0">Il cliente lo inquadra con l'app della sua banca e il bonifico si compila da solo. Funziona con le app che leggono i QR SEPA; con le altre basta l'IBAN.</p>
    <button class="btn primary big block" data-action="registra-pagamento">${ICONE.check} Ha pagato: registra</button>`,
  );
}

async function foglioSollecito(livelloRichiesto) {
  const prev = state.corrente;
  const s = incassoDi(prev);
  if (!(s.residuo > 0.005)) return toast("Non c'è nulla da incassare");
  let livello = state.pro ? livelloRichiesto : Math.min(livelloRichiesto, 1);
  const sug = inc.sollecitoSuggerito(s);
  const richiesta = daChiedere(prev, s);
  let link = "";
  try {
    link = (
      await creaLinkRichiesta(BASE(), prev, state.azienda, {
        ...richiesta,
        scadenza: s.scadutoDal || s.prossima?.data || "",
        totale: s.totale,
        incassato: s.incassato,
        pro: state.pro,
      })
    ).url;
  } catch {
    link = "";
  }
  const testo = (l) => inc.messaggioSollecito(prev, state.azienda, s, l, { link });
  const email = prev.cliente.email || "";
  // I toni decisi servono solo con importi scaduti.
  const scaduto = s.importoScaduto > 0;
  if (!scaduto) livello = Math.min(livello, 1);
  const f = apriFoglio(
    `${titoloFoglio(livello ? "Sollecita il pagamento" : "Chiedi il pagamento", `${esc(core.nomeCliente(prev.cliente))} · ${esc(core.formatEuro(richiesta.importo))}`)}
    <div class="muted xsmall" style="margin:-6px 0 8px">Scegli il tono: il messaggio qui sotto si aggiorna e puoi cambiarlo.</div>
    <div class="stack">
      <div class="seg seg-pieno" role="group" aria-label="Tono del messaggio">${[0, 1, 2, 3]
        .map(
          (l) =>
            `<button type="button" data-action="tono" data-l="${l}" class="${l === livello ? "on" : ""}" aria-pressed="${l === livello}" ${l >= 2 && !scaduto ? 'disabled title="Solo per importi scaduti"' : ""}>${esc(inc.TONI_MESSAGGIO[l])}${l >= 2 && !state.pro && scaduto ? ` <span class="badge pro" style="padding:1px 5px;font-size:10px">PRO</span>` : ""}</button>`,
        )
        .join("")}</div>
      ${sug.troppoPresto ? `<div class="banner warn"><span class="ico">${ICONE.orologio}</span><div>Hai già sollecitato il ${esc(core.formatData(core.oggiISO(new Date(sug.ultimo))))}: di solito conviene aspettare una settimana tra un messaggio e l'altro.</div></div>` : ""}
      <textarea id="sol-testo" rows="9" aria-label="Messaggio da inviare">${esc(testo(livello))}</textarea>
      ${link ? `<p class="muted xsmall" style="margin:0">Il messaggio contiene un link dove il cliente trova importo, IBAN, QR del bonifico e il pulsante "Ho pagato".</p>` : ""}
      <div class="lista-azioni">
        <a href="#" id="sol-wa" class="principale" target="_blank" rel="noopener" data-action="sol-inviato" data-canale="whatsapp"><span class="ico wa">${ICONE.whatsapp}</span><span class="corpo">Manda su WhatsApp<small>${esc(prev.cliente.telefono || "Scegli il contatto")}</small></span></a>
        <button data-action="sol-copia"><span class="ico">${ICONE.copia}</span><span class="corpo">Copia il messaggio<small>Per SMS, Telegram...</small></span></button>
        <a href="#" id="sol-mail" data-action="sol-inviato" data-canale="email"><span class="ico">${ICONE.mail}</span><span class="corpo">Email<small>${esc(email || "Scegli il destinatario")}</small></span></a>
      </div>
    </div>`,
  );
  const area = $("#sol-testo", f);
  const aggiornaLink = () => {
    $("#sol-wa", f).href = waLink(prev.cliente.telefono, area.value);
    $("#sol-mail", f).href =
      `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Pagamento preventivo n. ${prev.numero}`)}&body=${encodeURIComponent(area.value)}`;
  };
  aggiornaLink();
  autoAltezza(area);
  area.addEventListener("input", aggiornaLink);
  azioni.tono = (el) => {
    const l = Number(el.dataset.l);
    if (l >= 2 && !scaduto) return;
    if (l >= 2 && !state.pro) return paywall("crediti");
    livello = l;
    area.value = testo(l);
    autoAltezza(area);
    aggiornaLink();
    $$("[data-action=tono]", f).forEach((b) => {
      b.classList.toggle("on", Number(b.dataset.l) === l);
      b.setAttribute("aria-pressed", String(Number(b.dataset.l) === l));
    });
  };
  let registrato = false; // un messaggio aperto o copiato più volte vale come un solo sollecito
  const registra = async (canale) => {
    if (livello < 1 || registrato) return;
    registrato = true;
    incassoModificabile(prev).solleciti.push({ il: Date.now(), livello, canale });
    await salvaIncasso(prev);
    traccia("Sollecito", { livello, canale });
  };
  azioni["sol-inviato"] = (el) => {
    registra(el.dataset.canale);
    setTimeout(() => chiudiFoglio(), 300);
  };
  azioni["sol-copia"] = async () => {
    const ok = await copiaTesto(area.value);
    toast(ok ? "Messaggio copiato" : "Copia non riuscita");
    if (ok) registra("copia");
  };
}

async function pdfDiffida() {
  if (!state.pro) return paywall("crediti");
  const prev = state.corrente;
  const s = incassoDi(prev);
  if (!(s.importoScaduto > 0))
    return toast("Non ci sono importi scaduti: la lettera si manda solo per somme già dovute");
  if (!prev.cliente.nome) return toast("Inserisci il nome del cliente");
  const a = state.azienda;
  try {
    await caricaPdfLib();
    const { creaDiffidaBlob } = await import("./pdf.js");
    const blob = creaDiffidaBlob({
      prev,
      azienda: state.azienda,
      totali: totaliDi(prev),
      stato: s,
      config: CONFIG,
      // Privati: tasso legale; clienti con partita IVA: tasso del D.Lgs. 231/2002.
      tassoMora: inc.clienteImpresa(prev.cliente) ? a.tassoMoraImprese : a.tassoMoraPrivati,
    });
    scaricaBlob(blob, nomeFile("Messa-in-mora", prev, "pdf"));
  } catch (err) {
    return toast(err.message || "Errore nella creazione del PDF");
  }
  traccia("Messa in mora");
  // Generarla non vuol dire averla spedita: nel fascicolo finisce solo quando la mandi davvero.
  const inviata = await chiedi({
    titolo: "Lettera pronta",
    testo:
      "Firmala e inviala con PEC o raccomandata A/R. Quando l'hai spedita, registrala qui: comparirà nel fascicolo del credito con la data di oggi.",
    ok: "L'ho inviata oggi",
    annulla: "Non ancora",
  });
  if (!inviata) return;
  const i = incassoModificabile(prev);
  const oggi = core.oggiISO();
  if (!i.solleciti.some((x) => x.canale === "lettera" && core.oggiISO(new Date(x.il)) === oggi))
    i.solleciti.push({ il: Date.now(), livello: 3, canale: "lettera" });
  await salvaIncasso(prev, "Lettera registrata nel fascicolo", "ok");
}

async function pdfFascicolo() {
  if (!state.pro) return paywall("crediti");
  const prev = state.corrente;
  try {
    await caricaPdfLib();
    const { creaPdfBlob } = await import("./pdf.js");
    const blob = creaPdfBlob({
      prev,
      azienda: { ...state.azienda, logo: immagineSicura(state.azienda.logo) },
      totali: totaliDi(prev),
      pro: state.pro,
      config: CONFIG,
      fascicolo: { stato: incassoDi(prev) },
    });
    scaricaBlob(blob, nomeFile("Fascicolo-credito", prev, "pdf"));
    traccia("Fascicolo credito");
  } catch (err) {
    toast(err.message || "Errore nella creazione del PDF");
  }
}

// ------------------------------------------------------------------
// Editor: date proposte e inizio lavori
// ------------------------------------------------------------------
function htmlDate(prev) {
  const app = inc.normalizzaAppuntamento(prev.appuntamento);
  const lista = Array.isArray(prev.disponibilita) ? prev.disponibilita : [];
  const titolo = `<div class="sezione-titolo" style="margin:0"><div><h2>Inizio lavori</h2><div class="muted xsmall">${app ? "Data concordata con il cliente" : "Proponi fino a 3 date: il cliente ne sceglie una quando firma"}</div></div></div>`;
  if (app) {
    const { giorno, mese } = giornoMese(app.data);
    return `${titolo}
      <div class="appuntamento"><span class="data-tile" aria-hidden="true"><b>${giorno}</b><small>${esc(mese)}</small></span>
        <div class="corpo"><b>${esc(inc.testoAppuntamento(app))}</b><div class="muted xsmall">${app.da === "cliente" ? "Scelta dal cliente accettando online" : "Fissata da te"}</div></div></div>
      <div class="grid2"><button class="btn" data-action="appuntamento-ics">${ICONE.orologio} Calendario</button><button class="btn" data-action="appuntamento-togli">Cambia data</button></div>`;
  }
  return `${titolo}
    ${lista
      .map(
        (d, i) => `<div class="riga-data ${inc.dataValida(d.data) && d.data < core.oggiISO() ? "passata" : ""}">
        <input type="date" data-disp="${i}.data" value="${esc(inc.dataValida(d.data) ? d.data : "")}" min="${core.oggiISO()}" aria-label="Data proposta ${i + 1}">
        <select data-disp="${i}.fascia" aria-label="Fascia oraria ${i + 1}">${Object.entries(inc.FASCE)
          .map(([k, v]) => `<option value="${k}" ${d.fascia === k ? "selected" : ""}>${esc(v)}</option>`)
          .join("")}</select>
        <button class="icon-btn" data-action="data-togli" data-i="${i}" aria-label="Togli la data ${i + 1}">${ICONE.cestino}</button></div>`,
      )
      .join("")}
    ${lista.some((d) => inc.dataValida(d.data) && d.data < core.oggiISO()) ? `<div class="muted xsmall testo-bad">Le date già passate non vengono proposte al cliente.</div>` : ""}
    <div class="grid2">
      ${lista.length < inc.MAX_DISPONIBILITA ? `<button class="btn soft" data-action="data-aggiungi">${ICONE.piu} Proponi</button>` : ""}
      <button class="btn" data-action="fissa-data">${ICONE.check} Già decisa</button>
    </div>`;
}

function aggiornaDate() {
  const el = $("#sezione-date");
  if (el && state.corrente) el.innerHTML = htmlDate(state.corrente);
}

function foglioFissaData() {
  const prev = state.corrente;
  const prima = inc.normalizzaDisponibilita(prev.disponibilita)[0];
  const f = apriFoglio(
    `${titoloFoglio("Fissa l'inizio dei lavori", "Finisce in agenda e nel PDF")}
    <div class="stack">
      <div class="grid2 stack-mobile">
        <label class="campo">Data<input type="date" id="app-data" value="${esc(prima ? prima.data : core.aggiungiGiorni(core.oggiISO(), 1))}"></label>
        <label class="campo">Fascia<select id="app-fascia">${Object.entries(inc.FASCE)
          .map(([k, v]) => `<option value="${k}" ${prima && prima.fascia === k ? "selected" : ""}>${esc(v)}</option>`)
          .join("")}</select></label>
      </div>
      <button class="btn primary big block" data-action="app-salva">${ICONE.check} Salva</button>
    </div>`,
  );
  azioni["app-salva"] = async () => {
    const data = $("#app-data", f).value;
    if (!inc.dataValida(data)) return toast("Scegli una data");
    prev.appuntamento = { data, fascia: $("#app-fascia", f).value, da: "impresa", il: Date.now() };
    await salvaPreventivo(prev);
    chiudiFoglio();
    aggiornaDate();
    toast("Data fissata", "ok");
  };
}

function htmlFirma(prev) {
  const img = immagineSicura(prev.firma && prev.firma.img);
  if (img) {
    return `<div class="sezione-titolo" style="margin:0"><h2>Firma del cliente</h2><span class="badge accettato dx">Firmato</span></div>
      <div class="firma-box"><img src="${img}" alt="Firma del cliente"></div>
      <div class="muted small">Firmato ${prev.firma.sulPosto ? "sul posto " : prev.firma.online ? "online " : ""}da ${esc(prev.firma.nome)} il ${esc(core.formatData(core.oggiISO(new Date(prev.firma.data))))}</div>
      <button class="btn small danger" data-action="rimuovi-firma" style="align-self:flex-start">${ICONE.cestino} Rimuovi firma</button>`;
  }
  return `<div class="sezione-titolo" style="margin:0"><div><h2>Firma al tavolo</h2><div class="muted xsmall">${esc(notaPresenta())}</div></div></div>
    <p class="muted small" style="margin:0">Sei dal cliente? Gli passi il telefono: vede il preventivo come lo vedrebbe lui, sceglie gli extra e firma col dito. Se invece glielo mandi, firma dal suo telefono.</p>
    <button class="btn block" data-action="presenta">${ICONE.firma} Fallo firmare qui</button>`;
}

function htmlRiepilogo(prev) {
  const t = totaliDi(prev);
  const r = (et, val, cls = "") => `<div class="r ${cls}"><span>${et}</span><b>${val}</b></div>`;
  let html = `<div class="sezione-titolo"><span class="ico">${ICONE.euro}</span><h2>Riepilogo</h2></div>`;
  if (t.subtotali.man > 0 && t.subtotali.mat > 0) {
    html += r('<span class="muted">di cui manodopera</span>', core.formatEuro(t.subtotali.man), "small");
    html += r('<span class="muted">di cui materiali</span>', core.formatEuro(t.subtotali.mat), "small");
  }
  if (t.scontoImporto > 0)
    html += r(`Sconto ${core.formatQta(t.scontoPerc)}%`, "- " + core.formatEuro(t.scontoImporto));
  html += r(t.forfettario ? "Totale prestazioni" : "Imponibile", core.formatEuro(t.imponibile));
  if (!t.forfettario) for (const g of t.riepilogoIva) html += r(`IVA ${g.aliquota}%`, core.formatEuro(g.imposta));
  if (t.bollo > 0) html += r("Imposta di bollo", core.formatEuro(t.bollo));
  html += r("<b>Totale</b>", `<span class="big">${core.formatEuro(t.totale)}</span>`, "tot");
  if (t.acconto > 0) html += r("Acconto", core.formatEuro(t.acconto)) + r("Saldo", core.formatEuro(t.saldo));
  if (t.opzionali.length) {
    const extra = t.opzionali.reduce((s, x) => s + x.importo, 0);
    html += `<div class="banner warn" style="margin-top:10px"><span class="ico">${ICONE.scintille}</span><div>${t.opzionali.length === 1 ? `1 extra proposto (+ ${esc(core.formatEuro(extra))} senza IVA): il cliente può aggiungerlo quando firma.` : `${t.opzionali.length} extra proposti (+ ${esc(core.formatEuro(extra))} senza IVA): il cliente può aggiungerli quando firma.`}</div></div>`;
  }
  if (t.costi > 0) {
    html += `<div class="margine" id="margine">${ICONE.lucchetto}<div>Guadagno stimato <b>${esc(core.formatEuro(t.margine))}</b> (${esc(core.formatQta(t.marginePerc))}%)<div class="muted xsmall">Imponibile meno costo dei materiali · lo vedi solo tu</div></div></div>`;
  }
  return html;
}

function aggiornaTotali() {
  const prev = state.corrente;
  if (!prev) return;
  const t = totaliDi(prev);
  const totale = $("#tot-valore");
  if (totale) totale.textContent = core.formatEuro(t.totale);
  prev.righe.forEach((r, i) => {
    const el = $(`[data-importo="${i}"]`);
    if (el) el.textContent = core.formatEuro(core.importoRiga(r));
  });
  $("#riepilogo").innerHTML = htmlRiepilogo(prev);
  const acc = $("#acconto-testo");
  if (acc) {
    const tmp = document.createElement("div");
    tmp.innerHTML = htmlAcconto(prev);
    acc.innerHTML = $("#acconto-testo", tmp).innerHTML;
  }
  const ro = $("#riassunto-opzioni");
  if (ro) ro.textContent = riassuntoOpzioni(prev);
  if (!$("#sezione-incassi")?.hidden) aggiornaIncassi();
}

function rerenderRighe() {
  const prev = state.corrente;
  $("#righe").innerHTML = htmlRighe(prev);
  $("#n-righe").textContent = testoNumeroVoci(prev.righe.length);
  const pd = $("#parti-da");
  if (pd) pd.innerHTML = htmlPartiDa(prev);
  $$("#righe textarea").forEach(autoAltezza);
  aggiornaTotali();
}

function autoAltezza(el) {
  el.style.height = "auto";
  el.style.height = Math.max(el.scrollHeight + 3, 48) + "px";
}

const CAMPI_NUMERICI = new Set([
  "qta",
  "prezzo",
  "sconto",
  "iva",
  "costo",
  "scontoGlobale",
  "validitaGiorni",
  "acconto.valore",
]);
const CAMPI_EDITOR = new Set([
  "stato",
  "cliente.nome",
  "cliente.telefono",
  "cliente.email",
  "cliente.indirizzo",
  "cliente.citta",
  "cliente.cfpiva",
  "oggetto",
  "luogo",
  "scontoGlobale",
  "validitaGiorni",
  "acconto.tipo",
  "acconto.valore",
  "tempi",
  "pagamento",
  "note",
]);
const CAMPI_RIGA = new Set(["descrizione", "qta", "um", "prezzo", "sconto", "iva", "costo"]);

function impostaPercorso(obj, percorso, valore) {
  const parti = percorso.split(".");
  let o = obj;
  for (let i = 0; i < parti.length - 1; i++) o = o[parti[i]] = o[parti[i]] || {};
  o[parti[parti.length - 1]] = valore;
}

function suInputEditor(e) {
  const prev = state.corrente;
  if (!prev) return;
  const el = e.target;
  if (el.tagName === "TEXTAREA") autoAltezza(el);
  const campo = el.dataset.campo;
  if (campo === "caparra") {
    prev.caparra = el.value === "1";
  } else if (campo === "cliente.impresa") {
    prev.cliente.impresa = el.checked;
  } else if (campo && CAMPI_EDITOR.has(campo)) {
    const valore = CAMPI_NUMERICI.has(campo) ? core.parseNumero(el.value) : el.value;
    impostaPercorso(prev, campo, valore);
    if (campo === "cliente.nome" || campo === "oggetto") {
      const t = $("#titolo-editor");
      if (t) t.textContent = titoloEditor(prev);
    }
    // Un altro nome sullo stesso cliente (per esempio in un preventivo duplicato): è un altro cliente,
    // non si rinomina quello salvato.
    if (campo === "cliente.nome" && prev.clienteId) {
      const rec = state.clienti.find((x) => x.id === prev.clienteId);
      const norm = (x) =>
        String(x || "")
          .trim()
          .toLowerCase();
      const altri = state.preventivi.some((p) => p.id !== prev.id && p.clienteId === prev.clienteId);
      if (rec && altri && norm(rec.nome) !== norm(valore)) prev.clienteId = null;
    }
    if (campo === "stato") {
      if (valore === "accettato") {
        if (!prev.accettatoIl) prev.accettatoIl = core.oggiISO();
        fissaAccordo(prev);
      } else if (prev.incasso) {
        prev.incasso.accontoPattuito = null;
      }
      aggiornaIncassi();
    }
  } else if (el.dataset.inc) {
    const i = incassoModificabile(prev);
    if (el.dataset.inc === "fineLavori") {
      // Mentre si scrive la data a mano il valore è parziale: si aspetta una data completa.
      if (el.value && !inc.dataValida(el.value)) return;
      i.fineLavori = el.value;
      if (el.value) i.storico = false;
      incassiDaRidisegnare = true;
    }
    if (el.dataset.inc === "giorniSaldo") i.giorniSaldo = Number(el.value);
    salvaDopo(prev);
    // La sezione si ridisegna quando il campo data perde il focus (vedi "focusout").
    if (e.type === "change" && el.tagName === "SELECT") aggiornaIncassi();
    return;
  } else if (el.dataset.disp) {
    const [k, chiave] = el.dataset.disp.split(".");
    prev.disponibilita = Array.isArray(prev.disponibilita) ? prev.disponibilita : [];
    const d = prev.disponibilita[Number(k)];
    if (!d || (chiave !== "data" && chiave !== "fascia")) return;
    d[chiave] = el.value;
    salvaDopo(prev);
    return;
  } else if (el.dataset.r && CAMPI_RIGA.has(el.dataset.r)) {
    const riga = el.closest(".riga");
    const r = riga && prev.righe[Number(riga.dataset.i)];
    if (!r) return;
    const k = el.dataset.r;
    r[k] = CAMPI_NUMERICI.has(k) ? core.parseNumero(el.value) : el.value;
    // Cambiando unità compare/sparisce il pulsante del calcolatore.
    if (k === "um" && e.type === "change") rerenderRighe();
  } else {
    return;
  }
  aggiornaTotali();
  salvaDopo(prev);
}

// Scelta di un cliente esistente dal suggerimento: completa i dati mancanti.
function suChangeEditor(e) {
  const prev = state.corrente;
  if (!prev || e.target.dataset.campo !== "cliente.nome") return;
  const nome = e.target.value.trim().toLowerCase();
  const rec = state.clienti.find((x) => (x.nome || "").trim().toLowerCase() === nome);
  if (!rec) return;
  prev.clienteId = rec.id;
  for (const k of ["indirizzo", "citta", "cfpiva", "telefono", "email"]) {
    if (!prev.cliente[k] && rec[k]) {
      prev.cliente[k] = rec[k];
      const input = $(`[data-campo="cliente.${k}"]`);
      if (input) input.value = rec[k];
    }
  }
  if (prev.cliente.indirizzo || prev.cliente.cfpiva) $("details", app()).open = true;
  salvaDopo(prev);
}

function aggiungiRiga(base = {}) {
  const prev = state.corrente;
  prev.righe.push(core.rigaVuota(ivaRiga(prev), { ...base, iva: base.iva ?? ivaRiga(prev) }));
  rerenderRighe();
  salvaDopo(prev);
  return prev.righe.length - 1;
}

function menuRiga(i) {
  const prev = state.corrente;
  const r = prev.righe[i];
  const voce = (op, ico, testo, cls = "") =>
    `<button class="${cls}" data-action="riga-op" data-op="${op}" data-i="${i}"><span class="ico">${ico}</span><span class="corpo">${testo}</span></button>`;
  apriFoglio(
    `${titoloFoglio(esc(r.descrizione || "Voce"))}
    <div class="lista-azioni">
      ${i > 0 ? voce("su", ICONE.su, "Sposta su") : ""}
      ${i < prev.righe.length - 1 ? voce("giu", ICONE.giu, "Sposta giù") : ""}
      ${voce("duplica", ICONE.copia, "Duplica voce")}
      ${voce("listino", ICONE.listino, "Salva tra i miei prezzi")}
      ${voce("elimina", ICONE.cestino, "Elimina voce", "danger")}
    </div>`,
  );
}

async function opRiga(op, i) {
  const prev = state.corrente;
  const righe = prev.righe;
  chiudiFoglio();
  if (!righe[i]) return;
  if (op === "su" && i > 0) [righe[i - 1], righe[i]] = [righe[i], righe[i - 1]];
  if (op === "giu" && i < righe.length - 1) [righe[i + 1], righe[i]] = [righe[i], righe[i + 1]];
  if (op === "duplica") righe.splice(i + 1, 0, { ...righe[i], id: core.uid() });
  if (op === "elimina") {
    const [tolta] = righe.splice(i, 1);
    toast("Voce eliminata", "", {
      azione: "Annulla",
      suAzione: () => {
        if (state.corrente !== prev) return;
        prev.righe.splice(Math.min(i, prev.righe.length), 0, tolta);
        rerenderRighe();
        salvaDopo(prev);
      },
    });
  }
  if (op === "listino") {
    const r = righe[i];
    if (!r.descrizione.trim()) return toast("Scrivi prima la descrizione");
    const voce = {
      id: core.uid(),
      descrizione: r.descrizione.trim(),
      um: r.um,
      prezzo: core.parseNumero(r.prezzo),
      tipo: r.tipo,
      iva: r.iva,
      costo: core.parseNumero(r.costo),
    };
    await db.salva("listino", voce);
    state.listino.push(voce);
    return toast("Salvata tra i tuoi prezzi", "ok");
  }
  rerenderRighe();
  salvaDopo(prev);
}

function foglioListino() {
  const voci = [...state.listino].sort((a, b) => a.descrizione.localeCompare(b.descrizione, "it"));
  const m = trovaMestiere(state.azienda.mestiere);
  const htmlVociListino = (filtro = "") => {
    const f = filtro.trim().toLowerCase();
    const trovate = voci.filter((v) => !f || v.descrizione.toLowerCase().includes(f));
    if (!voci.length) {
      return `<p class="muted">Non hai ancora salvato prezzi.</p>
        ${m ? `<button class="btn soft block" data-action="carica-esempi" data-m="${m.id}">Carica i prezzi tipici da ${esc(m.nome.toLowerCase())}</button>` : ""}
        <a class="btn block" href="#/listino" style="margin-top:8px">Vai ai miei prezzi</a>`;
    }
    return (
      trovate
        .map(
          (v) => `<button class="voce-listino" data-action="usa-voce" data-id="${esc(v.id)}">
            <span class="tipo" aria-hidden="true">${v.tipo === "mat" ? ICONE.carrello : ICONE.lavoro}</span>
            <div class="corpo"><div>${esc(v.descrizione)}</div><div class="muted xsmall">${v.tipo === "mat" ? "Materiale" : "Manodopera"} · ${esc(v.um)}</div></div>
            <div class="prezzo">${core.formatEuro(v.prezzo)}</div></button>`,
        )
        .join("") || `<p class="muted">Nessuna voce trovata.</p>`
    );
  };
  apriFoglio(
    `${titoloFoglio("Dai miei prezzi", "Tocca una voce per aggiungerla al preventivo")}
    <input type="search" id="cerca-listino" placeholder="Cerca tra i tuoi prezzi" aria-label="Cerca tra i tuoi prezzi">
    <div id="voci-listino" style="margin-top:6px">${htmlVociListino()}</div>`,
    {
      alMontaggio: (f) => {
        $("#cerca-listino", f).addEventListener("input", (e) => {
          $("#voci-listino", f).innerHTML = htmlVociListino(e.target.value);
        });
      },
    },
  );
}

async function caricaEsempi(idMestiere) {
  const m = trovaMestiere(idMestiere);
  if (!m) return;
  const esistenti = new Set(state.listino.map((v) => v.descrizione.toLowerCase()));
  for (const v of vociListino(m)) {
    if (esistenti.has(v.descrizione.toLowerCase())) continue;
    const voce = { id: core.uid(), ...v, iva: ivaRiga() };
    await db.salva("listino", voce);
    state.listino.push(voce);
  }
}

function menuPreventivo() {
  const prev = state.corrente;
  const voce = (azione, ico, testo, sotto = "", cls = "") =>
    `<button class="${cls}" data-action="${azione}"><span class="ico">${ico}</span><span class="corpo">${testo}${sotto ? `<small>${sotto}</small>` : ""}</span></button>`;
  apriFoglio(
    `${titoloFoglio("Altre azioni", `Preventivo n. ${esc(prev.numero)}`)}
    <div class="lista-azioni">
      ${prev.stato === "accettato" ? voce("invia", ICONE.invia, "Manda di nuovo al cliente", "Il PDF o il link aggiornato") : ""}
      ${voce("scarica-pdf", ICONE.scarica, "Scarica il PDF")}
      ${prev.stato === "accettato" ? voce("crea-variante", ICONE.variante, "Lavori extra da far firmare", "Una variante con le sole voci in più") : ""}
      ${voce("lista-materiali", ICONE.carrello, "Lista materiali per il fornitore", "I materiali del preventivo in un messaggio")}
      ${voce("duplica-preventivo", ICONE.duplica, "Rifai un preventivo simile", "Stesse voci e prezzi, per lo stesso cliente o un altro")}
      ${voce("elimina-preventivo", ICONE.cestino, "Elimina preventivo", "", "danger")}
    </div>`,
  );
}

// Duplicare un preventivo per un altro cliente non deve portarsi dietro i dati del primo.
function foglioDuplica() {
  const orig = state.corrente;
  const nome = (orig.cliente.nome || "").trim();
  apriFoglio(
    `${titoloFoglio("Per chi è il nuovo preventivo?", "Voci, prezzi e condizioni restano uguali")}
    <div class="lista-azioni">
      <button data-action="duplica-per" data-chi="altro" class="principale"><span class="ico">${ICONE.persona_piu}</span><span class="corpo">Per un altro cliente<small>Parti con i dati del cliente vuoti</small></span></button>
      ${nome ? `<button data-action="duplica-per" data-chi="stesso"><span class="ico">${ICONE.utente}</span><span class="corpo">Di nuovo per ${esc(nome)}<small>Per esempio per un altro lavoro o una variante</small></span></button>` : ""}
    </div>`,
    { classe: "piccolo" },
  );
}

async function duplica(stessoCliente) {
  const orig = state.corrente;
  const numerazione = core.prossimoNumero(state.preventivi, new Date().getFullYear(), state.azienda.prefisso);
  const copia = {
    ...structuredClone(orig),
    ...numerazione,
    id: core.uid(),
    data: core.oggiISO(),
    stato: "bozza",
    firma: null,
    link: null,
    linkPrecedenti: [],
    accettazioneOnline: null,
    accettatoIl: "",
    incasso: null,
    appuntamento: null,
    disponibilita: [],
    inviatoIl: null,
    ricontattatoIl: null,
    variante: null,
    regime: state.azienda.regime,
    addebitaBollo: state.azienda.addebitaBollo,
    createdAt: Date.now(),
  };
  if (!stessoCliente) {
    copia.cliente = { nome: "", indirizzo: "", citta: "", cfpiva: "", telefono: "", email: "" };
    copia.clienteId = null;
  }
  copia.righe = copia.righe.map((r) => ({ ...r, id: core.uid() }));
  chiudiFoglio(true);
  await salvaPreventivo(copia);
  toast(
    stessoCliente ? `Nuovo preventivo n. ${copia.numero}` : "Copiato: scrivi il nuovo cliente e controlla i prezzi",
    "ok",
  );
  vai(`#/p/${copia.id}`);
}

// ------------------------------------------------------------------
// Calcolatore metri quadri
// ------------------------------------------------------------------
function foglioCalcolatore(i) {
  const prev = state.corrente;
  const stanze = [
    {
      nome: "Stanza 1",
      lunghezza: "",
      larghezza: "",
      altezza: "2,70",
      pareti: true,
      soffitto: false,
      pavimento: false,
      detrazioni: "",
    },
  ];
  const htmlStanza = (s, k) => `<div class="stanza" data-k="${k}">
    <div class="row spazia"><input data-st="nome" value="${esc(s.nome)}" aria-label="Nome stanza" data-no-focus="1" style="font-weight:700;min-height:40px">
      ${k > 0 ? `<button class="icon-btn" data-action="calc-togli" data-k="${k}" aria-label="Togli stanza">${ICONE.cestino}</button>` : ""}</div>
    <div class="grid3">
      <label class="campo">Lungh. (m)<input data-st="lunghezza" inputmode="decimal" value="${esc(s.lunghezza)}" placeholder="4"></label>
      <label class="campo">Largh. (m)<input data-st="larghezza" inputmode="decimal" value="${esc(s.larghezza)}" placeholder="3"></label>
      <label class="campo">Altezza (m)<input data-st="altezza" inputmode="decimal" value="${esc(s.altezza)}" placeholder="2,70"></label>
    </div>
    <div class="opzioni">
      <label><input type="checkbox" data-st="pareti" ${s.pareti ? "checked" : ""}> Pareti</label>
      <label><input type="checkbox" data-st="soffitto" ${s.soffitto ? "checked" : ""}> Soffitto</label>
      <label><input type="checkbox" data-st="pavimento" ${s.pavimento ? "checked" : ""}> Pavimento</label>
    </div>
    <label class="campo">Da togliere: porte e finestre (mq)<input data-st="detrazioni" inputmode="decimal" value="${esc(s.detrazioni)}" placeholder="es. 3,5"></label>
  </div>`;
  const f = apriFoglio(
    `${titoloFoglio("Calcola metri quadri", "Inserisci le misure delle stanze")}
    <div id="stanze">${stanze.map(htmlStanza).join("")}</div>
    <button class="btn ghost block" data-action="calc-aggiungi">${ICONE.piu} Aggiungi stanza</button>
    <div class="risultato-calc"><div class="muted small">Totale</div><div class="big" id="calc-totale">0 mq</div></div>
    <button class="btn primary big block" data-action="calc-usa">Usa questa quantità</button>`,
  );
  const leggi = () =>
    $$(".stanza", f).map((el) => {
      const o = {};
      $$("[data-st]", el).forEach((x) => (o[x.dataset.st] = x.type === "checkbox" ? x.checked : x.value));
      return o;
    });
  const aggiorna = () => {
    const r = core.calcolaSuperfici(leggi());
    $("#calc-totale", f).textContent = `${core.formatQta(r.totale)} mq`;
    return r.totale;
  };
  f.addEventListener("input", aggiorna);
  f.addEventListener("change", aggiorna);
  azioni["calc-aggiungi"] = () => {
    const attuali = leggi();
    attuali.push({
      nome: `Stanza ${attuali.length + 1}`,
      lunghezza: "",
      larghezza: "",
      altezza: attuali[0]?.altezza || "2,70",
      pareti: true,
    });
    $("#stanze", f).innerHTML = attuali.map(htmlStanza).join("");
    aggiorna();
  };
  azioni["calc-togli"] = (el) => {
    const attuali = leggi();
    attuali.splice(Number(el.dataset.k), 1);
    $("#stanze", f).innerHTML = attuali.map(htmlStanza).join("");
    aggiorna();
  };
  azioni["calc-usa"] = () => {
    const tot = aggiorna();
    if (!tot) return toast("Inserisci almeno una misura");
    const r = prev.righe[i];
    if (!r) return chiudiFoglio();
    r.qta = tot;
    r.um = "mq";
    chiudiFoglio();
    rerenderRighe();
    salvaDopo(prev);
    toast(`Quantità: ${core.formatQta(tot)} mq`, "ok");
  };
}

// ------------------------------------------------------------------
// Dettatura vocale (anche più voci in una frase)
// ------------------------------------------------------------------
function detta(suggerimento, onTesto) {
  if (!Riconoscimento) return toast("La dettatura non è disponibile su questo browser");
  const r = new Riconoscimento();
  r.lang = "it-IT";
  r.interimResults = true;
  r.continuous = true;
  let finale = "";
  let annullato = false;
  const f = apriFoglio(
    `${titoloFoglio("Sto ascoltando...")}
    <div class="row" style="gap:16px;align-items:center"><span class="onda" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><div id="parziale" class="muted">${esc(suggerimento)}</div></div>
    <div class="grid2" style="margin-top:18px"><button class="btn" data-action="detta-annulla">Annulla</button><button class="btn primary" data-action="detta-fine">Fatto</button></div>`,
  );
  f.parentElement._allaChiusura = () => {
    annullato = true;
    try {
      r.abort();
    } catch {
      /* già fermo */
    }
  };
  azioni["detta-fine"] = () => r.stop();
  azioni["detta-annulla"] = () => chiudiFoglio();
  r.onresult = (ev) => {
    let parziale = "";
    finale = "";
    for (const res of ev.results) {
      if (res.isFinal) finale += res[0].transcript + " ";
      else parziale += res[0].transcript;
    }
    const el = $("#parziale");
    if (el) el.textContent = finale + parziale || suggerimento;
  };
  r.onerror = (ev) => {
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed")
      toast("Consenti l'uso del microfono per dettare");
    else if (ev.error === "no-speech") toast("Non ho sentito nulla, riprova");
  };
  r.onend = () => {
    const testo = finale.trim();
    if (!annullato) {
      const ov = $("#foglio");
      if (ov) ov._allaChiusura = null;
      chiudiFoglio();
      if (testo) onTesto(testo);
    }
  };
  try {
    r.start();
  } catch {
    chiudiFoglio();
    toast("Impossibile avviare il microfono");
  }
}

function aggiungiDaDettatura(testo) {
  const voci = core.parseDettaturaMultipla(testo, state.listino);
  if (!voci.length) return toast("Non ho capito, riprova");
  for (const v of voci) aggiungiRiga(v);
  const dalListino = voci.filter((v) => v.dalListino).length;
  toast(
    voci.length === 1
      ? voci[0].prezzo
        ? "Voce aggiunta"
        : "Voce aggiunta: inserisci il prezzo"
      : `${voci.length} voci aggiunte${dalListino ? ` (${dalListino} con i tuoi prezzi)` : ""}`,
    "ok",
  );
  traccia("Dettatura", { voci: voci.length });
}

// ------------------------------------------------------------------
// Foto
// ------------------------------------------------------------------
function collegaInputFoto() {
  $("#input-foto")?.addEventListener("change", async (e) => {
    const prev = state.corrente;
    const file = [...e.target.files];
    e.target.value = "";
    prev.foto = prev.foto || [];
    const spazio = MAX_FOTO - prev.foto.length;
    if (file.length > spazio) toast(`Puoi aggiungere al massimo ${MAX_FOTO} foto`);
    for (const f of file.slice(0, spazio)) {
      try {
        const { img } = await comprimiImmagine(f);
        prev.foto.push({ id: core.uid(), img, didascalia: "" });
      } catch (err) {
        toast(err.message);
      }
    }
    await salvaPreventivo(prev);
    $("#sezione-foto").innerHTML = htmlFoto(prev);
    collegaInputFoto();
    traccia("Foto aggiunte", { n: file.length });
  });
}

// ------------------------------------------------------------------
// Firma sul posto (Pro)
// ------------------------------------------------------------------
function foglioFirma() {
  if (!state.pro) return paywall("firma");
  const prev = state.corrente;
  const f = apriFoglio(
    `${titoloFoglio("Firma del cliente", "Passa il telefono al cliente: firma con il dito")}
    <canvas class="firma" id="canvas-firma" aria-label="Riquadro firma"></canvas>
    <div class="grid2" style="margin-top:10px">
      <input id="firma-nome" placeholder="Nome di chi firma" value="${esc(prev.cliente.nome)}" data-no-focus="1" aria-label="Nome di chi firma">
      <input id="firma-luogo" placeholder="Luogo" value="${esc(prev.cliente.citta || state.azienda.citta || "")}" data-no-focus="1" aria-label="Luogo">
    </div>
    <div class="grid2" style="margin-top:10px">
      <button class="btn" data-action="firma-cancella">Cancella</button>
      <button class="btn primary" data-action="firma-conferma">${ICONE.check} Conferma</button>
    </div>`,
  );
  const pad = creaPadFirma($("#canvas-firma", f));
  f.parentElement._allaChiusura = () => pad.distruggi();
  azioni["firma-cancella"] = () => pad.cancella();
  azioni["firma-conferma"] = async () => {
    if (!pad.valida()) return toast("Fai firmare il cliente nel riquadro");
    prev.firma = {
      img: pad.png(),
      nome: $("#firma-nome").value.trim() || prev.cliente.nome,
      luogo: $("#firma-luogo").value.trim(),
      data: new Date().toISOString(),
    };
    prev.stato = "accettato";
    prev.accettatoIl = prev.accettatoIl || core.oggiISO();
    fissaAccordo(prev);
    await salvaPreventivo(prev);
    traccia("Firma cliente");
    chiudiFoglio(true);
    state.festa = prev.id;
    viewEditor(prev.id);
  };
}

// ------------------------------------------------------------------
// PDF, link di accettazione e invio
// ------------------------------------------------------------------
let pdfLib = null;
function caricaScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Impossibile caricare " + src));
    document.head.appendChild(s);
  });
}
function caricaPdfLib() {
  if (globalThis.jspdf && globalThis.autoTable) return Promise.resolve();
  if (!pdfLib) {
    pdfLib = caricaScript("vendor/jspdf.umd.min.js")
      .then(() => caricaScript("vendor/jspdf.plugin.autotable.min.js"))
      .catch((e) => {
        pdfLib = null;
        throw e;
      });
  }
  return pdfLib;
}

const BASE = () => new URL(".", location.href).href;

// Crea il link di accettazione e ne memorizza l'impronta, per riconoscere la conferma del cliente.
async function preparaLink(prev) {
  const l = await creaLinkAccettazione(BASE(), prev, state.azienda, { pro: state.pro });
  if (l.troppoLungo) return null;
  if (!prev.link || prev.link.hash !== l.hash) {
    if (prev.link) prev.linkPrecedenti = [prev.link.hash, ...(prev.linkPrecedenti || [])].slice(0, 20);
    prev.link = { hash: l.hash, il: Date.now(), gs: giorniSaldoDi(prev, state.azienda) };
    await salvaPreventivo(prev);
  }
  return l.url;
}

// link: se già preparato lo si passa, altrimenti viene creato qui.
async function generaPdf(prev, { link } = {}) {
  await caricaPdfLib();
  const { creaPdfBlob } = await import("./pdf.js");
  const linkAccettazione = link !== undefined ? link : await preparaLink(prev).catch(() => null);
  return creaPdfBlob({
    prev,
    azienda: { ...state.azienda, logo: immagineSicura(state.azienda.logo) },
    totali: totaliDi(prev),
    pro: state.pro,
    config: CONFIG,
    linkAccettazione,
  });
}

// Controllo sincrono: va fatto prima di qualunque await per non perdere
// il "gesto utente" che serve ad aprire finestre e il foglio di condivisione.
function entroLimite(prev) {
  if (state.pro || core.puoEsportare(state.contatore, CONFIG.pdfGratisAlMese, prev.id)) return true;
  paywall("limite");
  return false;
}

function registraEsportazione(prev) {
  traccia("PDF creato", { piano: state.pro ? "pro" : "gratis" });
  if (state.pro) return;
  state.contatore = core.registraEsportazione(state.contatore, prev.id);
  db.set("contatore", state.contatore);
}

// riprova: cosa rifare se l'utente conferma di voler mandare comunque le voci senza prezzo.
function verificaPronto(prev, riprova = null) {
  if (!prev.righe.length) {
    toast("Aggiungi almeno un lavoro o un materiale");
    return false;
  }
  const senzaPrezzo = prev.righe.filter((r) => !r.opzionale && !(core.parseNumero(r.prezzo) > 0)).length;
  if (senzaPrezzo && !state.senzaPrezzoOk.has(prev.id)) {
    chiedi({
      titolo: senzaPrezzo === 1 ? "Una voce è senza prezzo" : `${senzaPrezzo} voci sono senza prezzo`,
      testo: "Nel preventivo comparirebbero a 0 €.",
      ok: "Mandalo lo stesso",
      annulla: "Inserisco i prezzi",
    }).then((ok) => {
      if (ok) {
        state.senzaPrezzoOk.add(prev.id);
        riprova?.();
      } else $(`.riga [data-r="prezzo"]`)?.closest(".riga")?.scrollIntoView({ block: "center" });
    });
    return false;
  }
  return true;
}

function scaricaBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Guardare il PDF non consuma i preventivi gratuiti: conta solo quello che si manda o si scarica.
async function anteprima() {
  const prev = state.corrente;
  if (!verificaPronto(prev, anteprima)) return;
  // La finestra si apre subito (prima delle operazioni asincrone) per evitare i blocchi popup.
  const finestra = window.open("", "_blank");
  try {
    const blob = await generaPdf(prev);
    const url = URL.createObjectURL(blob);
    if (finestra) finestra.location.href = url;
    else scaricaBlob(blob, core.nomeFilePdf(prev));
  } catch (err) {
    if (finestra) finestra.close();
    toast(err.message || "Errore nella creazione del PDF");
  }
}

async function scaricaPdf() {
  const prev = state.corrente;
  chiudiFoglio();
  if (!verificaPronto(prev, scaricaPdf) || !entroLimite(prev)) return;
  registraEsportazione(prev);
  toast("Preparo il PDF…");
  try {
    scaricaBlob(await generaPdf(prev), core.nomeFilePdf(prev));
  } catch (err) {
    toast(err.message || "Errore nella creazione del PDF");
  }
}

async function segnaInviato(prev) {
  traccia("Preventivo inviato");
  if (prev.stato === "bozza") prev.stato = "inviato";
  // Il primo invio fa partire il conteggio per il promemoria; un nuovo invio vale come ricontatto.
  if (!prev.inviatoIl) prev.inviatoIl = Date.now();
  else prev.ricontattatoIl = Date.now();
  await salvaPreventivo(prev);
  aggiornaStatoEditor(prev);
}

function testoConLink(prev, link) {
  const t = totaliDi(prev);
  const saluto = prev.cliente.nome ? `Buongiorno ${prev.cliente.nome},` : "Buongiorno,";
  if (prev.variante)
    return (
      `${saluto} come d'accordo le mando i lavori extra al preventivo n. ${prev.variante.numero}: ${core.formatEuro(t.totale)}${t.forfettario ? "" : " IVA inclusa"}.
` +
      `Può vederli e accettarli con la firma direttamente dal telefono:
${link}` +
      (state.azienda.ragioneSociale
        ? `

${state.azienda.ragioneSociale}`
        : "")
    );
  return (
    `${saluto} ecco il preventivo n. ${prev.numero}${prev.oggetto ? ` per "${prev.oggetto}"` : ""}: ${core.formatEuro(t.totale)}${t.forfettario ? "" : " IVA inclusa"}.\n` +
    (t.opzionali.length
      ? `Ci sono anche ${t.opzionali.length === 1 ? "una voce facoltativa" : "alcune voci facoltative"} che può aggiungere se le interessano.\n`
      : "") +
    `Può vederlo e accettarlo con la firma direttamente dal telefono:\n${link}` +
    (state.azienda.ragioneSociale ? `\n\n${state.azienda.ragioneSociale}` : "")
  );
}

// Firma al tavolo: il cliente vede la sua pagina vera sul telefono dell'impresa, sceglie gli extra e firma.
// Poi ridà il telefono e l'impresa registra la firma. Senza Pro la prima volta è in prova.
function notaPresenta() {
  if (state.pro) return "Il cliente firma sul tuo telefono";
  return state.provaPresenta ? "Funzione Pro" : "La prima volta è gratis";
}

async function presenta(pulsante) {
  const prev = state.corrente;
  if (!prev) return;
  if (!state.pro && state.provaPresenta) return paywall("firma");
  if (!verificaPronto(prev, () => presenta(pulsante)) || !entroLimite(prev)) return;
  occupato(pulsante, "Preparo la pagina…");
  try {
    await salvaClienteDa(prev);
    const url = await preparaLink(prev);
    if (!url) {
      libero(pulsante);
      return foglioFirma(); // preventivo troppo grande per il link: resta il riquadro della firma
    }
    await salvaPreventivo(prev);
    registraEsportazione(prev);
    traccia("Firma al tavolo");
    const destinazione = url.replace("accetta.html#", "accetta.html?presenta=1#");
    // L'anteprima pubblicata passa il codice in un altro modo: le basta annullare questo evento.
    if (!window.dispatchEvent(new CustomEvent("pl-presenta", { detail: destinazione, cancelable: true }))) return;
    location.href = destinazione;
  } catch (err) {
    libero(pulsante);
    toast(err.message || "Non riesco a preparare la pagina del cliente");
  }
}

// Il foglio di invio prepara PDF e link PRIMA di mostrarsi: così i pulsanti aprono WhatsApp
// e la condivisione subito, senza attese che farebbero bloccare il popup dal browser.
async function invia(pulsante) {
  const prev = state.corrente;
  if (!verificaPronto(prev, () => invia(pulsante)) || !entroLimite(prev)) return;
  occupato(pulsante, "Preparo il preventivo…");
  let blob, link;
  try {
    await salvaClienteDa(prev);
    link = await preparaLink(prev).catch(() => null);
    blob = await generaPdf(prev, { link });
  } catch (err) {
    return toast(err.message || "Errore nella creazione del PDF");
  } finally {
    libero(pulsante);
  }
  const nomeFilePdf = core.nomeFilePdf(prev);
  const file = new File([blob], nomeFilePdf, { type: "application/pdf" });
  const puoCondividere = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  const testoPdf = core.testoWhatsApp(prev, state.azienda, totaliDi(prev));
  const testoLink = link ? testoConLink(prev, link) : "";
  const nome = (prev.cliente.nome || "").trim();
  const voce = (attr, ico, titolo, sotto, extra = "") =>
    `<${attr}><span class="ico ${extra}">${ico}</span><span class="corpo">${titolo}<small>${sotto}</small></span>`;
  const hrefWa = (tel) => waLink(tel, link ? testoLink : testoPdf);

  const f = apriFoglio(
    `${titoloFoglio("Manda il preventivo", `${esc(core.nomeCliente(prev.cliente))} · ${esc(core.formatEuro(totaliDi(prev).totale))}`)}
    <div class="stack">
      ${
        core.telefonoWhatsApp(prev.cliente.telefono)
          ? ""
          : `<label class="campo">Numero WhatsApp${nome ? ` di ${esc(nome)}` : " del cliente"}<input id="invio-tel" type="tel" inputmode="tel" placeholder="es. 333 123 4567" value="${esc(prev.cliente.telefono)}"></label>`
      }
      <div class="invio-principale">
        <a class="btn wa big block" id="invio-wa" href="${esc(hrefWa(prev.cliente.telefono))}" target="_blank" rel="noopener" data-action="invio-link">${ICONE.whatsapp} Manda su WhatsApp</a>
        <p class="muted small" style="margin:8px 2px 0">${nome ? `A <b>${esc(nome)}</b>. ` : ""}${
          link
            ? "Lo apre dal telefono, sceglie gli extra e firma col dito. Poi ti torna un suo messaggio di conferma."
            : "Gli arriva il riepilogo con il totale: allega il PDF con «Altri modi»."
        }</p>
      </div>
      ${
        link && !prev.firma
          ? `<button class="btn block invio-tavolo" data-action="presenta">${ICONE.firma}<span>Sei dal cliente? <b>Fallo firmare qui</b><small>${esc(notaPresenta())}</small></span></button>`
          : ""
      }
      <details class="altri-modi">
        <summary>Altri modi per mandarlo</summary>
        <div class="lista-azioni">
          ${link ? `${voce('button data-action="invio-copia-link"', ICONE.link, "Copia il messaggio con il link", "Da incollare in un SMS, Telegram o email")}</button>` : ""}
          ${puoCondividere ? `${voce('button data-action="invio-condividi"', ICONE.condividi, "Condividi il PDF", "WhatsApp, email o altre app")}</button>` : ""}
          ${voce('button data-action="invio-scarica"', ICONE.scarica, "Scarica il PDF", "Da allegare dove vuoi")}</button>
          ${voce(`a href="mailto:${encodeURIComponent(prev.cliente.email || "")}?subject=${encodeURIComponent(`Preventivo n. ${prev.numero}`)}&body=${encodeURIComponent((link ? testoLink : testoPdf) + "\n\n(In allegato il PDF)")}" data-action="invio-segna"`, ICONE.mail, "Email", prev.cliente.email ? esc(prev.cliente.email) : "Scegli il destinatario")}</a>
        </div>
      </details>
      <div class="grid2">
        ${link ? `<a class="btn ghost" href="${esc(link)}" target="_blank" rel="noopener" data-action="guarda-cliente">${ICONE.occhio} Come lo vede lui</a>` : ""}
        <button class="btn ghost ${link ? "" : "block"}" data-action="anteprima">${ICONE.documento} Il PDF</button>
      </div>
    </div>`,
  );
  f.dataset.link = link || "";
  registraEsportazione(prev);
  const tel = $("#invio-tel", f);
  tel?.addEventListener("input", () => {
    prev.cliente.telefono = tel.value;
    $("#invio-wa", f).href = hrefWa(tel.value);
    salvaDopo(prev);
  });
  azioni["invio-link"] = () => {
    segnaInviato(prev);
    traccia("Link accettazione inviato");
    attendiRitorno(prev);
  };
  azioni["invio-copia-link"] = async () => {
    const ok = await copiaTesto(testoLink);
    if (!ok) return toast("Copia non riuscita");
    await segnaInviato(prev);
    chiudiFoglio();
    toast("Messaggio copiato: incollalo dove vuoi", "ok");
  };
  azioni["invio-condividi"] = async () => {
    try {
      await navigator.share({ files: [file], title: nomeFilePdf, text: testoPdf });
      await segnaInviato(prev);
      chiudiFoglio();
      toast("Preventivo inviato", "ok");
    } catch {
      /* annullato */
    }
  };
  azioni["invio-scarica"] = async () => {
    scaricaBlob(blob, nomeFilePdf);
    await segnaInviato(prev);
  };
  azioni["invio-segna"] = () => segnaInviato(prev);
}

// Dopo WhatsApp si torna nell'app: il foglio di invio si chiude e si spiega cosa succede adesso.
let ritornoDaInvio = null;
function attendiRitorno(prev) {
  ritornoDaInvio = prev.id;
  // Se WhatsApp non porta via la pagina (computer, anteprima), si mostra comunque.
  setTimeout(() => {
    if (ritornoDaInvio === prev.id && document.visibilityState === "visible") dopoInvio();
  }, 1500);
}

function dopoInvio() {
  const prev = state.preventivi.find((p) => p.id === ritornoDaInvio);
  ritornoDaInvio = null;
  if (!prev || !state.corrente || state.corrente.id !== prev.id) return;
  aggiornaStatoEditor(prev);
  const nome = (prev.cliente.nome || "").trim() || "il cliente";
  const viste = Number(preferenza.get("pl-spiegato-invio")) || 0;
  if (viste >= 2) {
    chiudiFoglio();
    return toast(`Inviato a ${nome}`, "ok");
  }
  preferenza.set("pl-spiegato-invio", String(viste + 1));
  const giorni = Number(state.azienda.giorniRicontatto) || 3;
  apriFoglio(
    `${titoloFoglio(`Inviato a ${esc(nome)}`, "Ecco cosa succede adesso")}
    <ol class="percorso">
      <li class="fatto"><b>Preventivo inviato</b><span>Gli arriva su WhatsApp con il link</span></li>
      <li><b>${esc(nome.charAt(0).toUpperCase() + nome.slice(1))} lo firma dal telefono</b><span>Sceglie gli extra e la data di inizio, poi firma col dito</span></li>
      <li><b>Ti arriva il suo messaggio</b><span>Tocca il link che contiene: il preventivo diventa Accettato con la sua firma</span></li>
      <li><b>L'app segue i pagamenti</b><span>Acconto, saldo e promemoria quando qualcuno è in ritardo</span></li>
    </ol>
    <p class="muted small" style="margin:4px 0 14px">Se non risponde entro ${giorni} giorni te lo ricordo nella pagina iniziale.</p>
    <button class="btn primary big block" data-action="chiudi-foglio">Ho capito</button>`,
    { classe: "piccolo" },
  );
}

// Le operazioni lente (PDF, link) mostrano subito che il tocco è arrivato.
function occupato(pulsante, testo) {
  if (!pulsante || pulsante.dataset.testo) return;
  pulsante.dataset.testo = pulsante.innerHTML;
  pulsante.setAttribute("aria-busy", "true");
  pulsante.disabled = true;
  pulsante.innerHTML = `<span class="gira" aria-hidden="true"></span><span>${esc(testo)}</span>`;
}
function libero(pulsante) {
  if (!pulsante || !pulsante.dataset.testo) return;
  pulsante.innerHTML = pulsante.dataset.testo;
  delete pulsante.dataset.testo;
  pulsante.removeAttribute("aria-busy");
  pulsante.disabled = false;
}

// ------------------------------------------------------------------
// Ricezione dell'accettazione online
// ------------------------------------------------------------------
async function viewAccettazione(q) {
  const codice = q.get("d") || "";
  const pagina = (corpo) => {
    app().innerHTML = `<header class="topbar"><a class="back" href="#/" aria-label="Chiudi">${ICONE.indietro}</a><div class="titolo"><strong>Conferma del cliente</strong><div class="sopra">Firma online</div></div></header>
      <main class="pagina">${corpo}</main>`;
  };
  let conferma;
  try {
    conferma = await leggiConferma(codice);
  } catch (err) {
    return pagina(
      `<div class="card vuoto"><div class="illustrazione">${ICONE.link}</div><h3>Conferma non leggibile</h3><p class="muted">${esc(err.message)}. Chiedi al cliente di rimandare il messaggio.</p></div>`,
    );
  }
  const prev = state.preventivi.find((p) => p.id === conferma.id);
  const firma = trattiInPng(decodificaTratti(conferma.firma));
  const dettaglio = `<div class="firma-box"><img src="${immagineSicura(firma)}" alt="Firma del cliente"></div>
    <div class="muted small">Firmato da <b>${esc(conferma.nome)}</b> il ${esc(core.formatData(core.oggiISO(new Date(conferma.data))))}</div>`;
  if (!prev) {
    return pagina(`<div class="card stack">${aiutoAltroDispositivo(conferma.numero)}${dettaglio}</div>`);
  }
  if (prev.accettazioneOnline && prev.accettazioneOnline.hash === conferma.hash && prev.stato === "accettato") {
    return pagina(
      `<div class="card stack"><div class="banner ok"><span class="ico">${ICONE.fatto}</span><div>Questa conferma è già registrata.</div></div>${dettaglio}<a class="btn primary block" href="#/p/${esc(prev.id)}">Apri il preventivo</a></div>`,
    );
  }
  const verifica = verificaImpronta(prev, conferma.hash);
  const avviso = {
    ok: `<div class="banner ok"><span class="ico">${ICONE.scudo}</span><div>Ha accettato <b>esattamente</b> la versione che gli hai mandato.</div></div>`,
    precedente: `<div class="banner warn"><span class="ico">${ICONE.attenzione}</span><div>Il cliente ha accettato una <b>versione precedente</b> del preventivo: dopo l'invio l'hai modificato. Controlla prima di procedere.</div></div>`,
    diversa: `<div class="banner bad"><span class="ico">${ICONE.attenzione}</span><div><b>Attenzione:</b> i dati accettati non corrispondono a nessun link che hai inviato da questo telefono. Potrebbero essere stati modificati: verifica prezzi e voci con il cliente.</div></div>`,
  }[verifica];
  const scelte = conferma.scelte.map((_, k) => voceDaConferma(prev, conferma, k)).filter(Boolean);
  const copia = { ...prev, righe: prev.righe.map((r) => (scelte.includes(r) ? { ...r, opzionale: false } : r)) };
  const data = dataDaConferma(prev, conferma);
  const testoData = data.scelta ? esc(inc.testoAppuntamento(data.scelta)) : "";
  const htmlData = {
    nessuna: "",
    ok: `<div class="banner info"><span class="ico">${ICONE.calendario}</span><div>Per iniziare il cliente ha scelto <b>${testoData}</b>.</div></div>`,
    "non-proposta": `<div class="banner warn"><span class="ico">${ICONE.calendario}</span><div>Il cliente ha scelto <b>${testoData}</b>, che non è più tra le date che proponi: la data non viene salvata, concordala con lui.</div></div>`,
    "gia-fissata": `<div class="banner warn"><span class="ico">${ICONE.calendario}</span><div>Il cliente avrebbe preferito <b>${testoData}</b>, ma hai già fissato <b>${data.fissata ? esc(inc.testoAppuntamento(data.fissata)) : ""}</b>: resta la tua data.</div></div>`,
  }[data.esito];
  pagina(`<section class="card stack">
      <div class="row">${avatar(conferma.nome)}<div><div style="font-weight:750;font-size:17px">${esc(conferma.nome)} ha accettato</div><div class="muted small">Preventivo n. ${esc(prev.numero)}${prev.oggetto ? ` · ${esc(prev.oggetto)}` : ""}</div></div></div>
      ${avviso}
      ${scelte.length ? `<div><div class="muted small">Ha aggiunto questi extra</div>${scelte.map((r) => `<div class="row" style="gap:8px">${ICONE.piu.replace("<svg", '<svg width="16" height="16"')}${esc(r.descrizione)}</div>`).join("")}</div>` : ""}
      ${htmlData}
      <div class="r" style="display:flex;justify-content:space-between"><span>Nuovo totale</span><b class="big">${esc(core.formatEuro(totaliDi(copia).totale))}</b></div>
      ${dettaglio}
      <button class="btn primary big block" data-action="registra-accettazione">${ICONE.check} Registra la firma</button>
      <a class="btn ghost block" href="#/p/${esc(prev.id)}">Apri il preventivo senza registrare</a>
    </section>`);
  let registrata = false; // un doppio tocco non deve applicare due volte la conferma
  azioni["registra-accettazione"] = async () => {
    if (registrata) return;
    registrata = true;
    applicaConferma(prev, conferma, firma);
    fissaAccordo(prev);
    await salvaPreventivo(prev);
    if (conferma.sulPosto && !state.pro && !state.provaPresenta) {
      state.provaPresenta = true;
      await db.set("prova-presenta", true);
    }
    traccia(conferma.sulPosto ? "Firma al tavolo registrata" : "Accettazione online registrata", { verifica });
    state.festa = prev.id;
    vai(`#/p/${prev.id}`);
  };
}

// ------------------------------------------------------------------
// Avviso "Ho pagato" mandato dal cliente
// ------------------------------------------------------------------
async function viewAvviso(q) {
  const codice = q.get("d") || "";
  const pagina = (corpo) => {
    app().innerHTML = `<header class="topbar"><a class="back" href="#/" aria-label="Chiudi">${ICONE.indietro}</a><div class="titolo"><strong>Il cliente ha pagato?</strong><div class="sopra">Avviso di pagamento</div></div></header>
      <main class="pagina">${corpo}</main>`;
  };
  let avviso;
  try {
    avviso = await leggiAvviso(codice);
  } catch (err) {
    return pagina(
      `<div class="card vuoto"><div class="illustrazione">${ICONE.link}</div><h3>Avviso non leggibile</h3><p class="muted">${esc(err.message)}. Chiedi al cliente di rimandare il messaggio.</p></div>`,
    );
  }
  const prev = state.preventivi.find((p) => p.id === avviso.id);
  if (!prev) {
    return pagina(`<div class="card stack">${aiutoAltroDispositivo(avviso.numero)}</div>`);
  }
  const i = inc.normalizzaIncasso(prev.incasso);
  const apri = `<a class="btn ghost block" href="#/p/${esc(prev.id)}?sez=incassi">Apri il preventivo</a>`;
  if (i.pagamenti.some((x) => x.rif === avviso.rif)) {
    return pagina(
      `<div class="card stack"><div class="banner ok"><span class="ico">${ICONE.fatto}</span><div>Pagamento di ${esc(core.formatEuro(avviso.importo))} già registrato.</div></div>${apri}</div>`,
    );
  }
  const giaInAttesa = i.segnalazioni.some((x) => x.rif === avviso.rif && x.stato === "attesa");
  const s = incassoDi(prev);
  const simile = pagamentoSimile(i, avviso.importo, avviso.data, avviso.rif);
  const altraSegnalazione = i.segnalazioni.find(
    (x) => x.rif !== avviso.rif && x.stato === "attesa" && Math.abs(x.importo - avviso.importo) < 0.005,
  );
  pagina(`<section class="card stack">
      <div class="row">${avatar(core.nomeCliente(prev.cliente))}<div><div style="font-weight:750;font-size:17px">${esc(core.nomeCliente(prev.cliente))} dice di aver pagato</div><div class="muted small">Preventivo n. ${esc(prev.numero)}${prev.oggetto ? ` · ${esc(prev.oggetto)}` : ""}</div></div></div>
      <div class="risultato-calc"><div class="muted small">${esc(inc.METODI[avviso.metodo])} · ${esc(core.formatData(avviso.data))}</div><div class="big tnum">${esc(core.formatEuro(avviso.importo))}</div>${avviso.nota ? `<div class="small">${esc(avviso.nota)}</div>` : ""}</div>
      <div class="banner warn"><span class="ico">${ICONE.cerca}</span><div><b>Controlla sul conto</b> che il pagamento sia arrivato davvero prima di registrarlo: l'avviso lo manda il cliente.</div></div>
      ${prev.stato !== "accettato" ? `<div class="banner warn"><span class="ico">${ICONE.firma}</span><div>Non hai ancora registrato l'<b>accettazione firmata</b> di questo preventivo: chiedi al cliente di mandarti anche la conferma.</div></div>` : ""}
      ${avviso.importo > s.residuo + 0.005 ? `<div class="banner bad"><span class="ico">${ICONE.attenzione}</span><div>L'importo è superiore a quanto resta da incassare (${esc(core.formatEuro(s.residuo))}).</div></div>` : ""}
      ${simile ? `<div class="banner warn"><span class="ico">${ICONE.aggiorna}</span><div>Hai già registrato <b>${esc(core.formatEuro(simile.importo))}</b> il ${esc(core.formatData(simile.data))} (${esc(inc.METODI[simile.metodo])}): potrebbe essere lo stesso pagamento.</div></div>` : ""}
      ${altraSegnalazione ? `<div class="banner warn"><span class="ico">${ICONE.aggiorna}</span><div>Il cliente aveva già segnalato ${esc(core.formatEuro(altraSegnalazione.importo))}: potrebbe essere lo stesso pagamento.</div></div>` : ""}
      <div class="muted small">Da incassare prima di questo pagamento: <b class="tnum">${esc(core.formatEuro(s.residuo))}</b></div>
      ${simile ? `<button class="btn big block" data-action="avviso-stesso">È lo stesso: non contarlo due volte</button>` : ""}
      <button class="btn primary big block" data-action="avviso-registra">${ICONE.check} ${simile ? "È un altro pagamento: registra" : "Sì, è arrivato: registra"}</button>
      ${giaInAttesa ? "" : `<button class="btn block" data-action="avviso-attesa">Non ancora: lo controllo dopo</button>`}
      ${apri}
    </section>`);
  // La data dichiarata dal cliente non può precedere il preventivo né cadere nel futuro.
  const dataPagamento =
    avviso.data < prev.data ? prev.data : avviso.data > core.oggiISO() ? core.oggiISO() : avviso.data;
  const seg = { ...avviso, data: dataPagamento, il: Date.now(), stato: "attesa" };
  let fatto = false; // un doppio tocco non registra due volte
  const chiudi = async (messaggio) => {
    await salvaIncasso(prev, messaggio);
    vai(`#/p/${prev.id}?sez=incassi`);
  };
  azioni["avviso-registra"] = async () => {
    if (fatto) return;
    fatto = true;
    registraDaAvviso(incassoModificabile(prev), seg);
    traccia("Avviso pagamento registrato");
    await chiudi("Pagamento registrato");
  };
  azioni["avviso-stesso"] = async () => {
    if (fatto) return;
    fatto = true;
    const dati = incassoModificabile(prev);
    const stesso = dati.pagamenti.find((x) => x.id === simile.id);
    if (!dati.segnalazioni.some((x) => x.rif === seg.rif)) dati.segnalazioni.push({ ...seg, stato: "confermata" });
    registraDaAvviso(dati, seg, stesso);
    await chiudi("Avviso collegato al pagamento già registrato");
  };
  azioni["avviso-attesa"] = async () => {
    if (fatto) return;
    fatto = true;
    const dati = incassoModificabile(prev);
    const esistente = dati.segnalazioni.find((x) => x.rif === seg.rif);
    if (!esistente) dati.segnalazioni.push(seg);
    else if (esistente.stato === "respinta") {
      // Il cliente l'ha rimandato dopo un "non è arrivato": torna da verificare.
      esistente.stato = "attesa";
      esistente.il = Date.now();
    }
    await chiudi("Lo trovi nel preventivo, da verificare");
  };
}

// ------------------------------------------------------------------
// Lavori extra (variante) di un preventivo già firmato
// ------------------------------------------------------------------
// In cantiere salta fuori un lavoro in più: si prepara una variante con le sole voci extra e il
// cliente la firma dal telefono come il preventivo. Così anche gli extra sono firmati e pagati.
const variantiDi = (prev) =>
  state.preventivi
    .filter((p) => p.variante && p.variante.di === prev.id)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

async function creaVariante(orig) {
  const numerazione = core.prossimoNumero(state.preventivi, new Date().getFullYear(), state.azienda.prefisso);
  const prev = core.preventivoVuoto(state.azienda, numerazione);
  prev.cliente = structuredClone(orig.cliente);
  prev.clienteId = orig.clienteId || null;
  prev.oggetto = `Lavori extra: ${orig.oggetto || `preventivo n. ${orig.numero}`}`.slice(0, 300);
  prev.luogo = orig.luogo || "";
  prev.regime = orig.regime || state.azienda.regime;
  prev.addebitaBollo = orig.addebitaBollo ?? state.azienda.addebitaBollo;
  // Gli extra di solito si pagano con il saldo: nessun anticipo, lo si può sempre aggiungere.
  prev.acconto = { tipo: "perc", valore: 0 };
  prev.caparra = false;
  prev.tempi = "";
  prev.variante = { di: orig.id, numero: orig.numero, data: orig.data };
  prev.note = `Lavori aggiuntivi al preventivo n. ${orig.numero} del ${core.formatData(orig.data)}, già accettato: per il resto valgono le condizioni concordate.`;
  await salvaPreventivo(prev);
  traccia("Variante creata");
  vai(`#/p/${prev.id}`);
}

function htmlVariantiDi(prev) {
  if (prev.stato !== "accettato") return "";
  const varianti = variantiDi(prev);
  const firmati = varianti.filter((v) => v.stato === "accettato");
  const totaleExtra = firmati.reduce((t, v) => t + totaliDi(v).totale, 0);
  return `<section class="card stack" id="sezione-extra">
    <div class="sezione-titolo" style="margin:0"><div><h2>Lavori extra</h2><div class="muted xsmall">${
      varianti.length
        ? firmati.length
          ? `Firmati in più: <b class="tnum">${esc(core.formatEuro(totaleExtra))}</b>`
          : "Non ancora firmati dal cliente"
        : "È saltato fuori un lavoro in più? Fallo firmare prima di farlo"
    }</div></div></div>
    ${
      varianti.length
        ? `<div class="lista">${varianti
            .map(
              (v) =>
                `<a class="voce-lista" href="#/p/${esc(v.id)}"><div class="corpo"><div class="t">${esc(v.oggetto.replace(/^Lavori extra: /, "").replace(/^./, (c) => c.toUpperCase()) || "Lavori extra")}</div><div class="s xsmall">N° ${esc(v.numero)} · ${esc(core.formatData(v.data))}</div></div><div class="dx"><span class="importo">${esc(core.formatEuro(totaliDi(v).totale))}</span><span class="badge ${esc(v.stato)}">${esc(core.STATI[v.stato] || "")}</span></div></a>`,
            )
            .join("")}</div>`
        : ""
    }
    <button class="btn block" data-action="crea-variante">${ICONE.piu} Lavori extra da far firmare</button>
  </section>`;
}

function htmlBannerVariante(prev) {
  if (!prev.variante) return "";
  const orig = state.preventivi.find((p) => p.id === prev.variante.di);
  return `<div class="banner info"><span class="ico">${ICONE.variante}</span><div style="flex:1;min-width:0"><b>Lavori extra del preventivo n. ${esc(prev.variante.numero)}</b>
    <div class="small">${prev.stato === "bozza" ? "Aggiungi solo i lavori in più, poi mandalo: il cliente li firma dal telefono come il preventivo." : "Il cliente firma e paga questi lavori a parte, con lo stesso giro del preventivo."}</div>
    ${orig ? `<a class="btn ghost small" href="#/p/${esc(orig.id)}" style="padding-inline:0">Apri il preventivo n. ${esc(orig.numero)}</a>` : ""}</div></div>`;
}

// ------------------------------------------------------------------
// Aspetto: tema e "modalità sole"
// ------------------------------------------------------------------
// Al sole un telefono si legge a fatica: la modalità sole porta tutto al contrasto massimo.
function applicaAspetto() {
  const r = document.documentElement;
  const tema = preferenza.get("pl-tema") || "";
  if (tema === "chiaro" || tema === "scuro") r.dataset.theme = tema === "chiaro" ? "light" : "dark";
  else delete r.dataset.theme;
  if (preferenza.get("pl-sole") === "1") r.dataset.contrasto = "sole";
  else delete r.dataset.contrasto;
}
applicaAspetto();

// ------------------------------------------------------------------
// Lista materiali per il fornitore
// ------------------------------------------------------------------
function testoMateriali(prev) {
  const mat = prev.righe.filter((r) => r.tipo === "mat" && !r.opzionale && String(r.descrizione || "").trim());
  if (!mat.length) return "";
  const dove = prev.luogo || prev.cliente.citta || "";
  return (
    `Buongiorno, per un lavoro${dove ? ` a ${dove}` : ""} mi servirebbe:\n` +
    mat.map((r) => `- ${core.formatQta(r.qta)} ${r.um} · ${String(r.descrizione).trim()}`).join("\n") +
    `\nMi fa sapere disponibilità e prezzo? Grazie` +
    (state.azienda.ragioneSociale ? `\n${state.azienda.ragioneSociale}` : "")
  );
}

function foglioMateriali() {
  const prev = state.corrente;
  const testo = testoMateriali(prev);
  if (!testo) return toast("Non ci sono materiali: nei dettagli di una voce scegli «Materiale»");
  const f = apriFoglio(
    `${titoloFoglio("Lista materiali per il fornitore", "Cambiala come vuoi prima di mandarla")}
    <div class="stack">
      <textarea id="mat-testo" rows="8" aria-label="Lista dei materiali">${esc(testo)}</textarea>
      <a class="btn wa big block" id="mat-wa" href="#" target="_blank" rel="noopener">${ICONE.whatsapp} Manda al fornitore su WhatsApp</a>
      <button class="btn block" data-action="mat-copia">${ICONE.copia} Copia la lista</button>
    </div>`,
  );
  const area = $("#mat-testo", f);
  const aggiorna = () => ($("#mat-wa", f).href = `https://wa.me/?text=${encodeURIComponent(area.value)}`);
  aggiorna();
  autoAltezza(area);
  area.addEventListener("input", () => {
    aggiorna();
    autoAltezza(area);
  });
  azioni["mat-copia"] = async () => toast((await copiaTesto(area.value)) ? "Lista copiata" : "Copia non riuscita");
}

// ------------------------------------------------------------------
// Parti da un lavoro già fatto (o dal modello del tuo mestiere)
// ------------------------------------------------------------------
function htmlPartiDa(prev) {
  if (prev.righe.length || prev.stato !== "bozza") return "";
  const visti = new Set();
  const fatti = state.preventivi
    .filter((p) => p.id !== prev.id && p.righe.length && String(p.oggetto || "").trim())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .filter((p) => {
      const k = p.oggetto.trim().toLowerCase();
      if (visti.has(k)) return false;
      visti.add(k);
      return true;
    })
    .slice(0, 4);
  const m = trovaMestiere(state.azienda.mestiere);
  if (!fatti.length && !m) return "";
  const corto = (t) => (t.length > 34 ? t.slice(0, 32) + "…" : t);
  return `<div class="piu-usate" style="margin-top:12px"><div class="muted xsmall">Oppure parti da un lavoro già fatto: copio voci e prezzi</div>
    <div class="row wrap" style="gap:8px">
      ${fatti.map((p) => `<button type="button" class="chip" data-action="parti-da" data-id="${esc(p.id)}">${esc(corto(p.oggetto.trim()))}</button>`).join("")}
      ${m ? `<button type="button" class="chip" data-action="parti-da-modello">${ICONE.scintille.replace("<svg", '<svg width="16" height="16" style="margin-right:4px"')}Esempio da ${esc(m.nome.toLowerCase())}</button>` : ""}
    </div></div>`;
}

function copiaVoci(prev, righe, oggetto) {
  prev.righe = righe.map((r) => ({ ...r, id: core.uid() }));
  if (!String(prev.oggetto || "").trim() && oggetto) prev.oggetto = oggetto;
  salvaDopo(prev);
  viewEditor(prev.id);
  toast("Voci copiate: controlla quantità e prezzi", "ok");
}

// ------------------------------------------------------------------
// Pagamenti per il commercialista (CSV, si apre con Excel)
// ------------------------------------------------------------------
function csvPagamenti() {
  const cella = (v) => {
    const t = String(v ?? "");
    // Niente formule eseguite da Excel: si neutralizzano i caratteri iniziali "pericolosi".
    const sicuro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
    return /[";\n]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro;
  };
  const righe = [["Data", "Cliente", "Codice fiscale / P.IVA", "Preventivo", "Lavoro", "Importo", "Metodo", "Nota"]];
  const tutti = [];
  for (const p of state.preventivi) for (const x of inc.normalizzaIncasso(p.incasso).pagamenti) tutti.push({ p, x });
  tutti.sort((a, b) => a.x.data.localeCompare(b.x.data));
  for (const { p, x } of tutti)
    righe.push([
      core.formatData(x.data),
      core.nomeCliente(p.cliente),
      p.cliente.cfpiva || "",
      p.numero,
      p.oggetto || "",
      String(core.round2(x.importo)).replace(".", ","),
      inc.METODI[x.metodo] || "",
      x.nota || "",
    ]);
  return { testo: "﻿" + righe.map((r) => r.map(cella).join(";")).join("\r\n"), n: tutti.length };
}

// ------------------------------------------------------------------
// Messaggi del cliente incollati o condivisi nell'app
// ------------------------------------------------------------------
// Su iPhone l'app installata e Safari non condividono i dati: il link del cliente aperto da WhatsApp
// finisce nel browser, dove il preventivo non c'è. Incollando (o condividendo) il messaggio nell'app
// si arriva comunque alla conferma o all'avviso di pagamento.
const RE_LINK_CLIENTE = /#\/(accettazione|pagamento)\?d=([A-Za-z0-9_-]+)/;

function apriDaTesto(testo) {
  const m = String(testo || "").match(RE_LINK_CLIENTE);
  if (!m) return false;
  vai(`#/${m[1]}?d=${m[2]}`);
  return true;
}

async function incollaMessaggio() {
  try {
    if (apriDaTesto(await navigator.clipboard.readText())) return;
  } catch {
    /* lettura degli appunti negata: si incolla a mano */
  }
  const f = apriFoglio(
    `${titoloFoglio("Incolla il messaggio del cliente", "La conferma della firma o l'avviso di pagamento arrivato su WhatsApp")}
    <div class="stack">
      <textarea id="incolla-testo" rows="4" placeholder="Tieni premuto qui e scegli Incolla" aria-label="Messaggio del cliente"></textarea>
      <button class="btn primary big block" data-action="incolla-apri">Apri</button>
    </div>`,
  );
  azioni["incolla-apri"] = () => {
    if (apriDaTesto($("#incolla-testo", f).value)) return;
    toast("Nel messaggio non trovo il link del cliente: copia tutto il messaggio");
  };
}

function aiutoAltroDispositivo(numero) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const passi =
    ios && !standalone
      ? `<ol class="small" style="margin:8px 0 0;padding-left:20px;line-height:1.6"><li>Tocca <b>Copia il link</b> qui sotto</li><li>Apri PreventivoLampo dalla schermata Home</li><li>Tocca <b>Incolla il messaggio</b> nella pagina iniziale</li></ol>`
      : "";
  return `<div class="banner warn"><span class="ico">${ICONE.info}</span><div>${
    ios && !standalone
      ? `Sei nel browser, non nell'app: per questo non trovo il preventivo n. ${esc(numero)}.`
      : `Il preventivo n. ${esc(numero)} non è su questo telefono. Apri il messaggio sul telefono dove l'hai creato.`
  }${passi}</div></div>
  ${ios && !standalone ? `<button class="btn block" data-action="copia-link-pagina">${ICONE.copia} Copia il link</button>` : ""}`;
}

// ------------------------------------------------------------------
// Paywall e Pro
// ------------------------------------------------------------------
const VANTAGGI_PRO = [
  "Preventivi e link di accettazione illimitati",
  "Recupero crediti: solleciti decisi, lettera di messa in mora e fascicolo del credito in PDF",
  "Il tuo logo e i tuoi colori su PDF e pagina del cliente",
  "Firma al tavolo: il cliente sceglie gli extra e firma sul tuo telefono",
  "Foto del lavoro allegate al preventivo",
  'Niente scritta "Creato con PreventivoLampo"',
  "Assistenza prioritaria via email",
];

function paywall(motivo) {
  traccia("Paywall", { motivo });
  const mese = new Date().toLocaleDateString("it-IT", { month: "long" });
  const titoli = {
    limite: `Hai usato i ${CONFIG.pdfGratisAlMese} preventivi gratuiti di ${mese}`,
    firma: "Ti è piaciuto? Con Pro fai firmare sul posto ogni cliente",
    logo: "Logo e colori sono funzioni Pro",
    foto: "Le foto nel preventivo sono una funzione Pro",
    crediti: "Il recupero crediti è una funzione Pro",
  };
  apriFoglio(
    `${titoloFoglio(titoli[motivo] || "Passa a Pro")}
    <p class="muted" style="margin:-6px 0 14px">Basta <b>un lavoro in più all'anno</b> per ripagare l'abbonamento.</p>
    <ul class="vantaggi">${VANTAGGI_PRO.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>
    <a class="btn primary big block" href="#/pro" style="margin-top:18px">Vedi i piani da ${esc(CONFIG.prezzi.annuale.importo.replace(" €", ""))} €/anno</a>`,
  );
}

function viewPro(q) {
  const lic = state.licenza;
  const piani = [
    ["annuale", "Annuale", "Consigliato"],
    ["mensile", "Mensile", ""],
    ["aVita", "A vita", "Offerta lancio"],
  ].filter(([k]) => k !== "aVita" || CONFIG.checkout.aVita);

  const htmlPiani = piani
    .map(([k, nome, etichetta]) => {
      const p = CONFIG.prezzi[k];
      return `<div class="piano ${k === "annuale" ? "consigliato" : ""}" data-action="checkout" data-piano="${k}" role="button" tabindex="0">
        ${etichetta ? `<span class="etichetta">${esc(etichetta)}</span>` : ""}
        <div class="info"><div class="muted small" style="font-weight:700">${esc(nome)}</div>
          <div><span class="prezzo">${esc(p.importo)}</span> <span class="muted">${esc(p.periodo)}</span></div>
          ${p.nota ? `<div class="small" style="color:var(--ok);font-weight:700">${esc(p.nota)}</div>` : ""}</div>
        <span class="btn small ${k === "annuale" ? "primary" : ""}">Scegli</span>
      </div>`;
    })
    .join("");

  const statoLicenza = state.pro
    ? `<div class="banner ok"><span class="ico">${ICONE.stella}</span><div><b>Pro attivo</b>${lic.email ? ` · ${esc(lic.email)}` : ""}${lic.scadenza ? `<br><span class="small">Rinnovo/scadenza: ${esc(new Date(lic.scadenza).toLocaleDateString("it-IT"))}</span>` : ""}</div></div>
       ${CONFIG.portaleClienti ? `<a class="btn block" href="${esc(urlSicuro(CONFIG.portaleClienti))}" target="_blank" rel="noopener">Gestisci abbonamento e fatture</a>` : ""}
       <button class="btn block danger" data-action="rimuovi-licenza">Rimuovi licenza da questo dispositivo</button>`
    : "";

  app().innerHTML = `
    <header class="topbar"><a class="back" href="#/" aria-label="Indietro">${ICONE.indietro}</a><div class="titolo"><strong>${state.pro ? "Il tuo piano" : "PreventivoLampo Pro"}</strong></div></header>
    <main class="pagina">
      ${q.get("acquisto") === "ok" ? `<div class="banner ok"><span class="ico">${ICONE.fatto}</span><div><b>Grazie per l'acquisto!</b> Ti abbiamo inviato via email il <b>codice licenza</b>: incollalo qui sotto per attivare Pro.</div></div>` : ""}
      ${statoLicenza}
      ${
        state.pro
          ? ""
          : `
      <section class="pro-hero"><div class="stellina">${ICONE.stella}</div><h2>Vinci più lavori</h2><p>Preventivi illimitati, il tuo logo, foto e firma del cliente.</p></section>
      <section class="card"><ul class="vantaggi">${VANTAGGI_PRO.map((v) => `<li>${esc(v)}</li>`).join("")}</ul></section>
      <div class="piani">${htmlPiani}</div>
      <p class="muted small" style="text-align:center;margin:0">Prezzi IVA inclusa · Pagamento sicuro · Disdici quando vuoi</p>`
      }
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.lucchetto}</span><h2>Hai un codice licenza?</h2></div>
        <input id="chiave" placeholder="Incolla qui il codice ricevuto via email" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(lic && !state.pro ? lic.chiave : "")}" aria-label="Codice licenza">
        <button class="btn primary block" data-action="attiva-licenza">Attiva Pro</button>
        <div id="esito-licenza" class="small" role="status"></div>
      </section>
    </main>`;
}

async function attivaLicenza() {
  const chiave = $("#chiave").value.trim();
  const esito = $("#esito-licenza");
  if (chiave.length < 8) {
    esito.textContent = "Inserisci il codice completo che hai ricevuto via email.";
    return;
  }
  esito.textContent = "Verifica in corso...";
  try {
    const lic = await verifica(chiave, CONFIG);
    if (lic.valida) {
      state.licenza = lic;
      state.pro = isPro(lic, CONFIG);
      await db.set("licenza", lic);
      traccia("Pro attivato");
      vibra(30);
      toast("Pro attivato. Buon lavoro!", "ok");
      viewPro(new URLSearchParams());
    } else {
      esito.innerHTML = `<span style="color:var(--bad)">${esc(lic.messaggio || "Codice non valido o abbonamento scaduto.")}</span>`;
    }
  } catch (err) {
    esito.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`;
  }
}

// ------------------------------------------------------------------
// Clienti
// ------------------------------------------------------------------
function viewClienti() {
  const conteggi = {};
  for (const p of state.preventivi) if (p.clienteId) conteggi[p.clienteId] = (conteggi[p.clienteId] || 0) + 1;
  const lista = [...state.clienti].sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "it"));
  app().innerHTML = `
    <header class="topbar"><div class="titolo"><strong style="font-size:22px">Clienti</strong></div><button class="btn small" data-action="cliente-nuovo">${ICONE.piu} Nuovo cliente</button></header>
    <main class="pagina">
      ${lista.length ? `<input type="search" id="cerca-clienti" placeholder="Cerca cliente" aria-label="Cerca cliente">` : ""}
      <div class="lista" id="lista-clienti">${htmlListaClienti(lista, conteggi, "")}</div>
    </main>`;
  ombraTopbar();
  $("#cerca-clienti")?.addEventListener(
    "input",
    (e) => ($("#lista-clienti").innerHTML = htmlListaClienti(lista, conteggi, e.target.value)),
  );
}

function htmlListaClienti(lista, conteggi, filtro) {
  const f = filtro.trim().toLowerCase();
  const trovati = lista.filter((c) => !f || [c.nome, c.telefono, c.email, c.citta].join(" ").toLowerCase().includes(f));
  if (!lista.length) {
    return `<div class="card vuoto"><div class="illustrazione">${ICONE.clienti}</div><h3>Ancora nessun cliente</h3><p class="muted">I clienti si salvano da soli quando crei un preventivo.</p></div>`;
  }
  return (
    trovati
      .map(
        (c) => `<button class="voce-lista" data-action="cliente-apri" data-id="${esc(c.id)}">
          ${avatar(c.nome)}
          <div class="corpo"><div class="t">${esc(c.nome)}</div><div class="s">${esc([c.telefono, c.citta].filter(Boolean).join(" · ") || "—")}</div></div>
          <div class="dx muted small">${(conteggi[c.id] || 0) === 1 ? "1 preventivo" : `${conteggi[c.id] || 0} preventivi`}</div></button>`,
      )
      .join("") || `<p class="muted">Nessun cliente trovato.</p>`
  );
}

function foglioCliente(id) {
  const c = state.clienti.find((x) => x.id === id) || { id: core.uid(), nome: "", createdAt: Date.now() };
  const nuovo = !state.clienti.some((x) => x.id === c.id);
  const campo = (k, etichetta, tipo = "text", extra = "") =>
    `<label class="campo">${etichetta}<input data-cli="${k}" type="${tipo}" value="${esc(c[k])}" ${extra}></label>`;
  const suoi = nuovo
    ? []
    : state.preventivi.filter((p) => p.clienteId === c.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const deve = suoi.filter((p) => p.stato === "accettato").reduce((t, p) => t + Math.max(0, incassoDi(p).residuo), 0);
  const tel = core.telefonoWhatsApp(c.telefono);
  const campi = `
      ${campo("nome", "Nome e cognome o ragione sociale", "text", 'autocomplete="off"')}
      <div class="grid2 stack-mobile">${campo("telefono", "Cellulare (WhatsApp)", "tel", 'inputmode="tel"')}${campo("email", "Email", "email")}</div>
      ${campo("indirizzo", "Indirizzo")}
      ${campo("citta", "CAP, città e provincia")}
      ${campo("cfpiva", "Codice fiscale o partita IVA", "text", 'autocapitalize="characters" spellcheck="false"')}
      <label class="campo"><span>Note per te <span class="aiuto">non compaiono nel preventivo</span></span><textarea data-cli="note" rows="2">${esc(c.note)}</textarea></label>
      <button class="btn primary block" data-action="cliente-salva">Salva</button>`;
  apriFoglio(
    `${titoloFoglio(nuovo ? "Nuovo cliente" : esc(c.nome), nuovo ? "" : esc([c.telefono, c.citta].filter(Boolean).join(" · ")))}
    <div class="stack">
      ${
        nuovo
          ? campi
          : `<div class="grid3">
          <button class="btn soft" data-action="cliente-preventivo" style="flex-direction:column;gap:4px;min-height:66px;font-size:14px">${ICONE.nuovo}Preventivo</button>
          ${tel ? `<a class="btn soft" href="https://wa.me/${tel}" target="_blank" rel="noopener" style="flex-direction:column;gap:4px;min-height:66px;font-size:14px">${ICONE.whatsapp}WhatsApp</a>` : `<span></span>`}
          ${c.telefono ? `<a class="btn soft" href="tel:${esc(String(c.telefono).replace(/\s/g, ""))}" style="flex-direction:column;gap:4px;min-height:66px;font-size:14px">${ICONE.telefono}Chiama</a>` : `<span></span>`}
        </div>
        ${deve > 0.005 ? `<div class="banner warn"><span class="ico">${ICONE.pagamento}</span><div>Deve ancora pagarti <b class="tnum">${esc(core.formatEuro(deve))}</b></div></div>` : ""}
        ${
          suoi.length
            ? `<div><div class="muted small">I suoi preventivi</div><div class="lista" style="margin-top:6px">${suoi
                .map(
                  (p) =>
                    `<a class="voce-lista" href="#/p/${esc(p.id)}"><div class="corpo"><div class="t">${esc(p.oggetto || "Senza titolo")}</div><div class="s xsmall">N° ${esc(p.numero)} · ${esc(core.formatData(p.data))}</div></div><div class="dx"><span class="importo">${esc(core.formatEuro(totaliDi(p).totale))}</span><span class="badge ${esc(p.stato)}">${esc(core.STATI[p.stato] || "")}</span></div></a>`,
                )
                .join("")}</div></div>`
            : ""
        }
        <details><summary>Modifica i dati del cliente</summary><div class="stack">${campi}</div></details>
        <button class="btn danger block" data-action="cliente-elimina">${ICONE.cestino} Elimina cliente</button>`
      }
    </div>`,
  );
  const raccogli = () => {
    const r = { ...c };
    $$("[data-cli]").forEach((el) => (r[el.dataset.cli] = el.value.trim()));
    r.updatedAt = Date.now();
    return r;
  };
  azioni["cliente-salva"] = async () => {
    const r = raccogli();
    if (!r.nome) return toast("Inserisci il nome del cliente");
    await db.salva("clienti", r);
    const i = state.clienti.findIndex((x) => x.id === r.id);
    if (i >= 0) state.clienti[i] = r;
    else state.clienti.push(r);
    chiudiFoglio();
    viewClienti();
    toast("Cliente salvato", "ok");
  };
  azioni["cliente-preventivo"] = () => vai(`#/nuovo?cliente=${encodeURIComponent(c.id)}`);
  azioni["cliente-elimina"] = async () => {
    if (
      !(await chiedi({
        titolo: `Eliminare ${c.nome}?`,
        testo: "I preventivi già fatti restano.",
        ok: "Elimina",
        pericolo: true,
      }))
    )
      return;
    await db.elimina("clienti", c.id);
    state.clienti = state.clienti.filter((x) => x.id !== c.id);
    viewClienti();
  };
}

// ------------------------------------------------------------------
// Listino
// ------------------------------------------------------------------
function viewListino() {
  const voci = [...state.listino].sort((a, b) => a.descrizione.localeCompare(b.descrizione, "it"));
  const m = trovaMestiere(state.azienda.mestiere);
  app().innerHTML = `
    <header class="topbar"><div class="titolo"><strong style="font-size:22px">I miei prezzi</strong></div><button class="btn small" data-action="voce-nuova">${ICONE.piu} Nuova voce</button></header>
    <main class="pagina">
      <p class="muted" style="margin:0">I lavori e i materiali che usi più spesso, con i tuoi prezzi: nel preventivo li aggiungi con un tocco o dettandoli.</p>
      ${voci.length ? `<input type="search" id="cerca-voci" placeholder="Cerca voce" aria-label="Cerca voce">` : ""}
      <div class="card" style="padding:4px 12px" id="lista-voci">${htmlVociListino(voci, "")}</div>
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><h2>Prezzi tipici per mestiere</h2></div>
        <p class="muted small" style="margin:0">Aggiunge le voci più comuni con prezzi indicativi, da adattare ai tuoi.</p>
        <select id="mestiere-esempi" aria-label="Mestiere">${MESTIERI.map((x) => `<option value="${x.id}" ${m && m.id === x.id ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select>
        <button class="btn soft block" data-action="carica-esempi-sel">Aggiungi al mio listino</button>
      </section>
    </main>`;
  ombraTopbar();
  $("#cerca-voci")?.addEventListener(
    "input",
    (e) => ($("#lista-voci").innerHTML = htmlVociListino(voci, e.target.value)),
  );
}

function htmlVociListino(voci, filtro) {
  const f = filtro.trim().toLowerCase();
  if (!voci.length)
    return `<p class="muted" style="padding:8px 4px">Non hai ancora salvato prezzi. Aggiungi una voce o carica i prezzi tipici del tuo mestiere qui sotto.</p>`;
  return (
    voci
      .filter((v) => !f || v.descrizione.toLowerCase().includes(f))
      .map(
        (v) => `<button class="voce-listino" data-action="voce-apri" data-id="${esc(v.id)}">
          <span class="tipo" aria-hidden="true">${v.tipo === "mat" ? ICONE.carrello : ICONE.lavoro}</span>
          <div class="corpo"><div>${esc(v.descrizione)}</div><div class="muted xsmall">${v.tipo === "mat" ? "Materiale" : "Manodopera"} · ${esc(v.um)}${v.costo > 0 ? ` · costo ${esc(core.formatEuro(v.costo))}` : ""}</div></div>
          <div class="prezzo">${core.formatEuro(v.prezzo)}</div></button>`,
      )
      .join("") || `<p class="muted">Nessuna voce trovata.</p>`
  );
}

function foglioVoce(id) {
  const v = state.listino.find((x) => x.id === id) || {
    id: core.uid(),
    descrizione: "",
    um: "cad",
    prezzo: 0,
    tipo: "man",
    iva: ivaRiga(),
    costo: 0,
  };
  const nuova = !state.listino.some((x) => x.id === v.id);
  apriFoglio(
    `${titoloFoglio(nuova ? "Nuova voce" : "Modifica voce")}
    <div class="stack">
      <textarea id="v-desc" rows="2" placeholder="Descrizione" aria-label="Descrizione">${esc(v.descrizione)}</textarea>
      <div class="grid2">
        <label class="campo">Prezzo €<input id="v-prezzo" inputmode="decimal" value="${numIn(v.prezzo, true)}" placeholder="0,00"></label>
        <label class="campo">Unità<select id="v-um">${core.UNITA.map((u) => `<option ${u === v.um ? "selected" : ""}>${u}</option>`).join("")}</select></label>
      </div>
      <div class="grid2">
        <label class="campo">Tipo<select id="v-tipo"><option value="man" ${v.tipo !== "mat" ? "selected" : ""}>Manodopera</option><option value="mat" ${v.tipo === "mat" ? "selected" : ""}>Materiale</option></select></label>
        <label class="campo">Tuo costo € <span class="muted xsmall">(privato)</span><input id="v-costo" inputmode="decimal" value="${numIn(v.costo, true)}" placeholder="0,00"></label>
      </div>
      <button class="btn primary block" data-action="voce-salva">Salva</button>
      ${nuova ? "" : `<button class="btn danger block" data-action="voce-elimina">${ICONE.cestino} Elimina</button>`}
    </div>`,
  );
  azioni["voce-salva"] = async () => {
    const r = {
      ...v,
      descrizione: $("#v-desc").value.trim(),
      prezzo: core.parseNumero($("#v-prezzo").value),
      um: $("#v-um").value,
      tipo: $("#v-tipo").value,
      costo: core.parseNumero($("#v-costo").value),
    };
    if (!r.descrizione) return toast("Inserisci la descrizione");
    await db.salva("listino", r);
    const i = state.listino.findIndex((x) => x.id === r.id);
    if (i >= 0) state.listino[i] = r;
    else state.listino.push(r);
    chiudiFoglio();
    viewListino();
  };
  azioni["voce-elimina"] = async () => {
    await db.elimina("listino", v.id);
    state.listino = state.listino.filter((x) => x.id !== v.id);
    chiudiFoglio();
    viewListino();
  };
}

// ------------------------------------------------------------------
// Impostazioni
// ------------------------------------------------------------------
function viewImpostazioni() {
  const a = state.azienda;
  // Ridisegnando la stessa pagina le sezioni aperte restano aperte (l'evento "toggle" arriva in ritardo).
  for (const d of $$("details.sez-imp")) {
    if (d.open) state.impAperte.add(d.dataset.sez);
    else state.impAperte.delete(d.dataset.sez);
  }
  const campo = (k, etichetta, ph = "", tipo = "text", extra = "") =>
    `<label class="campo">${etichetta}<input data-az="${k}" type="${tipo}" placeholder="${esc(ph)}" value="${esc(a[k])}" ${extra}></label>`;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const rimasti = core.pdfRimasti(state.contatore, CONFIG.pdfGratisAlMese);
  const proBadge = state.pro ? "" : ` <span class="badge pro">PRO</span>`;
  const logo = immagineSicura(a.logo);
  const ultimaCopia = Number(preferenza.get("pl-ultima-copia")) || 0;
  const sezione = (id, titolo, riassunto, corpo) =>
    `<details class="card sez-imp" data-sez="${id}" ${state.impAperte.has(id) ? "open" : ""}>
      <summary><span class="corpo"><b>${titolo}</b><span class="small">${riassunto}</span></span></summary>
      <div class="stack">${corpo}</div>
    </details>`;
  const ibanOk = inc.ibanValido(a.iban);
  const sintesiImpresa = [a.ragioneSociale, a.citta].filter(Boolean).join(", ") || "Mancano i dati";
  const sintesiPagamenti = ibanOk
    ? `IBAN valido${urlSicuro(a.linkPagamento) ? " · pagamento online" : ""}`
    : a.iban
      ? "IBAN da controllare"
      : "Aggiungi l'IBAN: i clienti pagano con un tocco";
  const sintesiPreventivi = `valido ${Number(a.validitaGiorni) || 30} giorni · anticipo ${Number(a.accontoDefault ?? 30)}%${a.tipoAnticipo === "caparra" ? " (caparra)" : ""}`;
  const sintesiFisco =
    a.regime === "forfettario"
      ? "Regime forfettario, senza IVA"
      : `IVA ${Number(a.ivaDefault) || 22}% sulle nuove voci`;

  app().innerHTML = `
    <header class="topbar"><div class="titolo"><strong style="font-size:22px">Impostazioni</strong></div></header>
    <main class="pagina">
      <section class="card">
        ${
          state.pro
            ? `<div class="row"><span class="badge pro">PRO</span><span class="small">Attivo${state.licenza.email ? " · " + esc(state.licenza.email) : ""}</span><a class="btn small" style="margin-left:auto" href="#/pro">Gestisci</a></div>`
            : `<div class="row"><div><b>Piano gratuito</b><div class="muted xsmall">${rimasti === 1 ? "1 preventivo gratuito rimasto" : `${rimasti} preventivi gratuiti rimasti`} questo mese</div></div><a class="btn small" style="margin-left:auto" href="#/pro">Vedi Pro</a></div>`
        }
      </section>

      ${sezione(
        "impresa",
        "La tua impresa",
        esc(sintesiImpresa),
        `<p class="muted small" style="margin:0">Compare in testa a ogni preventivo.</p>
        ${campo("ragioneSociale", "Nome dell'impresa", "es. Idraulica Rossi di Mario Rossi", "text", 'autocomplete="organization"')}
        ${campo("indirizzo", "Indirizzo", "Via Roma 1")}
        <div class="grid3">${campo("cap", "CAP", "", "text", 'inputmode="numeric"')}${campo("citta", "Città")}${campo("provincia", "Prov.", "MI", "text", 'autocapitalize="characters"')}</div>
        <div class="grid2 stack-mobile">${campo("piva", "Partita IVA", "", "text", 'inputmode="numeric"')}${campo("cf", "Codice fiscale", "", "text", 'autocapitalize="characters" spellcheck="false"')}</div>
        <div class="grid2 stack-mobile">${campo("telefono", "Cellulare (WhatsApp)", "", "tel")}${campo("email", "Email", "", "email")}</div>
        <div class="grid2 stack-mobile">${campo("pec", "PEC", "", "email")}${campo("sito", "Sito web", "", "url")}</div>`,
      )}

      ${sezione(
        "pagamenti",
        "Come ti pagano i clienti",
        esc(sintesiPagamenti),
        `<div class="grid2 stack-mobile">${campo("iban", "IBAN", "IT60 X054 2811 1010 0000 0123 456", "text", 'autocapitalize="characters" spellcheck="false" autocomplete="off"')}${campo("intestatarioIban", "Intestato a")}</div>
        <div id="iban-stato" class="small">${htmlStatoIban(a.iban)}</div>
        ${campo("linkPagamento", "Link per pagare online (facoltativo)", "https://paypal.me/... o Satispay, Stripe", "url")}
        <p class="muted small" style="margin:0">Il cliente che accetta online vede l'importo dell'anticipo, i dati del bonifico da copiare, il QR e il pulsante "Paga online".</p>`,
      )}

      ${sezione(
        "preventivi",
        "Preventivi e testi",
        esc(sintesiPreventivi),
        `<div class="grid2">${campo("prefisso", "Prefisso del numero", "es. P-")}${campo("validitaGiorni", "Valido per (giorni)", "30", "number", 'inputmode="numeric"')}</div>
        <label class="campo">Anticipo nei nuovi preventivi
          <select data-az="accontoDefault">${[0, 20, 30, 40, 50].map((n) => `<option value="${n}" ${Number(a.accontoDefault ?? 30) === n ? "selected" : ""}>${n ? `${n}% quando il cliente accetta` : "Nessun anticipo"}</option>`).join("")}</select></label>
        <label class="campo">L'anticipo vale come
          <select data-az="tipoAnticipo">
            <option value="acconto" ${a.tipoAnticipo !== "caparra" ? "selected" : ""}>Acconto: si scala dal prezzo</option>
            <option value="caparra" ${a.tipoAnticipo === "caparra" ? "selected" : ""}>Caparra confirmatoria (art. 1385 c.c.)</option>
          </select></label>
        <p class="muted small" style="margin:0">Con la caparra confirmatoria, se il cliente non rispetta l'accordo puoi recedere e trattenerla; se sei tu a non rispettarlo, il cliente può chiederne il doppio.</p>
        <label class="campo">Il saldo va pagato entro
          <select data-az="giorniSaldo">${[0, 7, 15, 30, 60, 90]
            .map(
              (n) =>
                `<option value="${n}" ${Number(a.giorniSaldo) === n ? "selected" : ""}>${n === 0 ? "la fine dei lavori" : `${n} giorni dalla fine dei lavori`}</option>`,
            )
            .join("")}</select></label>
        <label class="campo">Ricordami di richiamare chi non risponde dopo
          <select data-az="giorniRicontatto">${[2, 3, 5, 7, 10].map((n) => `<option value="${n}" ${Number(a.giorniRicontatto) === n ? "selected" : ""}>${n} giorni</option>`).join("")}</select></label>
        <label class="campo">Come ti pagano (testo predefinito)<textarea data-az="pagamento" rows="2">${esc(a.pagamento)}</textarea></label>
        <label class="campo">Condizioni predefinite<textarea data-az="condizioni" rows="4">${esc(a.condizioni)}</textarea></label>
        <button class="btn soft block" data-action="clausola-pagamenti">${ICONE.condizioni} Aggiungi la clausola sui ritardi di pagamento</button>`,
      )}

      ${sezione(
        "fisco",
        "IVA e fisco",
        esc(sintesiFisco),
        `<label class="campo">Regime fiscale
          <select data-az="regime">
            <option value="ordinario" ${a.regime !== "forfettario" ? "selected" : ""}>Con IVA (ordinario o semplificato)</option>
            <option value="forfettario" ${a.regime === "forfettario" ? "selected" : ""}>Forfettario (senza IVA)</option>
          </select>
        </label>
        ${
          a.regime === "forfettario"
            ? `<label class="check"><input type="checkbox" data-az="addebitaBollo" ${a.addebitaBollo ? "checked" : ""}> <span>Addebita al cliente il bollo da 2 € (sopra 77,47 €)</span></label>
             <label class="campo">Frase del regime forfettario<textarea data-az="fraseForfettario" rows="3">${esc(a.fraseForfettario)}</textarea></label>`
            : `<label class="campo">IVA per le nuove voci
              <select data-az="ivaDefault">${core.ALIQUOTE_IVA.map((x) => `<option value="${x}" ${Number(a.ivaDefault) === x ? "selected" : ""}>${x}%</option>`).join("")}</select></label>`
        }`,
      )}

      ${sezione(
        "logo",
        `Logo e colore${proBadge}`,
        logo ? "Logo caricato" : "Il tuo marchio sul PDF e sulla pagina del cliente",
        `<div class="row">
          ${logo ? `<img src="${logo}" alt="Logo" style="max-height:56px;max-width:140px;border-radius:8px;background:#fff;padding:4px">` : `<span class="muted small">Nessun logo</span>`}
          ${
            state.pro
              ? `<label class="btn small" style="margin-left:auto">Carica logo<input type="file" accept="image/png,image/jpeg,image/webp" id="file-logo" hidden></label>`
              : `<button class="btn small" style="margin-left:auto" data-action="paywall" data-motivo="logo">Carica logo</button>`
          }
          ${logo ? `<button class="btn small danger" data-action="rimuovi-logo">Rimuovi</button>` : ""}
        </div>
        ${
          state.pro
            ? `<label class="campo">Colore del preventivo<input type="color" data-az="colore" value="${esc(/^#[0-9a-f]{6}$/i.test(a.colore) ? a.colore : "#1a1d21")}"></label>`
            : `<button class="btn block" data-action="paywall" data-motivo="logo">Scegli il colore del preventivo</button>`
        }`,
      )}

      ${sezione(
        "recensioni",
        "Recensioni",
        a.linkRecensioni ? "Link impostato" : "Fatti lasciare una recensione su Google",
        `${campo("linkRecensioni", "Link per lasciarti una recensione (Google)", "https://g.page/r/...", "url")}
        <p class="muted small" style="margin:0">Quando un lavoro è pagato tutto, l'app ti propone di chiedere la recensione con un messaggio già pronto.</p>`,
      )}

      ${sezione(
        "crediti",
        "Recupero crediti",
        "Interessi di mora per le lettere",
        `<div class="grid2 stack-mobile">${campo("tassoMoraPrivati", "Interessi di mora % per i privati", "tasso legale in vigore", "text", 'inputmode="decimal"')}${campo("tassoMoraImprese", "Interessi di mora % per le imprese", "tasso D.Lgs. 231/2002", "text", 'inputmode="decimal"')}</div>
        <details><summary>Quali tassi mettere?</summary><p class="muted small" style="margin:0">Facoltativi: servono alla lettera di messa in mora per calcolare gli interessi. Per i privati vale il tasso legale (art. 1284 c.c., fissato ogni anno dal Ministero dell'Economia); per imprese ed enti pubblici quello del D.Lgs. 231/2002 (BCE + 8 punti, aggiornato ogni sei mesi). Nel preventivo puoi indicare se il cliente è un'impresa.</p></details>
        <p class="muted xsmall" style="margin:0">${esc(AVVISO_LEGALE)}</p>`,
      )}

      ${sezione(
        "aspetto",
        "Aspetto",
        preferenza.get("pl-sole") === "1"
          ? "Modalità sole attiva"
          : { chiaro: "Tema chiaro", scuro: "Tema scuro" }[preferenza.get("pl-tema")] || "Tema come il telefono",
        `<div class="seg seg-pieno" role="radiogroup" aria-label="Tema">${[
          ["", "Come il telefono"],
          ["chiaro", "Chiaro"],
          ["scuro", "Scuro"],
        ]
          .map(([k, v]) => {
            const on = (preferenza.get("pl-tema") || "") === k;
            return `<button type="button" role="radio" data-action="tema" data-tema="${k}" class="${on ? "on" : ""}" aria-checked="${on}">${v}</button>`;
          })
          .join("")}</div>
        <label class="check"><span class="switch"><input type="checkbox" id="pref-sole" ${preferenza.get("pl-sole") === "1" ? "checked" : ""}><span></span></span><span><b>Modalità sole</b><br><span class="small muted">Contrasto massimo e testi più grandi, per leggere bene all'aperto</span></span></label>`,
      )}

      ${sezione(
        "promemoria",
        "Promemoria",
        "Chi deve pagare, chi richiamare",
        `<p class="muted small" style="margin:0">L'app non manda notifiche: per non dimenticarti di nessuno, mettiti un appuntamento fisso nel calendario del telefono.</p>
        <button class="btn block" data-action="promemoria-conti">${ICONE.sveglia} Ogni venerdì alle 17:30: 5 minuti per i conti</button>`,
      )}

      ${sezione(
        "dati",
        "Copia di sicurezza e app",
        ultimaCopia
          ? `Ultima copia il ${esc(core.formatData(core.oggiISO(new Date(ultimaCopia))))}`
          : "Nessuna copia: i dati sono solo su questo telefono",
        `${state.installEvento ? `<button class="btn soft block" data-action="installa">${ICONE.scarica} Installa l'app sul telefono</button>` : ""}
        ${isIos && !standalone ? `<div class="banner info"><span class="ico">${ICONE.info}</span><div>Per installare l'app su iPhone: tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>.</div></div>` : ""}
        <p class="muted small" style="margin:0">I preventivi restano solo su questo telefono. Salva una copia ogni tanto e prima di cambiare telefono: puoi mandarla a te stesso su WhatsApp o salvarla su Drive.</p>
        <div class="grid2">
          <button class="btn" data-action="backup-esporta">${ICONE.scarica} Salva una copia</button>
          <label class="btn">Ripristina<input type="file" accept="application/json,.json" id="file-backup" hidden></label>
        </div>
        <button class="btn block" data-action="esporta-pagamenti">${ICONE.tabella} Pagamenti ricevuti per il commercialista (Excel)</button>`,
      )}

      <button class="btn soft block" data-action="consiglia">${ICONE.condividi} Consiglia l'app a un collega</button>
      <div class="row wrap small" style="justify-content:center;gap:16px;margin-top:4px">
        <a href="privacy.html">Privacy</a><a href="termini.html">Termini</a><a href="mailto:${esc(CONFIG.emailSupporto)}">Assistenza</a>
      </div>
    </main>`;
  ombraTopbar();
  $$("details.sez-imp").forEach((d) =>
    d.addEventListener("toggle", () => {
      if (d.open) state.impAperte.add(d.dataset.sez);
      else state.impAperte.delete(d.dataset.sez);
    }),
  );

  $("#file-logo")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { img } = await comprimiImmagine(file, { lato: 600, formato: "image/png" });
      state.azienda.logo = img;
      await salvaAzienda();
      viewImpostazioni();
      toast("Logo salvato", "ok");
    } catch (err) {
      toast(err.message || "Immagine non valida");
    }
  });
  $("#file-backup").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) return toast("File troppo grande");
    try {
      const dati = JSON.parse(await file.text());
      const ok = await chiedi({
        titolo: "Ripristinare questa copia?",
        testo: "Sostituirà i dati che ci sono adesso su questo telefono.",
        ok: "Ripristina",
        pericolo: true,
      });
      if (!ok) return;
      const n = await db.importa(dati);
      await caricaTutto();
      toast(`Copia ripristinata: ${n.preventivi} preventivi, ${n.clienti} clienti`, "ok");
      vai("#/");
    } catch (err) {
      toast(err.message || "File non valido");
    }
  });
}

const AVVISO_LEGALE =
  "Caparra, solleciti e lettera di messa in mora sono modelli generici, non consulenza legale: per crediti importanti rivolgiti a un avvocato o alla tua associazione di categoria.";

const CLAUSOLA_PAGAMENTI =
  "I lavori iniziano dopo il versamento dell'anticipo pattuito. In caso di ritardato pagamento sono dovuti gli interessi di mora nella misura di legge e le spese di recupero del credito.";

function htmlStatoIban(iban) {
  if (!iban)
    return `<span class="muted">Con l'IBAN il cliente paga l'anticipo copiando i dati o inquadrando un QR.</span>`;
  return inc.ibanValido(iban)
    ? `<span class="row" style="gap:6px;color:var(--ok);font-weight:600">${ICONE.fatto.replace("<svg", '<svg width="18" height="18"')}IBAN valido: pagamento con un tocco attivo</span>`
    : `<span class="row testo-bad" style="gap:6px;font-weight:600;align-items:flex-start">${ICONE.attenzione.replace("<svg", '<svg width="18" height="18" style="flex:none;margin-top:1px"')}IBAN non valido: controlla le cifre (un errore manda i soldi altrove o li fa tornare indietro)</span>`;
}

const CAMPI_AZIENDA = new Set(
  Object.keys(AZIENDA_DEFAULT).filter((k) => !["onboarded", "logo", "mestiere"].includes(k)),
);

function suInputImpostazioni(e) {
  const el = e.target;
  if (el.id === "pref-sole") {
    preferenza.set("pl-sole", el.checked ? "1" : "");
    return applicaAspetto();
  }
  const k = el.dataset.az;
  if (!k || !CAMPI_AZIENDA.has(k)) return;
  if (k === "colore" && !state.pro) return;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (
    k === "ivaDefault" ||
    k === "validitaGiorni" ||
    k === "giorniRicontatto" ||
    k === "giorniSaldo" ||
    k === "accontoDefault"
  )
    v = core.parseNumero(v);
  const conLink = k === "linkPagamento" || k === "linkRecensioni";
  if (conLink && e.type === "change" && v && !urlSicuro(v)) {
    toast("Il link deve iniziare con https://");
  }
  if ((k === "tassoMoraPrivati" || k === "tassoMoraImprese") && e.type === "change") {
    const t = core.parseNumero(String(v).replace(/%/g, ""));
    if (v && !(t > 0 && t <= 100)) toast("Inserisci un tasso tra 0 e 100, per esempio 2,5");
    v = t > 0 && t <= 100 ? String(core.round2(t)).replace(".", ",") : "";
    el.value = v;
  }
  if (k === "iban") $("#iban-stato").innerHTML = htmlStatoIban(v);
  state.azienda[k] = conLink ? (urlSicuro(v) ? v.trim() : e.type === "change" ? "" : v) : v;
  salvaAziendaDopo();
  if (k === "regime" && e.type === "change") viewImpostazioni();
}

// ------------------------------------------------------------------
// Benvenuto (primo avvio, 2 passi)
// ------------------------------------------------------------------
function viewBenvenuto() {
  const a = state.azienda;
  const scelto = state.mestiereScelto || a.mestiere || state.mestiereSuggerito || "";
  state.mestiereScelto = scelto;
  const passo = state.passoOnb;
  const iva = a.regime === "forfettario" ? "forf" : String(a.ivaDefault || 22);
  const acconto = Number(a.accontoDefault ?? 30);
  const icona = (id) => ICONE_MESTIERI[id] || ICONE.cassetta;
  const nomeMestiere = scelto && scelto !== "altro" ? trovaMestiere(scelto)?.nome || "" : "";
  const passo1 = `
      <div class="titolone"><h1>Che lavoro fai?</h1><p>Ti preparo i prezzi tipici del tuo mestiere: li cambi quando vuoi.</p></div>
      <main class="pagina">
        <div class="griglia-mestieri" role="radiogroup" aria-label="Il tuo mestiere">
          ${MESTIERI.map((m) => `<button class="mestiere ${scelto === m.id ? "on" : ""}" role="radio" aria-checked="${scelto === m.id}" data-action="scegli-mestiere" data-m="${m.id}"><span class="em" aria-hidden="true">${icona(m.id)}</span>${esc(m.nome)}</button>`).join("")}
          <button class="mestiere ${scelto === "altro" ? "on" : ""}" role="radio" aria-checked="${scelto === "altro"}" data-action="scegli-mestiere" data-m="altro"><span class="em" aria-hidden="true">${icona("altro")}</span>Altro</button>
        </div>
      </main>
      <footer class="barra-totale"><div class="tot"><div class="xsmall">Passo 1 di 3</div><b>${scelto ? esc(nomeMestiere || "Altro") : "Scegli il tuo mestiere"}</b></div>
        <button class="btn primary big" data-action="onb-avanti" ${scelto ? "" : 'aria-disabled="true"'}>Avanti</button></footer>`;
  const passo2 = `
      <div class="titolone"><h1>La tua impresa</h1><p>Questi dati compaiono sul preventivo. Niente registrazione: restano sul tuo telefono.</p></div>
      <main class="pagina">
        <section class="card stack">
          <label class="campo">Nome dell'impresa<input id="b-nome" placeholder="es. Idraulica Rossi" value="${esc(a.ragioneSociale)}" autocomplete="organization" enterkeyhint="next"></label>
          <div class="grid2 stack-mobile">
            <label class="campo">Cellulare (WhatsApp)<input id="b-tel" type="tel" inputmode="tel" placeholder="es. 333 123 4567" value="${esc(a.telefono)}" autocomplete="tel" enterkeyhint="next"></label>
            <label class="campo">Partita IVA<input id="b-piva" inputmode="numeric" placeholder="11 cifre" value="${esc(a.piva)}" enterkeyhint="next"></label>
          </div>
          <div class="grid2 stack-mobile">
            <label class="campo">Città<input id="b-citta" placeholder="es. Bergamo" value="${esc(a.citta)}" autocomplete="address-level2" enterkeyhint="next"></label>
            <label class="campo"><span>Email <span class="aiuto">facoltativa</span></span><input id="b-email" type="email" placeholder="es. info@tuaimpresa.it" value="${esc(a.email)}" autocomplete="email"></label>
          </div>
        </section>
        <div class="etichetta-sez">Nei tuoi preventivi metti l'IVA?</div>
        <div class="scelta-iva" role="radiogroup" aria-label="IVA">
          <label><input type="radio" name="b-iva" value="22" ${iva === "22" ? "checked" : ""}><span>Sì, di solito il 22%<small>La più comune</small></span></label>
          <label><input type="radio" name="b-iva" value="10" ${iva === "10" ? "checked" : ""}><span>Sì, di solito il 10%<small>Manutenzioni nelle case dei privati</small></span></label>
          <label><input type="radio" name="b-iva" value="forf" ${iva === "forf" ? "checked" : ""}><span>No, sono nel regime forfettario<small>Senza IVA: aggiungo io la frase richiesta dalla legge</small></span></label>
        </div>
        <p class="muted small" style="margin:0 2px">Non sei sicuro? Guarda una tua fattura: se c'è la riga dell'IVA, scegli Sì.</p>
        <div class="etichetta-sez">Chiedi un anticipo quando il cliente accetta?</div>
        <div class="seg seg-pieno" role="radiogroup" aria-label="Anticipo predefinito">
          ${[0, 20, 30, 50].map((v) => `<button type="button" role="radio" data-action="onb-acconto" data-v="${v}" class="${acconto === v ? "on" : ""}" aria-checked="${acconto === v}">${v ? `${v}%` : "No"}</button>`).join("")}
        </div>
        <p class="muted small" style="margin:0 2px">È la protezione migliore contro chi firma e poi non paga. Lo cambi in ogni preventivo.</p>
      </main>
      <footer class="barra-totale"><button class="btn" data-action="onb-indietro" aria-label="Indietro">${ICONE.indietro}</button>
        <div class="tot"><div class="xsmall">Passo 2 di 3</div><b>I tuoi dati</b></div>
        <button class="btn primary big" data-action="onb-dati">Avanti</button></footer>`;
  const m = trovaMestiere(a.mestiere || (scelto !== "altro" ? scelto : ""));
  const passo3 = `
      <div class="titolone"><h1>Facciamo il primo preventivo</h1><p>Ci vuole un minuto. Puoi partire da un esempio già pronto e vedere cosa riceve il cliente.</p></div>
      <main class="pagina">
        <div class="lista-azioni">
          ${m ? `<button data-action="fine-benvenuto" data-modo="esempio" class="principale"><span class="ico">${icona(m.id)}</span><span class="corpo">Prova con un esempio da ${esc(m.nome.toLowerCase())}<small>Voci e prezzi tipici già compilati: cambi solo il cliente</small></span></button>` : ""}
          <button data-action="fine-benvenuto" data-modo="vuoto" class="${m ? "" : "principale"}"><span class="ico">${ICONE.matita}</span><span class="corpo">Fai un preventivo vero<small>Per un cliente che ti ha già chiesto un lavoro</small></span></button>
          <button data-action="fine-benvenuto" data-modo="home"><span class="ico">${ICONE.casa}</span><span class="corpo">Lo faccio dopo<small>Vai alla pagina iniziale</small></span></button>
        </div>
      </main>
      <footer class="barra-totale"><button class="btn" data-action="onb-indietro" aria-label="Indietro">${ICONE.indietro}</button>
        <div class="tot"><div class="xsmall">Passo 3 di 3</div><b>Pronto</b></div></footer>`;
  app().innerHTML = `
    <header class="topbar"><div class="brand">${ICONE.logo}<span>${esc(CONFIG.nomeProdotto)}</span></div></header>
    <div class="passi-onb" aria-hidden="true"><i class="on"></i><i class="${passo >= 2 ? "on" : ""}"></i><i class="${passo >= 3 ? "on" : ""}"></i></div>
    ${passo === 1 ? passo1 : passo === 2 ? passo2 : passo3}`;
}

function salvaDatiOnb() {
  const a = state.azienda;
  if (!$("#b-nome")) return;
  a.ragioneSociale = $("#b-nome").value.trim();
  a.telefono = $("#b-tel").value.trim();
  a.piva = $("#b-piva").value.trim();
  a.citta = $("#b-citta").value.trim();
  a.email = $("#b-email").value.trim();
  const iva = $('input[name="b-iva"]:checked')?.value || "22";
  if (iva === "forf") a.regime = "forfettario";
  else {
    a.regime = "ordinario";
    a.ivaDefault = Number(iva);
  }
}

async function datiOnb() {
  salvaDatiOnb();
  const a = state.azienda;
  if (!a.ragioneSociale) {
    $("#b-nome").focus();
    return toast("Scrivi il nome della tua impresa");
  }
  a.mestiere = state.mestiereScelto && state.mestiereScelto !== "altro" ? state.mestiereScelto : "";
  state.passoOnb = 3;
  transizione(() => {
    viewBenvenuto();
    window.scrollTo(0, 0);
  });
}

async function fineBenvenuto(modo) {
  const a = state.azienda;
  if (!a.ragioneSociale) {
    state.passoOnb = 2;
    return viewBenvenuto();
  }
  a.onboarded = true;
  await salvaAzienda();
  traccia("Onboarding completato", { mestiere: a.mestiere || "altro", regime: a.regime, modo });
  if (a.mestiere && !state.listino.length) await caricaEsempi(a.mestiere);
  db.rendiPersistente();
  if (modo === "home") return vai("#/");
  const modello = modo === "esempio" || state.apriModello ? trovaMestiere(a.mestiere) : null;
  state.apriModello = false;
  const prev = await creaPreventivo({ modello });
  vai(`#/p/${prev.id}`);
}

// ------------------------------------------------------------------
// Azioni (delegazione eventi)
// ------------------------------------------------------------------
const azioni = {
  "chiudi-foglio": () => chiudiFoglio(),
  paywall: (el) => paywall(el.dataset.motivo),
  filtro: (el) => {
    state.filtro = el.dataset.f;
    $$(".chips .chip").forEach((c) => c.classList.toggle("on", c.dataset.f === state.filtro));
    $("#lista-prev").innerHTML = htmlVoci();
  },
  installa: async () => {
    const ev = state.installEvento;
    if (!ev) return;
    ev.prompt();
    const scelta = await ev.userChoice;
    if (scelta.outcome !== "accepted") preferenza.set("pl-installa-no", "1");
    state.installEvento = null;
    render();
  },
  ricontatta: async (el) => {
    const prev = state.preventivi.find((p) => p.id === el.dataset.id);
    if (!prev) return;
    const tel = core.telefonoWhatsApp(prev.cliente.telefono);
    window.open(
      `https://wa.me/${tel}?text=${encodeURIComponent(core.messaggioRicontatto(prev, state.azienda))}`,
      "_blank",
      "noopener",
    );
    prev.ricontattatoIl = Date.now();
    await salvaPreventivo(prev);
    traccia("Ricontatto");
    viewLista();
  },
  stato: () => state.corrente && foglioStato(state.corrente),
  "imposta-stato": (el) => state.corrente && impostaStato(state.corrente, el.dataset.stato),
  sblocca: () => {
    const prev = state.corrente;
    if (!prev) return;
    state.sbloccati.add(prev.id);
    viewEditor(prev.id);
    toast("Ora puoi modificarlo: se cambi i prezzi, rimandalo al cliente");
  },
  acconto: (el) => {
    const prev = state.corrente;
    if (!prev || bloccato(prev)) return;
    if (el.dataset.v === "altro") {
      state.accontoAltro.add(prev.id);
    } else {
      state.accontoAltro.delete(prev.id);
      prev.acconto = { tipo: "perc", valore: Number(el.dataset.v) || 0 };
      salvaDopo(prev);
    }
    vibra();
    $("#sezione-acconto").innerHTML = htmlAcconto(prev);
    aggiornaTotali();
  },
  "da-rubrica": async () => {
    const prev = state.corrente;
    try {
      const [contatto] = await navigator.contacts.select(["name", "tel"], { multiple: false });
      if (!contatto) return;
      const nome = (contatto.name || [])[0] || "";
      const tel = (contatto.tel || [])[0] || "";
      if (nome) prev.cliente.nome = nome;
      if (tel) prev.cliente.telefono = tel;
      prev.clienteId = null;
      salvaDopo(prev);
      viewEditor(prev.id);
    } catch {
      toast("Rubrica non disponibile su questo telefono");
    }
  },
  "menu-riga": (el) => menuRiga(Number(el.dataset.i)),
  "riga-op": (el) => opRiga(el.dataset.op, Number(el.dataset.i)),
  "tipo-riga": (el) => {
    const r = state.corrente.righe[Number(el.dataset.i)];
    if (!r) return;
    r.tipo = el.dataset.tipo;
    rerenderRighe();
    salvaDopo(state.corrente);
  },
  opzionale: (el) => {
    const r = state.corrente.righe[Number(el.dataset.i)];
    if (!r) return;
    r.opzionale = !r.opzionale;
    vibra();
    rerenderRighe();
    salvaDopo(state.corrente);
    if (r.opzionale) toast("Esclusa dal totale: il cliente potrà aggiungerla");
  },
  calcolatore: (el) => foglioCalcolatore(Number(el.dataset.i)),
  "aggiungi-riga": (el) => {
    const i = aggiungiRiga({ tipo: el.dataset.tipo || "man" });
    $(`.riga[data-i="${i}"] textarea`)?.focus();
  },
  "dal-listino": () => foglioListino(),
  "usa-voce": (el) => {
    const v = state.listino.find((x) => x.id === el.dataset.id);
    if (!v) return;
    aggiungiRiga({
      descrizione: v.descrizione,
      um: v.um,
      prezzo: v.prezzo,
      tipo: v.tipo,
      costo: v.costo || 0,
      iva: forfettario(state.corrente) ? 0 : (v.iva ?? ivaRiga(state.corrente)),
    });
    chiudiFoglio();
    vibra();
    toast("Voce aggiunta", "ok");
  },
  "carica-esempi": async (el) => {
    await caricaEsempi(el.dataset.m);
    foglioListino();
  },
  "carica-esempi-sel": async () => {
    await caricaEsempi($("#mestiere-esempi").value);
    viewListino();
    toast("Prezzi aggiunti", "ok");
  },
  "detta-righe": () =>
    detta('Prova: "sostituzione miscelatore, poi 2 ore di manodopera a 38 euro"', aggiungiDaDettatura),
  "detta-campo": (el) =>
    detta("Parla pure...", (testo) => {
      const input = $(`[data-campo="${el.dataset.target}"]`);
      if (!input) return;
      const valore = testo.charAt(0).toUpperCase() + testo.slice(1);
      input.value = input.value ? input.value + " " + valore : valore;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }),
  "togli-foto": async (el) => {
    const prev = state.corrente;
    const prima = [...(prev.foto || [])];
    prev.foto = prima.filter((f) => f.id !== el.dataset.id);
    await salvaPreventivo(prev);
    $("#sezione-foto").innerHTML = htmlFoto(prev);
    collegaInputFoto();
    toast("Foto tolta", "", {
      azione: "Annulla",
      suAzione: async () => {
        prev.foto = prima;
        await salvaPreventivo(prev);
        if (state.corrente !== prev) return;
        $("#sezione-foto").innerHTML = htmlFoto(prev);
        collegaInputFoto();
      },
    });
  },
  "menu-preventivo": () => menuPreventivo(),
  "scarica-pdf": () => scaricaPdf(),
  "duplica-preventivo": () => foglioDuplica(),
  "duplica-per": (el) => duplica(el.dataset.chi === "stesso"),
  "elimina-preventivo": async () => {
    const prev = state.corrente;
    chiudiFoglio(true);
    if (
      !(await chiedi({
        titolo: `Eliminare il preventivo N. ${prev.numero}?`,
        testo: "Non si può annullare.",
        ok: "Elimina",
        pericolo: true,
      }))
    )
      return;
    await eliminaPreventivo(prev);
    vai("#/");
  },
  firma: () => foglioFirma(),
  presenta: (el) => presenta(el),
  "rimuovi-firma": async () => {
    if (!(await chiedi({ titolo: "Rimuovere la firma del cliente?", ok: "Rimuovi", pericolo: true }))) return;
    state.corrente.firma = null;
    await salvaPreventivo(state.corrente);
    $("#sezione-firma").innerHTML = htmlFirma(state.corrente);
  },
  anteprima: () => anteprima(),
  invia: (el) => invia(el),
  checkout: (el) => {
    const url = urlSicuro(CONFIG.checkout[el.dataset.piano]);
    traccia("Checkout", { piano: el.dataset.piano });
    if (!url) return toast("Pagamenti non ancora configurati (config.js)");
    window.open(url, "_blank", "noopener");
  },
  "attiva-licenza": () => attivaLicenza(),
  "rimuovi-licenza": async () => {
    if (
      !(await chiedi({
        titolo: "Rimuovere la licenza Pro?",
        testo: "Potrai riattivarla con lo stesso codice.",
        ok: "Rimuovi",
        pericolo: true,
      }))
    )
      return;
    state.licenza = null;
    state.pro = false;
    await db.set("licenza", null);
    viewPro(new URLSearchParams());
  },
  "cliente-nuovo": () => foglioCliente(null),
  "cliente-apri": (el) => foglioCliente(el.dataset.id),
  "voce-nuova": () => foglioVoce(null),
  "voce-apri": (el) => foglioVoce(el.dataset.id),
  "rimuovi-logo": async () => {
    state.azienda.logo = "";
    await salvaAzienda();
    viewImpostazioni();
  },
  // La copia si può mandare su WhatsApp a se stessi o salvare su Drive: così sopravvive al cambio di telefono.
  "backup-esporta": async () => {
    const dati = await db.esporta();
    const nome = `preventivolampo-copia-${core.oggiISO()}.json`;
    const file = new File([JSON.stringify(dati)], nome, { type: "application/json" });
    let fatto = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Copia dei miei preventivi" });
        fatto = true;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    if (!fatto) scaricaBlob(file, nome);
    preferenza.set("pl-ultima-copia", String(Date.now()));
    toast("Copia salvata: tienila in un posto sicuro", "ok");
    if (!state.corrente && (rotta().parti[0] || "") === "") viewLista();
  },
  consiglia: async () => {
    const testo = `Uso ${CONFIG.nomeProdotto} per fare i preventivi dal telefono in un minuto: il cliente li accetta e firma da WhatsApp. Provalo gratis:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: CONFIG.nomeProdotto, text: testo, url: CONFIG.sito });
      } catch {
        /* annullato */
      }
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(testo + " " + CONFIG.sito)}`, "_blank", "noopener");
    }
  },
  "scegli-mestiere": (el) => {
    state.mestiereScelto = el.dataset.m;
    vibra();
    viewBenvenuto();
  },
  "onb-avanti": () => {
    if (!state.mestiereScelto) return toast("Scegli il tuo mestiere");
    state.passoOnb = 2;
    transizione(() => {
      viewBenvenuto();
      window.scrollTo(0, 0);
    });
  },
  "onb-indietro": () => {
    salvaDatiOnb();
    state.passoOnb = Math.max(1, state.passoOnb - 1);
    transizione(viewBenvenuto);
  },
  "onb-dati": () => datiOnb(),
  "onb-acconto": (el) => {
    state.azienda.accontoDefault = Number(el.dataset.v) || 0;
    $$("[data-action=onb-acconto]").forEach((b) => {
      b.classList.toggle("on", b === el);
      b.setAttribute("aria-checked", String(b === el));
    });
    vibra();
  },
  "fine-benvenuto": (el) => fineBenvenuto(el.dataset.modo || "vuoto"),

  // Incassi
  "registra-pagamento": () => foglioPagamento(),
  // Il momento in cui si chiede il saldo: segna la fine lavori e prepara il messaggio.
  "lavori-finiti": async () => {
    const prev = state.corrente;
    const i = incassoModificabile(prev);
    i.fineLavori = core.oggiISO();
    i.storico = false;
    // Finito il lavoro sono finiti anche i lavori extra già firmati.
    for (const v of variantiDi(prev).filter((x) => x.stato === "accettato")) {
      const iv = incassoModificabile(v);
      if (!iv.fineLavori) {
        iv.fineLavori = i.fineLavori;
        iv.storico = false;
        await salvaPreventivo(v);
      }
    }
    await salvaIncasso(prev);
    foglioSollecito(0);
  },
  // L'app non può mandare notifiche da sola (niente server): il promemoria lo fa il calendario del telefono.
  "promemoria-scadenza": () => {
    const prev = state.corrente;
    const s = incassoDi(prev);
    if (!s.prossima || !s.prossima.data) return;
    const ics = inc.creaIcs({
      id: `${prev.id}-scadenza`,
      titolo: `Controlla il pagamento di ${core.nomeCliente(prev.cliente)}: ${core.formatEuro(s.prossima.importo)}`,
      data: s.prossima.data,
      fascia: "mattina",
      anticipo: "PT0M",
      descrizione: `${inc.causale(prev, s.prossima.tipo)} - scadenza ${core.formatData(s.prossima.data)}. Se non è arrivato, dall'app manda un sollecito.`,
    });
    scaricaBlob(new Blob([ics], { type: "text/calendar" }), nomeFile("Promemoria-pagamento", prev, "ics"));
    toast("Aprilo per aggiungerlo al calendario", "ok");
  },
  "compiti-tutti": () => {
    state.compitiTutti = !state.compitiTutti;
    const el = $("#da-fare");
    if (el) el.outerHTML = htmlDaFare(compitiOggi());
  },
  andamento: () => foglioAndamento(),
  "lista-materiali": () => foglioMateriali(),
  "guarda-cliente": () => traccia("Anteprima cliente"),
  "crea-variante": () => state.corrente && creaVariante(state.corrente),
  "parti-da": (el) => {
    const prev = state.corrente;
    const da = state.preventivi.find((p) => p.id === el.dataset.id);
    if (prev && da) copiaVoci(prev, da.righe, da.oggetto);
  },
  "parti-da-modello": () => {
    const prev = state.corrente;
    const m = trovaMestiere(state.azienda.mestiere);
    if (!prev || !m) return;
    copiaVoci(
      prev,
      vociListino(m)
        .slice(0, 5)
        .map((v) => core.rigaVuota(ivaRiga(prev), v)),
      m.oggetto,
    );
  },
  tema: (el) => {
    preferenza.set("pl-tema", el.dataset.tema || "");
    applicaAspetto();
    $$("[data-action=tema]").forEach((b) => {
      b.classList.toggle("on", b === el);
      b.setAttribute("aria-checked", String(b === el));
    });
  },
  "esporta-pagamenti": () => {
    const { testo, n } = csvPagamenti();
    if (!n) return toast("Non hai ancora registrato pagamenti");
    scaricaBlob(new Blob([testo], { type: "text/csv;charset=utf-8" }), `pagamenti-${core.oggiISO()}.csv`);
    toast(n === 1 ? "1 pagamento esportato" : `${n} pagamenti esportati`, "ok");
  },
  "promemoria-conti": () => {
    // Il prossimo venerdì: 5 minuti per i conti, ogni settimana.
    const oggi = new Date();
    const giorni = (5 - oggi.getDay() + 7) % 7 || 7;
    const ics = inc.creaIcs({
      id: "pl-conti-settimanali",
      titolo: "5 minuti per i conti: apri PreventivoLampo",
      data: core.aggiungiGiorni(core.oggiISO(), giorni),
      fascia: "promemoria",
      anticipo: "PT0M",
      ripeti: "settimanale",
      descrizione: "Guarda la lista Da fare: chi deve pagare, chi richiamare, quali preventivi stanno per scadere.",
    });
    scaricaBlob(new Blob([ics], { type: "text/calendar" }), "promemoria-conti.ics");
    toast("Aprilo per aggiungerlo al calendario", "ok");
  },
  "copia-link-pagina": async () =>
    toast((await copiaTesto(location.href)) ? "Link copiato: ora aprilo nell'app" : "Copia non riuscita"),
  "incolla-messaggio": () => incollaMessaggio(),
  "togli-pagamento": async (el) => {
    const prev = state.corrente;
    const i = incassoModificabile(prev);
    const pag = i.pagamenti.find((x) => x.id === el.dataset.id);
    if (!pag) return;
    if (
      !(await chiedi({
        titolo: `Eliminare il pagamento di ${core.formatEuro(pag.importo)}?`,
        ok: "Elimina",
        pericolo: true,
      }))
    )
      return;
    i.pagamenti = i.pagamenti.filter((x) => x.id !== pag.id);
    i.pagamentiEliminati = [...i.pagamentiEliminati, pag.id];
    // Se veniva da un avviso del cliente, l'avviso torna "da verificare".
    for (const x of i.segnalazioni) if (pag.rif && x.rif === pag.rif) x.stato = "attesa";
    await salvaIncasso(prev, "Pagamento eliminato");
  },
  "segnalazione-ok": (el) => confermaSegnalazione(el.dataset.rif, Number(el.dataset.il), true),
  "segnalazione-no": (el) => confermaSegnalazione(el.dataset.rif, Number(el.dataset.il), false),
  "mostra-qr": () => foglioQr(),
  sollecito: (el) => foglioSollecito(Number(el.dataset.livello) || 0),
  "pdf-diffida": () => pdfDiffida(),
  "pdf-fascicolo": () => pdfFascicolo(),
  "recensione-chiesta": async (el) => {
    const prev = state.preventivi.find((x) => x.id === el.dataset.id);
    if (!prev) return;
    incassoModificabile(prev).recensioneChiestaIl = Date.now();
    await salvaPreventivo(prev);
    traccia("Recensione chiesta");
    // Il link si apre comunque; la pagina si aggiorna subito dopo.
    setTimeout(() => (state.corrente ? aggiornaIncassi() : viewLista()), 400);
  },

  // Date e inizio lavori
  "data-aggiungi": () => {
    const prev = state.corrente;
    prev.disponibilita = Array.isArray(prev.disponibilita) ? prev.disponibilita : [];
    if (prev.disponibilita.length >= inc.MAX_DISPONIBILITA) return;
    prev.disponibilita.push({ data: "", fascia: "mattina" });
    aggiornaDate();
    salvaDopo(prev);
    $(`[data-disp="${prev.disponibilita.length - 1}.data"]`)?.focus();
  },
  "data-togli": (el) => {
    const prev = state.corrente;
    const i = Number(el.dataset.i);
    const [tolta] = (prev.disponibilita || []).splice(i, 1);
    aggiornaDate();
    salvaDopo(prev);
    if (tolta && tolta.data)
      toast("Data tolta", "", {
        azione: "Annulla",
        suAzione: () => {
          if (state.corrente !== prev) return;
          prev.disponibilita.splice(Math.min(i, prev.disponibilita.length), 0, tolta);
          aggiornaDate();
          salvaDopo(prev);
        },
      });
  },
  "fissa-data": () => foglioFissaData(),
  "appuntamento-togli": async () => {
    const prev = state.corrente;
    if (!(await chiedi({ titolo: "Cambiare la data di inizio?", testo: "La data attuale verrà tolta.", ok: "Cambia" })))
      return;
    prev.appuntamento = null;
    await salvaPreventivo(prev);
    aggiornaDate();
  },
  "appuntamento-ics": () => {
    const prev = state.corrente;
    const a = inc.normalizzaAppuntamento(prev.appuntamento);
    if (!a) return;
    const c = prev.cliente;
    const ics = inc.creaIcs({
      id: prev.id,
      titolo: inc.titoloAgenda(prev),
      data: a.data,
      fascia: a.fascia,
      luogo: prev.luogo || [c.indirizzo, c.citta].filter(Boolean).join(", "),
      descrizione: [`Preventivo n. ${prev.numero}`, c.telefono ? `Tel. ${c.telefono}` : ""].filter(Boolean).join("\n"),
    });
    scaricaBlob(new Blob([ics], { type: "text/calendar" }), nomeFile("Lavoro", prev, "ics"));
  },
  "clausola-pagamenti": async () => {
    const a = state.azienda;
    if ((a.condizioni || "").includes(CLAUSOLA_PAGAMENTI)) return toast("La clausola c'è già");
    a.condizioni = [a.condizioni, CLAUSOLA_PAGAMENTI].filter(Boolean).join("\n");
    await salvaAzienda();
    viewImpostazioni();
    toast("Clausola aggiunta alle condizioni dei nuovi preventivi", "ok");
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const fn = azioni[el.dataset.action];
  if (!fn) return;
  // I link (WhatsApp, email) devono comunque aprirsi: si blocca il default solo sui pulsanti.
  if (el.tagName !== "A") e.preventDefault();
  fn(el, e);
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches('[role="button"][data-action]')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === "Escape") chiudiFoglio();
});

document.addEventListener("input", (e) => {
  if (state.corrente) suInputEditor(e);
  else if (e.target.dataset.az) suInputImpostazioni(e);
});
document.addEventListener("change", (e) => {
  if (state.corrente) {
    if (e.target.tagName === "SELECT" || e.target.dataset.inc || e.target.dataset.disp) suInputEditor(e);
    suChangeEditor(e);
  } else if (e.target.dataset.az || e.target.id === "pref-sole") suInputImpostazioni(e);
});

// Dopo aver cambiato la fine lavori la sezione Incassi si ridisegna quando il focus esce dalla
// sezione (non mentre si scrive la data né passando al menu "Saldo entro").
let incassiDaRidisegnare = false;
document.addEventListener("focusout", (e) => {
  const sezione = $("#sezione-incassi");
  if (!state.corrente || !incassiDaRidisegnare || !sezione || !sezione.contains(e.target)) return;
  if (e.relatedTarget && sezione.contains(e.relatedTarget)) return;
  incassiDaRidisegnare = false;
  setTimeout(aggiornaIncassi, 0);
});

// I dettagli di una voce restano aperti anche quando le voci si ridisegnano.
document.addEventListener(
  "toggle",
  (e) => {
    const id = e.target.dataset && e.target.dataset.riga;
    if (!id) return;
    if (e.target.open) state.righeAperte.add(id);
    else state.righeAperte.delete(id);
  },
  true,
);

window.addEventListener("hashchange", render);
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.installEvento = e;
  if (!state.corrente && (rotta().parti[0] || "") === "" && state.azienda.onboarded) viewLista();
});
function salvaTuttoOra() {
  salvaAziendaSubito();
  if (state.corrente && daSalvare.has(state.corrente.id)) {
    clearTimeout(timerSalva);
    salvaPreventivo(state.corrente);
  }
}
window.addEventListener("pagehide", salvaTuttoOra);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") salvaTuttoOra();
  else {
    if (ritornoDaInvio) setTimeout(dopoInvio, 250);
    controllaAggiornamenti();
  }
});

// ------------------------------------------------------------------
// Avvio
// ------------------------------------------------------------------
async function avvio() {
  try {
    await caricaTutto();
  } catch {
    app().innerHTML = `<main class="pagina"><div class="card vuoto"><h3>Impossibile aprire l'archivio</h3><p class="muted">Il browser blocca il salvataggio dei dati (forse sei in navigazione privata). Apri l'app in una finestra normale.</p></div></main>`;
    return;
  }
  segnalaDatiPronti();
  caricaStatistiche();

  // Link dalle pagine "modello" del sito: app.html?mestiere=idraulico&modello=1
  const params = new URLSearchParams(location.search);
  // Messaggio del cliente condiviso da WhatsApp verso l'app (Android): app.html?text=...
  const condiviso = ["text", "url", "title"].map((k) => params.get(k) || "").join(" ");
  if (condiviso.trim()) {
    history.replaceState(null, "", location.pathname + location.hash);
    const m = condiviso.match(RE_LINK_CLIENTE);
    if (m) location.hash = `#/${m[1]}?d=${m[2]}`;
  }
  const mestiere = trovaMestiere(params.get("mestiere"));
  if (mestiere || params.has("modello")) {
    history.replaceState(null, "", location.pathname + location.hash);
    if (mestiere) state.mestiereSuggerito = mestiere.id;
    if (params.get("modello") === "1") {
      if (state.azienda.onboarded && mestiere) {
        if (!state.listino.length) await caricaEsempi(mestiere.id);
        const prev = await creaPreventivo({ modello: mestiere });
        location.hash = `#/p/${prev.id}`;
      } else {
        state.apriModello = true;
      }
    }
  }

  render();

  if (state.licenza) {
    rivalidaSeServe(state.licenza, CONFIG, (l) => db.set("licenza", l)).then((lic) => {
      const prima = state.pro;
      state.licenza = lic;
      state.pro = isPro(lic, CONFIG);
      if (prima !== state.pro && !state.corrente) render();
    });
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

avvio();
