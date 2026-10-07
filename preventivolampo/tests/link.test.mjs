import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comprimi,
  decomprimi,
  impronta,
  datiPerLink,
  creaLinkAccettazione,
  leggiLinkAccettazione,
  preventivoDaDati,
  creaLinkConferma,
  leggiConferma,
  applicaConferma,
  verificaImpronta,
  urlSicuro,
  MAX_LUNGHEZZA_LINK,
  creaLinkRichiesta,
  leggiLinkCliente,
  richiestaDaDati,
  datiRichiesta,
  creaLinkAvviso,
  leggiAvviso,
  dataDaConferma,
} from "../public/js/link.js";
import { codificaTratti, decodificaTratti, semplifica, lunghezzaTratti } from "../public/js/firma.js";
import { calcolaTotali } from "../public/js/core.js";

const AZIENDA = {
  ragioneSociale: "Idraulica Rossi",
  piva: "01234567890",
  telefono: "333 1234567",
  email: "info@rossi.it",
  cap: "24100",
  citta: "Bergamo",
  provincia: "BG",
  iban: "IT60X0542811101000000123456",
  linkPagamento: "https://paypal.me/idraulicarossi",
  colore: "#e11d48",
};

function preventivo() {
  return {
    id: "8f0c2a1e-1111-4222-8333-944445555666",
    numero: "2026-007",
    data: "2026-10-06",
    validitaGiorni: 30,
    regime: "ordinario",
    cliente: {
      nome: "Giulia Bianchi",
      indirizzo: "Via Roma 1",
      citta: "Bergamo",
      telefono: "347 000",
      email: "g@b.it",
    },
    oggetto: "Bagno",
    righe: [
      { descrizione: "Miscelatore", qta: 1, um: "cad", prezzo: 85, sconto: 0, iva: 22, tipo: "mat", costo: 52 },
      { descrizione: "Manodopera", qta: 2, um: "ora", prezzo: 38, sconto: 0, iva: 22, tipo: "man" },
      {
        descrizione: "Sostituzione sifone",
        qta: 1,
        um: "cad",
        prezzo: 45,
        sconto: 0,
        iva: 22,
        tipo: "man",
        opzionale: true,
      },
      {
        descrizione: "Pulizia caldaia",
        qta: 1,
        um: "cad",
        prezzo: 90,
        sconto: 0,
        iva: 22,
        tipo: "man",
        opzionale: true,
      },
    ],
    scontoGlobale: 0,
    acconto: { tipo: "perc", valore: 30 },
    pagamento: "Bonifico",
    note: "Note",
  };
}

test("compressione: andata e ritorno, testo accentato ed emoji", async () => {
  const testo = JSON.stringify({ a: "àèìòù € 😀".repeat(50) });
  const c = await comprimi(testo);
  assert.match(c, /^z[A-Za-z0-9_-]+$/);
  assert.ok(c.length < testo.length);
  assert.equal(await decomprimi(c), testo);
  assert.equal(await impronta(c), await impronta(c));
  assert.equal((await impronta(c)).length, 24);
});

test("link non validi o ostili vengono rifiutati con un messaggio chiaro", async () => {
  await assert.rejects(decomprimi("z@@@"), /non valido/);
  await assert.rejects(decomprimi("xabc"), /non valido/);
  await assert.rejects(decomprimi(""), /non valido/);
  const c = await comprimi("ciao mondo ".repeat(100));
  await assert.rejects(decomprimi(c.slice(0, c.length - 10)), /danneggiato|incompleto/);
  // "bomba" di compressione: pochi byte che diventano molti megabyte
  const bomba = await comprimi("0".repeat(5 * 1024 * 1024));
  assert.ok(bomba.length < 20000);
  await assert.rejects(decomprimi(bomba), /troppo grande/);
});

test("il link non contiene mai costi, telefono ed email del cliente", async () => {
  const dati = datiPerLink(preventivo(), AZIENDA, { pro: true });
  const json = JSON.stringify(dati);
  assert.ok(!json.includes("52"), "il costo d'acquisto non deve finire nel link");
  assert.ok(!json.includes("347 000"));
  assert.ok(!json.includes("g@b.it"));
  assert.equal(dati.az.col, "#e11d48");
  assert.equal(datiPerLink(preventivo(), AZIENDA, { pro: false }).az.col, "");
  assert.equal(datiPerLink(preventivo(), AZIENDA, { pro: false }).wm, 1);
});

