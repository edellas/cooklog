// Accettazione online senza server.
// Il preventivo viaggia compresso nel "frammento" del link (la parte dopo #), che i browser
// non inviano mai al server: nessun dato del cliente passa da noi.
// Il cliente lo apre, sceglie le voci facoltative, firma e rimanda all'artigiano un secondo link
// con l'accettazione. Un'impronta SHA-256 permette all'app di accorgersi se i dati sono stati alterati.
import { parseNumero, oggiISO } from "./core.js";

export const VERSIONE_LINK = 1;
export const MAX_LUNGHEZZA_LINK = 16000; // WhatsApp e i browser gestiscono link molto più lunghi
const MAX_DECOMPRESSO = 256 * 1024; // protezione da "bombe" di compressione

// ---------------- base64url ----------------
function b64urlDaBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesDaB64url(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("Link non valido");
  if (str.length % 4 === 1) throw new Error("Link incompleto o danneggiato");
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  let bin;
  try {
    bin = atob(b64);
  } catch {
    throw new Error("Link incompleto o danneggiato");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------- compressione ----------------
async function leggiLimitato(stream, max) {
  const reader = stream.getReader();
  const pezzi = [];
  let totale = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totale += value.length;
    if (totale > max) {
      await reader.cancel();
      throw new Error("Link troppo grande");
    }
    pezzi.push(value);
  }
  const out = new Uint8Array(totale);
  let pos = 0;
  for (const p of pezzi) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export async function comprimi(testo) {
  const bytes = new TextEncoder().encode(testo);
  if (typeof CompressionStream === "undefined") return "j" + b64urlDaBytes(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return "z" + b64urlDaBytes(await leggiLimitato(stream, MAX_DECOMPRESSO));
}

export async function decomprimi(stringa) {
  const s = String(stringa || "");
  if (s.length > MAX_LUNGHEZZA_LINK * 2) throw new Error("Link troppo grande");
  const tipo = s[0];
  const bytes = bytesDaB64url(s.slice(1));
  if (tipo === "j") {
    if (bytes.length > MAX_DECOMPRESSO) throw new Error("Link troppo grande");
    return new TextDecoder().decode(bytes);
  }
  if (tipo === "z") {
    if (typeof DecompressionStream === "undefined") throw new Error("Browser troppo vecchio per aprire il link");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    try {
      return new TextDecoder().decode(await leggiLimitato(stream, MAX_DECOMPRESSO));
    } catch (err) {
      if (err.message === "Link troppo grande") throw err;
      throw new Error("Link incompleto o danneggiato");
    }
  }
  throw new Error("Link non valido");
}

export async function impronta(testo) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(testo));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------- sanificazione ----------------
// Tutto ciò che arriva da un link è considerato ostile: tipi, lunghezze e formati vengono forzati.
const str = (v, max) =>
  typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "";
const num = (v, min, max) => {
  const n = typeof v === "number" ? v : parseNumero(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
};
const telefono = (v) => str(v, 25).replace(/[^\d+ ]/g, "");
const iban = (v) =>
  str(v, 40)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "");
const colore = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : "#1d4ed8");
const dataIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : oggiISO());

export function urlSicuro(v) {
  const s = str(v, 500).trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
  } catch {
    return "";
  }
}

