// Pagina del cliente. Apre due tipi di link:
// - il preventivo: il cliente sceglie le voci facoltative e la data di inizio, firma e rimanda
//   l'accettazione all'impresa; poi può versare subito l'acconto (QR, IBAN o link) e avvisare;
// - la richiesta di pagamento (sollecito): importo, dati del bonifico, QR e pulsante "Ho già pagato".
// Nessun dato lascia il telefono del cliente se non nei messaggi che il cliente stesso decide di inviare.
//
// Senza server l'impresa sa dell'accettazione solo quando il cliente le manda la conferma, e la pagina
// lo dice in modo onesto: dopo la firma l'unica azione è "Invia la conferma"; solo dopo il tocco
// (salvato come "inviata") compaiono il timbro "Accettato", il pagamento e i prossimi passi.
// Il cliente è spesso una persona anziana: si parla con il "Lei", testi grandi, un passo alla volta.
import { leggiLinkCliente, creaLinkConferma, creaLinkAvviso } from "./link.js";
import {
  calcolaTotali,
  formatEuro,
  formatNumero,
  formatQta,
  formatData,
  oggiISO,
  aggiungiGiorni,
  scadenzaDi,
  telefonoWhatsApp,
} from "./core.js";
import {
  payloadEpc,
  causale,
  ibanValido,
  ibanCompatto,
  testoAppuntamento,
  creaIcs,
  METODI,
  ORARI_FASCIA,
  normalizzaDisponibilita,
} from "./incassi.js";
import { svgQr } from "./qr.js";
import { creaPadFirma, decodificaTratti, disegnaTratti, trattiInPng } from "./firma.js";
import { $, $$, esc, toast, apriFoglio, chiudiFoglio, titoloFoglio, copiaTesto, vibra, avatar } from "./ui.js";
import { ICONE } from "./icone.js";
import { CONFIG } from "./config.js";

const BASE = new URL(".", location.href).href;
const app = () => $("#app");
// "Firma al tavolo": l'artigiano apre questa pagina sul suo telefono (accetta.html?presenta=1#...) e lo
// passa al cliente. Spariscono i passaggi che hanno senso solo sul telefono del cliente (contatti,
// invio della conferma, "Ho già pagato"), lo schermo resta acceso e dopo la firma il telefono torna
// all'artigiano, che registra l'accettazione nell'app.
const presenta = new URLSearchParams(location.search).has("presenta");

// Icone Lucide (licenza ISC) che servono solo qui: altoparlante, stop, dimensione del testo, ingrandisci.
const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  ascolta: svg(
    '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
  ),
  ferma: svg('<rect width="14" height="14" x="5" y="5" rx="2" />'),
  testo: svg(
    '<path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16" /><path d="M15.697 14h5.606" /><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" /><path d="M3.304 13h6.392" />',
  ),
  ingrandisci: svg('<path d="M15 3h6v6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /><path d="M9 21H3v-6" />'),
};

const stato = {
  tipo: "preventivo",
  prev: null,
  richiesta: null,
  hash: "",
  scelte: new Set(),
  data: "-1", // data di inizio scelta sulla pagina: indice in prev.disponibilita, "-1" = decidiamo insieme
  bozza: null, // firma in corso { nome, tratti, ok }: resta se il foglio si chiude e si riapre
  accettazione: null, // { link, nome, data, scelte, firma, appuntamento, pagamento, inviata }
  pagamento: null, // solo per le richieste di pagamento: { importo, metodo, nota, il, link, inviato }
  pad: null,
  pagatoOnline: false,
};

const memoria = {
  chiave: () => (stato.tipo === "pagamento" ? "pl-pagato-" : "pl-accettato-") + stato.hash,
  leggi() {
    try {
      return JSON.parse(localStorage.getItem(this.chiave()) || "null");
    } catch {
      return null;
    }
  },
  scrivi(v) {
    try {
      localStorage.setItem(this.chiave(), JSON.stringify(v));
    } catch {
      /* archiviazione non disponibile: la conferma resta valida in questa sessione */
    }
  },
};

// Preferenza di chi legge (solo una comodità): testo più grande.
const PREF_TESTO = "pl-cliente-testo-grande";
function leggiPref() {
  try {
    return localStorage.getItem(PREF_TESTO) === "1";
  } catch {
    return false;
  }
}
function scriviPref(v) {
  try {
    if (v) localStorage.setItem(PREF_TESTO, "1");
    else localStorage.removeItem(PREF_TESTO);
  } catch {
    /* non disponibile: vale per questa visita */
  }
}

const azienda = () => (stato.tipo === "pagamento" ? stato.richiesta.azienda : stato.prev.azienda);
const nomeAnticipo = (p) => (p.caparra ? "Caparra confirmatoria" : "Acconto");
const parolaAnticipo = (p) => (p.caparra ? "la caparra" : "l'acconto");
const riduciMovimento = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// "S.r.l." seguito dal punto della frase diventerebbe "S.r.l..".
const nomeSenzaPunto = (n) => String(n || "").replace(/\.+$/, "");
// Nome dell'impresa dentro una frase, con l'articolo giusto quando il nome manca.
const impresa = (a) => a.ragioneSociale || "l'impresa";
const aImpresa = (a) => (a.ragioneSociale ? `a ${a.ragioneSociale}` : "all'impresa");
const diImpresa = (a) => (a.ragioneSociale ? `di ${a.ragioneSociale}` : "dell'impresa");
const maiuscola = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
// Testo già passato da esc(): i numeri come "2026-008" non vanno a capo sul trattino.
const interi = (html) => html.replace(/((?:n\. )?[^\s;]*\d\w*(?:-\w+)+)/g, '<span class="nw">$1</span>');

// Date in parole, sempre in italiano e senza dipendere dal dispositivo: "6 novembre", "1° marzo 2027".
const MESI = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];
function partiData(iso) {
  const [a, m, g] = String(iso || "")
    .split("-")
    .map(Number);
  return a && m >= 1 && m <= 12 && g ? { a, m, g } : null;
}
function dataInParole(iso, { anno, parlato = false } = {}) {
  const d = partiData(iso);
  if (!d) return "";
  const conAnno = anno ?? d.a !== new Date().getFullYear();
  const giorno = d.g === 1 ? (parlato ? "primo" : "1°") : String(d.g);
  return `${giorno} ${MESI[d.m - 1]}${conAnno ? ` ${d.a}` : ""}`;
}
// "del 7 ottobre", "dell'8 ottobre", "al 6 novembre", "all'11 novembre", "il 3 marzo", "l'8 marzo".
function conPreposizione(prep, iso, opzioni) {
  const d = partiData(iso);
  if (!d) return "";
  const testo = dataInParole(iso, opzioni);
  if (d.g !== 8 && d.g !== 11) return `${prep} ${testo}`;
  return `${{ il: "l'", del: "dell'", al: "all'" }[prep] || `${prep} `}${testo}`;
}

