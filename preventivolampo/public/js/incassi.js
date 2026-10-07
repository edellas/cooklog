// Incassi: "e se il cliente firma ma non paga?"
// Tutto qui è logica pura (nessun accesso al DOM o all'archivio), così si può testare in Node.
//
// 1. Prevenire: acconto o caparra confirmatoria da versare subito, con QR SEPA e link di pagamento.
// 2. Seguire: pagamenti ricevuti, scadenze di acconto e saldo, importi scaduti.
// 3. Recuperare: solleciti in tre toni, messa in mora e fascicolo del credito (vedi pdf.js).
import { round2, parseNumero, oggiISO, aggiungiGiorni, formatEuro, formatData, uid, nomeCliente } from "./core.js";

export const METODI = {
  bonifico: "Bonifico",
  contanti: "Contanti",
  carta: "Carta / POS",
  online: "Pagamento online",
  assegno: "Assegno",
  altro: "Altro",
};
export const FASCE = { mattina: "Mattina", pomeriggio: "Pomeriggio", giornata: "Tutto il giorno" };
export const LIVELLI_SOLLECITO = { 1: "Promemoria cortese", 2: "Sollecito", 3: "Ultimo avviso" };
// Il livello 0 è la semplice richiesta di pagamento (dopo i lavori o per l'acconto): non è un sollecito.
export const TONI_MESSAGGIO = { 0: "Richiesta", 1: "Cortese", 2: "Sollecito", 3: "Ultimo avviso" };
export const FASI = {
  "non-accettato": "Non accettato",
  "attesa-acconto": "Attesa acconto",
  "in-corso": "Lavori in corso",
  "da-saldare": "Da saldare",
  scaduto: "Scaduto",
  pagato: "Pagato",
  storico: "Da aggiornare",
};

// Giorni concessi per versare l'acconto dopo la firma, prima di considerarlo in ritardo.
export const GRAZIA_ACCONTO = 3;
// Giorni minimi tra un sollecito e il successivo (insistere ogni giorno è controproducente).
export const PAUSA_SOLLECITI = 7;
export const MAX_DISPONIBILITA = 3;
const GIORNO = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------
// Validazione (i dati possono arrivare da un backup o da un link: mai fidarsi)
// ------------------------------------------------------------------
export function dataValida(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, g] = v.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, g));
  return a >= 2000 && a <= 2200 && d.getUTCMonth() === m - 1 && d.getUTCDate() === g;
}

const oggetto = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const lista = (v) => (Array.isArray(v) ? v : []);
const testo = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const istante = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 8.64e15 ? v : 0);
export function importoValido(v) {
  const n = typeof v === "number" ? v : parseNumero(v);
  return Number.isFinite(n) ? Math.min(Math.max(round2(n), 0), 1e7) : 0;
}
const idSicuro = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : uid());
const rifSicuro = (v) => (typeof v === "string" ? v.replace(/[^0-9a-f]/g, "").slice(0, 64) : "");