test("andata e ritorno del preventivo: stessi totali, facoltative comprese", async () => {
  const prev = preventivo();
  const { url, codice, hash, troppoLungo } = await creaLinkAccettazione("https://x.it/", prev, AZIENDA, { pro: true });
  assert.ok(url.startsWith("https://x.it/accetta.html#z"));
  assert.equal(troppoLungo, false);
  const letto = await leggiLinkAccettazione(codice);
  assert.equal(letto.hash, hash);
  assert.equal(letto.prev.numero, "2026-007");
  assert.equal(letto.prev.azienda.linkPagamento, "https://paypal.me/idraulicarossi");
  const a = calcolaTotali(prev, { regime: "ordinario" });
  const b = calcolaTotali(letto.prev, { regime: "ordinario" });
  assert.equal(b.totale, a.totale);
  assert.equal(b.opzionali.length, 2);
});

test("un preventivo lungo resta sotto il limite di lunghezza del link", async () => {
  const prev = preventivo();
  prev.righe = Array.from({ length: 60 }, (_, i) => ({
    descrizione: `Voce numero ${i} con una descrizione abbastanza lunga e realistica del lavoro`,
    qta: 1,
    um: "cad",
    prezzo: 10 + i,
    iva: 22,
    tipo: "man",
  }));
  prev.note = "Condizioni generali ".repeat(40);
  const { url } = await creaLinkAccettazione("https://x.it/", prev, AZIENDA, { pro: true });
  assert.ok(url.length < MAX_LUNGHEZZA_LINK, `link lungo ${url.length}`);
});