// Colore dell'impresa: dalla luminanza relativa si sceglie il testo più leggibile sopra (bianco o scuro).
function luminanza(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
// Oltre L ≈ 0,2 il testo scuro contrasta più del bianco (è il punto in cui i due rapporti si equivalgono).
function stileAccento(colore) {
  if (!/^#[0-9a-f]{6}$/i.test(colore || "")) return "";
  return `--accento:${colore};--su-accento:${luminanza(colore) > 0.2 ? "var(--on-lampo)" : "var(--bianco)"}`;
}
// La barra di stato del telefono prende il colore dell'impresa, come la striscia in cima alla testata.
function coloreBarra(colore) {
  if (!/^#[0-9a-f]{6}$/i.test(colore || "")) return;
  for (const m of $$('meta[name="theme-color"]')) m.setAttribute("content", colore);
}

function prevConScelte() {
  const p = stato.prev;
  return { ...p, righe: p.righe.map((r, i) => (r.opzionale && stato.scelte.has(i) ? { ...r, opzionale: false } : r)) };
}

const totaliDi = (p) => calcolaTotali(p, { regime: stato.prev.regime, addebitaBollo: stato.prev.addebitaBollo });
const totali = () => totaliDi(prevConScelte());

// Quanto aumenta il totale (IVA compresa) aggiungendo una voce facoltativa: è il numero che conta per chi paga.
function aumentoDi(i) {
  const p = stato.prev;
  const base = totaliDi(p).totale;
  const con = totaliDi({ ...p, righe: p.righe.map((r, k) => (k === i ? { ...r, opzionale: false } : r)) }).totale;
  return Math.max(0, con - base);
}

function scaduto() {
  const s = scadenzaDi(stato.prev);
  return Boolean(s && s < oggiISO());
}

function linkWa(a, testo) {
  return `https://wa.me/${telefonoWhatsApp(a.telefono)}?text=${encodeURIComponent(testo)}`;
}
// Senza numero dell'impresa wa.me apre la scelta del contatto: va detto prima.
const avvisoSenzaNumero = (a) =>
  telefonoWhatsApp(a.telefono)
    ? ""
    : `<p class="cp-aiuto">Si aprirà WhatsApp: scelga «${esc(nomeSenzaPunto(impresa(a)))}» tra i contatti.</p>`;

function errore(messaggio) {
  document.title = "Link non valido";
  app().innerHTML = `<main class="pagina" style="padding-top:40px">
    <div class="card vuoto">
      <div class="illustrazione">${ICONE.link}</div>
      <h3>Non riesco ad aprire questo link</h3>
      <p>${esc(messaggio)}. Il link potrebbe essere stato tagliato durante l'invio: chieda a chi gliel'ha mandato di inviarlo di nuovo.</p>
    </div></main>`;
}

// ------------------------------------------------------------------
// Fogli dal basso: il tasto Indietro di Android li chiude invece di lasciare la pagina
// ------------------------------------------------------------------
let voceFoglio = false; // c'è una voce nella cronologia per il foglio aperto
let daIndietro = false;
let popDaIgnorare = 0;
function apriFoglioCliente(html, { allaChiusura, classe = "" } = {}) {
  const avevaVoce = voceFoglio;
  voceFoglio = false; // l'eventuale foglio già aperto lascia la sua voce a quello nuovo
  const f = apriFoglio(html, { classe });
  if (avevaVoce) voceFoglio = true;
  else
    try {
      history.pushState({ foglioCliente: 1 }, "");
      voceFoglio = true;
    } catch {
      /* cronologia non disponibile: il foglio si chiude comunque con la X */
    }
  f.parentElement._allaChiusura = () => {
    allaChiusura?.();
    if (voceFoglio && !daIndietro) {
      popDaIgnorare++;
      history.back();
    }
    voceFoglio = false;
  };
  return f;
}
window.addEventListener("popstate", () => {
  if (popDaIgnorare) {
    popDaIgnorare--;
    return;
  }
  if (!$("#foglio")) return;
  daIndietro = true;
  try {
    chiudiFoglio();
  } finally {
    daIndietro = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const grande = $(".cp-pad-grande");
  if (grande) grande._chiudi?.(false);
  else if ($("#foglio")) chiudiFoglio();
});

// ------------------------------------------------------------------
// Parti comuni
// ------------------------------------------------------------------
// Nella firma al tavolo: un'uscita sempre visibile per l'artigiano.
const esci = () =>
  presenta
    ? `<button class="icon-btn cp-esci" data-azione="esci-presenta" aria-label="Esci e torna all'app">${ICONE.chiudi}</button>`
    : "";
const classeTesta = (extra = "") => `cp-testa${extra ? ` ${extra}` : ""}${presenta ? " con-esci" : ""}`;

function rigaAzienda(a, { dati = true } = {}) {
  const sotto = [[a.indirizzo, a.citta].filter(Boolean).join(", "), a.piva ? `P.IVA ${a.piva}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `<div class="cp-azienda">${avatar(a.ragioneSociale || "?", "small")}<div><b>${esc(a.ragioneSociale || "Impresa")}</b>${dati && sotto ? `<div class="cp-azienda-dati">${esc(sotto)}</div>` : ""}</div></div>`;
}

function strumenti() {
  const zoom = window.CSS?.supports?.("zoom", "1.1");
  const grande = document.documentElement.classList.contains("testo-grande");
  const etichetta = stato.tipo === "pagamento" ? "Ascolti la richiesta" : "Ascolti il preventivo";
  return `<div class="cp-strumenti">
    ${sintesi() ? `<button class="cp-strumento" data-azione="ascolta" data-etichetta="${etichetta}" aria-pressed="false">${IC.ascolta}<span>${etichetta}</span></button>` : ""}
    ${zoom ? `<button class="cp-strumento" data-azione="testo" aria-pressed="${grande}">${IC.testo}<span>Testo più grande</span></button>` : ""}
  </div>`;
}

function sezioneContatti(a, testoWa, { risposte = null } = {}) {
  const tel = telefonoWhatsApp(a.telefono);
  if (presenta || (!tel && !a.telefono && !a.email)) return "";
  const altri = [
    a.telefono ? `<a class="btn" href="tel:${esc(a.telefono.replace(/\s/g, ""))}">${ICONE.telefono} Chiama</a>` : "",
    a.email ? `<a class="btn" href="mailto:${esc(a.email)}">${ICONE.mail} Email</a>` : "",
  ].filter(Boolean);
  return `<section class="card stack cp-contatti" aria-labelledby="cp-t-contatti">
      <h2 id="cp-t-contatti">Ha domande? Scriva ${esc(aImpresa(a))}</h2>
      ${tel ? `<a class="btn wa block" href="${esc(linkWa(a, testoWa))}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} WhatsApp</a>` : ""}
      ${altri.length ? `<div class="${altri.length > 1 ? "grid2" : "stack"}">${altri.join("")}</div>` : ""}
      ${
        tel && risposte
          ? `<div class="cp-risposte"><p class="cp-aiuto">Oppure risponda con un tocco:</p><div class="row wrap">${risposte
              .map(
                ([etichetta, testo]) =>
                  `<a class="btn small soft" href="${esc(linkWa(a, testo))}" target="_blank" rel="noopener noreferrer">${esc(etichetta)}</a>`,
              )
              .join("")}</div></div>`
          : ""
      }
    </section>`;
}

function piedeFiducia(a, { pagamento = false } = {}) {
  const chi = [nomeSenzaPunto(impresa(a)), nomeSenzaPunto(a.citta), a.piva ? `P.IVA ${a.piva}` : ""]
    .filter(Boolean)
    .join(", ");
  const prodotto = esc(CONFIG.nomeProdotto);
  return pagamento
    ? `<p class="cp-piede">Richiesta preparata da ${esc(chi)}, con l'app ${prodotto}. ${prodotto} non verifica chi invia i link né l'IBAN indicato: se ha dubbi, chiami l'impresa al numero che ha già in rubrica prima di pagare.</p>`
    : `<p class="cp-piede">Preventivo preparato da ${esc(chi)}, con l'app ${prodotto}. ${prodotto} non verifica chi invia i preventivi: se ha dubbi, chiami l'impresa prima di firmare o pagare.</p>`;
}

const marchio = (conMarchio, coda = "") =>
  conMarchio
    ? `<p class="cp-marchio">Creato con <a href="${esc(CONFIG.sito)}" target="_blank" rel="noopener">${esc(CONFIG.nomeProdotto)}</a>${coda}</p>`
    : "";

// Passi numerati: qui la sequenza è l'informazione (cosa è fatto, cosa manca).
function htmlPassi(passi) {
  return `<ol class="cp-passi">${passi
    .map(
      ({ testo, fase }, i) =>
        `<li class="${fase}"><span class="n" aria-hidden="true">${fase === "fatto" ? ICONE.check : i + 1}</span><span>${esc(testo)}${fase === "fatto" ? '<span class="vh"> (fatto)</span>' : fase === "ora" ? '<span class="vh"> (adesso)</span>' : ""}</span></li>`,
    )
    .join("")}</ol>`;
}

// ------------------------------------------------------------------
// Preventivo: voci e totali
// ------------------------------------------------------------------
function dettaglioVoce(r) {
  const parti = [];
  const unaVolta = r.qta === 1 && r.um === "cad";
  if (!unaVolta) parti.push(`${formatQta(r.qta)} ${r.um} × ${formatEuro(r.prezzo)}`);
  else if (r.sconto > 0) parti.push(formatEuro(r.prezzo));
  if (r.sconto > 0) parti.push(`sconto ${formatQta(r.sconto)}%`);
  return parti.length ? `<span class="cp-dett tnum">${esc(parti.join(" · "))}</span>` : "";
}

function htmlVoce(r) {
  return `<div class="cp-voce">
    <div class="corpo"><span class="d">${esc(r.descrizione || "Voce")}</span>${dettaglioVoce(r)}</div>
    <div class="imp tnum">${esc(formatEuro(r.importo))}</div></div>`;
}

function htmlRiepilogo(t) {
  const r = (et, v, cls = "") => `<div class="r ${cls}"><span>${et}</span><b>${v}</b></div>`;
  let h = "";
  if (t.scontoImporto > 0) h += r(`Sconto ${esc(formatQta(t.scontoPerc))}%`, "- " + esc(formatEuro(t.scontoImporto)));
  h += r(t.forfettario ? "Totale prestazioni" : "Totale senza IVA", esc(formatEuro(t.imponibile)));
  if (!t.forfettario) for (const g of t.riepilogoIva) h += r(`IVA ${esc(g.aliquota)}%`, esc(formatEuro(g.imposta)));
  if (t.bollo > 0) h += r("Imposta di bollo", esc(formatEuro(t.bollo)));
  h += r("<b>Totale</b>", `<span class="big">${esc(formatEuro(t.totale))}</span>`, "tot");
  if (t.acconto > 0)
    h +=
      r(`${nomeAnticipo(stato.prev)} alla firma`, esc(formatEuro(t.acconto))) +
      r(
        stato.prev.giorniSaldo > 0
          ? `Saldo entro ${stato.prev.giorniSaldo} giorni dalla fine lavori`
          : "Saldo a fine lavori",
        esc(formatEuro(t.saldo)),
      );
  return h;
}

const FRASE_CAPARRA_LEI =
  "L'acconto è una caparra confirmatoria (art. 1385 c.c.): se lei non rispetta l'accordo, l'impresa può trattenerla; se è l'impresa a non rispettarlo, lei può chiederne il doppio.";

const haCondizioni = (p, t) => Boolean(p.tempi || p.pagamento || p.note || (p.caparra && t.acconto > 0));

// Le condizioni che il cliente accetta firmando: aperte, salvo note molto lunghe.
function htmlCondizioni(p, t, { tutte = false } = {}) {
  const a = p.azienda;
  const blocco = (titolo, testo, cls = "") =>
    `<div class="cp-cond-riga"><h3>${titolo}</h3><p class="${cls}">${esc(testo)}</p></div>`;
  const note = p.note
    ? tutte || p.note.length <= 400
      ? blocco("Note", p.note, "cp-testo")
      : `<details class="cp-note"><summary>Legga le note e condizioni</summary><p class="cp-testo">${esc(p.note)}</p></details>`
    : "";
  return [
    p.tempi ? blocco("Tempi", p.tempi) : "",
    p.pagamento ? blocco("Pagamento", p.pagamento, "cp-testo") : "",
    p.caparra && t.acconto > 0 ? blocco("Caparra confirmatoria", FRASE_CAPARRA_LEI) : "",
    note,
    p.regime === "forfettario" && a.fraseForfettario ? `<p class="cp-fine">${esc(a.fraseForfettario)}</p>` : "",
  ].join("");
}

function aggiornaTotali() {
  const t = totali();
  $("#cp-riepilogo").innerHTML = htmlRiepilogo(t);
  const testo = formatEuro(t.totale);
  const barra = $("#cp-totale");
  const cambiato = !barra || barra.textContent !== testo;
  if (barra) barra.textContent = testo;
  const testa = $("#cp-totale-testa");
  if (testa) testa.textContent = testo;
  const acc = $("#cp-acconto-testa");
  if (acc) acc.textContent = formatEuro(t.acconto);
  if (!cambiato) return;
  const annuncio = $("#cp-annuncio");
  if (annuncio) annuncio.textContent = `Totale aggiornato: ${testo}`;
  // Un cenno sul totale, perché il numero è cambiato (nessun movimento con "riduci movimento").
  if (!riduciMovimento())
    for (const el of [$("#cp-totale"), testa].filter(Boolean))
      el.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], {
        duration: 250,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      });
}

// Date proposte ancora valide: quelle già passate non si possono scegliere. L'indice resta quello
// della lista completa, così la scelta non cambia se la mezzanotte passa mentre il cliente firma.
const dateValide = () => stato.prev.disponibilita.map((d, i) => ({ d, i })).filter(({ d }) => d.data >= oggiISO());

function dataSceltaSullaPagina() {
  const i = Number(stato.data);
  const d = Number.isInteger(i) && i >= 0 ? stato.prev.disponibilita[i] : null;
  return d && d.data >= oggiISO() ? d : null;
}

// ------------------------------------------------------------------
// Preventivo da accettare
// ------------------------------------------------------------------
function pagina() {
  const p = stato.prev;
  const a = p.azienda;
  const v = p.variante;
  const t = totali();
  const s = scadenzaDi(p);
  const scad = scaduto();
  const tel = telefonoWhatsApp(a.telefono);
  document.title = `Preventivo ${p.numero} - ${a.ragioneSociale || "Preventivo"}`;
  coloreBarra(a.colore);
  const opz = p.righe.map((r, i) => ({ r, i })).filter((x) => x.r.opzionale);
  const tutte = calcolaTotali(p, { regime: p.regime, addebitaBollo: p.addebitaBollo });
  const date = scad ? [] : dateValide();
  const passi = presenta
    ? [
        { testo: "Controlli lavori e prezzo", fase: "ora" },
        { testo: "Firmi con il dito", fase: "poi" },
        { testo: `Ridia il telefono ${aImpresa(a)}`, fase: "poi" },
      ]
    : [
        { testo: "Controlli lavori e prezzo", fase: "ora" },
        { testo: "Firmi con il dito", fase: "poi" },
        { testo: `Invii la conferma ${aImpresa(a)}`, fase: "poi" },
        ...(t.acconto > 0 ? [{ testo: `Versi ${parolaAnticipo(p)}`, fase: "poi" }] : []),
      ];
  const testoScaduto = `Buongiorno, il preventivo n. ${p.numero} è scaduto il ${s ? formatData(s) : ""}: può aggiornarlo?`;

  app().innerHTML = `
    <header class="${classeTesta()}" style="${stileAccento(a.colore)}">
      ${esci()}${rigaAzienda(a)}
      <h1>${esc(p.oggetto || (v ? "Lavori extra" : "Preventivo"))}</h1>
      ${v ? `<p class="cp-meta cp-variante">Lavori extra del preventivo n. ${esc(v.numero)}${v.data ? ` del ${esc(formatData(v.data))}` : ""}</p>` : ""}
      <div class="cp-prezzo"><b id="cp-totale-testa">${esc(formatEuro(t.totale))}</b><span>${p.regime === "forfettario" ? "totale" : "IVA inclusa"}</span></div>
      ${
        scad
          ? `<p class="cp-sotto"><span class="badge rifiutato">Scaduto il ${esc(dataInParole(s))}</span></p>`
          : t.acconto > 0 || s
            ? `<p class="cp-sotto">${t.acconto > 0 ? `<span>${nomeAnticipo(p)} alla firma <b class="tnum" id="cp-acconto-testa">${esc(formatEuro(t.acconto))}</b>${s ? " ·" : ""}</span> ` : ""}${s ? `<span>Valido fino ${esc(conPreposizione("al", s))}</span>` : ""}</p>`
            : ""
      }
      <p class="cp-meta">Preventivo n. ${esc(p.numero)} ${esc(conPreposizione("del", p.data, { anno: true }))}${p.cliente.nome ? `<br>Per ${esc(p.cliente.nome)}${p.luogo ? ` · ${esc(p.luogo)}` : ""}` : ""}</p>
      ${strumenti()}
    </header>
    <main class="pagina cp-corpo">
      ${
        scad
          ? `<div class="banner warn"><span class="ico">${ICONE.orologio}</span><div>Questo preventivo è scaduto ${esc(conPreposizione("il", s))}: prezzi e date potrebbero essere cambiati. Può chiedere ${esc(aImpresa(a))} di aggiornarlo.</div></div>`
          : `<div class="cp-intro"><p>${esc(maiuscola(impresa(a)))} ${presenta ? "le propone" : "le ha inviato"} questo preventivo. Lo controlli con calma: se le va bene, può firmarlo qui con il dito. Ci vogliono un paio di minuti.</p>${htmlPassi(passi)}</div>`
      }
      ${v ? `<p class="cp-nota-variante">Sono lavori in più rispetto al preventivo che ha già firmato: per il resto valgono le condizioni concordate.</p>` : ""}
      <section class="card cp-doc" aria-labelledby="cp-t-lavori">
        <h2 id="cp-t-lavori">Lavori compresi</h2>
        <div class="cp-voci">${tutte.righe.map(htmlVoce).join("") || `<p class="cp-aiuto">Nessuna voce.</p>`}</div>
        ${
          opz.length
            ? `<div class="cp-sez" role="group" aria-labelledby="cp-t-opz">
          <h2 id="cp-t-opz">Può aggiungere anche</h2>
          <p class="cp-aiuto">Lavori in più che può scegliere: il totale si aggiorna da solo.</p>
          ${opz
            .map(({ r, i }) => {
              const piu = formatEuro(aumentoDi(i));
              return `<label class="cp-opz">
            <span class="corpo"><span class="d">${esc(r.descrizione || "Voce")}</span>${dettaglioVoce(r)}</span>
            <span class="cp-opz-dx">
              <span class="cp-piu"><b class="tnum">+ ${esc(piu)}</b>${p.regime === "forfettario" ? "" : "<small>IVA inclusa</small>"}</span>
              <input type="checkbox" class="cp-opz-input" data-opz="${i}" ${stato.scelte.has(i) ? "checked" : ""} ${scad ? "disabled" : ""} aria-label="Aggiungi ${esc(r.descrizione || "voce")}, più ${esc(piu)}">
              <span class="cp-aggiungi" aria-hidden="true"><span class="no">${ICONE.piu}Aggiungi</span><span class="si">${ICONE.check}Aggiunto</span></span>
            </span>
          </label>`;
            })
            .join("")}
        </div>`
            : ""
        }
        <div class="cp-sez riepilogo" id="cp-riepilogo">${htmlRiepilogo(t)}</div>
        ${haCondizioni(p, t) ? `<div class="cp-sez cp-cond"><h2>Condizioni</h2>${htmlCondizioni(p, t)}</div>` : ""}
        <div class="cp-sez cp-stampa"><button class="cp-link" data-azione="pdf">${ICONE.scarica}<span>Scarichi il preventivo in PDF da stampare</span></button></div>
      </section>
      ${
        date.length
          ? `<section class="card cp-date" id="cp-date" aria-labelledby="cp-t-date">
        <h2 id="cp-t-date">Quando preferisce iniziare?</h2>
        <p class="cp-aiuto">Scelga un giorno tra quelli proposti da ${esc(nomeSenzaPunto(impresa(a)))}: lo confermerà quando riceve la firma.</p>
        <div class="scelta" role="radiogroup" aria-labelledby="cp-t-date">
          ${date.map(({ d, i }) => `<label><input type="radio" name="acc-data" value="${i}" ${stato.data === String(i) ? "checked" : ""}><span>${esc(maiuscola(testoAppuntamento(d)))}</span></label>`).join("")}
          <label><input type="radio" name="acc-data" value="-1" ${dataSceltaSullaPagina() ? "" : "checked"}><span>Decidiamo insieme al telefono<small>${esc(maiuscola(impresa(a)))} la chiamerà per fissare la data</small></span></label>
        </div>
      </section>`
          : ""
      }
      ${sezioneContatti(a, `Buongiorno, ho una domanda sul preventivo n. ${p.numero}.`, {
        risposte: scad
          ? null
          : [
              ["Vorrei cambiare qualcosa", `Buongiorno, sul preventivo n. ${p.numero} vorrei cambiare: `],
              ["Non mi interessa, grazie", `Buongiorno, per ora non procedo con il preventivo n. ${p.numero}. Grazie.`],
            ],
      })}
      ${piedeFiducia(a)}
      ${marchio(p.conMarchio, " · preventivi dal telefono in 60 secondi")}
      <p class="vh" id="cp-annuncio" aria-live="polite"></p>
    </main>
    <footer class="barra-totale cp-barra">
      ${
        scad
          ? presenta
            ? `<p class="cp-aiuto">Il preventivo è scaduto: va aggiornato prima della firma.</p>`
            : tel
              ? `<a class="btn wa big block" href="${esc(linkWa(a, testoScaduto))}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} Chiedo un preventivo aggiornato</a>`
              : a.email
                ? `<a class="btn big block" href="mailto:${esc(a.email)}?subject=${encodeURIComponent(`Preventivo n. ${p.numero}`)}&body=${encodeURIComponent(testoScaduto)}">${ICONE.mail} Chiedo un preventivo aggiornato</a>`
                : `<p class="cp-aiuto">Chieda ${esc(aImpresa(a))} un preventivo aggiornato.</p>`
          : `<div class="tot"><div class="cp-barra-et">${p.regime === "forfettario" ? "Totale" : "Totale IVA inclusa"}</div><div class="big" id="cp-totale">${esc(formatEuro(t.totale))}</div></div>
      <button class="btn primary big" data-azione="accetta" aria-label="Accetta e firma">${ICONE.firma}<span>Accetta e firma</span></button>`
      }
    </footer>`;
  $$("[data-opz]").forEach((el) =>
    el.addEventListener("change", () => {
      const i = Number(el.dataset.opz);
      if (el.checked) stato.scelte.add(i);
      else stato.scelte.delete(i);
      vibra();
      aggiornaTotali();
    }),
  );
  $$('input[name="acc-data"]').forEach((el) =>
    el.addEventListener("change", () => {
      if (el.checked) stato.data = el.value;
    }),
  );
}

// ------------------------------------------------------------------
// Firma
// ------------------------------------------------------------------
function mostraErrore(campo, msg) {
  const box = $(`#err-${campo}`);
  if (!box) return;
  box.innerHTML = msg ? `${ICONE.attenzione}<span>${esc(msg)}</span>` : "";
  box.hidden = !msg;
  if (campo === "nome") $("#acc-nome")?.setAttribute("aria-invalid", msg ? "true" : "false");
  if (campo === "firma") $(".cp-firma .cp-pad")?.classList.toggle("errore", Boolean(msg));
  if (campo === "ok") $(".cp-consenso")?.classList.toggle("errore", Boolean(msg));
}

function foglioFirma() {
  if (scaduto()) return;
  const p = stato.prev;
  const a = p.azienda;
  const v = p.variante;
  const t = totali();
  const b = stato.bozza || (stato.bozza = { nome: p.cliente.nome || "", tratti: [], ok: false });
  const n = stato.scelte.size;
  const sotto = [
    `N. ${p.numero}`,
    `Totale ${formatEuro(t.totale)}`,
    t.acconto > 0 ? `${p.caparra ? "Caparra" : "Acconto"} ${formatEuro(t.acconto)}` : "",
    n ? (n === 1 ? "1 lavoro in più aggiunto" : `${n} lavori in più aggiunti`) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const cosa = interi(
    v ? `i lavori extra al preventivo n. ${esc(v.numero)} ${esc(diImpresa(a))}` : `il preventivo ${esc(diImpresa(a))}`,
  );
  const date = dateValide();
  const data = dataSceltaSullaPagina();
  // Prima ciò che conta (cosa si firma e la firma), in fondo il riepilogo della data: così il riquadro
  // della firma si vede subito anche sui telefoni piccoli, sopra il pulsante fisso.
  const f = apriFoglioCliente(
    `${titoloFoglio(v ? "Firmi i lavori extra" : "Firmi il preventivo", interi(esc(sotto)))}
    <div class="stack cp-firma">
      <p class="cp-dichiarazione">Firmando accetta ${cosa}: lavori, prezzi e condizioni${t.acconto > 0 ? `, con ${p.caparra ? "la caparra" : "l'acconto"} da versare alla firma` : ""}. Potrà scaricare subito una copia firmata in PDF.</p>
      ${haCondizioni(p, t) ? `<details class="cp-rileggi"><summary>Rilegga le condizioni</summary><div class="cp-cond">${htmlCondizioni(p, t, { tutte: true })}</div></details>` : ""}
      <label class="campo">Nome e cognome di chi firma
        <input id="acc-nome" autocomplete="name" value="${esc(b.nome)}" data-no-focus="1" aria-describedby="err-nome">
      </label>
      <p class="cp-errore" id="err-nome" role="alert" hidden></p>
      <div class="cp-firma-blocco">
        <div class="cp-firma-testa"><span class="cp-etichetta">Firmi con il dito nel riquadro</span><button class="btn ghost small" data-azione="cancella-firma" disabled>Rifai la firma</button></div>
        <div class="cp-pad">
          <canvas class="firma" id="acc-firma" aria-label="Riquadro per la firma" aria-describedby="err-firma"></canvas>
          <span class="cp-pad-linea" aria-hidden="true"></span>
          <span class="cp-pad-invito" aria-hidden="true">${ICONE.chiudi}Firmi qui</span>
        </div>
        <p class="cp-errore" id="err-firma" role="alert" hidden></p>
        <button class="cp-link cp-ingrandisci" data-azione="firma-grande">${IC.ingrandisci}<span>Riquadro più grande</span></button>
      </div>
      <label class="cp-consenso"><input type="checkbox" id="acc-ok" ${b.ok ? "checked" : ""} aria-describedby="err-ok"><span>Ho letto e accetto ${v ? "i lavori extra" : "il preventivo"} e le condizioni</span></label>
      <p class="cp-errore" id="err-ok" role="alert" hidden></p>
      ${
        date.length
          ? `<div class="cp-data-scelta">${ICONE.calendario}<div><span class="et">Inizio lavori</span><b>${esc(data ? maiuscola(testoAppuntamento(data)) : "Decidiamo insieme al telefono")}</b></div><button class="btn small soft" data-azione="cambia-data">Cambia</button></div>`
          : ""
      }
      <div class="cp-foglio-piede"><button class="btn primary big block" data-azione="conferma">${ICONE.firma} Firmo e accetto</button></div>
    </div>`,
    {
      classe: "cp-foglio-firma",
      allaChiusura: () => {
        if (stato.bozza && stato.pad) stato.bozza.tratti = stato.pad.tratti();
        stato.pad?.distruggi();
        stato.pad = null;
      },
    },
  );
  const canvas = $("#acc-firma", f);
  const box = canvas.parentElement;
  const aggiornaPad = () => {
    const tratti = stato.pad ? stato.pad.tratti() : [];
    if (stato.bozza) stato.bozza.tratti = tratti;
    box.classList.toggle("con-firma", tratti.length > 0);
    const rifai = $('[data-azione="cancella-firma"]', f);
    if (rifai) rifai.disabled = tratti.length === 0;
    if (stato.pad?.valida()) mostraErrore("firma", "");
  };
  canvas.addEventListener("pointerdown", () => box.classList.add("con-firma"));
  stato.pad = creaPadFirma(canvas, {
    tratti: b.tratti,
    colore: () => window.getComputedStyle(canvas).color,
    alCambio: aggiornaPad,
  });
  aggiornaPad();
  $("#acc-nome", f).addEventListener("input", (e) => {
    b.nome = e.target.value;
    if (b.nome.trim().length >= 2) mostraErrore("nome", "");
  });
  $("#acc-ok", f).addEventListener("change", (e) => {
    b.ok = e.target.checked;
    if (b.ok) mostraErrore("ok", "");
  });
}

// Riquadro a tutto schermo: con il telefono in orizzontale c'è molto più spazio per firmare.
async function firmaGrande() {
  if (!stato.pad || $(".cp-pad-grande")) return;
  const strato = document.createElement("div");
  strato.className = "cp-pad-grande";
  strato.setAttribute("role", "dialog");
  strato.setAttribute("aria-modal", "true");
  strato.setAttribute("aria-label", "Firma nel riquadro grande");
  strato.innerHTML = `
    <div class="cp-pg-testa"><b>Firmi nel riquadro</b><span>Se può, giri il telefono in orizzontale: avrà più spazio.</span></div>
    <div class="cp-pad"><canvas class="firma" aria-label="Riquadro grande per la firma"></canvas><span class="cp-pad-linea" aria-hidden="true"></span><span class="cp-pad-invito" aria-hidden="true">${ICONE.chiudi}Firmi qui</span></div>
    <div class="cp-pg-azioni"><button class="btn" data-pg="rifai">Rifai la firma</button><button class="btn primary" data-pg="fatto">${ICONE.check} Fatto</button></div>`;
  document.body.appendChild(strato);
  const canvas = $("canvas", strato);
  const box = canvas.parentElement;
  const grande = creaPadFirma(canvas, {
    tratti: stato.pad.tratti(),
    colore: () => window.getComputedStyle(canvas).color,
    alCambio: () => box.classList.toggle("con-firma", grande.tratti().length > 0),
  });
  box.classList.toggle("con-firma", grande.tratti().length > 0);
  canvas.addEventListener("pointerdown", () => box.classList.add("con-firma"));
  strato._chiudi = (salva) => {
    if (salva && stato.pad) stato.pad.imposta(grande.tratti());
    grande.distruggi();
    strato.remove();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  strato.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pg]");
    if (!b) return;
    if (b.dataset.pg === "rifai") {
      grande.cancella();
      box.classList.remove("con-firma");
    } else strato._chiudi(true);
  });
  // Su Android si può passare a schermo intero e girare lo schermo; altrove resta il consiglio.
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    await window.screen?.orientation?.lock?.("landscape");
  } catch {
    /* non supportato (iPhone, computer): il riquadro si adatta quando il telefono viene girato */
  }
}