export function normalizzaIncasso(x) {
  const o = oggetto(x) ? x : {};
  const gs = o.giorniSaldo;
  return {
    pagamenti: lista(o.pagamenti)
      .filter(oggetto)
      .slice(0, 200)
      .map((p) => ({
        id: idSicuro(p.id),
        data: dataValida(p.data) ? p.data : oggiISO(),
        importo: importoValido(p.importo),
        metodo: Object.hasOwn(METODI, p.metodo) ? p.metodo : "altro",
        nota: testo(p.nota, 300),
        rif: rifSicuro(p.rif),
      }))
      .filter((p) => p.importo > 0),
    fineLavori: dataValida(o.fineLavori) ? o.fineLavori : "",
    // null = si usa il valore predefinito delle impostazioni
    giorniSaldo:
      gs === null || gs === undefined || gs === "" || !Number.isFinite(Number(gs))
        ? null
        : Math.min(Math.max(Math.round(Number(gs)), 0), 365),
    solleciti: lista(o.solleciti)
      .filter(oggetto)
      .slice(-100)
      .map((s) => ({
        il: istante(s.il),
        livello: [1, 2, 3].includes(s.livello) ? s.livello : 1,
        canale: ["whatsapp", "email", "lettera", "copia"].includes(s.canale) ? s.canale : "whatsapp",
      }))
      .filter((s) => s.il > 0)
      .sort((a, b) => a.il - b.il),
    segnalazioni: lista(o.segnalazioni)
      .filter(oggetto)
      .slice(-50)
      .map((s) => ({
        il: istante(s.il) || Date.now(),
        data: dataValida(s.data) ? s.data : "",
        importo: importoValido(s.importo),
        metodo: Object.hasOwn(METODI, s.metodo) ? s.metodo : "altro",
        nota: testo(s.nota, 300),
        rif: rifSicuro(s.rif),
        stato: ["attesa", "confermata", "respinta"].includes(s.stato) ? s.stato : "attesa",
      }))
      .filter((s) => s.importo > 0),
    recensioneChiestaIl: istante(o.recensioneChiestaIl) || null,
    // Accettato prima che esistesse il registro incassi: niente scadenze finché non lo aggiorni.
    storico: o.storico === true,
    // Acconto concordato al momento dell'accettazione (le modifiche successive non lo cambiano).
    accontoPattuito: o.accontoPattuito == null || o.accontoPattuito === "" ? null : importoValido(o.accontoPattuito),
  };
}

export function normalizzaDisponibilita(v) {
  const viste = new Set();
  return lista(v)
    .filter(oggetto)
    .map((d) => ({
      data: dataValida(d.data) ? d.data : "",
      fascia: Object.hasOwn(FASCE, d.fascia) ? d.fascia : "giornata",
    }))
    .filter((d) => d.data && !viste.has(d.data + d.fascia) && viste.add(d.data + d.fascia))
    .slice(0, MAX_DISPONIBILITA);
}

export function normalizzaAppuntamento(v) {
  if (!oggetto(v) || !dataValida(v.data)) return null;
  return {
    data: v.data,
    fascia: Object.hasOwn(FASCE, v.fascia) ? v.fascia : "giornata",
    da: v.da === "cliente" ? "cliente" : "impresa",
    il: istante(v.il) || null,
  };
}

// ------------------------------------------------------------------
// Date
// ------------------------------------------------------------------
export function giorniTra(daIso, aIso) {
  const ms = (iso) => {
    const [a, m, g] = iso.split("-").map(Number);
    return Date.UTC(a, m - 1, g);
  };
  return Math.round((ms(aIso) - ms(daIso)) / GIORNO);
}

const inizioGiorno = (iso) => new Date(iso + "T00:00:00").getTime();

// Giorno in cui il cliente ha accettato: firma, accettazione online o cambio di stato.
export function dataAccettazione(prev) {
  const f = prev.firma && Date.parse(prev.firma.data);
  if (Number.isFinite(f) && dataValida(oggiISO(new Date(f)))) return oggiISO(new Date(f));
  const o = prev.accettazioneOnline && istante(prev.accettazioneOnline.il);
  if (o && dataValida(oggiISO(new Date(o)))) return oggiISO(new Date(o));
  if (dataValida(prev.accettatoIl)) return prev.accettatoIl;
  return dataValida(prev.data) ? prev.data : oggiISO();
}