// ---------------- preventivo -> dati del link ----------------
export function datiPerLink(prev, azienda, { pro }) {
  const a = azienda || {};
  return {
    v: VERSIONE_LINK,
    id: prev.id,
    n: prev.numero,
    d: prev.data,
    vg: Number(prev.validitaGiorni) || 0,
    az: {
      r: a.ragioneSociale || "",
      pi: a.piva || "",
      t: a.telefono || "",
      e: a.email || "",
      i: a.indirizzo || "",
      c: [a.cap, a.citta, a.provincia ? `(${a.provincia})` : ""].filter(Boolean).join(" "),
      ib: a.iban || "",
      it: a.intestatarioIban || "",
      pay: a.linkPagamento || "",
      col: pro ? a.colore || "" : "",
    },
    cl: { n: prev.cliente?.nome || "", i: prev.cliente?.indirizzo || "", c: prev.cliente?.citta || "" },
    o: prev.oggetto || "",
    l: prev.luogo || "",
    // Il costo d'acquisto (guadagno) non viene MAI inserito nel link.
    r: (prev.righe || []).map((r) => [
      r.descrizione || "",
      Number(r.qta) || 0,
      r.um || "",
      Number(r.prezzo) || 0,
      Number(r.sconto) || 0,
      Number(r.iva) || 0,
      r.tipo === "mat" ? "mat" : "man",
      r.opzionale ? 1 : 0,
    ]),
    sg: Number(prev.scontoGlobale) || 0,
    ac: [prev.acconto?.tipo === "importo" ? "importo" : "perc", Number(prev.acconto?.valore) || 0],
    rg: prev.regime === "forfettario" ? "f" : "o",
    bo: prev.addebitaBollo === false ? 0 : 1,
    ff: prev.regime === "forfettario" ? a.fraseForfettario || "" : "",
    pg: prev.pagamento || "",
    tm: prev.tempi || "",
    nt: prev.note || "",
    wm: pro ? 0 : 1,
  };
}

export async function creaLinkAccettazione(base, prev, azienda, opzioni) {
  const codice = await comprimi(JSON.stringify(datiPerLink(prev, azienda, opzioni)));
  const url = `${base}accetta.html#${codice}`;
  return { url, codice, hash: await impronta(codice), troppoLungo: url.length > MAX_LUNGHEZZA_LINK };
}

// Dati del link (non fidati) -> preventivo da mostrare, con tutti i campi sanificati.
export function preventivoDaDati(d) {
  if (!d || typeof d !== "object" || d.v !== VERSIONE_LINK)
    throw new Error("Link non valido o creato con una versione diversa");
  const az = d.az && typeof d.az === "object" ? d.az : {};
  const cl = d.cl && typeof d.cl === "object" ? d.cl : {};
  const righe = (Array.isArray(d.r) ? d.r : []).slice(0, 200).map((r, i) => {
    const x = Array.isArray(r) ? r : [];
    return {
      id: "r" + i,
      descrizione: str(x[0], 600),
      qta: num(x[1], 0, 1e6),
      um: str(x[2], 20) || "cad",
      prezzo: num(x[3], 0, 1e7),
      sconto: num(x[4], 0, 100),
      iva: num(x[5], 0, 100),
      tipo: x[6] === "mat" ? "mat" : "man",
      opzionale: x[7] === 1,
    };
  });
  const ac = Array.isArray(d.ac) ? d.ac : [];
  return {
    id: str(d.id, 64).replace(/[^a-zA-Z0-9-]/g, ""),
    numero: str(d.n, 40),
    data: dataIso(d.d),
    validitaGiorni: Math.round(num(d.vg, 0, 3650)),
    regime: d.rg === "f" ? "forfettario" : "ordinario",
    addebitaBollo: d.bo !== 0,
    cliente: {
      nome: str(cl.n, 120),
      indirizzo: str(cl.i, 200),
      citta: str(cl.c, 120),
      telefono: "",
      email: "",
      cfpiva: "",
    },
    oggetto: str(d.o, 300),
    luogo: str(d.l, 200),
    righe,
    scontoGlobale: num(d.sg, 0, 100),
    acconto: { tipo: ac[0] === "importo" ? "importo" : "perc", valore: num(ac[1], 0, 1e7) },
    pagamento: str(d.pg, 1000),
    tempi: str(d.tm, 300),
    note: str(d.nt, 3000),
    firma: null,
    azienda: {
      ragioneSociale: str(az.r, 120),
      piva: str(az.pi, 30),
      telefono: telefono(az.t),
      email: str(az.e, 120),
      indirizzo: str(az.i, 200),
      citta: str(az.c, 120),
      iban: iban(az.ib),
      intestatarioIban: str(az.it, 120),
      linkPagamento: urlSicuro(az.pay),
      colore: colore(az.col),
      fraseForfettario: str(d.ff, 600),
    },
    conMarchio: d.wm !== 0,
  };
}