let confermaInCorso = false;
async function conferma() {
  if (confermaInCorso) return; // doppio tocco
  const p = stato.prev;
  const nome = $("#acc-nome").value.trim();
  const tratti = stato.pad?.tratti() || [];
  const errNome = nome.length < 2 ? "Scriva il suo nome e cognome" : "";
  const errFirma = !tratti.length
    ? "Firmi nel riquadro bianco con il dito"
    : !stato.pad.valida()
      ? "La firma è troppo corta: la faccia per intero, come su un foglio"
      : "";
  const errOk = $("#acc-ok").checked ? "" : "Tocchi la casella per confermare che accetta";
  mostraErrore("nome", errNome);
  mostraErrore("firma", errFirma);
  mostraErrore("ok", errOk);
  if (errNome || errFirma || errOk) {
    const primo = errNome ? $("#acc-nome") : errFirma ? $("#acc-firma") : $("#acc-ok");
    primo.scrollIntoView({ block: "center", behavior: riduciMovimento() ? "auto" : "smooth" });
    if (primo.tagName === "INPUT") primo.focus({ preventScroll: true });
    vibra(20);
    return;
  }
  confermaInCorso = true;
  try {
    const scelte = [...stato.scelte].sort((x, y) => x - y);
    const firma = stato.pad.codificata();
    const appuntamento = dataSceltaSullaPagina();
    const link = await creaLinkConferma(BASE, {
      id: p.id,
      numero: p.numero,
      hash: stato.hash,
      scelte,
      descrizioni: scelte.map((i) => p.righe[i].descrizione),
      nome,
      firma,
      appuntamento,
      sulPosto: presenta,
    });
    stato.accettazione = {
      link,
      nome,
      data: new Date().toISOString(),
      scelte,
      firma,
      appuntamento,
      pagamento: null,
      inviata: null,
    };
    chiudiFoglio();
    stato.bozza = null;
    // Al tavolo il telefono è dell'artigiano: non si segna come "già accettato" in questo browser.
    if (presenta) return consegna();
    memoria.scrivi(stato.accettazione);
    vibra(30);
    successo();
  } finally {
    confermaInCorso = false;
  }
}