// ------------------------------------------------------------------
// Stato dei pagamenti di un preventivo
// opzioni: { oggi: "AAAA-MM-GG", giorniSaldo: numero predefinito delle impostazioni }
// ------------------------------------------------------------------
export function statoIncasso(prev, totali, { oggi = oggiISO(), giorniSaldo = 0 } = {}) {
  const inc = normalizzaIncasso(prev.incasso);
  const totale = round2(totali.totale || 0);
  const incassato = round2(inc.pagamenti.reduce((s, p) => s + p.importo, 0));
  const residuo = Math.max(round2(totale - incassato), 0);
  const eccedenza = Math.max(round2(incassato - totale), 0);
  const accettato = prev.stato === "accettato";
  const storico = accettato && inc.storico && !inc.pagamenti.length && !inc.fineLavori;
  const dataAcc = accettato ? dataAccettazione(prev) : null;
  const acconto = Math.min(inc.accontoPattuito ?? round2(totali.acconto || 0), totale);
  const accontoPagato = acconto <= 0 || incassato >= acconto - 0.005;
  const scadenzaAcconto = dataAcc && acconto > 0 && !storico ? aggiungiGiorni(dataAcc, GRAZIA_ACCONTO) : null;
  const gs = inc.giorniSaldo ?? Math.min(Math.max(Math.round(Number(giorniSaldo) || 0), 0), 365);
  const scadenzaSaldo = inc.fineLavori ? aggiungiGiorni(inc.fineLavori, gs) : null;

  // Quote scadute, ognuna con la sua data: servono per messaggi, lettere e interessi corretti.
  const accontoDaPagare = Math.max(round2(acconto - incassato), 0);
  const saldoDaPagare = Math.max(round2(residuo - accontoDaPagare), 0);
  const quote = [];
  if (accettato && residuo > 0.005) {
    const accontoScaduto = accontoDaPagare > 0.005 && scadenzaAcconto && oggi > scadenzaAcconto;
    if (accontoScaduto) quote.push({ tipo: "acconto", importo: accontoDaPagare, dal: scadenzaAcconto });
    if (scadenzaSaldo && oggi > scadenzaSaldo) {
      if (saldoDaPagare > 0.005) quote.push({ tipo: "saldo", importo: saldoDaPagare, dal: scadenzaSaldo });
      // Saldo scaduto prima della tolleranza sull'acconto: da quel giorno è dovuto anche l'acconto.
      if (accontoDaPagare > 0.005 && !accontoScaduto)
        quote.push({ tipo: "acconto", importo: accontoDaPagare, dal: scadenzaSaldo });
    }
  }
  quote.sort((a, b) => a.dal.localeCompare(b.dal));
  const importoScaduto = round2(quote.reduce((t, q) => t + q.importo, 0));
  const scadutoDal = quote.length ? quote[0].dal : null;

  let fase;
  if (!accettato && incassato <= 0) fase = "non-accettato";
  else if (residuo <= 0.005) fase = totale > 0 ? "pagato" : "in-corso";
  else if (storico) fase = "storico";
  else if (importoScaduto > 0) fase = "scaduto";
  else if (!accontoPagato) fase = "attesa-acconto";
  else if (scadenzaSaldo) fase = "da-saldare";
  else fase = "in-corso";

  let prossima = null;
  if (residuo > 0.005) {
    prossima = !accontoPagato
      ? { tipo: "acconto", importo: accontoDaPagare, data: scadenzaAcconto }
      : { tipo: "saldo", importo: residuo, data: scadenzaSaldo };
  }
  const attesa = inc.segnalazioni.filter((s) => s.stato === "attesa");
  return {
    totale,
    incassato,
    residuo,
    eccedenza,
    percentuale: totale > 0 ? Math.min(Math.round((incassato / totale) * 100), 100) : 0,
    acconto,
    accontoPagato,
    scadenzaAcconto,
    scadenzaSaldo,
    giorniSaldo: gs,
    fineLavori: inc.fineLavori,
    dataAccettazione: dataAcc,
    importoScaduto,
    scadutoDal,
    quote,
    giorniRitardo: scadutoDal ? Math.max(giorniTra(scadutoDal, oggi), 0) : 0,
    accettato,
    storico,
    fase,
    prossima,
    pagamenti: inc.pagamenti,
    solleciti: inc.solleciti,
    segnalazioniAttesa: attesa,
    daVerificare: round2(attesa.reduce((s, x) => s + x.importo, 0)),
    recensioneChiestaIl: inc.recensioneChiestaIl,
  };
}

