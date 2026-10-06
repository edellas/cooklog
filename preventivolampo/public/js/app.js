import { CONFIG } from "./config.js";
import { db } from "./store.js";
import * as core from "./core.js";
import { MESTIERI, trovaMestiere, vociListino } from "./mestieri.js";
import { isPro, verifica, rivalidaSeServe } from "./licenza.js";
import { ICONE } from "./icone.js";
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
  urlSicuro,
} from "./link.js";

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
  regime: "ordinario",
  ivaDefault: 22,
  addebitaBollo: true,
  fraseForfettario: core.FRASE_FORFETTARIO,
  prefisso: "",
  validitaGiorni: 30,
  giorniRicontatto: 3,
  pagamento: "Acconto del 30% all'accettazione, saldo a fine lavori tramite bonifico bancario.",
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
  pro: false,
  corrente: null, // preventivo aperto nell'editor
  filtro: "tutti",
  cerca: "",
  installEvento: null,
  passoOnb: 1,
  mestiereScelto: "",
  mestiereSuggerito: "",
  apriModello: false,
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
  const [azienda, preventivi, clienti, listino, licenza, contatore] = await Promise.all([
    db.get("azienda", null),
    db.tutti("preventivi"),
    db.tutti("clienti"),
    db.tutti("listino"),
    db.get("licenza", null),
    db.get("contatore", null),
  ]);
  state.azienda = { ...AZIENDA_DEFAULT, ...(azienda || {}) };
  state.preventivi = preventivi;
  state.clienti = clienti;
  state.listino = listino;
  state.licenza = licenza;
  state.contatore = contatore;
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

async function salvaPreventivo(prev) {
  prev.updatedAt = Date.now();
  await db.salva("preventivi", prev);
  const i = state.preventivi.findIndex((p) => p.id === prev.id);
  if (i >= 0) state.preventivi[i] = prev;
  else state.preventivi.push(prev);
}

let timerSalva;
function salvaDopo(prev) {
  clearTimeout(timerSalva);
  timerSalva = setTimeout(() => salvaPreventivo(prev), 400);
}

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

const PAGINE_SENZA_ONBOARDING = new Set(["benvenuto", "pro", "accettazione"]);