function dataScelta() {
  const d = stato.accettazione?.appuntamento;
  return d ? normalizzaDisponibilita([d])[0] || null : null;
}

function testoConferma() {
  const p = stato.prev;
  const t = totali();
  const aggiunte = stato.accettazione.scelte.map((i) => p.righe[i]?.descrizione).filter(Boolean);
  const data = dataScelta();
  const inizio = p.variante
    ? `Buongiorno, ho accettato i lavori extra al preventivo n. ${p.variante.numero} (n. ${p.numero}) per ${formatEuro(t.totale)}.`
    : `Buongiorno, ho accettato il preventivo n. ${p.numero}${p.oggetto ? ` "${p.oggetto}"` : ""} per un totale di ${formatEuro(t.totale)}.`;
  return (
    inizio +
    (aggiunte.length ? ` Ho aggiunto: ${aggiunte.join(", ")}.` : "") +
    (data ? ` Per iniziare scelgo: ${testoAppuntamento(data)}.` : "") +
    `\nEcco la conferma con la mia firma: ${stato.accettazione.link}`
  );
}

// ------------------------------------------------------------------
// Dopo la firma: prima la conferma da inviare; inviata, il timbro, il pagamento e i prossimi passi
// ------------------------------------------------------------------
let attesaRitorno = false;
function segnaInviata() {
  const acc = stato.accettazione;
  if (!acc || acc.inviata) return;
  acc.inviata = Date.now();
  memoria.scrivi(acc);
  attesaRitorno = true;
  // WhatsApp di solito copre la pagina: si cambia quando il cliente torna. Se la pagina resta
  // visibile (computer, finestra bloccata) si cambia dopo un attimo.
  setTimeout(() => {
    if (document.visibilityState === "visible") mostraInviata();
  }, 1200);
}
function mostraInviata() {
  if (!attesaRitorno) return;
  attesaRitorno = false;
  if (stato.tipo === "preventivo" && stato.accettazione) successo({ anima: true });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && attesaRitorno) setTimeout(mostraInviata, 150);
});