const ORDINE_FASI = { scaduto: 0, "attesa-acconto": 1, "da-saldare": 2, "in-corso": 3 };

// Ha soldi in ballo anche se non risulta accettato (per esempio un "Ho pagato" arrivato prima della firma).
export function haMovimenti(prev) {
  const i = normalizzaIncasso(prev.incasso);
  return i.pagamenti.length > 0 || i.segnalazioni.some((s) => s.stato === "attesa");
}

// Elenco per la dashboard "Da incassare": prima gli avvisi da verificare e gli scaduti
// (dal più vecchio), poi il resto. I totali contano solo i preventivi accettati.
export function daIncassare(preventivi, totaliDi, opzioni = {}) {
  const voci = (preventivi || [])
    .filter((p) => p.stato === "accettato" || haMovimenti(p))
    .map((p) => ({ prev: p, stato: statoIncasso(p, totaliDi(p), opzioni) }))
    .filter((x) => x.stato.segnalazioniAttesa.length > 0 || (x.stato.residuo > 0.005 && x.stato.fase in ORDINE_FASI))
    .sort((a, b) => {
      const va = a.stato.segnalazioniAttesa.length ? -1 : (ORDINE_FASI[a.stato.fase] ?? 4);
      const vb = b.stato.segnalazioniAttesa.length ? -1 : (ORDINE_FASI[b.stato.fase] ?? 4);
      if (va !== vb) return va - vb;
      if (a.stato.fase === "scaduto") return b.stato.giorniRitardo - a.stato.giorniRitardo;
      return String(a.stato.prossima?.data || "9999").localeCompare(String(b.stato.prossima?.data || "9999"));
    });
  const accettate = voci.filter((x) => x.stato.accettato);
  return {
    voci,
    totale: round2(accettate.reduce((s, x) => s + x.stato.residuo, 0)),
    scaduto: round2(accettate.reduce((s, x) => s + x.stato.importoScaduto, 0)),
    nScaduti: voci.filter((x) => x.stato.fase === "scaduto").length,
    daVerificare: round2(voci.reduce((s, x) => s + x.stato.daVerificare, 0)),
  };
}

// ------------------------------------------------------------------
// Solleciti in tre toni
// ------------------------------------------------------------------
export function sollecitoSuggerito(stato, ora = Date.now()) {
  const n = stato.solleciti.length;
  const ultimo = n ? stato.solleciti[n - 1].il : 0;
  const prontoIl = ultimo ? ultimo + PAUSA_SOLLECITI * GIORNO : 0;
  // Il tono sale solo con i solleciti mandati per il ritardo di adesso (non per un acconto pagato
  // in ritardo mesi prima); se non è scaduto nulla si resta gentili.
  let livello = 1;
  if (stato.importoScaduto > 0 && stato.scadutoDal) {
    const dal = inizioGiorno(stato.scadutoDal);
    livello = Math.min(stato.solleciti.filter((s) => s.il >= dal).length + 1, 3);
  }
  return { livello, ultimo, prontoIl, troppoPresto: Boolean(ultimo && ora < prontoIl) };
}

export function causale(prev, tipo) {
  const nome = tipo === "acconto" ? (prev.caparra ? "Caparra" : "Acconto") : tipo === "saldo" ? "Saldo" : "Pagamento";
  return `${nome} preventivo n. ${prev.numero}`;
}

// Cosa chiedere adesso: tutto lo scaduto se c'è, altrimenti la prossima scadenza.
// tipo "residuo" quando si chiedono insieme acconto e saldo (causale "Pagamento ...").
export function daChiedere(prev, stato) {
  const scaduto = stato.importoScaduto > 0;
  const importo = scaduto ? stato.importoScaduto : stato.prossima ? stato.prossima.importo : stato.residuo;
  const tipo = scaduto
    ? stato.quote.length === 1
      ? stato.quote[0].tipo
      : "residuo"
    : stato.prossima
      ? stato.prossima.tipo
      : "saldo";
  return { importo, tipo, causale: causale(prev, tipo), scaduto };
}