test("sanificazione: dati ostili nel link vengono neutralizzati", () => {
  const p = preventivoDaDati({
    v: 1,
    id: "abc<script>",
    n: "1".repeat(500),
    d: "2026-13-99<b>",
    vg: 1e9,
    az: {
      r: "<img src=x onerror=alert(1)>",
      t: "+39 333<script>",
      ib: "it60 x054<>",
      pay: "javascript:alert(1)",
      col: "red;background:url(x)",
    },
    cl: { n: { toString: () => "x" } },
    r: [
      ["Voce", "1e9", "cad", -50, 500, 999, "evil", 1],
      "non un array",
      ...Array.from({ length: 300 }, () => ["x", 1, "cad", 1, 0, 22, "man", 0]),
    ],
    sg: -10,
    ac: ["importo", "1e99"],
    rg: "f",
  });
  assert.equal(p.id, "abcscript");
  assert.equal(p.numero.length, 40);
  assert.match(p.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(p.data, "2026-13-99<b>");
  assert.equal(p.validitaGiorni, 3650);
  assert.equal(p.azienda.ragioneSociale, "<img src=x onerror=alert(1)>"); // resta testo: viene sempre mostrato con escape
  assert.equal(p.azienda.telefono, "+39 333");
  assert.equal(p.azienda.iban, "IT60 X054");
  assert.equal(p.azienda.linkPagamento, "");
  assert.equal(p.azienda.colore, "#1d4ed8");
  assert.equal(p.cliente.nome, "");
  assert.equal(p.righe.length, 200);
  assert.deepEqual(
    [p.righe[0].qta, p.righe[0].prezzo, p.righe[0].sconto, p.righe[0].iva, p.righe[0].tipo, p.righe[0].opzionale],
    [1e6, 0, 100, 100, "man", true],
  );
  assert.equal(p.righe[1].descrizione, "");
  assert.equal(p.scontoGlobale, 0);
  assert.equal(p.acconto.valore, 1e7);
  assert.equal(p.regime, "forfettario");
  assert.throws(() => preventivoDaDati({ v: 2 }), /versione/);
  assert.throws(() => preventivoDaDati(null), /non valido/);
});

test("solo link di pagamento https senza credenziali", () => {
  assert.equal(urlSicuro("https://paypal.me/x"), "https://paypal.me/x");
  assert.equal(urlSicuro("http://paypal.me/x"), "");
  assert.equal(urlSicuro("javascript:alert(1)"), "");
  assert.equal(urlSicuro("data:text/html,<script>"), "");
  assert.equal(urlSicuro("https://user:pass@evil.com"), "");
  assert.equal(urlSicuro("non un url"), "");
});

test("un preventivo modificato nel link produce un'impronta diversa", async () => {
  const prev = preventivo();
  const orig = await creaLinkAccettazione("https://x.it/", prev, AZIENDA, { pro: true });
  const dati = JSON.parse(await decomprimi(orig.codice));
  dati.r[0][3] = 1; // il "cliente" abbassa il prezzo
  const alterato = await comprimi(JSON.stringify(dati));
  assert.notEqual(await impronta(alterato), orig.hash);
  prev.link = { hash: orig.hash };
  prev.linkPrecedenti = ["aaa"];
  assert.equal(verificaImpronta(prev, orig.hash), "ok");
  assert.equal(verificaImpronta(prev, "aaa"), "precedente");
  assert.equal(verificaImpronta(prev, await impronta(alterato)), "diversa");
});

test("conferma del cliente: andata e ritorno e applicazione al preventivo", async () => {
  const firma = codificaTratti([
    Array.from({ length: 50 }, (_, i) => ({ x: i * 15, y: 200 + Math.sin(i / 4) * 80 })),
    [{ x: 100, y: 100 }],
  ]);
  const url = await creaLinkConferma("https://x.it/", {
    id: "8f0c2a1e-1111-4222-8333-944445555666",
    numero: "2026-007",
    hash: "abcdef0123456789abcdef01",
    scelte: [3],
    descrizioni: ["Pulizia caldaia"],
    nome: "Giulia Bianchi",
    firma,
  });
  assert.ok(url.startsWith("https://x.it/app.html#/accettazione?d=z"));
  const conferma = await leggiConferma(url.split("?d=")[1]);
  assert.equal(conferma.nome, "Giulia Bianchi");
  assert.deepEqual(conferma.scelte, [3]);
  assert.equal(decodificaTratti(conferma.firma).length, 2);

  const prev = preventivo();
  // L'artigiano nel frattempo ha riordinato le voci: la scelta si ritrova per descrizione.
  prev.righe.reverse();
  const aggiunte = applicaConferma(prev, conferma, "data:image/png;base64,xx");
  assert.deepEqual(aggiunte, ["Pulizia caldaia"]);
  assert.equal(prev.stato, "accettato");
  assert.equal(prev.firma.online, true);
  assert.equal(prev.righe.find((r) => r.descrizione === "Pulizia caldaia").opzionale, false);
  assert.equal(prev.righe.find((r) => r.descrizione === "Sostituzione sifone").opzionale, true);
  await assert.rejects(leggiConferma("zAAAA"), /non valid|danneggiato|incompleto/);
});

test("firma: semplificazione, codifica compatta e limiti di sicurezza", () => {
  const linea = Array.from({ length: 200 }, (_, i) => ({ x: i * 5, y: 200 }));
  assert.equal(semplifica(linea).length, 2);
  const tratti = [Array.from({ length: 120 }, (_, i) => ({ x: 10 + i * 8, y: 200 + Math.sin(i / 5) * 120 }))];
  const cod = codificaTratti(tratti);
  const dec = decodificaTratti(cod);
  assert.ok(Math.abs(lunghezzaTratti(dec) - lunghezzaTratti(tratti)) / lunghezzaTratti(tratti) < 0.05);
  assert.ok(JSON.stringify(cod).length < 1500);
  // dati ostili: valori enormi, non numeri, troppi tratti
  const ostile = decodificaTratti([[1e9, -1e9, "a", 3], "x", ...Array.from({ length: 500 }, () => [1, 1, 1, 1])]);
  assert.equal(ostile[0][0].x, 1000);
  assert.equal(ostile[0][0].y, 0);
  assert.equal(ostile[0].length, 1);
  assert.ok(ostile.length <= 80);
  assert.deepEqual(decodificaTratti(null), []);
});

test("date proposte: viaggia la data scelta (non la posizione), mai date passate o già fissate", async () => {
  const giorno = (n) => {
    const d = new Date(Date.now() + n * 864e5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const prev = preventivo();
  prev.caparra = true;
  prev.incasso = { giorniSaldo: 15 };
  prev.disponibilita = [
    { data: giorno(-2), fascia: "mattina" }, // già passata: non va proposta
    { data: giorno(2), fascia: "mattina" },
    { data: "2026-02-30", fascia: "mattina" },
    { data: giorno(4), fascia: "pomeriggio" },
    { data: giorno(6), fascia: "giornata" },
  ];
  const { codice, hash } = await creaLinkAccettazione("https://x.it/", prev, AZIENDA, { pro: true });
  const letto = await leggiLinkAccettazione(codice);
  assert.equal(letto.prev.caparra, true);
  assert.equal(letto.prev.giorniSaldo, 15);
  assert.deepEqual(letto.prev.disponibilita, [
    { data: giorno(2), fascia: "mattina" },
    { data: giorno(4), fascia: "pomeriggio" },
  ]);
  // date ostili nel link: scartate
  const dati = JSON.parse(await decomprimi(codice));
  dati.dt = [
    ["<script>", "mattina"],
    ["2026-10-20", "notte"],
    "x",
    ...Array.from({ length: 50 }, () => ["2026-11-01", "mattina"]),
  ];
  dati.gs = 99999;
  const ostile = preventivoDaDati(dati);
  assert.deepEqual(ostile.disponibilita, [
    { data: "2026-10-20", fascia: "giornata" },
    { data: "2026-11-01", fascia: "mattina" },
  ]);
  assert.equal(ostile.giorniSaldo, 365);

  const conferma = async (appuntamento, dt) => {
    const url = await creaLinkConferma("https://x.it/", {
      id: prev.id,
      numero: prev.numero,
      hash,
      scelte: [],
      descrizioni: [],
      nome: "Giulia",
      firma: [],
      appuntamento,
    });
    const codiceConferma = url.split("?d=")[1];
    if (!dt) return leggiConferma(codiceConferma);
    const d = JSON.parse(await decomprimi(codiceConferma));
    d.dt = dt;
    return leggiConferma(await comprimi(JSON.stringify(d)));
  };
  const scelta = { data: giorno(4), fascia: "pomeriggio" };
  const c = await conferma(scelta);
  assert.deepEqual(c.appuntamento, scelta);
  // l'impresa toglie la prima data dopo l'invio: si salva comunque la data che il cliente ha visto
  prev.disponibilita = prev.disponibilita.filter((d) => d.data !== giorno(2));
  assert.equal(dataDaConferma(prev, c).esito, "ok");
  applicaConferma(prev, c, "data:image/png;base64,xx");
  assert.equal(prev.appuntamento.data, giorno(4));
  assert.equal(prev.appuntamento.fascia, "pomeriggio");
  assert.equal(prev.appuntamento.da, "cliente");
  // una data non più proposta non viene salvata
  const p2 = preventivo();
  p2.disponibilita = [{ data: giorno(9), fascia: "mattina" }];
  assert.equal(dataDaConferma(p2, c).esito, "non-proposta");
  applicaConferma(p2, c, "x");
  assert.equal(p2.appuntamento, undefined);
  // una data già fissata dall'impresa non viene sostituita
  const p3 = preventivo();
  p3.disponibilita = [scelta];
  p3.appuntamento = { data: giorno(10), fascia: "mattina", da: "impresa" };
  assert.equal(dataDaConferma(p3, c).esito, "gia-fissata");
  applicaConferma(p3, c, "x");
  assert.equal(p3.appuntamento.data, giorno(10));
  // con l'inizio già fissato il link non propone più date
  assert.deepEqual(
    JSON.parse(await decomprimi((await creaLinkAccettazione("https://x.it/", p3, AZIENDA, { pro: true })).codice)).dt,
    [],
  );
  // date della firma non plausibili: valgono il momento in cui arriva la conferma
  for (const dt of ["2199-01-01T10:00:00Z", "1970-01-01T00:00:00Z", "+275760-09-13T00:00:00Z", "ieri"]) {
    const cc = await conferma(null, dt);
    assert.ok(Math.abs(Date.parse(cc.data) - Date.now()) < 60000, dt);
  }
  // la firma non può precedere la creazione del link
  const p4 = preventivo();
  p4.link = { hash, il: Date.now() - 3600e3 };
  applicaConferma(p4, await conferma(null, new Date(Date.now() - 30 * 864e5).toISOString()), "x");
  assert.ok(Date.parse(p4.firma.data) >= p4.link.il);
  assert.match(p4.accettatoIl, /^\d{4}-\d{2}-\d{2}$/);
});

test("richiesta di pagamento: andata e ritorno e dati ostili ripuliti", async () => {
  const prev = preventivo();
  const { url, codice } = await creaLinkRichiesta("https://x.it/", prev, AZIENDA, {
    importo: 204.05,
    tipo: "saldo",
    causale: "Saldo preventivo n. 2026-007",
    scadenza: "2026-10-20",
    totale: 291.5,
    incassato: 87.45,
    pro: false,
  });
  assert.ok(url.startsWith("https://x.it/accetta.html#z"));
  const letto = await leggiLinkCliente(codice);
  assert.equal(letto.tipo, "pagamento");
  assert.equal(letto.richiesta.importo, 204.05);
  assert.equal(letto.richiesta.azienda.iban, "IT60X0542811101000000123456");
  assert.equal(letto.richiesta.conMarchio, true);
  assert.ok(
    !JSON.stringify(datiRichiesta(prev, AZIENDA, { importo: 1 })).includes("347 000"),
    "niente telefono del cliente",
  );
  await assert.rejects(leggiLinkAccettazione(codice), /link di pagamento/);
  const preventivoLink = await leggiLinkCliente(
    (await creaLinkAccettazione("https://x.it/", prev, AZIENDA, { pro: true })).codice,
  );
  assert.equal(preventivoLink.tipo, "preventivo");
  const r = richiestaDaDati({
    v: 1,
    k: "pg",
    id: "a<b>",
    az: { pay: "javascript:alert(1)", col: "red", ib: "it60<x>" },
    im: "1e99",
    tp: "tutto",
    ca: "riga1\nBCD\r\nriga3",
    sc: "2026-13-01",
    tt: -4,
    wm: 0,
  });
  assert.equal(r.id, "ab");
  assert.equal(r.azienda.linkPagamento, "");
  assert.equal(r.azienda.colore, "#1d4ed8");
  assert.equal(r.azienda.iban, "IT60X");
  assert.equal(r.importo, 1e7);
  assert.equal(r.tipo, "residuo");
  assert.equal(r.causale, "riga1 BCD riga3");
  assert.equal(r.scadenza, "");
  assert.equal(r.totale, 0);
  assert.equal(r.conMarchio, false);
  assert.throws(() => richiestaDaDati({ v: 1 }), /non valido/);
});

test("avviso 'Ho pagato': andata e ritorno, impronta per non registrarlo due volte, rifiuti", async () => {
  const url = await creaLinkAvviso("https://x.it/", {
    id: "8f0c2a1e-1111-4222-8333-944445555666",
    numero: "2026-007",
    importo: 87.45,
    metodo: "bonifico",
    data: "2026-10-06",
    nota: "CRO 123",
  });
  assert.ok(url.startsWith("https://x.it/app.html#/pagamento?d=z"));
  const codice = url.split("?d=")[1];
  const a = await leggiAvviso(codice);
  assert.deepEqual(
    { ...a, rif: undefined },
    {
      id: "8f0c2a1e-1111-4222-8333-944445555666",
      numero: "2026-007",
      importo: 87.45,
      metodo: "bonifico",
      data: "2026-10-06",
      nota: "CRO 123",
      rif: undefined,
    },
  );
  assert.equal(a.rif, await impronta(codice));
  const fai = async (d) => leggiAvviso(await comprimi(JSON.stringify(d)));
  await assert.rejects(fai({ v: 1, k: "av", id: "x", im: 0 }), /senza importo/);
  await assert.rejects(fai({ v: 1, k: "pg", id: "x", im: 5 }), /non valido/);
  await assert.rejects(leggiAvviso("zAAAA"), /non valid|danneggiato|incompleto/);
  const strano = await fai({ v: 1, k: "av", id: "x<y>", im: "1e20", me: "__proto__", dt: "ieri", nt: "n".repeat(900) });
  assert.equal(strano.id, "xy");
  assert.equal(strano.importo, 1e7);
  assert.equal(strano.metodo, "altro");
  assert.match(strano.data, /^\d{4}-\d{2}-\d{2}$/);
  const futuro = await fai({ v: 1, k: "av", id: "x", im: 5, dt: "2199-12-31" });
  const oggi = new Date();
  const iso = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, "0")}-${String(oggi.getDate()).padStart(2, "0")}`;
  assert.equal(futuro.data, iso, "una data di pagamento nel futuro non è plausibile");
  assert.equal((await fai({ v: 1, k: "av", id: "x", im: 5, dt: "2001-01-01" })).data, iso);
  assert.equal(strano.nota.length, 300);
});