export async function leggiLinkAccettazione(codice) {
  const testo = await decomprimi(codice);
  let dati;
  try {
    dati = JSON.parse(testo);
  } catch {
    throw new Error("Link danneggiato");
  }
  return { prev: preventivoDaDati(dati), hash: await impronta(codice) };
}

// ---------------- risposta del cliente ----------------
// scelte: indici delle voci facoltative scelte; descrizioni: le stesse voci, per controllo e riepilogo.
export async function creaLinkConferma(base, { id, numero, hash, scelte, descrizioni, nome, firma }) {
  const dati = {
    v: VERSIONE_LINK,
    id,
    n: numero,
    h: hash,
    s: scelte,
    sd: descrizioni,
    nm: nome,
    dt: new Date().toISOString(),
    f: firma,
  };
  return `${base}app.html#/accettazione?d=${await comprimi(JSON.stringify(dati))}`;
}

export async function leggiConferma(codice) {
  let d;
  try {
    d = JSON.parse(await decomprimi(codice));
  } catch (err) {
    throw new Error(err.message && err.message.startsWith("Link") ? err.message : "Conferma non valida");
  }
  if (!d || d.v !== VERSIONE_LINK) throw new Error("Conferma non valida");
  const dt = Date.parse(d.dt);
  return {
    id: str(d.id, 64).replace(/[^a-zA-Z0-9-]/g, ""),
    numero: str(d.n, 40),
    hash: str(d.h, 64).replace(/[^0-9a-f]/g, ""),
    scelte: (Array.isArray(d.s) ? d.s : []).filter((i) => Number.isInteger(i) && i >= 0 && i < 200).slice(0, 200),
    descrizioni: (Array.isArray(d.sd) ? d.sd : []).slice(0, 200).map((x) => str(x, 600)),
    nome: str(d.nm, 120),
    data: Number.isFinite(dt) ? new Date(dt).toISOString() : new Date().toISOString(),
    firma: Array.isArray(d.f) ? d.f : [],
  };
}

// Applica al preventivo l'accettazione ricevuta: le voci facoltative scelte entrano nel totale.
// Ogni voce scelta si cerca per posizione e si controlla la descrizione; se il preventivo è stato
// riordinato nel frattempo, si cerca per descrizione tra le voci ancora facoltative.
export function voceDaConferma(prev, conferma, k) {
  const i = conferma.scelte[k];
  const descr = conferma.descrizioni[k];
  const r = prev.righe[i];
  if (r && r.opzionale && (descr === undefined || r.descrizione === descr)) return r;
  return descr !== undefined ? prev.righe.find((x) => x.opzionale && x.descrizione === descr) || null : null;
}

export function applicaConferma(prev, conferma, firmaPng) {
  const facoltative = [];
  conferma.scelte.forEach((_, k) => {
    const r = voceDaConferma(prev, conferma, k);
    if (r && r.opzionale) {
      r.opzionale = false;
      facoltative.push(r.descrizione);
    }
  });
  prev.firma = { img: firmaPng, nome: conferma.nome, luogo: "", data: conferma.data, online: true };
  prev.stato = "accettato";
  prev.accettazioneOnline = { il: Date.now(), hash: conferma.hash, facoltativeAggiunte: facoltative };
  return facoltative;
}

export function verificaImpronta(prev, hash) {
  if (prev.link && prev.link.hash === hash) return "ok";
  if ((prev.linkPrecedenti || []).includes(hash)) return "precedente";
  return "diversa";
}