const ITALIANO_GIORNI = (n) => `${n} ${n === 1 ? "giorno" : "giorni"}`;

export function descriviScadenza(stato) {
  if (stato.importoScaduto > 0) {
    if (stato.quote.length > 1)
      return `, scaduto in parte dal ${formatData(stato.quote[0].dal)} e in parte dal ${formatData(stato.quote[1].dal)}`;
    return `, scaduto il ${formatData(stato.scadutoDal)}${stato.giorniRitardo > 1 ? ` (da ${ITALIANO_GIORNI(stato.giorniRitardo)})` : ""}`;
  }
  return stato.prossima && stato.prossima.data ? `, in scadenza il ${formatData(stato.prossima.data)}` : "";
}

function righeIban(azienda, causaleTesto) {
  if (!azienda.iban) return "";
  return (
    `Può pagare con bonifico all'IBAN ${azienda.iban}` +
    (azienda.intestatarioIban ? ` intestato a ${azienda.intestatarioIban}` : "") +
    `, causale "${causaleTesto}".`
  );
}

export function messaggioSollecito(prev, azienda, stato, livello, { link = "" } = {}) {
  const a = azienda || {};
  const nome = prev.cliente && prev.cliente.nome ? ` ${prev.cliente.nome}` : "";
  // Senza importi scaduti si resta su richiesta o promemoria gentile: niente "entro 7 giorni".
  const { importo, tipo, causale: causaleTesto, scaduto } = daChiedere(prev, stato);
  if (!scaduto) livello = Math.min(livello, 1);
  const cosa =
    tipo === "acconto"
      ? `${prev.caparra ? "della caparra" : "dell'acconto"} di ${formatEuro(importo)}`
      : tipo === "saldo"
        ? `del saldo di ${formatEuro(importo)}`
        : `di ${formatEuro(importo)}`;
  const rif = `il preventivo n. ${prev.numero}${prev.oggetto ? ` "${prev.oggetto}"` : ""}`;
  const quando = descriviScadenza(stato);
  const firmato = prev.firma && prev.firma.img ? "accettato e firmato" : "accettato";
  const iban = righeIban(a, causaleTesto);
  const linkTxt = link ? `Qui trova importo, IBAN e QR per pagare: ${link}` : "";
  const firmaImpresa = [a.ragioneSociale, a.telefono].filter(Boolean).join(" - ");
  const corpo =
    {
      0: [
        `Buongiorno${nome},`,
        `le invio il riepilogo per il pagamento ${cosa} per ${rif}${quando}.`,
        iban,
        linkTxt,
        "Grazie!",
      ],
      1: [
        `Buongiorno${nome},`,
        `le ricordo il pagamento ${cosa} per ${rif}${quando}.`,
        iban,
        linkTxt,
        "Se ha già provveduto, non consideri questo messaggio. Grazie!",
      ],
      2: [
        `Buongiorno${nome},`,
        `non mi risulta ancora il pagamento ${cosa} per ${rif}, ${firmato} il ${formatData(stato.dataAccettazione || prev.data)}${quando}.`,
        `Le chiedo di provvedere entro 7 giorni. ${iban}`.trim(),
        linkTxt,
        "Se c'è qualche problema mi chiami pure: troviamo una soluzione.",
      ],
      3: [
        `Buongiorno${nome},`,
        `nonostante i precedenti solleciti, il pagamento ${cosa} per ${rif}, ${firmato} il ${formatData(stato.dataAccettazione || prev.data)}, risulta ancora non effettuato${quando}.`,
        "Se il pagamento non arriverà entro 7 giorni sarò costretto a inviarle una lettera formale di messa in mora e a tutelare il credito nelle sedi opportune, con addebito di interessi e spese.",
        iban,
        linkTxt,
      ],
    }[livello] || [];
  return [...corpo, firmaImpresa].filter(Boolean).join("\n");
}