// La firma in un'immagine: inchiostro blu penna sulla "carta" bianca della ricevuta.
function immagineFirma(firma) {
  try {
    const c = document.createElement("canvas");
    c.width = 500;
    c.height = 200;
    disegnaTratti(c.getContext("2d"), decodificaTratti(firma), c.width, c.height, "#2445b0");
    return c.toDataURL("image/png");
  } catch {
    return "";
  }
}

function htmlRicevuta({ conPdf }) {
  const p = stato.prev;
  const acc = stato.accettazione;
  const t = totali();
  const data = dataScelta();
  const aggiunte = acc.scelte.map((i) => p.righe[i]?.descrizione).filter(Boolean);
  const img = immagineFirma(acc.firma);
  const riga = (et, v) => `<div class="cp-riga"><span>${et}</span><b>${v}</b></div>`;
  return `<section class="card cp-ricevuta" aria-labelledby="cp-t-ricevuta">
      <h2 id="cp-t-ricevuta">${p.variante ? "I lavori extra che ha firmato" : "Il preventivo che ha firmato"}</h2>
      <div class="cp-righe">
        ${riga("Preventivo", `n. ${esc(p.numero)}${p.oggetto ? ` · ${esc(p.oggetto)}` : ""}`)}
        ${p.variante ? riga("Lavori extra del", `preventivo n. ${esc(p.variante.numero)}`) : ""}
        ${riga("Totale", `<span class="tnum">${esc(formatEuro(t.totale))}</span>`)}
        ${aggiunte.length ? riga(aggiunte.length === 1 ? "Lavoro in più" : "Lavori in più", esc(aggiunte.join(", "))) : ""}
        ${t.acconto > 0 ? riga(`${nomeAnticipo(p)} alla firma`, `<span class="tnum">${esc(formatEuro(t.acconto))}</span>`) : ""}
        ${p.disponibilita.length || data ? riga("Inizio lavori", data ? esc(maiuscola(testoAppuntamento(data))) : "Da decidere insieme al telefono") : ""}
        ${riga("Firmato da", `${esc(acc.nome)}, ${esc(dataInParole(oggiISO(new Date(acc.data)), { anno: true }))}`)}
      </div>
      ${img ? `<img class="cp-firma-img" src="${img}" alt="Firma di ${esc(acc.nome)}">` : ""}
      ${conPdf ? `<button class="cp-link" data-azione="pdf">${ICONE.scarica}<span>Scarica il preventivo firmato (PDF)</span></button>` : ""}
    </section>`;
}

function successo({ anima = false } = {}) {
  const p = stato.prev;
  const a = p.azienda;
  const acc = stato.accettazione;
  stato.scelte = new Set(acc.scelte);
  coloreBarra(a.colore);
  window.scrollTo(0, 0);
  const testata = `<header class="cp-testa breve" style="${stileAccento(a.colore)}">${rigaAzienda(a, { dati: false })}</header>`;
  app().innerHTML = testata + (acc.inviata ? htmlInviata(anima) : htmlDaInviare());
}

// Firma al tavolo, dopo la firma: il cliente ridà il telefono e l'artigiano registra la firma nell'app.
function consegna() {
  const p = stato.prev;
  const a = p.azienda;
  const acc = stato.accettazione;
  stato.scelte = new Set(acc.scelte);
  document.title = `Firmato - Preventivo ${p.numero}`;
  window.scrollTo(0, 0);
  vibra(30);
  const nome = nomeSenzaPunto(impresa(a));
  app().innerHTML = `
    <header class="cp-testa breve" style="${stileAccento(a.colore)}">${rigaAzienda(a, { dati: false })}</header>
    <main class="pagina cp-successo cp-consegna">
      <div class="cp-timbro-riga"><span class="timbro anima">Accettato<small class="tnum">${esc(formatData(oggiISO(new Date(acc.data))))}</small></span></div>
      <h1>Fatto, grazie ${esc(acc.nome)}!</h1>
      <p class="cp-lead">Ora ridia il telefono ${esc(aImpresa(a))}.</p>
      <a class="btn primary big block" data-azione="registra-qui" href="${esc(acc.link)}">${ICONE.check} Sono ${esc(a.ragioneSociale ? nome : "l'impresa")}: registra la firma</a>
      ${htmlRicevuta({ conPdf: false })}
    </main>`;
}

function htmlDaInviare() {
  const p = stato.prev;
  const a = p.azienda;
  const t = totali();
  const testo = testoConferma();
  document.title = `Invii la conferma - Preventivo ${p.numero}`;
  const passi = [
    { testo: "Controllato il preventivo", fase: "fatto" },
    { testo: "Firmato", fase: "fatto" },
    { testo: `Invii la conferma ${aImpresa(a)}`, fase: "ora" },
    ...(t.acconto > 0 ? [{ testo: `Versi ${parolaAnticipo(p)} di ${formatEuro(t.acconto)}`, fase: "poi" }] : []),
  ];
  return `
    <main class="pagina cp-successo cp-da-inviare">
      ${htmlPassi(passi)}
      <h1>Ha firmato. Ora invii la conferma</h1>
      <p class="cp-lead">${esc(maiuscola(impresa(a)))} non sa ancora che lei ha accettato: le invii la conferma con la sua firma. Basta un tocco.</p>
      <div class="stack">
        <a class="btn wa big block" id="cp-invia-wa" data-azione="invia-conferma" href="${esc(linkWa(a, testo))}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp}<span>Invia la conferma ${esc(aImpresa(a))}</span></a>
        ${avvisoSenzaNumero(a)}
        ${a.email ? `<a class="btn block" data-azione="invia-conferma" href="mailto:${esc(a.email)}?subject=${encodeURIComponent(`Accettazione preventivo n. ${p.numero}`)}&body=${encodeURIComponent(testo)}">${ICONE.mail} Invia per email</a>` : ""}
        <button class="btn ghost block" data-azione="copia-conferma">${ICONE.copia} Copia il messaggio di conferma</button>
        <button class="btn ghost block" data-azione="gia-inviata">L'ho già mandata in un altro modo</button>
      </div>
      ${htmlRicevuta({ conPdf: true })}
      ${piedeFiducia(a)}
    </main>`;
}

function htmlInviata(anima) {
  const p = stato.prev;
  const a = p.azienda;
  const acc = stato.accettazione;
  const t = totali();
  const testo = testoConferma();
  const seg = acc.pagamento;
  document.title = `Conferma inviata - Preventivo ${p.numero}`;
  return `
    <main class="pagina cp-successo cp-inviata">
      <div class="cp-timbro-riga"><span class="timbro${anima ? " anima" : ""}">Accettato<small class="tnum">${esc(formatData(oggiISO(new Date(acc.data))))}</small></span></div>
      <h1>Conferma inviata ${esc(aImpresa(a))}</h1>
      <p class="cp-lead">Preventivo n. ${esc(p.numero)} · <span class="tnum">${esc(formatEuro(t.totale))}</span> · firmato da ${esc(acc.nome)}.</p>
      <div class="cp-di-nuovo">
        <p class="cp-aiuto">WhatsApp non si è aperto o non ha premuto Invia? La mandi di nuovo.</p>
        <div class="stack">
          <a class="btn block" id="cp-invia-wa" href="${esc(linkWa(a, testo))}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} Invia di nuovo su WhatsApp</a>
          ${a.email ? `<a class="btn ghost block" href="mailto:${esc(a.email)}?subject=${encodeURIComponent(`Accettazione preventivo n. ${p.numero}`)}&body=${encodeURIComponent(testo)}">${ICONE.mail} Invia per email</a>` : ""}
        </div>
      </div>
      ${
        t.acconto > 0
          ? `<section class="card stack cp-paga" id="cp-paga" aria-labelledby="cp-t-paga">
        <h2 id="cp-t-paga">Ora può versare ${parolaAnticipo(p)} di <span class="tnum">${esc(formatEuro(t.acconto))}</span></h2>
        ${p.caparra ? `<p class="cp-aiuto">È un anticipo che vale come garanzia per entrambi.</p>` : ""}
        ${a.iban || a.linkPagamento ? htmlPaga(a, t.acconto, causale(p, "acconto")) : `<p class="cp-aiuto">${esc(maiuscola(impresa(a)))} le dirà come pagarlo.</p>`}
        <div id="cp-pagato" class="stack">${seg ? htmlSegnalato(seg) : bottoneHoPagato(a)}</div>
      </section>`
          : ""
      }
      ${htmlProssimi()}
      ${htmlRicevuta({ conPdf: true })}
      ${sezioneContatti(a, `Buongiorno, ho una domanda sul preventivo n. ${p.numero} che ho accettato.`)}
      ${piedeFiducia(a)}
    </main>`;
}

// "Cosa succede adesso": i prossimi passi con date e importi veri.
function htmlProssimi() {
  const p = stato.prev;
  const a = p.azienda;
  const t = totali();
  const data = dataScelta();
  const seg = stato.accettazione.pagamento;
  const voce = (fase, quando, cosa, extra = "") =>
    `<li class="${fase}"><span class="segno" aria-hidden="true"></span><div><span class="quando">${quando}</span><span class="cosa">${cosa}</span>${extra}</div></li>`;
  const voci = [voce("fatto", "Oggi", `${esc(maiuscola(impresa(a)))} riceve la sua firma`)];
  if (t.acconto > 0)
    voci.push(
      seg
        ? voce(
            "fatto",
            "Pagamento",
            `Avviso del pagamento preparato: ${esc(impresa(a))} controllerà sul conto e glielo confermerà`,
          )
        : voce(
            "ora",
            "Adesso",
            `Versa ${parolaAnticipo(p)} di <span class="tnum">${esc(formatEuro(t.acconto))}</span>`,
          ),
    );
  voci.push(
    data
      ? voce(
          "poi",
          esc(maiuscola(testoAppuntamento(data))),
          `Inizio lavori: ${esc(impresa(a))} le confermerà la data`,
          `<button class="btn small" data-azione="ics">${ICONE.calendario} Aggiungi al calendario</button>`,
        )
      : voce("poi", "Inizio lavori", `${esc(maiuscola(impresa(a)))} la chiamerà per fissare la data`),
  );
  const saldo = t.acconto > 0 ? t.saldo : t.totale;
  if (saldo > 0)
    voci.push(
      voce(
        "poi",
        "Fine lavori",
        `${t.acconto > 0 ? "Saldo" : "Pagamento"} di <span class="tnum">${esc(formatEuro(saldo))}</span> ${p.giorniSaldo > 0 ? `entro ${p.giorniSaldo} giorni` : "a fine lavori"}`,
      ),
    );
  return `<section class="card cp-prossimi" aria-labelledby="cp-t-prossimi">
      <h2 id="cp-t-prossimi">Cosa succede adesso</h2>
      <ol class="cp-tempi">${voci.join("")}</ol>
      <button class="cp-link" data-azione="pdf">${ICONE.scarica}<span>Scarica il preventivo firmato (PDF)</span></button>
    </section>`;
}