async function eseguiRender() {
  clearTimeout(timerSalva);
  await salvaAziendaSubito();
  if (state.corrente) {
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
  state.corrente = null;
  const senzaTab = pagina === "p" || pagina === "benvenuto" || pagina === "accettazione" || pagina === "pro";
  document.body.classList.toggle("no-tabbar", senzaTab);
  $$(".tabbar a.tab").forEach((a) => a.classList.toggle("on", a.dataset.tab === (pagina || "lista")));

  await transizione(async () => {
    window.scrollTo(0, 0);
    if (pagina === "") return viewLista();
    if (pagina === "nuovo") return nuovoPreventivo(q);
    if (pagina === "p") return viewEditor(parti[1]);
    if (pagina === "clienti") return viewClienti();
    if (pagina === "listino") return viewListino();
    if (pagina === "impostazioni") return viewImpostazioni();
    if (pagina === "pro") return viewPro(q);
    if (pagina === "benvenuto") return viewBenvenuto();
    if (pagina === "accettazione") return viewAccettazione(q);
    vai("#/");
  });
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

function htmlHero() {
  const mese = core.meseCorrente();
  const delMese = state.preventivi.filter((p) => (p.data || "").startsWith(mese));
  const totaleMese = delMese.reduce((s, p) => s + totaliDi(p).totale, 0);
  const accettati = delMese.filter((p) => p.stato === "accettato");
  const valoreAccettati = accettati.reduce((s, p) => s + totaliDi(p).totale, 0);
  const inAttesa = state.preventivi.filter((p) => p.stato === "inviato").length;
  const st = core.statistiche(state.preventivi, (p) => totaliDi(p).totale);
  const max = Math.max(1, ...st.mesi.map((m) => m.preventivato));
  return `<section class="hero">
    <div class="etic">Preventivato a ${esc(nomeMese(mese, true))}</div>
    <div class="valore">${esc(euroCorto(totaleMese))}</div>
    <div class="metriche">
      <div class="metrica"><div class="v">${esc(euroCorto(valoreAccettati))}</div><div class="l">Accettati (${accettati.length})</div></div>
      <div class="metrica"><div class="v">${st.tassoAccettazione === null ? "–" : st.tassoAccettazione + "%"}</div><div class="l">Tasso di sì</div></div>
      <div class="metrica"><div class="v">${inAttesa}</div><div class="l">In attesa</div></div>
    </div>
    <div class="grafico" aria-label="Valore preventivato negli ultimi 6 mesi">
      ${st.mesi
        .map(
          (
            m,
          ) => `<div class="col" title="${esc(nomeMese(m.mese, true))}: ${esc(euroCorto(m.preventivato))} preventivati, ${esc(euroCorto(m.accettato))} accettati">
        <div class="barra" style="height:${Math.max(6, Math.round((m.preventivato / max) * 100))}%"><i style="height:${m.preventivato ? Math.round((m.accettato / m.preventivato) * 100) : 0}%"></i></div>
        <span class="mese">${esc(nomeMese(m.mese))}</span></div>`,
        )
        .join("")}
    </div>
  </section>`;
}

function htmlRicontatti() {
  const lista = core
    .daRicontattare(state.preventivi, Date.now(), Number(state.azienda.giorniRicontatto) || 3)
    .slice(0, 5);
  if (!lista.length) return "";
  return `<section class="card">
    <div class="sezione-titolo"><span class="ico" style="background:var(--warn-soft);color:var(--warn)">${ICONE.sveglia}</span>
      <div><h2>Da ricontattare</h2><div class="muted xsmall">Un messaggio di promemoria fa vincere più lavori</div></div></div>
    ${lista
      .map(
        (x) => `<div class="ricontatto">
        ${avatar(core.nomeCliente(x.prev.cliente), "small")}
        <div class="corpo"><div class="t">${esc(core.nomeCliente(x.prev.cliente))} · ${esc(euroCorto(totaliDi(x.prev).totale))}</div>
          <div class="s">Inviato ${x.giorniDaInvio === 1 ? "ieri" : `${x.giorniDaInvio} giorni fa`}${x.scadenza ? ` · scade il ${esc(core.formatData(x.scadenza))}` : ""}</div></div>
        <button class="btn wa small" data-action="ricontatta" data-id="${esc(x.prev.id)}">${ICONE.whatsapp} Scrivi</button>
      </div>`,
      )
      .join("")}
  </section>`;
}

function htmlPiano() {
  if (state.pro) return "";
  const rimasti = core.pdfRimasti(state.contatore, CONFIG.pdfGratisAlMese);
  const usati = CONFIG.pdfGratisAlMese - rimasti;
  return `<div class="banner ${rimasti === 0 ? "warn" : "info"}">
    <div style="flex:1"><b>${rimasti === 0 ? "Preventivi gratuiti finiti" : `Piano gratuito · ${usati} di ${CONFIG.pdfGratisAlMese} usati`}</b>
      <div class="muted xsmall">${rimasti === 0 ? "Passa a Pro per continuare a inviare questo mese" : "Si rinnovano ogni mese"}</div>
      <div class="barra-limite"><i style="width:${Math.round((usati / CONFIG.pdfGratisAlMese) * 100)}%"></i></div></div>
    <a class="btn small primary" href="#/pro">Pro</a>
  </div>`;
}

function filtraLista() {
  const cerca = state.cerca.trim().toLowerCase();
  return state.preventivi
    .filter((p) => state.filtro === "tutti" || p.stato === state.filtro)
    .filter((p) => !cerca || [p.numero, p.oggetto, p.cliente && p.cliente.nome].join(" ").toLowerCase().includes(cerca))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function htmlVoci() {
  const lista = filtraLista();
  if (!lista.length) return `<div class="vuoto muted">Nessun preventivo trovato.</div>`;
  return lista
    .map((p) => {
      const t = totaliDi(p);
      return `<a class="voce-lista" href="#/p/${esc(p.id)}">
        ${avatar(core.nomeCliente(p.cliente))}
        <div class="corpo">
          <div class="t">${esc(core.nomeCliente(p.cliente))}</div>
          <div class="s">${esc(p.oggetto || "Senza oggetto")}</div>
          <div class="s xsmall">N. ${esc(p.numero)} · ${esc(core.formatData(p.data))}${p.accettazioneOnline ? " · firmato online" : ""}</div>
        </div>
        <div class="dx"><span class="importo">${esc(core.formatEuro(t.totale))}</span><span class="badge ${esc(p.stato)}">${esc(core.STATI[p.stato] || "")}</span></div>
      </a>`;
    })
    .join("");
}

function viewLista() {
  const conta = { tutti: state.preventivi.length };
  for (const p of state.preventivi) conta[p.stato] = (conta[p.stato] || 0) + 1;
  const filtri = ["tutti", ...Object.keys(core.STATI)]
    .map(
      (f) =>
        `<button class="chip ${state.filtro === f ? "on" : ""}" data-action="filtro" data-f="${f}">${f === "tutti" ? "Tutti" : core.STATI[f]}<span class="n">${conta[f] || 0}</span></button>`,
    )
    .join("");
  const bannerInstalla =
    state.installEvento && !preferenza.get("pl-installa-no")
      ? `<div class="banner info"><span class="ico">📲</span><div>Installa l'app: si apre con un tocco e funziona anche senza rete.</div><button class="btn small primary" data-action="installa">Installa</button></div>`
      : "";

  const vuoto = `<div class="card vuoto">
      <div class="illustrazione">${ICONE.fulmine}</div>
      <h3>Il primo preventivo in 60 secondi</h3>
      <p class="muted">Scegli le voci dal listino o dettale a voce, poi mandalo su WhatsApp: il cliente può accettare e firmare dal suo telefono.</p>
      <a class="btn primary big" href="#/nuovo">${ICONE.piu} Crea preventivo</a></div>`;

  app().innerHTML = `
    <header class="topbar">
      <div class="brand">${ICONE.logo}<span>${esc(CONFIG.nomeProdotto)}</span></div>
      ${state.pro ? `<span class="badge pro">PRO</span>` : `<a class="btn small soft" href="#/pro">${ICONE.stella} Pro</a>`}
    </header>
    <main class="pagina">
      ${bannerInstalla}
      ${state.preventivi.length ? htmlHero() : ""}
      ${htmlRicontatti()}
      ${htmlPiano()}
      ${
        state.preventivi.length
          ? `<div class="etichetta-sez">I tuoi preventivi</div>
             <input type="search" placeholder="Cerca cliente, oggetto o numero" value="${esc(state.cerca)}" id="cerca-prev" aria-label="Cerca preventivi">
             <div class="chips">${filtri}</div>
             <div class="lista" id="lista-prev">${htmlVoci()}</div>`
          : vuoto
      }
    </main>`;
  ombraTopbar();
  $("#cerca-prev")?.addEventListener("input", (e) => {
    state.cerca = e.target.value;
    $("#lista-prev").innerHTML = htmlVoci();
  });
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
function htmlRiga(r, i) {
  const forf = forfettario(state.corrente);
  const um = core.UNITA.includes(r.um) ? core.UNITA : [r.um, ...core.UNITA];
  return `<div class="riga ${r.opzionale ? "facoltativa" : ""}" data-i="${i}">
    <div class="riga-top">
      <textarea data-r="descrizione" rows="1" placeholder="Descrizione del lavoro o del materiale" aria-label="Descrizione">${esc(r.descrizione)}</textarea>
      <button class="icon-btn" data-action="menu-riga" data-i="${i}" aria-label="Opzioni voce">${ICONE.altro}</button>
    </div>
    <div class="riga-grid">
      <label>Quantità<span class="qta-wrap"><input data-r="qta" inputmode="decimal" value="${numIn(r.qta)}">${
        r.um === "mq"
          ? `<button type="button" class="calc" data-action="calcolatore" data-i="${i}" aria-label="Calcola metri quadri">${ICONE.righello}</button>`
          : ""
      }</span></label>
      <label>Unità<select data-r="um">${um.map((u) => `<option ${u === r.um ? "selected" : ""}>${esc(u)}</option>`).join("")}</select></label>
      <label>Prezzo €<input data-r="prezzo" inputmode="decimal" placeholder="0,00" value="${numIn(r.prezzo, true)}"></label>
    </div>
    <div class="riga-extra">
      <div class="seg" role="group" aria-label="Tipo voce">
        <button type="button" data-action="tipo-riga" data-i="${i}" data-tipo="man" class="${r.tipo === "man" ? "on" : ""}">Manodopera</button>
        <button type="button" data-action="tipo-riga" data-i="${i}" data-tipo="mat" class="${r.tipo === "mat" ? "on" : ""}">Materiale</button>
      </div>
      ${forf ? "" : `<select data-r="iva" aria-label="IVA">${core.ALIQUOTE_IVA.map((a) => `<option value="${a}" ${Number(r.iva) === a ? "selected" : ""}>IVA ${a}%</option>`).join("")}</select>`}
    </div>
    <div class="riga-piede">
      <button type="button" class="pill-opz ${r.opzionale ? "on" : ""}" data-action="opzionale" data-i="${i}" aria-pressed="${r.opzionale ? "true" : "false"}"><span class="pallino"></span>Facoltativa</button>
      <label class="mini">Sconto %<input data-r="sconto" inputmode="decimal" placeholder="0" value="${numIn(r.sconto, true)}"></label>
      ${r.tipo === "mat" ? `<label class="mini" title="Quanto lo paghi tu: serve a calcolare il guadagno, non compare al cliente">${ICONE.lucchetto.replace("<svg", '<svg width="14" height="14"')}Costo<input data-r="costo" inputmode="decimal" placeholder="0" value="${numIn(r.costo, true)}"></label>` : ""}
      <span class="riga-importo" data-importo="${i}">${core.formatEuro(core.importoRiga(r))}</span>
    </div>
  </div>`;
}

const Riconoscimento = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

function micBtn(target) {
  if (!Riconoscimento) return "";
  return `<button type="button" class="mic" data-action="detta-campo" data-target="${target}" aria-label="Detta">${ICONE.mic}</button>`;
}

function htmlRighe(prev) {
  return (
    prev.righe.map((r, i) => htmlRiga(r, i)).join("") ||
    `<p class="muted small" style="margin:0">Nessuna voce. Aggiungila dal listino, a mano o a voce: puoi dettare più voci insieme.</p>`
  );
}

function htmlFoto(prev) {
  const foto = (prev.foto || []).filter((f) => immagineSicura(f.img));
  const badge = state.pro ? "" : `<span class="badge pro dx">PRO</span>`;
  return `<div class="sezione-titolo"><span class="ico">${ICONE.foto}</span><div><h2>Foto del lavoro</h2><div class="muted xsmall">Finiscono in una pagina del PDF</div></div>${badge}</div>
    <div class="foto-griglia">
      ${foto
        .map(
          (
            f,
          ) => `<figure><img src="${immagineSicura(f.img)}" alt="${esc(f.didascalia || "Foto del lavoro")}" loading="lazy">
          <button class="togli" data-action="togli-foto" data-id="${esc(f.id)}" aria-label="Togli foto">${ICONE.chiudi}</button></figure>`,
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

function viewEditor(id) {
  const prev = state.preventivi.find((p) => p.id === id);
  if (!prev) {
    toast("Preventivo non trovato");
    vai("#/");
    return;
  }
  state.corrente = prev;
  document.body.classList.add("no-tabbar");
  const c = prev.cliente;
  const forf = forfettario(prev);
  caricaPdfLib().catch(() => {});
  import("./pdf.js").catch(() => {});

  app().innerHTML = `
    <header class="topbar">
      <a class="back" href="#/" aria-label="Indietro">${ICONE.indietro}</a>
      <div class="titolo"><div class="sopra">Preventivo</div><strong>N. ${esc(prev.numero)}</strong></div>
      <select data-campo="stato" style="width:auto;min-height:40px;padding:6px 32px 6px 12px;font-weight:650" aria-label="Stato">
        ${Object.entries(core.STATI)
          .map(([k, v]) => `<option value="${k}" ${prev.stato === k ? "selected" : ""}>${v}</option>`)
          .join("")}
      </select>
      <button class="icon-btn" data-action="menu-preventivo" aria-label="Altre azioni">${ICONE.altro}</button>
    </header>
    <main class="pagina">
      ${prev.accettazioneOnline ? `<div class="banner ok"><span class="ico">✅</span><div><b>Accettato online</b> da ${esc(prev.firma?.nome || "il cliente")}${prev.accettazioneOnline.facoltativeAggiunte?.length ? ` · aggiunte: ${esc(prev.accettazioneOnline.facoltativeAggiunte.join(", "))}` : ""}</div></div>` : ""}
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.utente}</span><h2>Cliente</h2></div>
        <input data-campo="cliente.nome" list="lista-clienti" autocomplete="off" placeholder="Nome e cognome o ragione sociale" value="${esc(c.nome)}" aria-label="Nome cliente">
        <datalist id="lista-clienti">${state.clienti.map((x) => `<option value="${esc(x.nome)}"></option>`).join("")}</datalist>
        <div class="grid2 stack-mobile">
          <input data-campo="cliente.telefono" type="tel" placeholder="Telefono (per WhatsApp)" value="${esc(c.telefono)}" aria-label="Telefono cliente">
          <input data-campo="cliente.email" type="email" placeholder="Email" value="${esc(c.email)}" aria-label="Email cliente">
        </div>
        <details ${c.indirizzo || c.cfpiva ? "open" : ""}>
          <summary>Indirizzo e dati fiscali</summary>
          <div class="stack">
            <input data-campo="cliente.indirizzo" placeholder="Via e numero civico" value="${esc(c.indirizzo)}" aria-label="Indirizzo">
            <input data-campo="cliente.citta" placeholder="CAP, città e provincia" value="${esc(c.citta)}" aria-label="Città">
            <input data-campo="cliente.cfpiva" placeholder="Codice fiscale o Partita IVA" value="${esc(c.cfpiva)}" aria-label="Codice fiscale o partita IVA">
          </div>
        </details>
      </section>

      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.lavoro}</span><h2>Lavoro</h2></div>
        <div class="con-mic"><input data-campo="oggetto" placeholder="Oggetto, es. Rifacimento bagno" value="${esc(prev.oggetto)}" aria-label="Oggetto">${micBtn("oggetto")}</div>
        <input data-campo="luogo" placeholder="Indirizzo del cantiere (se diverso)" value="${esc(prev.luogo)}" aria-label="Luogo dell'intervento">
      </section>

      <section class="card">
        <div class="sezione-titolo"><span class="ico">${ICONE.listino}</span><h2>Voci <span class="muted" id="n-righe">(${prev.righe.length})</span></h2></div>
        <div id="righe">${htmlRighe(prev)}</div>
        <div class="azioni-righe">
          <button class="btn soft" data-action="dal-listino">${ICONE.listino}Listino</button>
          <button class="btn soft" data-action="aggiungi-riga">${ICONE.piu}Voce</button>
          ${Riconoscimento ? `<button class="btn soft" data-action="detta-righe">${ICONE.mic}Detta</button>` : `<button class="btn soft" data-action="aggiungi-riga" data-tipo="mat">${ICONE.piu}Materiale</button>`}
        </div>
      </section>

      <section class="card" id="sezione-foto">${htmlFoto(prev)}</section>

      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.condizioni}</span><h2>Condizioni</h2></div>
        <div class="grid2">
          <label class="campo">Sconto totale %<input data-campo="scontoGlobale" inputmode="decimal" placeholder="0" value="${numIn(prev.scontoGlobale, true)}"></label>
          <label class="campo">Validità (giorni)<input data-campo="validitaGiorni" inputmode="numeric" value="${numIn(prev.validitaGiorni)}"></label>
        </div>
        <div class="grid2">
          <label class="campo">Acconto
            <select data-campo="acconto.tipo">
              <option value="perc" ${prev.acconto.tipo !== "importo" ? "selected" : ""}>in percentuale</option>
              <option value="importo" ${prev.acconto.tipo === "importo" ? "selected" : ""}>importo fisso €</option>
            </select>
          </label>
          <label class="campo">Valore acconto<input data-campo="acconto.valore" inputmode="decimal" placeholder="0" value="${numIn(prev.acconto.valore, true)}"></label>
        </div>
        <label class="campo">Tempi di esecuzione<input data-campo="tempi" placeholder="es. 3 giorni lavorativi dall'accettazione" value="${esc(prev.tempi)}"></label>
        <label class="campo">Modalità di pagamento<textarea data-campo="pagamento" rows="2">${esc(prev.pagamento)}</textarea></label>
        <label class="campo">Note e condizioni<textarea data-campo="note" rows="3">${esc(prev.note)}</textarea></label>
      </section>

      <section class="card stack" id="sezione-firma">${htmlFirma(prev)}</section>
      <section class="card riepilogo" id="riepilogo">${htmlRiepilogo(prev)}</section>
    </main>
    <footer class="barra-totale">
      <div class="tot"><div class="muted xsmall">${forf ? "Totale" : "Totale IVA inclusa"}</div><div class="big" id="tot-valore">${core.formatEuro(totaliDi(prev).totale)}</div></div>
      <button class="btn" data-action="anteprima" aria-label="Anteprima PDF">${ICONE.occhio}<span>Anteprima</span></button>
      <button class="btn primary" data-action="invia">${ICONE.invia}<span>Invia</span></button>
    </footer>`;

  $$("textarea", app()).forEach(autoAltezza);
  collegaInputFoto();
  ombraTopbar();
}

function htmlFirma(prev) {
  const img = immagineSicura(prev.firma && prev.firma.img);
  if (img) {
    return `<div class="sezione-titolo" style="margin:0"><span class="ico" style="background:var(--ok-soft);color:var(--ok)">${ICONE.firma}</span><h2>Firma del cliente</h2><span class="badge accettato dx">Firmato</span></div>
      <div class="firma-box"><img src="${img}" alt="Firma del cliente"></div>
      <div class="muted small">Firmato ${prev.firma.online ? "online " : ""}da ${esc(prev.firma.nome)} il ${esc(core.formatData(core.oggiISO(new Date(prev.firma.data))))}</div>
      <button class="btn small danger" data-action="rimuovi-firma" style="align-self:flex-start">${ICONE.cestino} Rimuovi firma</button>`;
  }
  return `<div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.firma}</span><div><h2>Firma del cliente</h2><div class="muted xsmall">Sul posto, sul tuo telefono${state.pro ? "" : " · Pro"}</div></div></div>
    <p class="muted small" style="margin:0">Sei dal cliente? Fallo firmare qui. Se invece mandi il <b>link di accettazione</b>, firma lui dal suo telefono.</p>
    <button class="btn block" data-action="firma">${ICONE.firma} Fai firmare il cliente ora</button>`;
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
    html += `<div class="banner warn" style="margin-top:10px"><span class="ico">✨</span><div>${t.opzionali.length} ${t.opzionali.length === 1 ? "voce facoltativa" : "voci facoltative"} proposte (+ ${esc(core.formatEuro(extra))} imponibile): il cliente può aggiungerle accettando online.</div></div>`;
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
  $("#tot-valore").textContent = core.formatEuro(t.totale);
  prev.righe.forEach((r, i) => {
    const el = $(`[data-importo="${i}"]`);
    if (el) el.textContent = core.formatEuro(core.importoRiga(r));
  });
  $("#riepilogo").innerHTML = htmlRiepilogo(prev);
}

function rerenderRighe() {
  const prev = state.corrente;
  $("#righe").innerHTML = htmlRighe(prev);
  $("#n-righe").textContent = `(${prev.righe.length})`;
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
  if (campo && CAMPI_EDITOR.has(campo)) {
    const valore = CAMPI_NUMERICI.has(campo) ? core.parseNumero(el.value) : el.value;
    impostaPercorso(prev, campo, valore);
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
      ${voce("listino", ICONE.listino, "Salva nel mio listino")}
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
  if (op === "elimina") righe.splice(i, 1);
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
    return toast("Salvata nel listino", "ok");
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
      return `<p class="muted">Il tuo listino è vuoto.</p>
        ${m ? `<button class="btn soft block" data-action="carica-esempi" data-m="${m.id}">Carica i prezzi tipici da ${esc(m.nome.toLowerCase())}</button>` : ""}
        <a class="btn block" href="#/listino" style="margin-top:8px">Vai al listino</a>`;
    }
    return (
      trovate
        .map(
          (v) => `<button class="voce-listino" data-action="usa-voce" data-id="${esc(v.id)}">
            <span class="tipo" aria-hidden="true">${v.tipo === "mat" ? "📦" : "🛠️"}</span>
            <div class="corpo"><div>${esc(v.descrizione)}</div><div class="muted xsmall">${v.tipo === "mat" ? "Materiale" : "Manodopera"} · ${esc(v.um)}</div></div>
            <div class="prezzo">${core.formatEuro(v.prezzo)}</div></button>`,
        )
        .join("") || `<p class="muted">Nessuna voce trovata.</p>`
    );
  };
  apriFoglio(
    `${titoloFoglio("Aggiungi dal listino", "Tocca una voce per aggiungerla")}
    <input type="search" id="cerca-listino" placeholder="Cerca nel listino" aria-label="Cerca nel listino">
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
  const voce = (azione, ico, testo, cls = "") =>
    `<button class="${cls}" data-action="${azione}"><span class="ico">${ico}</span><span class="corpo">${testo}</span></button>`;
  apriFoglio(
    `${titoloFoglio("Azioni")}
    <div class="lista-azioni">
      ${voce("scarica-pdf", ICONE.scarica, "Scarica PDF")}
      ${voce("duplica-preventivo", ICONE.copia, "Duplica preventivo")}
      ${voce("elimina-preventivo", ICONE.cestino, "Elimina preventivo", "danger")}
    </div>`,
  );
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
      : `${voci.length} voci aggiunte${dalListino ? ` (${dalListino} dal listino)` : ""}`,
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
    await salvaPreventivo(prev);
    traccia("Firma cliente");
    chiudiFoglio();
    vibra(30);
    $("#sezione-firma").innerHTML = htmlFirma(prev);
    $('[data-campo="stato"]').value = "accettato";
    toast("Firmato! Preventivo accettato", "ok");
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
    prev.link = { hash: l.hash, il: Date.now() };
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

function verificaPronto(prev) {
  if (!prev.righe.length) {
    toast("Aggiungi almeno una voce al preventivo");
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

async function anteprima() {
  const prev = state.corrente;
  if (!verificaPronto(prev) || !entroLimite(prev)) return;
  // La finestra si apre subito (prima delle operazioni asincrone) per evitare i blocchi popup.
  const finestra = window.open("", "_blank");
  registraEsportazione(prev);
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
  if (!verificaPronto(prev) || !entroLimite(prev)) return;
  registraEsportazione(prev);
  scaricaBlob(await generaPdf(prev), core.nomeFilePdf(prev));
}

async function segnaInviato(prev) {
  traccia("Preventivo inviato");
  if (prev.stato === "bozza") {
    prev.stato = "inviato";
    const sel = $('[data-campo="stato"]');
    if (sel) sel.value = "inviato";
  }
  // Il primo invio fa partire il conteggio per il promemoria; un nuovo invio vale come ricontatto.
  if (!prev.inviatoIl) prev.inviatoIl = Date.now();
  else prev.ricontattatoIl = Date.now();
  await salvaPreventivo(prev);
}

function testoConLink(prev, link) {
  const t = totaliDi(prev);
  const saluto = prev.cliente.nome ? `Buongiorno ${prev.cliente.nome},` : "Buongiorno,";
  return (
    `${saluto} ecco il preventivo n. ${prev.numero}${prev.oggetto ? ` per "${prev.oggetto}"` : ""}: ${core.formatEuro(t.totale)}${t.forfettario ? "" : " IVA inclusa"}.\n` +
    (t.opzionali.length
      ? `Ci sono anche ${t.opzionali.length === 1 ? "una voce facoltativa" : "alcune voci facoltative"} che può aggiungere se le interessano.\n`
      : "") +
    `Può vederlo e accettarlo con la firma direttamente dal telefono:\n${link}` +
    (state.azienda.ragioneSociale ? `\n\n${state.azienda.ragioneSociale}` : "")
  );
}

// Il foglio di invio prepara PDF e link PRIMA di mostrarsi: così i pulsanti aprono WhatsApp
// e la condivisione subito, senza attese che farebbero bloccare il popup dal browser.
async function invia() {
  const prev = state.corrente;
  if (!verificaPronto(prev) || !entroLimite(prev)) return;
  await salvaClienteDa(prev);
  let blob, link;
  try {
    link = await preparaLink(prev).catch(() => null);
    blob = await generaPdf(prev, { link });
  } catch (err) {
    return toast(err.message || "Errore nella creazione del PDF");
  }
  const nome = core.nomeFilePdf(prev);
  const file = new File([blob], nome, { type: "application/pdf" });
  const puoCondividere = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  const tel = core.telefonoWhatsApp(prev.cliente.telefono);
  const testoPdf = core.testoWhatsApp(prev, state.azienda, totaliDi(prev));
  const testoLink = link ? testoConLink(prev, link) : "";
  const voce = (attr, ico, titolo, sotto, extra = "") =>
    `<${attr}><span class="ico ${extra}">${ico}</span><span class="corpo">${titolo}<small>${sotto}</small></span>`;

  const f = apriFoglio(
    `${titoloFoglio("Invia il preventivo", `${esc(core.nomeCliente(prev.cliente))} · ${esc(core.formatEuro(totaliDi(prev).totale))}`)}
    <div class="lista-azioni">
      ${
        link
          ? `${voce(`a href="https://wa.me/${tel}?text=${encodeURIComponent(testoLink)}" target="_blank" rel="noopener" data-action="invio-link"`, ICONE.whatsapp, "WhatsApp con link di accettazione", "Il cliente lo apre, sceglie le facoltative e firma dal suo telefono", "wa")}<span class="nuovo">NUOVO</span></a>
             ${voce('button data-action="invio-copia-link"', ICONE.link, "Copia il link di accettazione", "Da incollare in SMS, Telegram, email...")}</button>`
          : ""
      }
      ${puoCondividere ? `${voce('button data-action="invio-condividi"', ICONE.condividi, "Condividi il PDF", "WhatsApp, email o altre app", "grad")}</button>` : ""}
      ${voce('button data-action="invio-scarica"', ICONE.scarica, "Scarica il PDF", "Da allegare dove vuoi")}</button>
      ${voce(`a href="mailto:${encodeURIComponent(prev.cliente.email || "")}?subject=${encodeURIComponent(`Preventivo n. ${prev.numero}`)}&body=${encodeURIComponent((link ? testoLink : testoPdf) + "\n\n(In allegato il PDF)")}" data-action="invio-segna"`, ICONE.mail, "Email", prev.cliente.email ? esc(prev.cliente.email) : "Scegli il destinatario")}</a>
    </div>`,
  );
  f.dataset.link = link || "";
  registraEsportazione(prev);
  azioni["invio-link"] = () => {
    segnaInviato(prev);
    traccia("Link accettazione inviato");
  };
  azioni["invio-copia-link"] = async () => {
    toast((await copiaTesto(testoLink)) ? "Messaggio con link copiato" : "Copia non riuscita");
    segnaInviato(prev);
  };
  azioni["invio-condividi"] = async () => {
    try {
      await navigator.share({ files: [file], title: nome, text: testoPdf });
      await segnaInviato(prev);
      chiudiFoglio();
      toast("Preventivo inviato", "ok");
    } catch {
      /* annullato */
    }
  };
  azioni["invio-scarica"] = async () => {
    scaricaBlob(blob, nome);
    await segnaInviato(prev);
  };
  azioni["invio-segna"] = () => segnaInviato(prev);
}

// ------------------------------------------------------------------
// Ricezione dell'accettazione online
// ------------------------------------------------------------------
async function viewAccettazione(q) {
  const codice = q.get("d") || "";
  const pagina = (corpo) => {
    app().innerHTML = `<header class="topbar"><a class="back" href="#/" aria-label="Chiudi">${ICONE.indietro}</a><div class="titolo"><div class="sopra">Accettazione online</div><strong>Conferma del cliente</strong></div></header>
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
    return pagina(
      `<div class="card stack"><div class="banner warn"><span class="ico">📱</span><div>Il preventivo n. ${esc(conferma.numero)} non è su questo dispositivo. Apri il link sul telefono dove l'hai creato.</div></div>${dettaglio}</div>`,
    );
  }
  if (prev.accettazioneOnline && prev.accettazioneOnline.hash === conferma.hash && prev.stato === "accettato") {
    return pagina(
      `<div class="card stack"><div class="banner ok"><span class="ico">✅</span><div>Accettazione già registrata.</div></div>${dettaglio}<a class="btn primary block" href="#/p/${esc(prev.id)}">Apri il preventivo</a></div>`,
    );
  }
  const verifica = verificaImpronta(prev, conferma.hash);
  const avviso = {
    ok: `<div class="banner ok"><span class="ico">🔒</span><div>Il cliente ha accettato <b>esattamente</b> la versione che hai inviato.</div></div>`,
    precedente: `<div class="banner warn"><span class="ico">⚠️</span><div>Il cliente ha accettato una <b>versione precedente</b> del preventivo: dopo l'invio l'hai modificato. Controlla prima di procedere.</div></div>`,
    diversa: `<div class="banner bad"><span class="ico">⛔</span><div><b>Attenzione:</b> i dati accettati non corrispondono a nessun link che hai inviato da questo telefono. Potrebbero essere stati modificati: verifica prezzi e voci con il cliente.</div></div>`,
  }[verifica];
  const scelte = conferma.scelte.map((_, k) => voceDaConferma(prev, conferma, k)).filter(Boolean);
  const copia = { ...prev, righe: prev.righe.map((r) => (scelte.includes(r) ? { ...r, opzionale: false } : r)) };
  pagina(`<section class="card stack">
      <div class="row">${avatar(conferma.nome)}<div><div style="font-weight:750;font-size:17px">${esc(conferma.nome)} ha accettato</div><div class="muted small">Preventivo n. ${esc(prev.numero)}${prev.oggetto ? ` · ${esc(prev.oggetto)}` : ""}</div></div></div>
      ${avviso}
      ${scelte.length ? `<div><div class="muted xsmall">VOCI FACOLTATIVE AGGIUNTE DAL CLIENTE</div>${scelte.map((r) => `<div>✨ ${esc(r.descrizione)}</div>`).join("")}</div>` : ""}
      <div class="r" style="display:flex;justify-content:space-between"><span>Nuovo totale</span><b class="big">${esc(core.formatEuro(totaliDi(copia).totale))}</b></div>
      ${dettaglio}
      <button class="btn primary big block" data-action="registra-accettazione">${ICONE.check} Registra accettazione</button>
      <a class="btn ghost block" href="#/p/${esc(prev.id)}">Apri senza registrare</a>
    </section>`);
  azioni["registra-accettazione"] = async () => {
    applicaConferma(prev, conferma, firma);
    await salvaPreventivo(prev);
    traccia("Accettazione online registrata", { verifica });
    vibra(30);
    toast("Accettazione registrata", "ok");
    vai(`#/p/${prev.id}`);
  };
}

// ------------------------------------------------------------------
// Paywall e Pro
// ------------------------------------------------------------------
const VANTAGGI_PRO = [
  "Preventivi e link di accettazione illimitati",
  "Il tuo logo e i tuoi colori su PDF e pagina del cliente",
  "Firma del cliente sul tuo telefono, in cantiere",
  "Foto del lavoro allegate al preventivo",
  'Niente scritta "Creato con PreventivoLampo"',
  "Assistenza prioritaria via email",
];

function paywall(motivo) {
  traccia("Paywall", { motivo });
  const mese = new Date().toLocaleDateString("it-IT", { month: "long" });
  const titoli = {
    limite: `Hai usato i ${CONFIG.pdfGratisAlMese} preventivi gratuiti di ${mese}`,
    firma: "La firma sul posto è una funzione Pro",
    logo: "Logo e colori sono funzioni Pro",
    foto: "Le foto nel preventivo sono una funzione Pro",
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
    ? `<div class="banner ok"><span class="ico">⭐</span><div><b>Pro attivo</b>${lic.email ? ` · ${esc(lic.email)}` : ""}${lic.scadenza ? `<br><span class="small">Rinnovo/scadenza: ${esc(new Date(lic.scadenza).toLocaleDateString("it-IT"))}</span>` : ""}</div></div>
       ${CONFIG.portaleClienti ? `<a class="btn block" href="${esc(urlSicuro(CONFIG.portaleClienti))}" target="_blank" rel="noopener">Gestisci abbonamento e fatture</a>` : ""}
       <button class="btn block danger" data-action="rimuovi-licenza">Rimuovi licenza da questo dispositivo</button>`
    : "";

  app().innerHTML = `
    <header class="topbar"><a class="back" href="#/" aria-label="Indietro">${ICONE.indietro}</a><div class="titolo"><strong>${state.pro ? "Il tuo piano" : "PreventivoLampo Pro"}</strong></div></header>
    <main class="pagina">
      ${q.get("acquisto") === "ok" ? `<div class="banner ok"><span class="ico">🎉</span><div><b>Grazie per l'acquisto!</b> Ti abbiamo inviato via email il <b>codice licenza</b>: incollalo qui sotto per attivare Pro.</div></div>` : ""}
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
    <header class="topbar"><div class="titolo"><strong style="font-size:22px">Clienti</strong></div><button class="btn small soft" data-action="cliente-nuovo">${ICONE.piu} Nuovo</button></header>
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
          <div class="dx muted small">${conteggi[c.id] || 0} prev.</div></button>`,
      )
      .join("") || `<p class="muted">Nessun cliente trovato.</p>`
  );
}

function foglioCliente(id) {
  const c = state.clienti.find((x) => x.id === id) || { id: core.uid(), nome: "", createdAt: Date.now() };
  const nuovo = !state.clienti.some((x) => x.id === c.id);
  const campo = (k, ph, tipo = "text") =>
    `<input data-cli="${k}" type="${tipo}" placeholder="${ph}" value="${esc(c[k])}" aria-label="${ph}">`;
  apriFoglio(
    `${titoloFoglio(nuovo ? "Nuovo cliente" : esc(c.nome))}
    <div class="stack">
      ${campo("nome", "Nome e cognome o ragione sociale")}
      ${campo("telefono", "Telefono", "tel")}
      ${campo("email", "Email", "email")}
      ${campo("indirizzo", "Via e numero civico")}
      ${campo("citta", "CAP, città e provincia")}
      ${campo("cfpiva", "Codice fiscale o Partita IVA")}
      <textarea data-cli="note" rows="2" placeholder="Note interne (non compaiono nel preventivo)" aria-label="Note interne">${esc(c.note)}</textarea>
      <button class="btn primary block" data-action="cliente-salva">Salva</button>
      ${
        nuovo
          ? ""
          : `<button class="btn soft block" data-action="cliente-preventivo">${ICONE.piu} Nuovo preventivo per questo cliente</button>
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
    <header class="topbar"><div class="titolo"><strong style="font-size:22px">Listino prezzi</strong></div><button class="btn small soft" data-action="voce-nuova">${ICONE.piu} Nuova</button></header>
    <main class="pagina">
      <p class="muted small" style="margin:0">Le voci che usi più spesso con i tuoi prezzi: nel preventivo le aggiungi con un tocco o dettandole.</p>
      ${voci.length ? `<input type="search" id="cerca-voci" placeholder="Cerca voce" aria-label="Cerca voce">` : ""}
      <div class="card" style="padding:4px 12px" id="lista-voci">${htmlVociListino(voci, "")}</div>
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.scintille}</span><h2>Prezzi tipici per mestiere</h2></div>
        <p class="muted small" style="margin:0">Aggiunge le voci più comuni con prezzi indicativi, da adattare ai tuoi.</p>
        <select id="mestiere-esempi" aria-label="Mestiere">${MESTIERI.map((x) => `<option value="${x.id}" ${m && m.id === x.id ? "selected" : ""}>${esc(x.icona)} ${esc(x.nome)}</option>`).join("")}</select>
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
    return `<p class="muted" style="padding:8px 4px">Il listino è vuoto. Aggiungi una voce o carica i prezzi tipici del tuo mestiere qui sotto.</p>`;
  return (
    voci
      .filter((v) => !f || v.descrizione.toLowerCase().includes(f))
      .map(
        (v) => `<button class="voce-listino" data-action="voce-apri" data-id="${esc(v.id)}">
          <span class="tipo" aria-hidden="true">${v.tipo === "mat" ? "📦" : "🛠️"}</span>
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
  const campo = (k, etichetta, ph = "", tipo = "text") =>
    `<label class="campo">${etichetta}<input data-az="${k}" type="${tipo}" placeholder="${esc(ph)}" value="${esc(a[k])}"></label>`;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const rimasti = core.pdfRimasti(state.contatore, CONFIG.pdfGratisAlMese);
  const proBadge = state.pro ? "" : `<span class="badge pro dx">PRO</span>`;
  const logo = immagineSicura(a.logo);

  app().innerHTML = `
    <header class="topbar"><div class="titolo"><strong style="font-size:22px">Impostazioni</strong></div></header>
    <main class="pagina">
      <section class="card">
        ${
          state.pro
            ? `<div class="row"><span class="badge pro">PRO</span><span class="small">Attivo${state.licenza.email ? " · " + esc(state.licenza.email) : ""}</span><a class="btn small" style="margin-left:auto" href="#/pro">Gestisci</a></div>`
            : `<div class="row"><div><b>Piano gratuito</b><div class="muted xsmall">${rimasti} PDF rimasti questo mese</div></div><a class="btn small primary" style="margin-left:auto" href="#/pro">Passa a Pro</a></div>`
        }
      </section>

      <div class="etichetta-sez">La tua impresa <span class="dx muted xsmall">appare sul preventivo</span></div>
      <section class="card stack">
        ${campo("ragioneSociale", "Nome impresa *", "es. Idraulica Rossi di Mario Rossi")}
        ${campo("indirizzo", "Indirizzo", "Via Roma 1")}
        <div class="grid3">${campo("cap", "CAP")}${campo("citta", "Città")}${campo("provincia", "Prov.", "MI")}</div>
        <div class="grid2 stack-mobile">${campo("piva", "Partita IVA")}${campo("cf", "Codice fiscale")}</div>
        <div class="grid2 stack-mobile">${campo("telefono", "Telefono / WhatsApp", "", "tel")}${campo("email", "Email", "", "email")}</div>
        <div class="grid2 stack-mobile">${campo("pec", "PEC")}${campo("sito", "Sito web")}</div>
      </section>

      <div class="etichetta-sez">Pagamenti</div>
      <section class="card stack">
        <div class="grid2 stack-mobile">${campo("iban", "IBAN")}${campo("intestatarioIban", "Intestatario IBAN")}</div>
        ${campo("linkPagamento", "Link per pagare l'acconto online", "https://paypal.me/... o link Satispay/Stripe", "url")}
        <p class="muted xsmall" style="margin:0">Il cliente che accetta online vede IBAN e pulsante "Paga online" per l'acconto.</p>
      </section>

      <div class="etichetta-sez">Logo e colore ${proBadge}</div>
      <section class="card stack">
        <div class="row">
          ${logo ? `<img src="${logo}" alt="Logo" style="max-height:56px;max-width:140px;border-radius:10px;background:#fff;padding:4px">` : `<span class="muted small">Nessun logo</span>`}
          ${
            state.pro
              ? `<label class="btn small" style="margin-left:auto">Carica logo<input type="file" accept="image/png,image/jpeg,image/webp" id="file-logo" hidden></label>`
              : `<button class="btn small" style="margin-left:auto" data-action="paywall" data-motivo="logo">Carica logo</button>`
          }
          ${logo ? `<button class="btn small danger" data-action="rimuovi-logo">Rimuovi</button>` : ""}
        </div>
        ${
          state.pro
            ? `<label class="campo">Colore del preventivo<input type="color" data-az="colore" value="${esc(/^#[0-9a-f]{6}$/i.test(a.colore) ? a.colore : "#1d4ed8")}"></label>`
            : `<button class="btn block" data-action="paywall" data-motivo="logo">Scegli il colore del preventivo</button>`
        }
      </section>

      <div class="etichetta-sez">Fisco</div>
      <section class="card stack">
        <label class="campo">Regime fiscale
          <select data-az="regime">
            <option value="ordinario" ${a.regime !== "forfettario" ? "selected" : ""}>Ordinario / semplificato (con IVA)</option>
            <option value="forfettario" ${a.regime === "forfettario" ? "selected" : ""}>Forfettario (senza IVA)</option>
          </select>
        </label>
        ${
          a.regime === "forfettario"
            ? `<label class="check"><input type="checkbox" data-az="addebitaBollo" ${a.addebitaBollo ? "checked" : ""}> <span>Addebita al cliente il bollo da 2 € (sopra 77,47 €)</span></label>
             <label class="campo">Dicitura forfettario<textarea data-az="fraseForfettario" rows="3">${esc(a.fraseForfettario)}</textarea></label>`
            : `<label class="campo">IVA predefinita per le nuove voci
              <select data-az="ivaDefault">${core.ALIQUOTE_IVA.map((x) => `<option value="${x}" ${Number(a.ivaDefault) === x ? "selected" : ""}>${x}%</option>`).join("")}</select></label>`
        }
      </section>

      <div class="etichetta-sez">Preventivi</div>
      <section class="card stack">
        <div class="grid2">${campo("prefisso", "Prefisso numero", "es. P-")}${campo("validitaGiorni", "Validità (giorni)", "30", "number")}</div>
        <label class="campo">Promemoria "da ricontattare" dopo
          <select data-az="giorniRicontatto">${[2, 3, 5, 7, 10].map((n) => `<option value="${n}" ${Number(a.giorniRicontatto) === n ? "selected" : ""}>${n} giorni</option>`).join("")}</select></label>
        <label class="campo">Pagamento predefinito<textarea data-az="pagamento" rows="2">${esc(a.pagamento)}</textarea></label>
        <label class="campo">Condizioni predefinite<textarea data-az="condizioni" rows="4">${esc(a.condizioni)}</textarea></label>
      </section>

      <div class="etichetta-sez">App e dati</div>
      <section class="card stack">
        ${state.installEvento ? `<button class="btn soft block" data-action="installa">📲 Installa l'app sul telefono</button>` : ""}
        ${isIos && !standalone ? `<div class="banner info"><span class="ico">📲</span><div>Per installare l'app su iPhone: tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>.</div></div>` : ""}
        <p class="muted small" style="margin:0">I tuoi dati restano solo su questo dispositivo. Fai un backup ogni tanto o prima di cambiare telefono.</p>
        <div class="grid2">
          <button class="btn" data-action="backup-esporta">${ICONE.scarica} Esporta backup</button>
          <label class="btn">Importa backup<input type="file" accept="application/json,.json" id="file-backup" hidden></label>
        </div>
        <button class="btn soft block" data-action="consiglia">${ICONE.condividi} Consiglia l'app a un collega</button>
        <div class="row wrap small" style="justify-content:center;gap:16px;margin-top:4px">
          <a href="privacy.html">Privacy</a><a href="termini.html">Termini</a><a href="mailto:${esc(CONFIG.emailSupporto)}">Assistenza</a>
        </div>
      </section>
    </main>`;
  ombraTopbar();

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
        titolo: "Importare il backup?",
        testo: "Sostituirà i dati attuali su questo dispositivo.",
        ok: "Importa",
        pericolo: true,
      });
      if (!ok) return;
      const n = await db.importa(dati);
      await caricaTutto();
      toast(`Backup importato: ${n.preventivi} preventivi, ${n.clienti} clienti`, "ok");
      vai("#/");
    } catch (err) {
      toast(err.message || "File non valido");
    }
  });
}

const CAMPI_AZIENDA = new Set(
  Object.keys(AZIENDA_DEFAULT).filter((k) => !["onboarded", "logo", "mestiere"].includes(k)),
);

function suInputImpostazioni(e) {
  const el = e.target;
  const k = el.dataset.az;
  if (!k || !CAMPI_AZIENDA.has(k)) return;
  if (k === "colore" && !state.pro) return;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (k === "ivaDefault" || k === "validitaGiorni" || k === "giorniRicontatto") v = core.parseNumero(v);
  if (k === "linkPagamento" && e.type === "change" && v && !urlSicuro(v)) {
    toast("Il link deve iniziare con https://");
  }
  state.azienda[k] = k === "linkPagamento" ? (urlSicuro(v) ? v.trim() : e.type === "change" ? "" : v) : v;
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
  const passo1 = `
      <div class="titolone"><h1>Che lavoro fai?</h1><p>Ti preparo il listino con i prezzi tipici del tuo mestiere.</p></div>
      <main class="pagina">
        <div class="griglia-mestieri">
          ${MESTIERI.map((m) => `<button class="mestiere ${scelto === m.id ? "on" : ""}" data-action="scegli-mestiere" data-m="${m.id}"><span class="em" aria-hidden="true">${esc(m.icona)}</span>${esc(m.nome)}</button>`).join("")}
          <button class="mestiere ${scelto === "altro" ? "on" : ""}" data-action="scegli-mestiere" data-m="altro"><span class="em" aria-hidden="true">✨</span>Altro</button>
        </div>
      </main>
      <footer class="barra-totale"><div class="tot"><div class="muted xsmall">Passo 1 di 2</div><b>${scelto && scelto !== "altro" ? esc(trovaMestiere(scelto)?.nome || "") : scelto === "altro" ? "Altro" : "Scegli un mestiere"}</b></div>
        <button class="btn primary big" data-action="onb-avanti" ${scelto ? "" : 'aria-disabled="true"'}>Avanti</button></footer>`;
  const passo2 = `
      <div class="titolone"><h1>I tuoi dati</h1><p>Compaiono sul preventivo. Niente registrazione: restano sul tuo telefono.</p></div>
      <main class="pagina">
        <section class="card stack">
          <input id="b-nome" placeholder="Nome impresa (es. Idraulica Rossi)" value="${esc(a.ragioneSociale)}" aria-label="Nome impresa" autocomplete="organization">
          <div class="grid2 stack-mobile">
            <input id="b-tel" type="tel" placeholder="Telefono / WhatsApp" value="${esc(a.telefono)}" aria-label="Telefono" autocomplete="tel">
            <input id="b-piva" placeholder="Partita IVA" value="${esc(a.piva)}" aria-label="Partita IVA" inputmode="numeric">
          </div>
          <div class="grid2 stack-mobile">
            <input id="b-citta" placeholder="Città" value="${esc(a.citta)}" aria-label="Città" autocomplete="address-level2">
            <input id="b-email" type="email" placeholder="Email" value="${esc(a.email)}" aria-label="Email" autocomplete="email">
          </div>
        </section>
        <div class="etichetta-sez">Come applichi l'IVA?</div>
        <div class="scelta-iva" role="radiogroup">
          <label><input type="radio" name="b-iva" value="22" ${iva === "22" ? "checked" : ""}><span>IVA 22%<small>Aliquota ordinaria</small></span></label>
          <label><input type="radio" name="b-iva" value="10" ${iva === "10" ? "checked" : ""}><span>IVA 10%<small>Manutenzioni su abitazioni private</small></span></label>
          <label><input type="radio" name="b-iva" value="forf" ${iva === "forf" ? "checked" : ""}><span>Regime forfettario<small>Senza IVA, con la dicitura di legge</small></span></label>
        </div>
        <p class="muted xsmall" style="margin:0 4px">Puoi cambiare tutto quando vuoi da Impostazioni.</p>
      </main>
      <footer class="barra-totale"><button class="btn" data-action="onb-indietro" aria-label="Indietro">${ICONE.indietro}</button>
        <div class="tot"><div class="muted xsmall">Passo 2 di 2</div><b>Quasi fatto</b></div>
        <button class="btn primary big" data-action="fine-benvenuto">${ICONE.fulmine} Inizia</button></footer>`;
  app().innerHTML = `
    <header class="topbar"><div class="brand">${ICONE.logo}<span>${esc(CONFIG.nomeProdotto)}</span></div></header>
    <div class="passi-onb" aria-hidden="true"><i class="on"></i><i class="${passo === 2 ? "on" : ""}"></i></div>
    ${passo === 1 ? passo1 : passo2}`;
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

async function fineBenvenuto() {
  salvaDatiOnb();
  const a = state.azienda;
  if (!a.ragioneSociale) {
    $("#b-nome").focus();
    return toast("Scrivi il nome della tua impresa");
  }
  a.mestiere = state.mestiereScelto && state.mestiereScelto !== "altro" ? state.mestiereScelto : "";
  a.onboarded = true;
  await salvaAzienda();
  traccia("Onboarding completato", { mestiere: a.mestiere || "altro", regime: a.regime });
  if (a.mestiere && !state.listino.length) await caricaEsempi(a.mestiere);
  db.rendiPersistente();
  const modello = state.apriModello ? trovaMestiere(a.mestiere) : null;
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
    toast("Voci aggiunte al listino", "ok");
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
    prev.foto = (prev.foto || []).filter((f) => f.id !== el.dataset.id);
    await salvaPreventivo(prev);
    $("#sezione-foto").innerHTML = htmlFoto(prev);
    collegaInputFoto();
  },
  "menu-preventivo": () => menuPreventivo(),
  "scarica-pdf": () => scaricaPdf(),
  "duplica-preventivo": async () => {
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
      inviatoIl: null,
      ricontattatoIl: null,
      regime: state.azienda.regime,
      addebitaBollo: state.azienda.addebitaBollo,
      createdAt: Date.now(),
    };
    copia.righe = copia.righe.map((r) => ({ ...r, id: core.uid() }));
    await salvaPreventivo(copia);
    toast(`Creato il preventivo N. ${copia.numero}`, "ok");
    vai(`#/p/${copia.id}`);
  },
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
    clearTimeout(timerSalva);
    await db.elimina("preventivi", prev.id);
    state.preventivi = state.preventivi.filter((p) => p.id !== prev.id);
    state.corrente = null;
    vai("#/");
  },
  firma: () => foglioFirma(),
  "rimuovi-firma": async () => {
    if (!(await chiedi({ titolo: "Rimuovere la firma del cliente?", ok: "Rimuovi", pericolo: true }))) return;
    state.corrente.firma = null;
    await salvaPreventivo(state.corrente);
    $("#sezione-firma").innerHTML = htmlFirma(state.corrente);
  },
  anteprima: () => anteprima(),
  invia: () => invia(),
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
  "backup-esporta": async () => {
    const dati = await db.esporta();
    const blob = new Blob([JSON.stringify(dati)], { type: "application/json" });
    scaricaBlob(blob, `preventivolampo-backup-${core.oggiISO()}.json`);
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
    state.passoOnb = 1;
    transizione(viewBenvenuto);
  },
  "fine-benvenuto": () => fineBenvenuto(),
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
    if (e.target.tagName === "SELECT") suInputEditor(e);
    suChangeEditor(e);
  } else if (e.target.dataset.az) suInputImpostazioni(e);
});

window.addEventListener("hashchange", render);
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.installEvento = e;
  if (!state.corrente && (rotta().parti[0] || "") === "" && state.azienda.onboarded) viewLista();
});
function salvaTuttoOra() {
  salvaAziendaSubito();
  if (state.corrente) salvaPreventivo(state.corrente);
}
window.addEventListener("pagehide", salvaTuttoOra);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") salvaTuttoOra();
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
