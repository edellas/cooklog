import { CONFIG } from "./config.js";
import { db } from "./store.js";
import * as core from "./core.js";
import { MESTIERI, trovaMestiere, vociListino } from "./mestieri.js";
import { isPro, verifica, rivalidaSeServe } from "./licenza.js";
import { ICONE } from "./icone.js";

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
  regime: "ordinario",
  ivaDefault: 22,
  addebitaBollo: true,
  fraseForfettario: core.FRASE_FORFETTARIO,
  prefisso: "",
  validitaGiorni: 30,
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
};

const $ = (sel, root = document) => root.querySelector(sel);
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
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = () => $("#app");

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Numero -> testo per un campo input ("" se zero e vuoto è più comodo).
function numIn(n, vuotoSeZero = false) {
  const x = Number(n) || 0;
  if (vuotoSeZero && x === 0) return "";
  return String(core.round2(x)).replace(".", ",");
}

const regimeDi = (prev) => (prev && prev.regime) || state.azienda.regime;
const forfettario = (prev) => regimeDi(prev) === "forfettario";

function totaliDi(prev) {
  return core.calcolaTotali(prev, {
    regime: regimeDi(prev),
    addebitaBollo: prev.addebitaBollo ?? state.azienda.addebitaBollo,
    ivaDefault: state.azienda.ivaDefault,
  });
}

// Eventi anonimi per capire il funnel (prova -> PDF -> paywall -> acquisto).
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
    // Coda per gli eventi inviati prima che lo script sia caricato.
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
// Toast e modali
// ------------------------------------------------------------------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}

function apriFoglio(html, alMontaggio) {
  chiudiFoglio();
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.id = "foglio";
  ov.innerHTML = `<div class="foglio" role="dialog" aria-modal="true">${html}</div>`;
  ov.addEventListener("click", (e) => {
    if (e.target === ov) chiudiFoglio();
  });
  document.body.appendChild(ov);
  if (alMontaggio) alMontaggio(ov.firstElementChild);
  return ov.firstElementChild;
}

function chiudiFoglio() {
  const ov = $("#foglio");
  if (ov) {
    if (ov._allaChiusura) ov._allaChiusura();
    ov.remove();
  }
}

const titoloFoglio = (t) =>
  `<h3>${t}<button class="icon-btn chiudi" data-action="chiudi-foglio" aria-label="Chiudi">${ICONE.chiudi}</button></h3>`;

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
  const [percorso, query] = h.split("?");
  return { parti: percorso.split("/").filter(Boolean), q: new URLSearchParams(query || "") };
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

async function eseguiRender() {
  clearTimeout(timerSalva);
  await salvaAziendaSubito();
  if (state.corrente) {
    await salvaPreventivo(state.corrente);
    await salvaClienteDa(state.corrente);
  }
  chiudiFoglio();
  const { parti, q } = rotta();
  const pagina = parti[0] || "";
  if (!state.azienda.onboarded && pagina !== "benvenuto" && pagina !== "pro") {
    vai("#/benvenuto");
    return;
  }
  state.corrente = null;
  document.body.classList.toggle("no-tabbar", pagina === "p" || pagina === "benvenuto");
  $$(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === (pagina || "lista")));
  window.scrollTo(0, 0);

  if (pagina === "") return viewLista();
  if (pagina === "nuovo") return nuovoPreventivo(q);
  if (pagina === "p") return viewEditor(parti[1]);
  if (pagina === "clienti") return viewClienti();
  if (pagina === "listino") return viewListino();
  if (pagina === "impostazioni") return viewImpostazioni();
  if (pagina === "pro") return viewPro(q);
  if (pagina === "benvenuto") return viewBenvenuto();
  vai("#/");
}