export function messaggioRecensione(prev, azienda, link) {
  const nome = prev.cliente && prev.cliente.nome ? ` ${prev.cliente.nome}` : "";
  return [
    `Buongiorno${nome}, grazie per averci scelto${prev.oggetto ? ` per "${prev.oggetto}"` : ""}!`,
    "Se è soddisfatto del lavoro, ci aiuterebbe moltissimo una sua breve recensione (bastano 30 secondi):",
    link,
    azienda && azienda.ragioneSociale ? `Grazie di cuore, ${azienda.ragioneSociale}` : "Grazie di cuore!",
  ].join("\n");
}

// Pagati da poco e senza recensione chiesta: il momento migliore per chiederla.
export function daRecensire(preventivi, totaliDi, { oggi = oggiISO(), giorni = 45 } = {}) {
  return (preventivi || [])
    .filter((p) => p.stato === "accettato")
    .map((p) => ({ prev: p, stato: statoIncasso(p, totaliDi(p), { oggi }) }))
    .filter((x) => x.stato.fase === "pagato" && !x.stato.recensioneChiestaIl && x.stato.pagamenti.length)
    .filter((x) => giorniTra(x.stato.pagamenti[x.stato.pagamenti.length - 1].data, oggi) <= giorni)
    .sort((a, b) => b.stato.pagamenti.at(-1).data.localeCompare(a.stato.pagamenti.at(-1).data));
}

// ------------------------------------------------------------------
// Interessi di mora. Il tasso lo inserisce l'impresa: per i privati è il tasso legale
// (art. 1284 c.c., fissato ogni anno), per imprese e P.A. quello del D.Lgs. 231/2002
// (BCE + 8 punti, aggiornato ogni semestre).
// ------------------------------------------------------------------
export function interessiMora(importo, tassoAnnuo, giorni) {
  const t = parseNumero(String(tassoAnnuo ?? "").replace("%", ""));
  if (!(t > 0) || !(giorni > 0) || !(importo > 0)) return 0;
  return round2((importo * Math.min(t, 100) * giorni) / 36500);
}

// Interessi quota per quota, ciascuna dal giorno in cui è scaduta.
export function interessiQuote(quote, tassoAnnuo, oggi = oggiISO()) {
  return round2((quote || []).reduce((t, q) => t + interessiMora(q.importo, tassoAnnuo, giorniTra(q.dal, oggi)), 0));
}

// Partita IVA (11 cifre) = cliente impresa: interessi del D.Lgs. 231/2002; altrimenti privato.
export function clienteImpresa(cliente) {
  return /^(IT)?\d{11}$/i.test(String((cliente && cliente.cfpiva) || "").replace(/\s+/g, ""));
}

// ------------------------------------------------------------------
// IBAN e QR di pagamento SEPA (standard EPC069-12, "QR bonifico")
// ------------------------------------------------------------------
export function ibanCompatto(iban) {
  return String(iban || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function ibanValido(iban) {
  const s = ibanCompatto(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith("IT") && s.length !== 27) return false;
  let resto = 0;
  for (const ch of s.slice(4) + s.slice(0, 4)) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const cifra of v) resto = (resto * 10 + Number(cifra)) % 97;
  }
  return resto === 1;
}

// I campi del QR sono separati da "a capo": un a capo nel nome o nella causale sposterebbe
// i campi (per esempio l'IBAN), quindi caratteri di controllo e a capo vengono eliminati.
const campoEpc = (v, max) =>
  [
    ...String(v || "")
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ]
    .slice(0, max)
    .join("");

