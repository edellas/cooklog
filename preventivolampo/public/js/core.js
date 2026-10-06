// Logica pura (nessun DOM): calcoli, formattazione, numerazione, dettatura.
// Importabile sia dal browser sia da Node per i test.

export const STATI = {
  bozza: "Bozza",
  inviato: "Inviato",
  accettato: "Accettato",
  rifiutato: "Rifiutato",
};

export const ALIQUOTE_IVA = [22, 10, 5, 4, 0];

export const UNITA = [
  "cad",
  "ora",
  "mq",
  "ml",
  "mc",
  "kg",
  "l",
  "km",
  "giorno",
  "mese",
  "anno",
  "intervento",
  "a corpo",
];

export const FRASE_FORFETTARIO =
  "Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, della Legge n. 190/2014 (regime forfettario): operazione senza applicazione dell'IVA.";

export const SOGLIA_BOLLO = 77.47;
export const IMPORTO_BOLLO = 2;

export function round2(n) {
  const x = Number(n) || 0;
  // toPrecision elimina l'errore binario (264.15 * 30 = 7924.4999...) prima di arrotondare.
  return Math.round(Number((x * 100).toPrecision(15))) / 100;
}

// "1.234,56" / "1234.56" / "12,5" / 12 -> numero. Restituisce 0 se non valido.
export function parseNumero(valore) {
  if (typeof valore === "number") return Number.isFinite(valore) ? valore : 0;
  if (valore == null) return 0;
  let s = String(valore).trim().replace(/[€\s]/g, "");
  if (!s) return 0;
  const haPunto = s.includes(".");
  const haVirgola = s.includes(",");
  if (haPunto && haVirgola) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (haVirgola) {
    s = s.replace(",", ".");
  } else if (haPunto && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Formattazione italiana deterministica (non dipende dall'ICU del dispositivo).
export function formatNumero(n, decimali = 2) {
  const x = round2(n);
  const negativo = x < 0;
  const [intera, dec] = Math.abs(x).toFixed(decimali).split(".");
  const conPunti = intera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (negativo ? "-" : "") + conPunti + (decimali > 0 ? "," + dec : "");
}

export function formatEuro(n) {
  return "€ " + formatNumero(n, 2);
}

// Quantità: fino a 2 decimali, senza zeri inutili ("1,5", "3").
export function formatQta(n) {
  const x = round2(n);
  if (Number.isInteger(x)) return formatNumero(x, 0);
  return formatNumero(x, 2).replace(/0$/, "");
}

export function oggiISO(d = new Date()) {
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function aggiungiGiorni(iso, giorni) {
  const [a, m, g] = iso.split("-").map(Number);
  const d = new Date(a, m - 1, g + Number(giorni || 0));
  return oggiISO(d);
}

export function formatData(iso) {
  if (!iso) return "";
  const [a, m, g] = iso.split("-");
  return `${g}/${m}/${a}`;
}

export function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function importoRiga(riga) {
  const lordo = parseNumero(riga.qta) * parseNumero(riga.prezzo);
  const sconto = Math.min(Math.max(parseNumero(riga.sconto), 0), 100);
  return round2(lordo * (1 - sconto / 100));
}

// Calcola tutti i totali del preventivo.
// opzioni: { regime: "ordinario" | "forfettario", addebitaBollo: boolean }
export function calcolaTotali(prev, opzioni = {}) {
  const forfettario = opzioni.regime === "forfettario";
  const righe = (prev.righe || []).map((r) => ({ ...r, importo: importoRiga(r) }));

  const imponibileRighe = round2(righe.reduce((s, r) => s + r.importo, 0));
  const sg = Math.min(Math.max(parseNumero(prev.scontoGlobale), 0), 100);
  const scontoImporto = round2((imponibileRighe * sg) / 100);
  const imponibile = round2(imponibileRighe - scontoImporto);

  const subtotali = { man: 0, mat: 0, altro: 0 };
  for (const r of righe) {
    const k = r.tipo === "man" || r.tipo === "mat" ? r.tipo : "altro";
    subtotali[k] = round2(subtotali[k] + r.importo);
  }

  // Riepilogo IVA per aliquota. Lo sconto globale si ripartisce in proporzione
  // e l'ultimo gruppo assorbe gli arrotondamenti, così la somma torna sempre.
  const gruppi = new Map();
  for (const r of righe) {
    const aliquota = forfettario ? 0 : parseNumero(r.iva ?? opzioni.ivaDefault ?? 22);
    gruppi.set(aliquota, round2((gruppi.get(aliquota) || 0) + r.importo));
  }
  const aliquote = [...gruppi.keys()].sort((a, b) => b - a);
  const riepilogoIva = [];
  let assegnato = 0;
  aliquote.forEach((aliquota, i) => {
    const base =
      i === aliquote.length - 1 ? round2(imponibile - assegnato) : round2(gruppi.get(aliquota) * (1 - sg / 100));
    assegnato = round2(assegnato + base);
    riepilogoIva.push({ aliquota, imponibile: base, imposta: round2((base * aliquota) / 100) });
  });
  const iva = round2(riepilogoIva.reduce((s, g) => s + g.imposta, 0));

  const bollo = forfettario && opzioni.addebitaBollo && imponibile > SOGLIA_BOLLO ? IMPORTO_BOLLO : 0;
  const totale = round2(imponibile + iva + bollo);

  let acconto = 0;
  const a = prev.acconto || {};
  const va = parseNumero(a.valore);
  if (va > 0) {
    acconto = a.tipo === "importo" ? Math.min(round2(va), totale) : round2((totale * Math.min(va, 100)) / 100);
  }

  return {
    righe,
    imponibileRighe,
    scontoPerc: sg,
    scontoImporto,
    imponibile,
    subtotali,
    riepilogoIva,
    iva,
    bollo,
    totale,
    acconto,
    saldo: round2(totale - acconto),
    forfettario,
  };
}

// Numerazione progressiva per anno: "2026-001", con prefisso opzionale ("P-2026-001").
export function prossimoNumero(preventivi, anno, prefisso = "") {
  const max = (preventivi || [])
    .filter((p) => Number(p.anno) === Number(anno))
    .reduce((m, p) => Math.max(m, Number(p.progressivo) || 0), 0);
  const progressivo = max + 1;
  return {
    anno: Number(anno),
    progressivo,
    numero: `${prefisso || ""}${anno}-${String(progressivo).padStart(3, "0")}`,
  };
}

const NUMERI_PAROLE = {
  un: 1,
  uno: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
  quindici: 15,
  venti: 20,
  trenta: 30,
  quaranta: 40,
  cinquanta: 50,
  cento: 100,
  mezzo: 0.5,
  mezza: 0.5,
};

const UNITA_PAROLE = [
  [/^(metri quadri|metri quadrati|metro quadro|metro quadrato|mq|m2|metriquadri)$/, "mq"],
  [/^(metri lineari|metro lineare|ml)$/, "ml"],
  [/^(metri cubi|metro cubo|mc|m3)$/, "mc"],
  [/^(metri|metro|m)$/, "ml"],
  [/^(ore|ora|h)$/, "ora"],
  [/^(pezzi|pezzo|pz|unità|cad|cadauno)$/, "cad"],
  [/^(chili|chilo|kg|chilogrammi)$/, "kg"],
  [/^(litri|litro|l)$/, "l"],
  [/^(giorni|giorno|giornate|giornata)$/, "giorno"],
  [/^(mesi|mese)$/, "mese"],
  [/^(interventi|intervento)$/, "intervento"],
  [/^(km|chilometri)$/, "km"],
];

const RE_UNITA =
  "(metri quadri|metri quadrati|metro quadro|metro quadrato|metri lineari|metro lineare|metri cubi|metro cubo|mq|m2|ml|mc|m3|metri|metro|ore|ora|pezzi|pezzo|pz|chili|chilo|kg|litri|litro|giorni|giorno|giornate|giornata|mesi|mese|interventi|intervento|km|chilometri)";

function unitaDa(parola) {
  const p = parola.toLowerCase().trim();
  for (const [re, u] of UNITA_PAROLE) if (re.test(p)) return u;
  return null;
}

function numeroDa(token) {
  const t = token.toLowerCase();
  if (t in NUMERI_PAROLE) return NUMERI_PAROLE[t];
  return parseNumero(t);
}

// Trasforma una frase dettata in una riga di preventivo.
// "sostituzione rubinetto cucina 2 pezzi 85 euro" -> { descrizione, qta: 2, um: "cad", prezzo: 85 }
export function parseDettatura(testo) {
  let s =
    " " +
    String(testo || "")
      .replace(/€/g, " euro ")
      .replace(/\s+/g, " ")
      .trim() +
    " ";
  let prezzo = 0;
  let qta = 1;
  let um = null;
  const NUM = "(\\d+(?:[.,]\\d+)*|" + Object.keys(NUMERI_PAROLE).join("|") + ")";

  // Prezzo: "85 euro", "85,50 euro", "85 euro e 50", eventualmente seguito da "l'ora", "al metro"...
  const rePrezzo = new RegExp(
    "(?:\\s(?:a|al prezzo di|prezzo|da|per|costo))?\\s" +
      NUM +
      "\\s?(?:euro|eur)(?:\\s+e\\s+(\\d{1,2})(?:\\s+centesimi)?)?" +
      "(?:\\s+(?:l'|all'|al|a|per)\\s?(ora|metro quadro|metro quadrato|metro lineare|metro|mq|pezzo|giorno|mese|intervento))?",
    "i",
  );
  const mp = s.match(rePrezzo);
  if (mp) {
    prezzo = numeroDa(mp[1]);
    if (mp[2]) prezzo = round2(prezzo + Number(mp[2]) / 100);
    if (mp[3]) um = unitaDa(mp[3]);
    s = s.replace(mp[0], " ");
  }

  // Quantità + unità: "2 pezzi", "20 metri quadri", "tre ore"
  const reQta = new RegExp("\\s(?:x\\s?)?" + NUM + "\\s" + RE_UNITA + "(?=[\\s,.;])", "i");
  const mq = s.match(reQta);
  if (mq) {
    qta = numeroDa(mq[1]) || 1;
    um = unitaDa(mq[2]) || um;
    s = s.replace(mq[0], " ");
  } else {
    const reX = /\s(?:x|per)\s?(\d+(?:[.,]\d+)?)(?=\s)/i;
    const mx = s.match(reX);
    if (mx) {
      qta = parseNumero(mx[1]) || 1;
      s = s.replace(mx[0], " ");
    }
  }

  let descrizione = s
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .replace(/\s(?:a|al|per|da|di|x|e|con|totale|prezzo)$/i, "")
    .trim();
  descrizione = descrizione.charAt(0).toUpperCase() + descrizione.slice(1);

  return { descrizione, qta, um: um || "cad", prezzo: round2(prezzo) };
}

export function nomeCliente(c) {
  return (c && (c.nome || "").trim()) || "Cliente";
}

export function testoWhatsApp(prev, azienda, totali) {
  const saluto = prev.cliente && prev.cliente.nome ? `Buongiorno ${prev.cliente.nome},` : "Buongiorno,";
  const oggetto = prev.oggetto ? ` per "${prev.oggetto}"` : "";
  const ivaTxt = totali.forfettario ? "" : " IVA inclusa";
  const firma = [azienda.ragioneSociale, azienda.telefono].filter(Boolean).join(" - ");
  return (
    `${saluto} le invio il preventivo n. ${prev.numero}${oggetto}.\n` +
    `Totale: ${formatEuro(totali.totale)}${ivaTxt}.\n` +
    `Resto a disposizione per qualsiasi chiarimento.` +
    (firma ? `\n${firma}` : "")
  );
}

// Nome file sicuro: "Preventivo-2026-001-Rossi.pdf"
export function nomeFilePdf(prev) {
  const cliente = nomeCliente(prev.cliente)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  return `Preventivo-${prev.numero}${cliente ? "-" + cliente : ""}.pdf`;
}

// Limite piano gratuito: N preventivi diversi esportati in PDF al mese.
// Riesportare lo stesso preventivo (anteprima, correzioni) non consuma il limite.
export function meseCorrente(d = new Date()) {
  return oggiISO(d).slice(0, 7);
}

function idsDelMese(contatore, d) {
  return contatore && contatore.mese === meseCorrente(d) && Array.isArray(contatore.ids) ? contatore.ids : [];
}

export function pdfRimasti(contatore, limite, d = new Date()) {
  return Math.max(limite - idsDelMese(contatore, d).length, 0);
}

export function puoEsportare(contatore, limite, idPreventivo, d = new Date()) {
  const ids = idsDelMese(contatore, d);
  return ids.includes(idPreventivo) || ids.length < limite;
}

export function registraEsportazione(contatore, idPreventivo, d = new Date()) {
  const ids = idsDelMese(contatore, d);
  return { mese: meseCorrente(d), ids: ids.includes(idPreventivo) ? ids : [...ids, idPreventivo] };
}

// Telefono per link wa.me: solo cifre, prefisso 39 se manca.
export function telefonoWhatsApp(tel) {
  let d = String(tel || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.length <= 10 && /^3\d{8,9}$/.test(d)) d = "39" + d;
  return d.replace(/\D/g, "");
}

export function preventivoVuoto(azienda, numerazione, oggi = oggiISO()) {
  return {
    id: uid(),
    numero: numerazione.numero,
    anno: numerazione.anno,
    progressivo: numerazione.progressivo,
    data: oggi,
    validitaGiorni: Number(azienda.validitaGiorni) || 30,
    stato: "bozza",
    // Il regime fiscale è "fotografato" alla creazione: cambiarlo nelle impostazioni
    // non deve modificare i totali dei preventivi già fatti.
    regime: azienda.regime === "forfettario" ? "forfettario" : "ordinario",
    addebitaBollo: azienda.addebitaBollo !== false,
    clienteId: null,
    cliente: { nome: "", indirizzo: "", citta: "", cfpiva: "", telefono: "", email: "" },
    oggetto: "",
    luogo: "",
    righe: [],
    scontoGlobale: 0,
    acconto: { tipo: "perc", valore: 0 },
    pagamento: azienda.pagamento || "",
    tempi: "",
    note: azienda.condizioni || "",
    firma: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function rigaVuota(ivaDefault = 22, base = {}) {
  return {
    id: uid(),
    descrizione: base.descrizione || "",
    qta: base.qta ?? 1,
    um: base.um || "cad",
    prezzo: base.prezzo ?? 0,
    sconto: 0,
    iva: base.iva ?? ivaDefault,
    tipo: base.tipo || "man",
  };
}