// ------------------------------------------------------------------
// Lista preventivi
// ------------------------------------------------------------------
function viewLista() {
  const mese = core.meseCorrente();
  const delMese = state.preventivi.filter((p) => (p.data || "").startsWith(mese));
  const totaleMese = delMese.reduce((s, p) => s + totaliDi(p).totale, 0);
  const accettati = delMese.filter((p) => p.stato === "accettato");
  const valoreAccettati = accettati.reduce((s, p) => s + totaliDi(p).totale, 0);

  const cerca = state.cerca.trim().toLowerCase();
  const lista = state.preventivi
    .filter((p) => state.filtro === "tutti" || p.stato === state.filtro)
    .filter((p) => {
      if (!cerca) return true;
      return [p.numero, p.oggetto, p.cliente && p.cliente.nome].join(" ").toLowerCase().includes(cerca);
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const rimasti = core.pdfRimasti(state.contatore, CONFIG.pdfGratisAlMese);
  const bannerPiano = state.pro
    ? ""
    : `<div class="banner ${rimasti === 0 ? "warn" : "info"}">
        <div>${rimasti === 0 ? "Hai finito i preventivi gratuiti di questo mese." : `Piano gratuito: <b>${rimasti} di ${CONFIG.pdfGratisAlMese}</b> preventivi PDF rimasti questo mese.`}</div>
        <a class="btn small primary" href="#/pro">Pro</a>
      </div>`;

  const bannerInstalla =
    state.installEvento && !preferenza.get("pl-installa-no")
      ? `<div class="banner info"><div>Installa l'app sul telefono: si apre con un tocco e funziona anche senza rete.</div><button class="btn small primary" data-action="installa">Installa</button></div>`
      : "";

  const filtri = ["tutti", ...Object.keys(core.STATI)]
    .map(
      (f) =>
        `<button class="chip ${state.filtro === f ? "on" : ""}" data-action="filtro" data-f="${f}">${f === "tutti" ? "Tutti" : core.STATI[f]}</button>`,
    )
    .join("");

  const voci = lista
    .map((p) => {
      const t = totaliDi(p);
      return `<a class="voce-lista" href="#/p/${esc(p.id)}">
        <div class="corpo">
          <div class="t">${esc(core.nomeCliente(p.cliente))}</div>
          <div class="s">N. ${esc(p.numero)} · ${esc(core.formatData(p.data))}${p.oggetto ? " · " + esc(p.oggetto) : ""}</div>
        </div>
        <div class="dx"><span class="importo">${core.formatEuro(t.totale)}</span><span class="badge ${esc(p.stato)}">${core.STATI[p.stato] || ""}</span></div>
      </a>`;
    })
    .join("");

  const vuoto = state.preventivi.length
    ? `<div class="vuoto muted">Nessun preventivo trovato.</div>`
    : `<div class="card vuoto">${ICONE.fulmine}<h3>Il tuo primo preventivo in 60 secondi</h3>
        <p class="muted">Aggiungi le voci dal listino o dettale a voce, poi invialo su WhatsApp in PDF.</p>
        <a class="btn primary big" href="#/nuovo">${ICONE.piu} Crea preventivo</a></div>`;

  app().innerHTML = `
    <header class="topbar">
      <div class="brand">${ICONE.logo}<span>${esc(CONFIG.nomeProdotto)}</span></div>
      ${state.pro ? `<span class="badge pro">PRO</span>` : `<a class="btn small soft" href="#/pro">${ICONE.stella} Passa a Pro</a>`}
    </header>
    <main class="pagina">
      ${bannerInstalla}
      <div class="stats">
        <div class="stat"><div class="v">${delMese.length}</div><div class="l">Preventivi del mese</div></div>
        <div class="stat"><div class="v">${core.formatEuro(totaleMese).replace(",00", "")}</div><div class="l">Valore preventivato</div></div>
        <div class="stat"><div class="v">${core.formatEuro(valoreAccettati).replace(",00", "")}</div><div class="l">Accettati (${accettati.length})</div></div>
      </div>
      ${bannerPiano}
      ${state.preventivi.length ? `<input type="search" placeholder="Cerca cliente, oggetto o numero" value="${esc(state.cerca)}" data-action-input="cerca"><div class="chips">${filtri}</div>` : ""}
      <div class="lista">${voci || vuoto}</div>
    </main>
    ${state.preventivi.length ? `<a class="fab" href="#/nuovo">${ICONE.piu} Nuovo</a>` : ""}`;

  const inputCerca = $('[data-action-input="cerca"]');
  if (inputCerca) {
    inputCerca.addEventListener("input", (e) => {
      state.cerca = e.target.value;
      const pos = e.target.selectionStart;
      viewLista();
      const nuovo = $('[data-action-input="cerca"]');
      nuovo.focus();
      nuovo.setSelectionRange(pos, pos);
    });
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

function ivaRiga(prev) {
  return forfettario(prev) ? 0 : Number(state.azienda.ivaDefault) || 22;
}

// ------------------------------------------------------------------
// Editor
// ------------------------------------------------------------------
function htmlRiga(r, i) {
  const forf = forfettario(state.corrente);
  const um = core.UNITA.includes(r.um) ? core.UNITA : [r.um, ...core.UNITA];
  return `<div class="riga" data-i="${i}">
    <div class="riga-top">
      <textarea data-r="descrizione" rows="1" placeholder="Descrizione del lavoro o del materiale">${esc(r.descrizione)}</textarea>
      <button class="icon-btn" data-action="menu-riga" data-i="${i}" aria-label="Opzioni voce">${ICONE.altro}</button>
    </div>
    <div class="riga-grid">
      <label>Quantità<input data-r="qta" inputmode="decimal" value="${numIn(r.qta)}"></label>
      <label>Unità<select data-r="um">${um.map((u) => `<option ${u === r.um ? "selected" : ""}>${esc(u)}</option>`).join("")}</select></label>
      <label>Prezzo €<input data-r="prezzo" inputmode="decimal" placeholder="0,00" value="${numIn(r.prezzo, true)}"></label>
    </div>
    <div class="riga-extra">
      <div class="seg" role="group" aria-label="Tipo voce">
        <button type="button" data-action="tipo-riga" data-i="${i}" data-tipo="man" class="${r.tipo === "man" ? "on" : ""}">Manodopera</button>
        <button type="button" data-action="tipo-riga" data-i="${i}" data-tipo="mat" class="${r.tipo === "mat" ? "on" : ""}">Materiale</button>
      </div>
      ${forf ? "" : `<select data-r="iva" aria-label="IVA">${core.ALIQUOTE_IVA.map((a) => `<option value="${a}" ${Number(r.iva) === a ? "selected" : ""}>IVA ${a}%</option>`).join("")}</select>`}
      <label class="mini">Sconto %<input data-r="sconto" inputmode="decimal" placeholder="0" value="${numIn(r.sconto, true)}"></label>
      <span class="riga-importo" data-importo="${i}">${core.formatEuro(core.importoRiga(r))}</span>
    </div>
  </div>`;
}

function micBtn(target) {
  if (!Riconoscimento) return "";
  return `<button type="button" class="mic" data-action="detta-campo" data-target="${target}" aria-label="Detta">${ICONE.mic}</button>`;
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
      <a class="back" href="#/" aria-label="Indietro">‹</a>
      <div class="titolo"><span class="muted small">Preventivo</span><strong>N. ${esc(prev.numero)}</strong></div>
      <select data-campo="stato" style="width:auto;min-height:40px;padding:6px 10px" aria-label="Stato">
        ${Object.entries(core.STATI)
          .map(([k, v]) => `<option value="${k}" ${prev.stato === k ? "selected" : ""}>${v}</option>`)
          .join("")}
      </select>
      <button class="icon-btn" data-action="menu-preventivo" aria-label="Altre azioni">${ICONE.altro}</button>
    </header>
    <main class="pagina">
      <section class="card stack">
        <h2>Cliente</h2>
        <input data-campo="cliente.nome" list="lista-clienti" autocomplete="off" placeholder="Nome e cognome o ragione sociale" value="${esc(c.nome)}">
        <datalist id="lista-clienti">${state.clienti.map((x) => `<option value="${esc(x.nome)}"></option>`).join("")}</datalist>
        <div class="grid2 stack-mobile">
          <input data-campo="cliente.telefono" type="tel" placeholder="Telefono (per WhatsApp)" value="${esc(c.telefono)}">
          <input data-campo="cliente.email" type="email" placeholder="Email" value="${esc(c.email)}">
        </div>
        <details ${c.indirizzo || c.cfpiva ? "open" : ""}>
          <summary>Indirizzo e dati fiscali</summary>
          <div class="stack">
            <input data-campo="cliente.indirizzo" placeholder="Via e numero civico" value="${esc(c.indirizzo)}">
            <input data-campo="cliente.citta" placeholder="CAP, città e provincia" value="${esc(c.citta)}">
            <input data-campo="cliente.cfpiva" placeholder="Codice fiscale o Partita IVA" value="${esc(c.cfpiva)}">
          </div>
        </details>
      </section>

      <section class="card stack">
        <h2>Lavoro</h2>
        <div class="con-mic"><input data-campo="oggetto" placeholder="Oggetto, es. Rifacimento bagno" value="${esc(prev.oggetto)}">${micBtn("oggetto")}</div>
        <input data-campo="luogo" placeholder="Indirizzo del cantiere (se diverso)" value="${esc(prev.luogo)}">
      </section>

      <section class="card">
        <h2>Voci <span class="muted" id="n-righe">(${prev.righe.length})</span></h2>
        <div id="righe">${prev.righe.map((r, i) => htmlRiga(r, i)).join("") || `<p class="muted small" style="margin:0">Nessuna voce. Aggiungine una dal listino, a mano o a voce.</p>`}</div>
        <div class="azioni-righe">
          <button class="btn soft" data-action="dal-listino">${ICONE.listino} Listino</button>
          <button class="btn soft" data-action="aggiungi-riga">${ICONE.piu} Voce</button>
          ${Riconoscimento ? `<button class="btn soft" data-action="detta-riga">${ICONE.mic} Detta</button>` : `<button class="btn soft" data-action="aggiungi-riga" data-tipo="mat">${ICONE.piu} Materiale</button>`}
        </div>
      </section>

      <section class="card stack">
        <h2>Condizioni</h2>
        <div class="grid2">
          <label class="campo">Sconto totale %<input data-campo="scontoGlobale" inputmode="decimal" placeholder="0" value="${numIn(prev.scontoGlobale, true)}"></label>
          <label class="campo">Validità (giorni)<input data-campo="validitaGiorni" inputmode="numeric" value="${numIn(prev.validitaGiorni)}"></label>
        </div>
        <div class="grid2">
          <label class="campo">Acconto richiesto
            <select data-campo="acconto.tipo">
              <option value="perc" ${prev.acconto.tipo !== "importo" ? "selected" : ""}>in percentuale (%)</option>
              <option value="importo" ${prev.acconto.tipo === "importo" ? "selected" : ""}>importo fisso (€)</option>
            </select>
          </label>
          <label class="campo">Valore acconto<input data-campo="acconto.valore" inputmode="decimal" placeholder="0" value="${numIn(prev.acconto.valore, true)}"></label>
        </div>
        <label class="campo">Tempi di esecuzione<input data-campo="tempi" placeholder="es. 3 giorni lavorativi dall'accettazione" value="${esc(prev.tempi)}"></label>
        <label class="campo">Modalità di pagamento<textarea data-campo="pagamento" rows="2">${esc(prev.pagamento)}</textarea></label>
        <label class="campo">Note e condizioni<textarea data-campo="note" rows="3">${esc(prev.note)}</textarea></label>
      </section>

      <section class="card stack" id="sezione-firma">${htmlFirma(prev)}</section>

      <section class="card" id="riepilogo">${htmlRiepilogo(prev)}</section>
      <div class="spacer"></div>
    </main>
    <footer class="barra-totale"><div class="dentro">
      <div class="tot"><div class="muted small">${forf ? "Totale" : "Totale IVA inclusa"}</div><div class="big" id="tot-valore">${core.formatEuro(totaliDi(prev).totale)}</div></div>
      <button class="btn" data-action="anteprima">${ICONE.occhio}<span>Anteprima</span></button>
      <button class="btn primary" data-action="invia">${ICONE.invia}<span>Invia</span></button>
    </div></footer>`;

  $$("textarea", app()).forEach(autoAltezza);
}

function htmlFirma(prev) {
  const pro = state.pro ? "" : `<span class="badge pro">PRO</span>`;
  if (prev.firma && prev.firma.img) {
    return `<h2>Firma del cliente <span class="badge accettato dx">Firmato</span></h2>
      <div class="firma-box"><img src="${esc(prev.firma.img)}" alt="Firma del cliente"></div>
      <div class="muted small">Firmato da ${esc(prev.firma.nome)} il ${esc(core.formatData(core.oggiISO(new Date(prev.firma.data))))}</div>
      <button class="btn small danger" data-action="rimuovi-firma">${ICONE.cestino} Rimuovi firma</button>`;
  }
  return `<h2>Firma del cliente ${pro}</h2>
    <p class="muted small" style="margin:0">Sei dal cliente? Fallo firmare sul telefono: il preventivo diventa "Accettato" e il PDF include la firma.</p>
    <button class="btn block" data-action="firma">${ICONE.firma} Fai firmare il cliente ora</button>`;
}

function htmlRiepilogo(prev) {
  const t = totaliDi(prev);
  const riga = (et, val, cls = "") =>
    `<div class="row ${cls}" style="justify-content:space-between"><span>${et}</span><b>${val}</b></div>`;
  let html = `<h2>Riepilogo</h2><div class="stack">`;
  if (t.subtotali.man > 0 && t.subtotali.mat > 0) {
    html += riga('<span class="muted">di cui manodopera</span>', core.formatEuro(t.subtotali.man), "small");
    html += riga('<span class="muted">di cui materiali</span>', core.formatEuro(t.subtotali.mat), "small");
  }
  if (t.scontoImporto > 0)
    html += riga(`Sconto ${core.formatQta(t.scontoPerc)}%`, "- " + core.formatEuro(t.scontoImporto));
  html += riga(t.forfettario ? "Totale prestazioni" : "Imponibile", core.formatEuro(t.imponibile));
  if (!t.forfettario) for (const g of t.riepilogoIva) html += riga(`IVA ${g.aliquota}%`, core.formatEuro(g.imposta));
  if (t.bollo > 0) html += riga("Imposta di bollo", core.formatEuro(t.bollo));
  html += `<hr>` + riga("<b>Totale</b>", `<span class="big">${core.formatEuro(t.totale)}</span>`);
  if (t.acconto > 0) html += riga("Acconto", core.formatEuro(t.acconto)) + riga("Saldo", core.formatEuro(t.saldo));
  return html + `</div>`;
}

function aggiornaTotali() {
  const prev = state.corrente;
  if (!prev) return;
  const t = totaliDi(prev);
  $("#tot-valore").textContent = core.formatEuro(t.totale);
  t.righe.forEach((r, i) => {
    const el = $(`[data-importo="${i}"]`);
    if (el) el.textContent = core.formatEuro(r.importo);
  });
  $("#riepilogo").innerHTML = htmlRiepilogo(prev);
}

function rerenderRighe() {
  const prev = state.corrente;
  $("#righe").innerHTML =
    prev.righe.map((r, i) => htmlRiga(r, i)).join("") ||
    `<p class="muted small" style="margin:0">Nessuna voce. Aggiungine una dal listino, a mano o a voce.</p>`;
  $("#n-righe").textContent = `(${prev.righe.length})`;
  $$("#righe textarea").forEach(autoAltezza);
  aggiornaTotali();
}

function autoAltezza(el) {
  el.style.height = "auto";
  el.style.height = Math.max(el.scrollHeight + 3, 46) + "px";
}

const CAMPI_NUMERICI = new Set(["qta", "prezzo", "sconto", "iva", "scontoGlobale", "validitaGiorni", "acconto.valore"]);

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
  if (el.dataset.campo) {
    const campo = el.dataset.campo;
    const valore = CAMPI_NUMERICI.has(campo) ? core.parseNumero(el.value) : el.value;
    impostaPercorso(prev, campo, valore);
    if (campo === "stato" && valore === "accettato" && !prev.firma) toast("Segnato come accettato");
  } else if (el.dataset.r) {
    const i = Number(el.closest(".riga").dataset.i);
    const campo = el.dataset.r;
    prev.righe[i][campo] = CAMPI_NUMERICI.has(campo) ? core.parseNumero(el.value) : el.value;
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
  apriFoglio(
    `${titoloFoglio(esc(r.descrizione || "Voce"))}
    <div class="lista-azioni">
      ${i > 0 ? `<button data-action="riga-op" data-op="su" data-i="${i}">${ICONE.su} Sposta su</button>` : ""}
      ${i < prev.righe.length - 1 ? `<button data-action="riga-op" data-op="giu" data-i="${i}">${ICONE.giu} Sposta giù</button>` : ""}
      <button data-action="riga-op" data-op="duplica" data-i="${i}">${ICONE.copia} Duplica voce</button>
      <button data-action="riga-op" data-op="listino" data-i="${i}">${ICONE.listino} Salva nel mio listino</button>
      <button class="danger" data-action="riga-op" data-op="elimina" data-i="${i}">${ICONE.cestino} Elimina voce</button>
    </div>`,
  );
}

async function opRiga(op, i) {
  const prev = state.corrente;
  const righe = prev.righe;
  chiudiFoglio();
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
    };
    await db.salva("listino", voce);
    state.listino.push(voce);
    return toast("Salvata nel listino");
  }
  rerenderRighe();
  salvaDopo(prev);
}

function foglioListino() {
  const voci = [...state.listino].sort((a, b) => a.descrizione.localeCompare(b.descrizione, "it"));
  const m = trovaMestiere(state.azienda.mestiere);
  const htmlVoci = (filtro = "") => {
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
            <div class="corpo"><div>${esc(v.descrizione)}</div><div class="muted small">${v.tipo === "mat" ? "Materiale" : "Manodopera"} · ${esc(v.um)}</div></div>
            <div class="prezzo">${core.formatEuro(v.prezzo)}</div></button>`,
        )
        .join("") || `<p class="muted">Nessuna voce trovata.</p>`
    );
  };
  apriFoglio(
    `${titoloFoglio("Aggiungi dal listino")}
    <input type="search" id="cerca-listino" placeholder="Cerca nel listino">
    <div id="voci-listino" style="margin-top:6px">${htmlVoci()}</div>`,
    (f) => {
      $("#cerca-listino", f).addEventListener("input", (e) => {
        $("#voci-listino", f).innerHTML = htmlVoci(e.target.value);
      });
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
  apriFoglio(
    `${titoloFoglio("Azioni")}
    <div class="lista-azioni">
      <button data-action="scarica-pdf">${ICONE.scarica} Scarica PDF</button>
      <button data-action="duplica-preventivo">${ICONE.copia} Duplica preventivo</button>
      <button class="danger" data-action="elimina-preventivo">${ICONE.cestino} Elimina preventivo</button>
    </div>`,
  );
}

// ------------------------------------------------------------------
// Dettatura vocale
// ------------------------------------------------------------------
const Riconoscimento = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

function detta(suggerimento, onTesto) {
  if (!Riconoscimento) return toast("La dettatura non è disponibile su questo browser");
  const r = new Riconoscimento();
  r.lang = "it-IT";
  r.interimResults = true;
  r.continuous = false;
  let finale = "";
  let annullato = false;
  const f = apriFoglio(
    `${titoloFoglio("Sto ascoltando...")}
    <div class="row" style="gap:14px"><span class="mic ascolto">${ICONE.mic}</span><div id="parziale" class="muted">${esc(suggerimento)}</div></div>
    <div class="grid2" style="margin-top:16px"><button class="btn" data-action="detta-annulla">Annulla</button><button class="btn primary" data-action="detta-fine">Fatto</button></div>`,
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
      if (res.isFinal) finale += res[0].transcript;
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

// ------------------------------------------------------------------
// Firma
// ------------------------------------------------------------------
function foglioFirma() {
  if (!state.pro) return paywall("firma");
  const prev = state.corrente;
  const f = apriFoglio(
    `${titoloFoglio("Firma del cliente")}
    <p class="muted small" style="margin-top:-4px">Passa il telefono al cliente: firma con il dito nel riquadro.</p>
    <canvas class="firma" id="canvas-firma"></canvas>
    <div class="grid2" style="margin-top:10px">
      <input id="firma-nome" placeholder="Nome di chi firma" value="${esc(prev.cliente.nome)}">
      <input id="firma-luogo" placeholder="Luogo" value="${esc(prev.cliente.citta || state.azienda.citta || "")}">
    </div>
    <div class="grid2" style="margin-top:10px">
      <button class="btn" data-action="firma-cancella">Cancella</button>
      <button class="btn primary" data-action="firma-conferma">Conferma firma</button>
    </div>`,
  );
  const canvas = $("#canvas-firma", f);
  const ctx = canvas.getContext("2d");
  const dpr = Math.max(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.scale(dpr, dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0b1f4d";
  ctx.lineWidth = 2.6;
  let disegna = false;
  let tratti = 0;
  let ultimo = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener("pointerdown", (e) => {
    disegna = true;
    ultimo = pos(e);
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.arc(ultimo.x, ultimo.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!disegna) return;
    const p = pos(e);
    const medio = { x: (ultimo.x + p.x) / 2, y: (ultimo.y + p.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(ultimo.x, ultimo.y);
    ctx.quadraticCurveTo(ultimo.x, ultimo.y, medio.x, medio.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo = p;
    tratti++;
  });
  const fine = () => (disegna = false);
  canvas.addEventListener("pointerup", fine);
  canvas.addEventListener("pointercancel", fine);

  azioni["firma-cancella"] = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    tratti = 0;
  };
  azioni["firma-conferma"] = async () => {
    if (tratti < 5) return toast("Fai firmare il cliente nel riquadro");
    prev.firma = {
      img: canvas.toDataURL("image/png"),
      nome: $("#firma-nome").value.trim() || prev.cliente.nome,
      luogo: $("#firma-luogo").value.trim(),
      data: new Date().toISOString(),
    };
    prev.stato = "accettato";
    await salvaPreventivo(prev);
    traccia("Firma cliente");
    chiudiFoglio();
    $("#sezione-firma").innerHTML = htmlFirma(prev);
    $('[data-campo="stato"]').value = "accettato";
    toast("Firmato! Preventivo accettato");
  };
}

// ------------------------------------------------------------------
// PDF e invio
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

async function generaPdf(prev) {
  await caricaPdfLib();
  const { creaPdfBlob } = await import("./pdf.js");
  return creaPdfBlob({ prev, azienda: state.azienda, totali: totaliDi(prev), pro: state.pro, config: CONFIG });
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
    await salvaPreventivo(prev);
    const sel = $('[data-campo="stato"]');
    if (sel) sel.value = "inviato";
  }
}

async function invia() {
  const prev = state.corrente;
  if (!verificaPronto(prev) || !entroLimite(prev)) return;
  registraEsportazione(prev);
  let blob;
  try {
    blob = await generaPdf(prev);
  } catch (err) {
    return toast(err.message || "Errore nella creazione del PDF");
  }
  const nome = core.nomeFilePdf(prev);
  const file = new File([blob], nome, { type: "application/pdf" });
  const testo = core.testoWhatsApp(prev, state.azienda, totaliDi(prev));
  const puoCondividere = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  salvaClienteDa(prev);
  if (puoCondividere) {
    try {
      await navigator.share({ files: [file], title: nome, text: testo });
      await segnaInviato(prev);
      toast("Preventivo inviato");
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
      // Altri errori (es. attivazione utente scaduta): si passa al foglio manuale.
    }
  }
  foglioInvio(prev, blob, file, testo, puoCondividere);
}

function foglioInvio(prev, blob, file, testo, puoCondividere) {
  const tel = core.telefonoWhatsApp(prev.cliente.telefono);
  const wa = `https://wa.me/${tel}?text=${encodeURIComponent(testo)}`;
  const mail = `mailto:${encodeURIComponent(prev.cliente.email || "")}?subject=${encodeURIComponent(`Preventivo n. ${prev.numero}`)}&body=${encodeURIComponent(testo + "\n\n(Il preventivo è in allegato)")}`;
  apriFoglio(
    `${titoloFoglio("Invia il preventivo")}
    <div class="lista-azioni">
      ${puoCondividere ? `<button data-action="invio-condividi">${ICONE.condividi} Condividi PDF (WhatsApp, email...)</button>` : ""}
      <button data-action="invio-scarica">${ICONE.scarica} Scarica il PDF</button>
      <a href="${esc(wa)}" target="_blank" rel="noopener" data-action="invio-segna">${ICONE.whatsapp} Apri WhatsApp${tel ? "" : " (scegli il contatto)"}</a>
      <a href="${esc(mail)}" data-action="invio-segna">${ICONE.mail} Invia per email</a>
    </div>
    <p class="muted small">Dal computer: scarica il PDF e allegalo nella chat WhatsApp o nell'email.</p>`,
  );
  azioni["invio-condividi"] = async () => {
    try {
      await navigator.share({ files: [file], title: file.name, text: testo });
      await segnaInviato(prev);
      chiudiFoglio();
      toast("Preventivo inviato");
    } catch {
      /* annullato */
    }
  };
  azioni["invio-scarica"] = async () => {
    scaricaBlob(blob, file.name);
    await segnaInviato(prev);
  };
  azioni["invio-segna"] = () => segnaInviato(prev);
}

// ------------------------------------------------------------------
// Paywall e Pro
// ------------------------------------------------------------------
const VANTAGGI_PRO = [
  "Preventivi PDF illimitati",
  "Il tuo logo e i tuoi colori sul preventivo",
  "Firma del cliente sul telefono, direttamente in cantiere",
  'Niente scritta "Creato con PreventivoLampo"',
  "Listino prezzi, clienti e dettatura vocale senza limiti",
  "Assistenza prioritaria via email",
];

function paywall(motivo) {
  traccia("Paywall", { motivo });
  const mese = new Date().toLocaleDateString("it-IT", { month: "long" });
  const titoli = {
    limite: `Hai usato i ${CONFIG.pdfGratisAlMese} preventivi gratuiti di ${mese}`,
    firma: "La firma del cliente è una funzione Pro",
    logo: "Logo e colori sono funzioni Pro",
  };
  apriFoglio(
    `${titoloFoglio(titoli[motivo] || "Passa a Pro")}
    <p class="muted" style="margin-top:-4px">Basta <b>un lavoro in più al mese</b> per ripagare l'abbonamento per anni.</p>
    <ul class="vantaggi">${VANTAGGI_PRO.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>
    <a class="btn primary big block" href="#/pro" style="margin-top:16px">Vedi i piani da ${esc(CONFIG.prezzi.annuale.importo.replace(" €", ""))} €/anno</a>`,
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
      return `<div class="piano ${k === "annuale" ? "consigliato" : ""}">
        ${etichetta ? `<span class="etichetta">${esc(etichetta)}</span>` : ""}
        <div class="info"><div class="muted small" style="font-weight:700">${esc(nome)}</div>
          <div><span class="prezzo">${esc(p.importo)}</span> <span class="muted">${esc(p.periodo)}</span></div>
          ${p.nota ? `<div class="small" style="color:var(--ok);font-weight:700">${esc(p.nota)}</div>` : ""}</div>
        <button class="btn ${k === "annuale" ? "primary" : ""}" data-action="checkout" data-piano="${k}">Scegli</button>
      </div>`;
    })
    .join("");

  const statoLicenza = state.pro
    ? `<div class="banner ok"><div><b>Pro attivo</b>${lic.email ? ` · ${esc(lic.email)}` : ""}${lic.scadenza ? `<br><span class="small">Rinnovo/scadenza: ${esc(new Date(lic.scadenza).toLocaleDateString("it-IT"))}</span>` : ""}</div></div>
       ${CONFIG.portaleClienti ? `<a class="btn block" href="${esc(CONFIG.portaleClienti)}" target="_blank" rel="noopener">Gestisci abbonamento e fatture</a>` : ""}
       <button class="btn block danger" data-action="rimuovi-licenza">Rimuovi licenza da questo dispositivo</button>`
    : "";

  app().innerHTML = `
    <header class="topbar"><a class="back" href="#/" aria-label="Indietro">‹</a><h1>${state.pro ? "Il tuo piano" : "Passa a Pro"}</h1></header>
    <main class="pagina">
      ${q.get("acquisto") === "ok" ? `<div class="banner ok"><div><b>Grazie per l'acquisto!</b> Ti abbiamo inviato via email il <b>codice licenza</b>: incollalo qui sotto per attivare Pro.</div></div>` : ""}
      ${statoLicenza}
      ${
        state.pro
          ? ""
          : `
      <section class="card stack">
        <div class="row"><span class="badge pro">PRO</span><b>Tutto quello che serve per vincere più lavori</b></div>
        <ul class="vantaggi">${VANTAGGI_PRO.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>
      </section>
      <div class="piani">${htmlPiani}</div>
      <p class="muted small" style="text-align:center;margin:0">Prezzi IVA inclusa · Pagamento sicuro · Disdici quando vuoi con un clic</p>`
      }
      <section class="card stack">
        <h2>Hai un codice licenza?</h2>
        <input id="chiave" placeholder="Incolla qui il codice ricevuto via email" autocomplete="off" autocapitalize="characters" value="${esc(lic && !state.pro ? lic.chiave : "")}">
        <button class="btn primary block" data-action="attiva-licenza">Attiva Pro</button>
        <div id="esito-licenza" class="small"></div>
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
      toast("Pro attivato. Buon lavoro!");
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
    <header class="topbar"><h1>Clienti</h1><button class="btn small soft" data-action="cliente-nuovo">${ICONE.piu} Nuovo</button></header>
    <main class="pagina">
      ${lista.length ? `<input type="search" id="cerca-clienti" placeholder="Cerca cliente">` : ""}
      <div class="lista" id="lista-clienti">${htmlListaClienti(lista, conteggi, "")}</div>
    </main>`;
  const cerca = $("#cerca-clienti");
  if (cerca)
    cerca.addEventListener(
      "input",
      (e) => ($("#lista-clienti").innerHTML = htmlListaClienti(lista, conteggi, e.target.value)),
    );
}

function htmlListaClienti(lista, conteggi, filtro) {
  const f = filtro.trim().toLowerCase();
  const trovati = lista.filter((c) => !f || [c.nome, c.telefono, c.email, c.citta].join(" ").toLowerCase().includes(f));
  if (!lista.length) {
    return `<div class="card vuoto">${ICONE.clienti}<h3>Ancora nessun cliente</h3><p class="muted">I clienti vengono salvati in automatico quando crei un preventivo.</p></div>`;
  }
  return (
    trovati
      .map(
        (c) => `<button class="voce-lista" data-action="cliente-apri" data-id="${esc(c.id)}">
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
    `<input data-cli="${k}" type="${tipo}" placeholder="${ph}" value="${esc(c[k])}">`;
  apriFoglio(
    `${titoloFoglio(nuovo ? "Nuovo cliente" : esc(c.nome))}
    <div class="stack">
      ${campo("nome", "Nome e cognome o ragione sociale")}
      ${campo("telefono", "Telefono", "tel")}
      ${campo("email", "Email", "email")}
      ${campo("indirizzo", "Via e numero civico")}
      ${campo("citta", "CAP, città e provincia")}
      ${campo("cfpiva", "Codice fiscale o Partita IVA")}
      <textarea data-cli="note" rows="2" placeholder="Note interne (non compaiono nel preventivo)">${esc(c.note)}</textarea>
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
    toast("Cliente salvato");
  };
  azioni["cliente-preventivo"] = () => vai(`#/nuovo?cliente=${encodeURIComponent(c.id)}`);
  azioni["cliente-elimina"] = async () => {
    if (!confirm(`Eliminare ${c.nome}? I preventivi già fatti restano.`)) return;
    await db.elimina("clienti", c.id);
    state.clienti = state.clienti.filter((x) => x.id !== c.id);
    chiudiFoglio();
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
    <header class="topbar"><h1>Listino prezzi</h1><button class="btn small soft" data-action="voce-nuova">${ICONE.piu} Nuova</button></header>
    <main class="pagina">
      <p class="muted small" style="margin:0">Le voci che usi più spesso, con i tuoi prezzi. Nel preventivo le aggiungi con un tocco.</p>
      ${voci.length ? `<input type="search" id="cerca-voci" placeholder="Cerca voce">` : ""}
      <div class="card" style="padding:4px 14px" id="lista-voci">${htmlVoci(voci, "")}</div>
      <section class="card stack">
        <h2>Prezzi tipici per mestiere</h2>
        <p class="muted small" style="margin:0">Aggiunge al listino le voci più comuni con prezzi indicativi, da adattare ai tuoi.</p>
        <select id="mestiere-esempi">${MESTIERI.map((x) => `<option value="${x.id}" ${m && m.id === x.id ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select>
        <button class="btn soft block" data-action="carica-esempi-sel">Aggiungi al mio listino</button>
      </section>
    </main>`;
  const cerca = $("#cerca-voci");
  if (cerca) cerca.addEventListener("input", (e) => ($("#lista-voci").innerHTML = htmlVoci(voci, e.target.value)));
}

function htmlVoci(voci, filtro) {
  const f = filtro.trim().toLowerCase();
  if (!voci.length)
    return `<p class="muted">Il listino è vuoto. Aggiungi una voce o carica i prezzi tipici del tuo mestiere qui sotto.</p>`;
  return (
    voci
      .filter((v) => !f || v.descrizione.toLowerCase().includes(f))
      .map(
        (v) => `<button class="voce-listino" data-action="voce-apri" data-id="${esc(v.id)}">
          <div class="corpo"><div>${esc(v.descrizione)}</div><div class="muted small">${v.tipo === "mat" ? "Materiale" : "Manodopera"} · ${esc(v.um)}</div></div>
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
  };
  const nuova = !state.listino.some((x) => x.id === v.id);
  apriFoglio(
    `${titoloFoglio(nuova ? "Nuova voce" : "Modifica voce")}
    <div class="stack">
      <textarea id="v-desc" rows="2" placeholder="Descrizione">${esc(v.descrizione)}</textarea>
      <div class="grid2">
        <label class="campo">Prezzo €<input id="v-prezzo" inputmode="decimal" value="${numIn(v.prezzo, true)}" placeholder="0,00"></label>
        <label class="campo">Unità<select id="v-um">${core.UNITA.map((u) => `<option ${u === v.um ? "selected" : ""}>${u}</option>`).join("")}</select></label>
      </div>
      <select id="v-tipo"><option value="man" ${v.tipo !== "mat" ? "selected" : ""}>Manodopera</option><option value="mat" ${v.tipo === "mat" ? "selected" : ""}>Materiale / fornitura</option></select>
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
  const proBadge = state.pro ? "" : `<span class="badge pro">PRO</span>`;

  app().innerHTML = `
    <header class="topbar"><h1>Impostazioni</h1></header>
    <main class="pagina">
      <section class="card stack">
        <h2>Il tuo piano</h2>
        ${
          state.pro
            ? `<div class="row"><span class="badge pro">PRO</span><span>Attivo${state.licenza.email ? " · " + esc(state.licenza.email) : ""}</span><a class="btn small" style="margin-left:auto" href="#/pro">Gestisci</a></div>`
            : `<div class="row"><span>Gratuito · ${rimasti} PDF rimasti questo mese</span><a class="btn small primary" style="margin-left:auto" href="#/pro">Passa a Pro</a></div>`
        }
      </section>

      <section class="card stack">
        <h2>La tua impresa <span class="muted small dx">appare sul preventivo</span></h2>
        ${campo("ragioneSociale", "Nome impresa *", "es. Idraulica Rossi di Mario Rossi")}
        ${campo("indirizzo", "Indirizzo", "Via Roma 1")}
        <div class="grid3">${campo("cap", "CAP")}${campo("citta", "Città")}${campo("provincia", "Prov.", "MI")}</div>
        <div class="grid2 stack-mobile">${campo("piva", "Partita IVA")}${campo("cf", "Codice fiscale")}</div>
        <div class="grid2 stack-mobile">${campo("telefono", "Telefono", "", "tel")}${campo("email", "Email", "", "email")}</div>
        <div class="grid2 stack-mobile">${campo("pec", "PEC")}${campo("sito", "Sito web")}</div>
        <div class="grid2 stack-mobile">${campo("iban", "IBAN")}${campo("intestatarioIban", "Intestatario IBAN")}</div>
      </section>

      <section class="card stack">
        <h2>Logo e colore ${proBadge}</h2>
        <div class="row">
          ${a.logo ? `<img src="${esc(a.logo)}" alt="Logo" style="max-height:56px;max-width:140px;border-radius:8px;background:#fff;padding:4px">` : `<span class="muted small">Nessun logo</span>`}
          ${
            state.pro
              ? `<label class="btn small" style="margin-left:auto">Carica logo<input type="file" accept="image/*" id="file-logo" hidden></label>`
              : `<button class="btn small" style="margin-left:auto" data-action="paywall" data-motivo="logo">Carica logo</button>`
          }
          ${a.logo ? `<button class="btn small danger" data-action="rimuovi-logo">Rimuovi</button>` : ""}
        </div>
        ${
          state.pro
            ? `<label class="campo">Colore del preventivo<input type="color" data-az="colore" value="${esc(a.colore)}"></label>`
            : `<button class="btn block" data-action="paywall" data-motivo="logo">Scegli il colore del preventivo</button>`
        }
      </section>

      <section class="card stack">
        <h2>Fisco</h2>
        <label class="campo">Regime fiscale
          <select data-az="regime">
            <option value="ordinario" ${a.regime !== "forfettario" ? "selected" : ""}>Ordinario / semplificato (con IVA)</option>
            <option value="forfettario" ${a.regime === "forfettario" ? "selected" : ""}>Forfettario (senza IVA)</option>
          </select>
        </label>
        ${
          a.regime === "forfettario"
            ? `<label class="check"><input type="checkbox" data-az="addebitaBollo" ${a.addebitaBollo ? "checked" : ""}> Addebita al cliente il bollo da 2 € (sopra 77,47 €)</label>
             <label class="campo">Dicitura forfettario<textarea data-az="fraseForfettario" rows="3">${esc(a.fraseForfettario)}</textarea></label>`
            : `<label class="campo">IVA predefinita per le nuove voci
              <select data-az="ivaDefault">${core.ALIQUOTE_IVA.map((x) => `<option value="${x}" ${Number(a.ivaDefault) === x ? "selected" : ""}>${x}%</option>`).join("")}</select></label>`
        }
      </section>

      <section class="card stack">
        <h2>Preventivi</h2>
        <div class="grid2">${campo("prefisso", "Prefisso numero", "es. P-")}${campo("validitaGiorni", "Validità (giorni)", "30", "number")}</div>
        <label class="campo">Pagamento predefinito<textarea data-az="pagamento" rows="2">${esc(a.pagamento)}</textarea></label>
        <label class="campo">Condizioni predefinite<textarea data-az="condizioni" rows="4">${esc(a.condizioni)}</textarea></label>
      </section>

      <section class="card stack">
        <h2>App e dati</h2>
        ${state.installEvento ? `<button class="btn soft block" data-action="installa">Installa l'app sul telefono</button>` : ""}
        ${isIos && !standalone ? `<div class="banner info"><div>Per installare l'app su iPhone: tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>.</div></div>` : ""}
        <p class="muted small" style="margin:0">I tuoi dati restano solo su questo dispositivo. Fai un backup ogni tanto o prima di cambiare telefono.</p>
        <div class="grid2">
          <button class="btn" data-action="backup-esporta">${ICONE.scarica} Esporta backup</button>
          <label class="btn">Importa backup<input type="file" accept="application/json,.json" id="file-backup" hidden></label>
        </div>
        <button class="btn soft block" data-action="consiglia">${ICONE.condividi} Consiglia l'app a un collega</button>
        <div class="row wrap small" style="justify-content:center;gap:14px">
          <a href="privacy.html">Privacy</a><a href="termini.html">Termini</a><a href="mailto:${esc(CONFIG.emailSupporto)}">Assistenza</a>
        </div>
      </section>
    </main>`;

  $("#file-logo")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state.azienda.logo = await ridimensionaImmagine(file, 600, 300);
      await salvaAzienda();
      viewImpostazioni();
      toast("Logo salvato");
    } catch {
      toast("Immagine non valida");
    }
  });
  $("#file-backup").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dati = JSON.parse(await file.text());
      if (!confirm("Importando il backup sostituirai i dati attuali su questo dispositivo. Continuare?")) return;
      await db.importa(dati);
      await caricaTutto();
      toast("Backup importato");
      vai("#/");
    } catch (err) {
      toast(err.message || "File non valido");
    }
  });
}

function suInputImpostazioni(e) {
  const el = e.target;
  const k = el.dataset.az;
  if (!k) return;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (k === "ivaDefault" || k === "validitaGiorni") v = core.parseNumero(v);
  state.azienda[k] = v;
  salvaAziendaDopo();
  if (k === "regime" && e.type === "change") viewImpostazioni();
}

function ridimensionaImmagine(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scala = Math.min(1, maxW / img.width, maxH / img.height);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scala));
      c.height = Math.max(1, Math.round(img.height * scala));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Immagine non valida"));
    };
    img.src = url;
  });
}

// ------------------------------------------------------------------
// Benvenuto (primo avvio)
// ------------------------------------------------------------------
function viewBenvenuto() {
  const a = state.azienda;
  const scelto = a.mestiere || state.mestiereSuggerito || "";
  app().innerHTML = `
    <header class="topbar"><div class="brand">${ICONE.logo}<span>${esc(CONFIG.nomeProdotto)}</span></div></header>
    <main class="pagina">
      <div>
        <h1 style="font-size:26px;margin:4px 0 6px;letter-spacing:-0.02em">Preventivi professionali in 60 secondi</h1>
        <p class="muted" style="margin:0">Due domande e sei pronto. Niente registrazione: i dati restano sul tuo telefono.</p>
      </div>
      <section class="card stack">
        <h2>1. Che lavoro fai?</h2>
        <div class="griglia-mestieri">
          ${MESTIERI.map((m) => `<button class="chip ${scelto === m.id ? "on" : ""}" data-action="scegli-mestiere" data-m="${m.id}">${esc(m.nome)}</button>`).join("")}
          <button class="chip ${scelto === "altro" ? "on" : ""}" data-action="scegli-mestiere" data-m="altro">Altro</button>
        </div>
      </section>
      <section class="card stack">
        <h2>2. I tuoi dati sul preventivo</h2>
        <input id="b-nome" placeholder="Nome impresa (es. Idraulica Rossi)" value="${esc(a.ragioneSociale)}">
        <div class="grid2 stack-mobile">
          <input id="b-tel" type="tel" placeholder="Telefono" value="${esc(a.telefono)}">
          <input id="b-piva" placeholder="Partita IVA" value="${esc(a.piva)}">
        </div>
        <div class="grid2 stack-mobile">
          <input id="b-citta" placeholder="Città" value="${esc(a.citta)}">
          <input id="b-email" type="email" placeholder="Email" value="${esc(a.email)}">
        </div>
        <label class="campo">Come applichi l'IVA?
          <select id="b-iva">
            <option value="22">IVA 22%</option>
            <option value="10">IVA 10% (lavori su abitazioni)</option>
            <option value="forf">Regime forfettario (senza IVA)</option>
          </select>
        </label>
        <p class="muted small" style="margin:0">Puoi cambiare tutto quando vuoi da Impostazioni.</p>
      </section>
      <button class="btn primary big block" data-action="fine-benvenuto">${ICONE.fulmine} Crea il primo preventivo</button>
    </main>`;
  state.mestiereScelto = scelto;
}

async function fineBenvenuto() {
  const a = state.azienda;
  const nome = $("#b-nome").value.trim();
  if (!nome) {
    $("#b-nome").focus();
    return toast("Scrivi il nome della tua impresa");
  }
  a.ragioneSociale = nome;
  a.telefono = $("#b-tel").value.trim();
  a.piva = $("#b-piva").value.trim();
  a.citta = $("#b-citta").value.trim();
  a.email = $("#b-email").value.trim();
  const iva = $("#b-iva").value;
  if (iva === "forf") a.regime = "forfettario";
  else {
    a.regime = "ordinario";
    a.ivaDefault = Number(iva);
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
    viewLista();
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
  "menu-riga": (el) => menuRiga(Number(el.dataset.i)),
  "riga-op": (el) => opRiga(el.dataset.op, Number(el.dataset.i)),
  "tipo-riga": (el) => {
    const i = Number(el.dataset.i);
    state.corrente.righe[i].tipo = el.dataset.tipo;
    $$(`.riga[data-i="${i}"] .seg button`).forEach((b) => b.classList.toggle("on", b.dataset.tipo === el.dataset.tipo));
    aggiornaTotali();
    salvaDopo(state.corrente);
  },
  "aggiungi-riga": (el) => {
    const i = aggiungiRiga({ tipo: el.dataset.tipo || "man" });
    const t = $(`.riga[data-i="${i}"] textarea`);
    if (t) t.focus();
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
      iva: forfettario(state.corrente) ? 0 : (v.iva ?? ivaRiga(state.corrente)),
    });
    chiudiFoglio();
    toast("Voce aggiunta");
  },
  "carica-esempi": async (el) => {
    await caricaEsempi(el.dataset.m);
    foglioListino();
  },
  "carica-esempi-sel": async () => {
    await caricaEsempi($("#mestiere-esempi").value);
    viewListino();
    toast("Voci aggiunte al listino");
  },
  "detta-riga": () =>
    detta('Prova: "Sostituzione rubinetto 2 pezzi 85 euro"', (testo) => {
      const r = core.parseDettatura(testo);
      aggiungiRiga({ descrizione: r.descrizione, qta: r.qta, um: r.um, prezzo: r.prezzo });
      toast(r.prezzo ? "Voce aggiunta" : "Voce aggiunta: inserisci il prezzo");
    }),
  "detta-campo": (el) =>
    detta("Parla pure...", (testo) => {
      const campo = el.dataset.target;
      const input = $(`[data-campo="${campo}"]`);
      const valore = testo.charAt(0).toUpperCase() + testo.slice(1);
      input.value = input.value ? input.value + " " + valore : valore;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }),
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
      regime: state.azienda.regime,
      addebitaBollo: state.azienda.addebitaBollo,
      createdAt: Date.now(),
    };
    copia.righe = copia.righe.map((r) => ({ ...r, id: core.uid() }));
    await salvaPreventivo(copia);
    toast(`Creato il preventivo N. ${copia.numero}`);
    vai(`#/p/${copia.id}`);
  },
  "elimina-preventivo": async () => {
    const prev = state.corrente;
    if (!confirm(`Eliminare il preventivo N. ${prev.numero}?`)) return;
    clearTimeout(timerSalva);
    await db.elimina("preventivi", prev.id);
    state.preventivi = state.preventivi.filter((p) => p.id !== prev.id);
    state.corrente = null;
    vai("#/");
  },
  firma: () => foglioFirma(),
  "rimuovi-firma": async () => {
    if (!confirm("Rimuovere la firma del cliente?")) return;
    state.corrente.firma = null;
    await salvaPreventivo(state.corrente);
    $("#sezione-firma").innerHTML = htmlFirma(state.corrente);
  },
  anteprima: () => anteprima(),
  invia: () => invia(),
  checkout: (el) => {
    const url = CONFIG.checkout[el.dataset.piano];
    traccia("Checkout", { piano: el.dataset.piano });
    if (!url) return toast("Pagamenti non ancora configurati (config.js)");
    window.open(url, "_blank", "noopener");
  },
  "attiva-licenza": () => attivaLicenza(),
  "rimuovi-licenza": async () => {
    if (!confirm("Rimuovere la licenza Pro da questo dispositivo? Potrai riattivarla con lo stesso codice.")) return;
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
    const testo = `Uso ${CONFIG.nomeProdotto} per fare i preventivi dal telefono in un minuto e mandarli su WhatsApp. Provalo gratis:`;
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
    $$(".griglia-mestieri .chip").forEach((c) => c.classList.toggle("on", c.dataset.m === el.dataset.m));
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
  if (!state.corrente && (rotta().parti[0] || "") === "") viewLista();
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
  } catch (err) {
    app().innerHTML = `<main class="pagina"><div class="card"><h3>Impossibile aprire l'archivio</h3><p class="muted">Il browser blocca il salvataggio dei dati (forse sei in navigazione privata). Apri l'app in una finestra normale.</p></div></main>`;
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