export function payloadEpc({ nome, iban, importo, causale: causaleTesto }) {
  const conto = ibanCompatto(iban);
  const beneficiario = campoEpc(nome, 70);
  if (!ibanValido(conto) || !beneficiario) return null;
  const euro = round2(Number(importo) || 0);
  const linee = [
    "BCD",
    "002",
    "1", // UTF-8
    "SCT",
    "", // BIC facoltativo nello Spazio economico europeo
    beneficiario,
    conto,
    euro >= 0.01 && euro <= 999999999.99 ? `EUR${euro.toFixed(2)}` : "",
    "",
    "",
    campoEpc(causaleTesto, 140),
  ];
  const payload = linee.join("\n");
  return new TextEncoder().encode(payload).length <= 331 ? payload : null;
}

// ------------------------------------------------------------------
// Calendario (.ics): inizio lavori nel calendario del telefono
// ------------------------------------------------------------------
export const ORARI_FASCIA = { mattina: ["080000", "130000"], pomeriggio: ["140000", "190000"] };

// Si taglia PRIMA di aggiungere gli escape, così non resta mai una barra "orfana" in fondo.
function escIcs(v, max) {
  return [...String(v || "")]
    .slice(0, max)
    .join("")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Righe lunghe "piegate" a 74 caratteri come richiede lo standard.
function piega(riga) {
  const pezzi = [];
  let resto = [...riga];
  while (resto.length > 74) {
    pezzi.push(resto.slice(0, 74).join(""));
    resto = resto.slice(74);
  }
  pezzi.push(resto.join(""));
  return pezzi.join("\r\n ");
}

export function creaIcs({ id, titolo, data, fascia, luogo = "", descrizione = "", ora = new Date() }) {
  if (!dataValida(data)) return "";
  const giorno = data.replace(/-/g, "");
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${ora.getUTCFullYear()}${p(ora.getUTCMonth() + 1)}${p(ora.getUTCDate())}T${p(ora.getUTCHours())}${p(ora.getUTCMinutes())}${p(ora.getUTCSeconds())}Z`;
  const orari = ORARI_FASCIA[fascia];
  const inizio = orari ? `DTSTART:${giorno}T${orari[0]}` : `DTSTART;VALUE=DATE:${giorno}`;
  const fine = orari ? `DTEND:${giorno}T${orari[1]}` : `DTEND;VALUE=DATE:${aggiungiGiorni(data, 1).replace(/-/g, "")}`;
  const righe = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PreventivoLampo//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${String(id || uid()).replace(/[^A-Za-z0-9_-]/g, "")}@preventivolampo`,
    `DTSTAMP:${stamp}`,
    inizio,
    fine,
    `SUMMARY:${escIcs(titolo, 300)}`,
    luogo ? `LOCATION:${escIcs(luogo, 300)}` : "",
    descrizione ? `DESCRIPTION:${escIcs(descrizione, 1500)}` : "",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Promemoria",
    "TRIGGER:-PT12H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return righe.map(piega).join("\r\n") + "\r\n";
}

export function testoAppuntamento(app) {
  if (!app) return "";
  const giorno = new Date(app.data + "T12:00:00").toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return `${giorno}${app.fascia && app.fascia !== "giornata" ? `, ${FASCE[app.fascia].toLowerCase()}` : ""}`;
}

// Lavori in agenda nei prossimi giorni (accettati, con data concordata).
export function prossimiLavori(preventivi, { oggi = oggiISO(), giorni = 30 } = {}) {
  const limite = aggiungiGiorni(oggi, giorni);
  return (preventivi || [])
    .filter((p) => p.stato === "accettato")
    .map((p) => ({ prev: p, app: normalizzaAppuntamento(p.appuntamento) }))
    .filter((x) => x.app && x.app.data >= oggi && x.app.data <= limite)
    .sort((a, b) => a.app.data.localeCompare(b.app.data) || a.app.fascia.localeCompare(b.app.fascia));
}

export function titoloAgenda(prev) {
  return `${nomeCliente(prev.cliente)}${prev.oggetto ? ` - ${prev.oggetto}` : ""}`;
}