// ------------------------------------------------------------------
// Pagamento: dati del bonifico in righe da copiare, link, QR e "Ho già pagato"
// ------------------------------------------------------------------
// Dal telefono il QR serve poco (lo schermo non si può inquadrare da solo): lì vengono prima
// "Paga online" e i dati da copiare; il QR resta a portata per chi paga da un altro dispositivo o dal PC.
const daTelefono = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;

const beneficiario = (a) => a.intestatarioIban || a.ragioneSociale || "";

function datiBonifico(a, importo, causaleTesto) {
  return [
    `Beneficiario: ${beneficiario(a)}`,
    `IBAN: ${ibanCompatto(a.iban)}`,
    `Importo: ${formatEuro(importo)}`,
    `Causale: ${causaleTesto}`,
  ].join("\n");
}

// IBAN a gruppi di 4 che non si spezzano a metà.
const ibanAGruppi = (iban) =>
  (ibanCompatto(iban).match(/.{1,4}/g) || []).map((g) => `<span>${esc(g)}</span>`).join(" ");

function htmlPaga(a, importo, causaleTesto) {
  const payload = ibanValido(a.iban)
    ? payloadEpc({ nome: beneficiario(a), iban: a.iban, importo, causale: causaleTesto })
    : null;
  const qr = payload
    ? `<div class="qr-box"><div class="qr">${svgQr(payload, { etichetta: `QR per pagare ${formatEuro(importo)} con bonifico` })}</div>
        <div class="muted">Inquadri il QR con l'app della sua banca da un altro telefono o dal computer: importo, IBAN e causale si compilano da soli. Se la sua app non legge i QR, usi i dati qui sopra.</div></div>`
    : "";
  const nome = beneficiario(a);
  const riga = (et, valore, bottone = "", cls = "") =>
    `<div class="cp-dato ${cls}"><div class="cp-dato-testo"><span class="et">${et}</span><b>${valore}</b></div>${bottone}</div>`;
  const copia = (azione, etichetta, testo = "") =>
    `<button class="btn small" data-azione="${azione}"${testo ? ` data-testo="${esc(testo)}"` : ""} aria-label="${etichetta}">${ICONE.copia} Copia</button>`;
  return `
    ${a.linkPagamento ? `<a class="btn primary big block" data-azione="paga-online" href="${esc(a.linkPagamento)}" target="_blank" rel="noopener noreferrer">${ICONE.euro} Paga online <span class="cp-host">(${esc(new URL(a.linkPagamento).hostname)})</span></a>` : ""}
    ${
      a.iban
        ? `<p class="cp-aiuto">${a.linkPagamento ? "Oppure apra" : "Apra"} l'app della sua banca e faccia un bonifico con questi dati: tocchi «Copia» e incolli nel campo giusto.</p>
    <div class="cp-dati">
      ${nome ? riga("Intestato a", esc(nome), "", "principale") : ""}
      ${riga("IBAN", `<span class="cp-iban-num tnum">${ibanAGruppi(a.iban)}</span>`, copia("copia-iban", "Copia l'IBAN"))}
      ${riga("Importo", `<span class="tnum">${esc(formatEuro(importo))}</span>`, copia("copia-importo", "Copia l'importo", formatNumero(importo, 2)))}
      ${riga("Causale", interi(esc(causaleTesto)), copia("copia-causale", "Copia la causale", causaleTesto))}
    </div>
    ${nome ? `<div class="banner info cp-prima"><span class="ico">${ICONE.scudo}</span><div><b>Prima di pagare</b>Prima di confermare il bonifico, la sua banca le mostrerà il nome del beneficiario: deve essere «${esc(nome)}». Se è diverso, non paghi e chiami l'impresa al numero che ha già in rubrica.</div></div>` : ""}
    <button class="btn block" data-azione="copia-bonifico" data-testo="${esc(datiBonifico(a, importo, causaleTesto))}">${ICONE.condividi} Mandi i dati a chi paga per lei</button>
    ${qr ? `<details class="cp-qr"${daTelefono() ? "" : " open"}><summary>QR per pagare da un altro dispositivo</summary>${qr}</details>` : ""}`
        : ""
    }`;
}

// Con un nome lungo il pulsante andrebbe su tre righe: allora "l'impresa" (il nome è già scritto sopra).
const bottoneHoPagato = (a) => {
  const nome = nomeSenzaPunto(impresa(a));
  return `<button class="btn soft block" data-azione="ho-pagato">${ICONE.check} Ho già pagato: avviso ${esc(nome.length > 24 ? "l'impresa" : nome)}</button>`;
};

// Dopo il tocco su "Avvisa su WhatsApp": il messaggio è pronto, ma solo il cliente sa se l'ha inviato.
function htmlSegnalato(seg) {
  const a = azienda();
  const nome = esc(nomeSenzaPunto(impresa(a)));
  return `<div class="banner info"><span class="ico">${ICONE.whatsapp}</span><div><b>Messaggio per ${nome} pronto in WhatsApp</b>Pagamento di <span class="tnum">${esc(formatEuro(seg.importo))}</span> (${esc((METODI[seg.metodo] || "pagamento").toLowerCase())}) ${esc(conPreposizione("del", oggiISO(new Date(seg.il))))}. Se non l'ha ancora inviato, tocchi di nuovo il pulsante.</div></div>
    <a class="btn wa block" id="cp-avviso-wa" href="${esc(linkWa(a, testoAvviso(seg)))}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} Avvisa ${nome} su WhatsApp</a>
    <button class="btn ghost block" data-azione="copia-avviso">${ICONE.copia} Copia il messaggio</button>
    <button class="btn ghost block" data-azione="ho-pagato">Segnala un altro pagamento</button>`;
}

function testoAvviso(seg) {
  const numero = stato.tipo === "pagamento" ? stato.richiesta.numero : stato.prev.numero;
  return (
    `Buongiorno, ho pagato ${formatEuro(seg.importo)} per il preventivo n. ${numero} (${METODI[seg.metodo] || "pagamento"}${seg.nota ? `: ${seg.nota}` : ""}).` +
    `\nEcco l'avviso da registrare: ${seg.link}`
  );
}

// Dati del pagamento da segnalare, a seconda della pagina aperta.
function pagamentoCorrente() {
  if (stato.tipo === "pagamento") {
    const r = stato.richiesta;
    return { id: r.id, numero: r.numero, importo: r.importo, causale: r.causale || causale(r, r.tipo) };
  }
  const p = stato.prev;
  return { id: p.id, numero: p.numero, importo: totali().acconto, causale: causale(p, "acconto") };
}

// Il messaggio per l'impresa si prepara mentre il cliente sceglie: il pulsante del foglio è
// direttamente il link di WhatsApp (un tocco solo). "versione" dice se il link è aggiornato.
const avviso = { versione: 0, pronta: -1, seg: null };

async function preparaAvviso() {
  const v = ++avviso.versione;
  const pg = pagamentoCorrente();
  const metodo = $('input[name="hp-metodo"]:checked')?.value || "altro";
  const nota = ($("#hp-nota")?.value || "").trim().slice(0, 200);
  const link = await creaLinkAvviso(BASE, {
    id: pg.id,
    numero: pg.numero,
    importo: pg.importo,
    metodo,
    data: oggiISO(),
    nota,
  });
  if (v !== avviso.versione) return null; // nel frattempo è cambiato qualcosa: vale l'ultima
  avviso.seg = { importo: pg.importo, metodo, nota, il: Date.now(), link };
  avviso.pronta = v;
  const bottone = $("#foglio #cp-avviso-wa");
  if (bottone) bottone.href = linkWa(azienda(), testoAvviso(avviso.seg));
  return avviso.seg;
}

async function foglioHoPagato() {
  const pg = pagamentoCorrente();
  const a = azienda();
  const metodi = [a.iban ? "bonifico" : "", a.linkPagamento ? "online" : "", "contanti", "carta", "altro"].filter(
    Boolean,
  );
  const preferito = stato.pagatoOnline && metodi.includes("online") ? "online" : metodi[0];
  const f = apriFoglioCliente(
    `${titoloFoglio("Come ha pagato?", `${esc(formatEuro(pg.importo))} · ${interi(esc(pg.causale))}`)}
    <div class="stack">
      <div class="scelta" role="radiogroup" aria-label="Come ha pagato">
        ${metodi.map((m) => `<label><input type="radio" name="hp-metodo" value="${m}" ${m === preferito ? "checked" : ""}><span>${esc(METODI[m])}</span></label>`).join("")}
      </div>
      <label class="campo">Nota per l'impresa (facoltativa)
        <input id="hp-nota" maxlength="200" placeholder="es. bonifico fatto da mio figlio, Luca Bianchi" data-no-focus="1">
      </label>
      <p class="cp-aiuto">${esc(maiuscola(impresa(a)))} controllerà sul conto e le confermerà di aver ricevuto il pagamento.</p>
      <div class="cp-foglio-piede">
        <a class="btn wa big block" id="cp-avviso-wa" data-azione="hp-conferma" href="${esc(linkWa(a, ""))}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} Avvisa ${esc(nomeSenzaPunto(impresa(a)))} su WhatsApp</a>
        ${avvisoSenzaNumero(a)}
        <button class="btn ghost block" data-azione="copia-avviso">${ICONE.copia} Copia il messaggio</button>
      </div>
    </div>`,
  );
  avviso.pronta = -1;
  $$('input[name="hp-metodo"]', f).forEach((el) => el.addEventListener("change", preparaAvviso));
  $("#hp-nota", f).addEventListener("input", preparaAvviso);
  await preparaAvviso();
}

// Il cliente ha toccato "Avvisa su WhatsApp" (o ha copiato il messaggio): si ricorda l'avviso.
function registraAvviso(seg) {
  const s = { ...seg, inviato: Date.now() };
  if (stato.tipo === "pagamento") {
    stato.pagamento = s;
    memoria.scrivi(s);
  } else {
    stato.accettazione.pagamento = s;
    memoria.scrivi(stato.accettazione);
  }
  chiudiFoglio();
  vibra(30);
  const box = $("#cp-pagato");
  if (box) box.innerHTML = htmlSegnalato(s);
  box?.scrollIntoView({ block: "center", behavior: riduciMovimento() ? "auto" : "smooth" });
}

async function confermaHoPagato(e, el) {
  // Link già aggiornato: si lascia aprire WhatsApp e si registra. Altrimenti lo si aggiorna e si apre da qui.
  if (avviso.pronta === avviso.versione && avviso.seg) {
    registraAvviso(avviso.seg);
    return;
  }
  e.preventDefault();
  const seg = await preparaAvviso();
  if (!seg) return;
  const href = linkWa(azienda(), testoAvviso(seg));
  el.href = href;
  window.open(href, "_blank", "noopener,noreferrer");
  registraAvviso(seg);
}

// "Mandi i dati a chi paga per lei": condivisione del telefono, altrimenti WhatsApp o copia.
async function condividiBonifico(el) {
  const a = azienda();
  const link = stato.tipo === "pagamento" ? `\nPagina con i dati e il QR: ${location.href}` : "";
  const testo = `Dati per il bonifico ${aImpresa(a)}:\n${el.dataset.testo || ""}${link}`;
  if (navigator.share) {
    try {
      await navigator.share({ text: testo });
      toast("Dati pronti da inviare");
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  } else if (daTelefono()) {
    window.open(`https://wa.me/?text=${encodeURIComponent(testo)}`, "_blank", "noopener,noreferrer");
    return;
  }
  toast((await copiaTesto(testo)) ? "Dati copiati: li incolli in un messaggio" : "Copia non riuscita");
}

// ------------------------------------------------------------------
// Richiesta di pagamento
// ------------------------------------------------------------------
function paginaPagamento() {
  const r = stato.richiesta;
  const a = r.azienda;
  const scad = r.scadenza && r.scadenza < oggiISO();
  const titolo = { acconto: r.caparra ? "Caparra" : "Acconto", saldo: "Saldo", residuo: "Importo da pagare" }[r.tipo];
  const caus = r.causale || causale(r, r.tipo);
  document.title = `Pagamento preventivo ${r.numero} - ${a.ragioneSociale || "Impresa"}`;
  coloreBarra(a.colore);
  const parziale = r.importo < r.totale - r.incassato - 0.005;
  app().innerHTML = `
    <header class="${classeTesta()}" style="${stileAccento(a.colore)}">
      ${esci()}${rigaAzienda(a)}
      <h1 class="tnum">${esc(formatEuro(r.importo))}</h1>
      <p class="cp-sotto">${esc(titolo)}${r.oggetto ? ` per ${esc(r.oggetto)}` : ""} · preventivo n. ${esc(r.numero)}</p>
      ${r.scadenza ? `<p class="cp-sotto"><span class="badge ${scad ? "warn" : "nodot"}">Da pagare entro ${esc(conPreposizione("il", r.scadenza))}${scad ? " · in ritardo" : ""}</span></p>` : ""}
      <p class="cp-meta">Richiesta di pagamento${r.cliente.nome ? ` per ${esc(r.cliente.nome)}` : ""}</p>
      ${strumenti()}
    </header>
    <main class="pagina cp-corpo">
      ${scad ? `<p class="cp-intro">Può pagare anche adesso con i dati qui sotto.</p>` : ""}
      ${
        r.totale > 0
          ? `<section class="card riepilogo" aria-label="Riepilogo dei pagamenti">
        <div class="r"><span>Totale del preventivo</span><b class="tnum">${esc(formatEuro(r.totale))}</b></div>
        ${r.incassato > 0 ? `<div class="r"><span>Già pagato</span><b class="tnum">- ${esc(formatEuro(r.incassato))}</b></div>` : ""}
        ${parziale ? `<div class="r"><span>Resta da pagare in tutto</span><b class="tnum">${esc(formatEuro(r.totale - r.incassato))}</b></div>` : ""}
        <div class="r tot"><span><b>Da pagare ora${parziale ? ` (${esc(titolo.toLowerCase())})` : ""}</b></span><b><span class="big tnum">${esc(formatEuro(r.importo))}</span></b></div>
      </section>`
          : ""
      }
      <section class="card stack cp-paga" aria-labelledby="cp-t-come">
        <h2 id="cp-t-come">Come pagare</h2>
        ${a.iban || a.linkPagamento ? htmlPaga(a, r.importo, caus) : `<p class="cp-aiuto">${esc(maiuscola(impresa(a)))} le dirà come pagare: la contatti qui sotto.</p>`}
      </section>
      ${
        presenta
          ? ""
          : `<section class="card stack" aria-labelledby="cp-t-pagato">
        <h2 id="cp-t-pagato">Ha già pagato?</h2>
        <p class="cp-aiuto">Avvisi ${esc(nomeSenzaPunto(impresa(a)))} con un tocco: controllerà sul conto.</p>
        <div id="cp-pagato" class="stack">${stato.pagamento ? htmlSegnalato(stato.pagamento) : bottoneHoPagato(a)}</div>
      </section>`
      }
      ${sezioneContatti(a, `Buongiorno, la contatto per il pagamento del preventivo n. ${r.numero}.`)}
      ${piedeFiducia(a, { pagamento: true })}
      ${marchio(r.conMarchio)}
    </main>`;
}

// ------------------------------------------------------------------
// Lettura ad alta voce (sintesi vocale del telefono, nessun server)
// ------------------------------------------------------------------
function sintesi() {
  try {
    return window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function"
      ? window.speechSynthesis
      : null;
  } catch {
    return null;
  }
}

function euroParlati(n) {
  const cent = Math.round((Number(n) || 0) * 100);
  const euro = Math.floor(cent / 100);
  const resto = cent % 100;
  return `${formatNumero(euro, 0)} euro${resto ? ` e ${resto} centesimi` : ""}`;
}

function frasiDaLeggere() {
  if (stato.tipo === "pagamento") {
    const r = stato.richiesta;
    const a = r.azienda;
    return [
      `${maiuscola(impresa(a))} le chiede di pagare ${euroParlati(r.importo)}${r.oggetto ? ` per ${r.oggetto}` : ""}, preventivo numero ${r.numero}.`,
      r.scadenza ? `Da pagare entro ${conPreposizione("il", r.scadenza, { parlato: true })}.` : "",
      a.iban ? `Il bonifico va intestato a ${beneficiario(a)}.` : "",
      "Quando ha pagato, tocchi Ho già pagato per avvisare l'impresa.",
    ].filter(Boolean);
  }
  const p = stato.prev;
  const a = p.azienda;
  const t = totali();
  const s = scadenzaDi(p);
  const voci = t.righe.map((r) => r.descrizione).filter(Boolean);
  const opz = p.righe.map((r, i) => ({ r, i })).filter((x) => x.r.opzionale && !stato.scelte.has(x.i));
  return [
    `${maiuscola(impresa(a))} le propone questo preventivo: ${p.oggetto || "lavori"}.`,
    voci.length
      ? `Lavori compresi: ${voci.slice(0, 8).join("; ")}${voci.length > 8 ? `; e altre ${voci.length - 8} voci` : ""}.`
      : "",
    opz.length
      ? `Può aggiungere anche: ${opz.map(({ r, i }) => `${r.descrizione}, per ${euroParlati(aumentoDi(i))} in più`).join("; ")}.`
      : "",
    `Totale ${euroParlati(t.totale)}${t.forfettario ? "" : ", IVA inclusa"}.`,
    t.acconto > 0 ? `${nomeAnticipo(p)} alla firma: ${euroParlati(t.acconto)}.` : "",
    s
      ? scaduto()
        ? `Il preventivo è scaduto ${conPreposizione("il", s, { parlato: true })}.`
        : `Il preventivo vale fino ${conPreposizione("al", s, { parlato: true })}.`
      : "",
    scaduto() ? "" : "Se le va bene, può firmarlo con il dito toccando Accetta e firma, in fondo alla pagina.",
  ].filter(Boolean);
}

function aggiornaAscolta(attivo) {
  const b = $('[data-azione="ascolta"]');
  if (!b) return;
  b.setAttribute("aria-pressed", String(attivo));
  b.innerHTML = attivo
    ? `${IC.ferma}<span>Ferma la lettura</span>`
    : `${IC.ascolta}<span>${esc(b.dataset.etichetta || "Ascolti")}</span>`;
}

function ascolta() {
  const voce = sintesi();
  if (!voce) return;
  if (voce.speaking || voce.pending) {
    voce.cancel();
    aggiornaAscolta(false);
    return;
  }
  const italiana = voce.getVoices().find((v) => /^it([-_]|$)/i.test(v.lang));
  const frasi = frasiDaLeggere();
  // Una frase per volta: alcuni telefoni interrompono le letture lunghe.
  frasi.forEach((testo, k) => {
    const u = new window.SpeechSynthesisUtterance(testo);
    u.lang = "it-IT";
    if (italiana) u.voice = italiana;
    u.rate = 0.95;
    if (k === frasi.length - 1) u.onend = () => aggiornaAscolta(false);
    u.onerror = () => aggiornaAscolta(false);
    voce.speak(u);
  });
  aggiornaAscolta(true);
}

// Se il telefono ha delle voci ma nessuna italiana, il pulsante non serve.
function controllaVoci() {
  const voce = sintesi();
  const voci = voce ? voce.getVoices() : [];
  if (voci.length && !voci.some((v) => /^it([-_]|$)/i.test(v.lang))) $('[data-azione="ascolta"]')?.remove();
}
sintesi()?.addEventListener?.("voiceschanged", controllaVoci);

function testoGrande(attiva) {
  document.documentElement.classList.toggle("testo-grande", attiva);
  $('[data-azione="testo"]')?.setAttribute("aria-pressed", String(attiva));
}

// ------------------------------------------------------------------
// File: PDF (da stampare prima della firma, firmato dopo) e calendario
// ------------------------------------------------------------------
function scaricaFile(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let pdfCaricato = null;
function carica(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error("Non riesco a preparare il PDF: controlli la connessione e riprovi"));
    document.head.appendChild(s);
  });
}

async function scaricaPdf() {
  try {
    if (!pdfCaricato) {
      toast("Preparo il PDF…");
      pdfCaricato = carica("vendor/jspdf.umd.min.js").then(() => carica("vendor/jspdf.plugin.autotable.min.js"));
    }
    await pdfCaricato;
    const { creaPdfBlob } = await import("./pdf.js");
    const acc = stato.accettazione;
    // Prima della firma: il preventivo così come è stato proposto, con il link per accettarlo online.
    const p = acc ? prevConScelte() : { ...stato.prev, righe: stato.prev.righe.map((r) => ({ ...r })) };
    if (acc) {
      p.firma = {
        img: trattiInPng(decodificaTratti(acc.firma)),
        nome: acc.nome,
        luogo: "",
        data: acc.data,
        online: true,
      };
      const data = dataScelta();
      if (data) p.appuntamento = { ...data, da: "cliente" };
    }
    p.incasso = { giorniSaldo: stato.prev.giorniSaldo };
    const a = stato.prev.azienda;
    const blob = creaPdfBlob({
      prev: p,
      azienda: { ...a, cap: "", provincia: "" },
      totali: calcolaTotali(p, { regime: p.regime, addebitaBollo: p.addebitaBollo }),
      pro: !stato.prev.conMarchio,
      config: CONFIG,
      linkAccettazione: acc ? "" : location.href,
    });
    scaricaFile(blob, `Preventivo-${p.numero.replace(/[^\w-]+/g, "-")}${acc ? "-firmato" : ""}.pdf`);
  } catch (err) {
    pdfCaricato = null;
    toast(err.message || "Non riesco a preparare il PDF: riprovi tra poco");
  }
}

function datiCalendario() {
  const p = stato.prev;
  return {
    titolo: `${p.azienda.ragioneSociale || "Lavori"}${p.oggetto ? ` - ${p.oggetto}` : ""}`,
    luogo: p.luogo || [p.cliente.indirizzo, p.cliente.citta].filter(Boolean).join(", "),
    descrizione: `Preventivo n. ${p.numero}${p.azienda.telefono ? `\nTel. ${p.azienda.telefono}` : ""}`,
  };
}

// Su Android un file .ics finisce tra i download: lì si apre direttamente Google Calendar.
function linkGoogleCalendar(d, { titolo, luogo, descrizione }) {
  const giorno = d.data.replace(/-/g, "");
  const orari = ORARI_FASCIA[d.fascia];
  const dates = orari
    ? `${giorno}T${orari[0]}/${giorno}T${orari[1]}`
    : `${giorno}/${aggiungiGiorni(d.data, 1).replace(/-/g, "")}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: titolo, dates, details: descrizione, ctz: "Europe/Rome" });
  if (luogo) q.set("location", luogo);
  return `https://calendar.google.com/calendar/render?${q}`;
}

function scaricaIcs() {
  const p = stato.prev;
  const data = dataScelta();
  if (!data) return;
  const dati = datiCalendario();
  if (/Android/i.test(navigator.userAgent || "")) {
    window.open(linkGoogleCalendar(data, dati), "_blank", "noopener,noreferrer");
    return;
  }
  const ics = creaIcs({
    id: p.id,
    titolo: dati.titolo,
    data: data.data,
    fascia: data.fascia,
    luogo: dati.luogo,
    descrizione: dati.descrizione,
  });
  scaricaFile(new Blob([ics], { type: "text/calendar" }), `Lavori-${p.numero.replace(/[^\w-]+/g, "-")}.ics`);
}

// ------------------------------------------------------------------
// Azioni
// ------------------------------------------------------------------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-azione], [data-action]");
  if (!el) return;
  const azione = el.dataset.azione || el.dataset.action;
  if (azione === "chiudi-foglio") return chiudiFoglio();
  if (el.tagName !== "A") e.preventDefault();
  if (azione === "accetta") foglioFirma();
  if (azione === "cambia-data") {
    chiudiFoglio();
    const sez = $("#cp-date");
    sez?.scrollIntoView({ block: "start", behavior: riduciMovimento() ? "auto" : "smooth" });
    $('input[name="acc-data"]:checked', sez || document)?.focus({ preventScroll: true });
  }
  if (azione === "cancella-firma") {
    stato.pad?.cancella();
    $(".cp-firma .cp-pad")?.classList.remove("con-firma");
  }
  if (azione === "firma-grande") firmaGrande();
  if (azione === "conferma") conferma();
  if (azione === "invia-conferma") segnaInviata();
  if (azione === "esci-presenta") {
    if (history.length > 1) history.back();
    else location.href = "app.html#/";
  }
  // La conferma non deve restare nella cronologia: si sostituisce la pagina invece di aggiungerne una.
  if (azione === "registra-qui") {
    e.preventDefault();
    const link = stato.accettazione?.link || "";
    if (link.startsWith(BASE)) location.replace(link);
  }
  if (azione === "gia-inviata" && stato.accettazione) {
    stato.accettazione.inviata = Date.now();
    memoria.scrivi(stato.accettazione);
    attesaRitorno = true;
    mostraInviata();
  }
  if (azione === "copia-conferma")
    toast(
      (await copiaTesto(testoConferma()))
        ? `Messaggio copiato: lo incolli in un SMS o in una email ${aImpresa(azienda())}`
        : "Copia non riuscita",
    );
  if (azione === "copia-iban")
    toast(
      (await copiaTesto(ibanCompatto(azienda().iban)))
        ? "IBAN copiato: lo incolli nell'app della banca"
        : "Copia non riuscita",
    );
  if (azione === "copia-importo")
    toast((await copiaTesto(el.dataset.testo || "")) ? "Importo copiato" : "Copia non riuscita");
  if (azione === "copia-causale")
    toast((await copiaTesto(el.dataset.testo || "")) ? "Causale copiata" : "Copia non riuscita");
  if (azione === "copia-bonifico") condividiBonifico(el);
  if (azione === "paga-online") stato.pagatoOnline = true;
  if (azione === "ho-pagato") foglioHoPagato();
  if (azione === "hp-conferma") confermaHoPagato(e, el);
  if (azione === "copia-avviso") {
    const nelFoglio = Boolean(el.closest("#foglio"));
    const seg = nelFoglio
      ? avviso.pronta === avviso.versione
        ? avviso.seg
        : await preparaAvviso()
      : stato.tipo === "pagamento"
        ? stato.pagamento
        : stato.accettazione?.pagamento;
    if (!seg) return;
    const ok = await copiaTesto(testoAvviso(seg));
    toast(ok ? `Messaggio copiato: lo incolli in WhatsApp o in un SMS ${aImpresa(azienda())}` : "Copia non riuscita");
    if (ok && nelFoglio) registraAvviso(seg);
  }
  if (azione === "ascolta") ascolta();
  if (azione === "testo") {
    const attiva = !document.documentElement.classList.contains("testo-grande");
    testoGrande(attiva);
    scriviPref(attiva);
  }
  if (azione === "ics") scaricaIcs();
  if (azione === "pdf") scaricaPdf();
});

// ------------------------------------------------------------------
// Avvio: quanto è salvato sul telefono del cliente viene ricontrollato prima di essere mostrato
// ------------------------------------------------------------------
function segnalazioneSalvata(s) {
  if (!s || typeof s !== "object" || typeof s.link !== "string" || !s.link.startsWith(BASE)) return null;
  const importo = Number(s.importo);
  if (!(importo > 0)) return null;
  return {
    importo,
    metodo: Object.hasOwn(METODI, s.metodo) ? s.metodo : "altro",
    nota: typeof s.nota === "string" ? s.nota.slice(0, 200) : "",
    il: Number.isFinite(s.il) ? s.il : Date.now(),
    link: s.link,
    inviato: Number.isFinite(s.inviato) ? s.inviato : null,
  };
}

// Le accettazioni salvate dalle versioni precedenti non hanno "inviata": valgono come non ancora inviate.
function accettazioneSalvata(s, prev) {
  if (!s || typeof s !== "object" || typeof s.link !== "string" || !s.link.startsWith(BASE)) return null;
  if (!Array.isArray(s.scelte)) return null;
  const quando = Date.parse(s.data);
  return {
    link: s.link,
    nome: typeof s.nome === "string" ? s.nome.slice(0, 120) : "",
    data: Number.isFinite(quando) ? new Date(quando).toISOString() : new Date().toISOString(),
    scelte: s.scelte.filter((i) => Number.isInteger(i) && i >= 0 && i < prev.righe.length && prev.righe[i].opzionale),
    firma: Array.isArray(s.firma) ? s.firma : [],
    appuntamento: normalizzaDisponibilita([s.appuntamento])[0] || null,
    pagamento: segnalazioneSalvata(s.pagamento),
    inviata: Number.isFinite(s.inviata) ? s.inviata : null,
  };
}

async function avvio() {
  const codice = location.hash.slice(1);
  if (!codice) return errore("Il link è vuoto");
  try {
    const letto = await leggiLinkCliente(codice);
    stato.tipo = letto.tipo;
    stato.hash = letto.hash;
    stato.prev = letto.prev || null;
    stato.richiesta = letto.richiesta || null;
  } catch (err) {
    return errore(err.message || "Link non valido");
  }
  const salvata = memoria.leggi();
  if (stato.tipo === "pagamento") {
    stato.pagamento = segnalazioneSalvata(salvata);
    return paginaPagamento();
  }
  // Riaprendo il link dopo la firma si ritrova la conferma (da inviare o già inviata).
  stato.accettazione = presenta ? null : accettazioneSalvata(salvata, stato.prev);
  if (stato.accettazione) successo();
  else pagina();
}

if (leggiPref()) testoGrande(true);

// Al tavolo lo schermo non deve spegnersi mentre il cliente legge: si chiede di tenerlo acceso
// (di nuovo quando la pagina torna visibile, perché il sistema lo rilascia) e lo si lascia uscendo.
let schermo = null;
async function schermoAcceso() {
  if (!presenta || document.visibilityState !== "visible") return;
  try {
    schermo = (await navigator.wakeLock?.request("screen")) || null;
  } catch {
    schermo = null; // non supportato o negato: pazienza
  }
}
if (presenta) {
  document.body.classList.add("al-tavolo");
  schermoAcceso();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schermoAcceso();
  });
  window.addEventListener("pagehide", () => {
    try {
      schermo?.release?.().catch?.(() => {});
    } catch {
      /* già rilasciato */
    }
    schermo = null;
  });
}

// Un nuovo link aperto nella stessa scheda: si riparte da capo senza ricaricare la pagina
// (un ricaricamento a metà farebbe perdere la firma in corso).
window.addEventListener("hashchange", () => {
  voceFoglio = false;
  chiudiFoglio(true);
  $(".cp-pad-grande")?._chiudi?.(false);
  sintesi()?.cancel();
  stato.scelte = new Set();
  stato.data = "-1";
  stato.bozza = null;
  stato.accettazione = null;
  stato.pagamento = null;
  stato.pad = null;
  stato.pagatoOnline = false;
  attesaRitorno = false;
  avvio();
});
window.addEventListener("pagehide", () => sintesi()?.cancel());
avvio();
