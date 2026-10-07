import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizzaIncasso,
  normalizzaDisponibilita,
  normalizzaAppuntamento,
  statoIncasso,
  daIncassare,
  sollecitoSuggerito,
  messaggioSollecito,
  messaggioRecensione,
  daRecensire,
  dataAccettazione,
  interessiMora,
  ibanValido,
  payloadEpc,
  creaIcs,
  prossimiLavori,
  giorniTra,
  dataValida,
  PAUSA_SOLLECITI,
  interessiQuote,
  daChiedere,
  clienteImpresa,
} from "../public/js/incassi.js";
import { matriceQr, rettangoliQr, svgQr } from "../public/js/qr.js";

const AZIENDA = {
  ragioneSociale: "Idraulica Rossi",
  telefono: "333 1234567",
  iban: "IT60 X054 2811 1010 0000 0123 456",
  intestatarioIban: "Mario Rossi",
};
const TOT = { totale: 1000, acconto: 300 };
const totaliDi = (p) => p.t || TOT;

function prev(extra = {}) {
  return {
    id: "p1",
    numero: "2026-010",
    data: "2026-09-01",
    oggetto: "Bagno",
    stato: "accettato",
    cliente: { nome: "Luca Verdi" },
    firma: { img: "data:image/png;base64,AA", nome: "Luca Verdi", data: "2026-09-02T10:00:00.000Z" },
    ...extra,
  };
}

test("date: validazione stretta e differenza in giorni", () => {
  assert.ok(dataValida("2026-02-28"));
  assert.ok(!dataValida("2026-02-30"));
  assert.ok(!dataValida("2026-13-01"));
  assert.ok(!dataValida("26-01-01"));
  assert.ok(!dataValida(20260101));
  assert.equal(giorniTra("2026-03-28", "2026-03-30"), 2); // attraversa il cambio dell'ora legale
  assert.equal(giorniTra("2026-10-01", "2026-09-30"), -1);
});

test("incasso: dati ostili da backup o link vengono ripuliti", () => {
  const n = normalizzaIncasso({
    pagamenti: [
      { id: "<x>", data: "2026-99-99", importo: "1.234,50", metodo: "__proto__", nota: "a".repeat(999) },
      { importo: -50 },
      { importo: 1e12, metodo: "contanti" },
      "non un oggetto",
      null,
    ],
    fineLavori: "ieri",
    giorniSaldo: "abc",
    solleciti: [{ il: "oggi" }, { il: 5, livello: 9, canale: "fax" }],
    segnalazioni: [{ importo: 10, stato: "boh", rif: "zz12ab" }],
    recensioneChiestaIl: -1,
  });
  assert.equal(n.pagamenti.length, 2);
  assert.notEqual(n.pagamenti[0].id, "<x>");
  assert.match(n.pagamenti[0].data, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(n.pagamenti[0].importo, 1234.5);
  assert.equal(n.pagamenti[0].metodo, "altro");
  assert.equal(n.pagamenti[0].nota.length, 300);
  assert.equal(n.pagamenti[1].importo, 1e7);
  assert.equal(n.fineLavori, "");
  assert.equal(n.giorniSaldo, null);
  assert.deepEqual(n.solleciti, [{ il: 5, livello: 1, canale: "whatsapp" }]);
  assert.equal(n.segnalazioni[0].stato, "attesa");
  assert.equal(n.segnalazioni[0].rif, "12ab");
  assert.equal(n.recensioneChiestaIl, null);
  assert.deepEqual(normalizzaIncasso(null).pagamenti, []);
  assert.equal(normalizzaIncasso({ giorniSaldo: 0 }).giorniSaldo, 0);
  assert.equal(normalizzaIncasso({ giorniSaldo: 9999 }).giorniSaldo, 365);
});

test("disponibilità e appuntamento: massimo 3 date valide, fasce note", () => {
  const d = normalizzaDisponibilita([
    { data: "2026-10-12", fascia: "mattina" },
    { data: "2026-10-12", fascia: "mattina" },
    { data: "2026-10-13", fascia: "sera" },
    { data: "2026-02-30" },
    { data: "2026-10-14" },
    { data: "2026-10-15" },
  ]);
  assert.deepEqual(d, [
    { data: "2026-10-12", fascia: "mattina" },
    { data: "2026-10-13", fascia: "giornata" },
    { data: "2026-10-14", fascia: "giornata" },
  ]);
  assert.equal(normalizzaAppuntamento({ data: "x" }), null);
  assert.deepEqual(normalizzaAppuntamento({ data: "2026-10-12", fascia: "pomeriggio", da: "cliente", il: 7 }), {
    data: "2026-10-12",
    fascia: "pomeriggio",
    da: "cliente",
    il: 7,
  });
});

test("data di accettazione: firma, poi accettazione online, poi cambio di stato", () => {
  assert.equal(dataAccettazione(prev()), "2026-09-02");
  assert.equal(
    dataAccettazione(prev({ firma: null, accettazioneOnline: { il: Date.UTC(2026, 8, 5, 12) } })),
    "2026-09-05",
  );
  assert.equal(dataAccettazione(prev({ firma: null, accettatoIl: "2026-09-07" })), "2026-09-07");
  assert.equal(dataAccettazione(prev({ firma: null })), "2026-09-01");
});

test("stato incasso: acconto atteso, poi in ritardo dopo i giorni di tolleranza", () => {
  let s = statoIncasso(prev(), TOT, { oggi: "2026-09-04" });
  assert.equal(s.fase, "attesa-acconto");
  assert.equal(s.prossima.tipo, "acconto");
  assert.equal(s.prossima.importo, 300);
  assert.equal(s.scadenzaAcconto, "2026-09-05");
  assert.equal(s.importoScaduto, 0);
  s = statoIncasso(prev(), TOT, { oggi: "2026-09-10" });
  assert.equal(s.fase, "scaduto");
  assert.equal(s.importoScaduto, 300);
  assert.equal(s.giorniRitardo, 5);
  // acconto pagato in parte: resta in ritardo solo la differenza
  const p = prev({ incasso: { pagamenti: [{ data: "2026-09-03", importo: 100, metodo: "bonifico" }] } });
  s = statoIncasso(p, TOT, { oggi: "2026-09-10" });
  assert.equal(s.importoScaduto, 200);
  assert.equal(s.residuo, 900);
});

test("stato incasso: lavori in corso, saldo in scadenza, saldo scaduto, pagato", () => {
  const pag = [{ data: "2026-09-03", importo: 300, metodo: "bonifico" }];
  let s = statoIncasso(prev({ incasso: { pagamenti: pag } }), TOT, { oggi: "2026-09-20" });
  assert.equal(s.fase, "in-corso");
  assert.equal(s.prossima.tipo, "saldo");
  assert.equal(s.prossima.data, null);
  const finito = prev({ incasso: { pagamenti: pag, fineLavori: "2026-09-25" } });
  s = statoIncasso(finito, TOT, { oggi: "2026-10-10", giorniSaldo: 30 });
  assert.equal(s.fase, "da-saldare");
  assert.equal(s.scadenzaSaldo, "2026-10-25");
  s = statoIncasso(finito, TOT, { oggi: "2026-10-30", giorniSaldo: 30 });
  assert.equal(s.fase, "scaduto");
  assert.equal(s.importoScaduto, 700);
  assert.equal(s.giorniRitardo, 5);
  // i giorni del singolo preventivo vincono su quelli predefiniti
  const subito = prev({ incasso: { pagamenti: pag, fineLavori: "2026-09-25", giorniSaldo: 0 } });
  assert.equal(statoIncasso(subito, TOT, { oggi: "2026-09-26", giorniSaldo: 30 }).fase, "scaduto");
  const pagato = prev({ incasso: { pagamenti: [...pag, { data: "2026-10-01", importo: 750 }] } });
  s = statoIncasso(pagato, TOT, { oggi: "2026-10-30" });
  assert.equal(s.fase, "pagato");
  assert.equal(s.residuo, 0);
  assert.equal(s.eccedenza, 50);
  assert.equal(s.percentuale, 100);
  assert.equal(s.prossima, null);
});

test("stato incasso: preventivo non accettato e senza acconto", () => {
  assert.equal(statoIncasso(prev({ stato: "inviato" }), TOT, { oggi: "2026-09-04" }).fase, "non-accettato");
  const s = statoIncasso(prev(), { totale: 500, acconto: 0 }, { oggi: "2026-12-31" });
  assert.equal(s.fase, "in-corso");
  assert.equal(s.accontoPagato, true);
  assert.equal(s.importoScaduto, 0);
});

test("segnalazioni del cliente in attesa di verifica", () => {
  const p = prev({
    incasso: {
      segnalazioni: [
        { il: 1, importo: 300, stato: "attesa" },
        { il: 2, importo: 50, stato: "respinta" },
      ],
    },
  });
  const s = statoIncasso(p, TOT, { oggi: "2026-09-04" });
  assert.equal(s.daVerificare, 300);
  assert.equal(s.incassato, 0, "una segnalazione non è un incasso finché non la confermi");
});

test("da incassare: prima gli scaduti dal più vecchio, poi acconti, saldi e lavori in corso", () => {
  const pag = [{ data: "2026-09-03", importo: 300 }];
  const lista = [
    prev({ id: "corso", incasso: { pagamenti: pag } }),
    prev({ id: "acconto", firma: { data: "2026-10-09T10:00:00Z", img: "x" } }),
    prev({ id: "vecchio", incasso: { pagamenti: pag, fineLavori: "2026-08-01" } }),
    prev({ id: "recente", incasso: { pagamenti: pag, fineLavori: "2026-09-01" } }),
    prev({ id: "pagato", incasso: { pagamenti: [{ importo: 1000 }] } }),
    prev({ id: "bozza", stato: "bozza" }),
    prev({ id: "saldare", incasso: { pagamenti: pag, fineLavori: "2026-10-05" } }),
  ];
  const r = daIncassare(lista, totaliDi, { oggi: "2026-10-10", giorniSaldo: 15 });
  assert.deepEqual(
    r.voci.map((x) => x.prev.id),
    ["vecchio", "recente", "acconto", "saldare", "corso"],
  );
  assert.equal(r.nScaduti, 2);
  assert.equal(r.scaduto, 1400);
  assert.equal(r.totale, 700 * 4 + 1000);
});

test("solleciti: livello crescente e pausa minima tra un sollecito e l'altro", () => {
  const giorno = 864e5;
  const ora = Date.UTC(2026, 9, 10);
  let s = statoIncasso(prev(), TOT, { oggi: "2026-10-10" });
  assert.deepEqual(sollecitoSuggerito(s, ora), { livello: 1, ultimo: 0, prontoIl: 0, troppoPresto: false });
  const p = prev({
    incasso: {
      solleciti: [
        { il: ora - 20 * giorno, livello: 1 },
        { il: ora - 2 * giorno, livello: 2 },
      ],
    },
  });
  s = statoIncasso(p, TOT, { oggi: "2026-10-10" });
  const sug = sollecitoSuggerito(s, ora);
  assert.equal(sug.livello, 3);
  assert.equal(sug.troppoPresto, true);
  assert.equal(sug.prontoIl, ora - 2 * giorno + PAUSA_SOLLECITI * giorno);
});

test("messaggi di sollecito: importo, scadenza, IBAN, link e tono crescente", () => {
  const s = statoIncasso(prev(), TOT, { oggi: "2026-09-10" });
  const m1 = messaggioSollecito(prev(), AZIENDA, s, 1, { link: "https://x.it/accetta.html#zAB" });
  assert.match(m1, /^Buongiorno Luca Verdi,/);
  assert.match(
    m1,
    /dell'acconto di € 300,00 per il preventivo n\. 2026-010 "Bagno", scaduto il 05\/09\/2026 \(da 5 giorni\)/,
  );
  assert.match(
    m1,
    /IBAN IT60 X054 2811 1010 0000 0123 456 intestato a Mario Rossi, causale "Acconto preventivo n\. 2026-010"/,
  );
  assert.match(m1, /https:\/\/x\.it\/accetta\.html#zAB/);
  assert.match(m1, /Idraulica Rossi - 333 1234567$/);
  const m2 = messaggioSollecito(prev(), AZIENDA, s, 2);
  assert.match(m2, /non mi risulta ancora il pagamento/);
  assert.match(m2, /accettato e firmato il 02\/09\/2026/);
  assert.match(m2, /entro 7 giorni/);
  const m3 = messaggioSollecito(prev({ caparra: true }), AZIENDA, s, 3);
  assert.match(m3, /della caparra di € 300,00/);
  assert.match(m3, /messa in mora/);
  assert.match(m3, /causale "Caparra preventivo/);
  // saldo scaduto: si chiede tutto il dovuto
  const finito = prev({ incasso: { pagamenti: [{ importo: 100 }], fineLavori: "2026-09-01" } });
  const sf = statoIncasso(finito, TOT, { oggi: "2026-10-10", giorniSaldo: 0 });
  assert.match(messaggioSollecito(finito, AZIENDA, sf, 1), /il pagamento di € 900,00/);
  // senza IBAN né link il messaggio resta valido
  const senza = messaggioSollecito(prev({ cliente: {} }), {}, s, 1);
  assert.match(senza, /^Buongiorno,\nle ricordo/);
  assert.ok(!senza.includes("IBAN"));
});

test("recensioni: solo lavori pagati di recente e non ancora chiesti", () => {
  const pagato = (id, data, extra = {}) => prev({ id, incasso: { pagamenti: [{ importo: 1000, data }], ...extra } });
  const r = daRecensire(
    [
      pagato("a", "2026-10-01"),
      pagato("b", "2026-10-08"),
      pagato("vecchio", "2026-05-01"),
      pagato("chiesto", "2026-10-05", { recensioneChiestaIl: 5 }),
      prev({ id: "non-pagato" }),
    ],
    totaliDi,
    { oggi: "2026-10-10" },
  );
  assert.deepEqual(
    r.map((x) => x.prev.id),
    ["b", "a"],
  );
  assert.match(
    messaggioRecensione(prev(), AZIENDA, "https://g.page/r/abc"),
    /Luca Verdi.*\n.*recensione.*\nhttps:\/\/g\.page\/r\/abc\nGrazie di cuore, Idraulica Rossi/,
  );
});

test("interessi di mora: tasso annuo sui giorni di ritardo", () => {
  assert.equal(interessiMora(1000, "10,15", 365), 101.5);
  assert.equal(interessiMora(1000, 10, 30), 8.22);
  assert.equal(interessiMora(1000, "", 30), 0);
  assert.equal(interessiMora(1000, 10, 0), 0);
  assert.equal(interessiMora(1000, 9999, 365), 1000);
});

test("IBAN: controllo del codice (mod 97) e lunghezza italiana", () => {
  assert.ok(ibanValido("IT60 X054 2811 1010 0000 0123 456"));
  assert.ok(ibanValido("it60x0542811101000000123456"));
  assert.ok(ibanValido("DE89 3704 0044 0532 0130 00"));
  assert.ok(!ibanValido("IT60X0542811101000000123457"), "una cifra sbagliata va segnalata");
  assert.ok(!ibanValido("IT60X054281110100000012345"), "IBAN italiano troppo corto");
  assert.ok(!ibanValido("IT60 X054<script>"));
  assert.ok(!ibanValido(""));
});

test("QR SEPA (EPC): campi corretti e niente a capo iniettati nel nome o nella causale", () => {
  const p = payloadEpc({
    nome: "Mario\nRossi",
    iban: "it60 x054 2811 1010 0000 0123 456",
    importo: 181.5,
    causale: "Acconto\r\nIT00FALSO\nEUR1",
  });
  const campi = p.split("\n");
  assert.equal(campi.length, 11);
  assert.deepEqual(campi.slice(0, 8), [
    "BCD",
    "002",
    "1",
    "SCT",
    "",
    "Mario Rossi",
    "IT60X0542811101000000123456",
    "EUR181.50",
  ]);
  assert.equal(campi[10], "Acconto IT00FALSO EUR1");
  assert.equal(payloadEpc({ nome: "X", iban: "IT60X0542811101000000123457", importo: 1 }), null);
  assert.equal(payloadEpc({ nome: "  ", iban: "IT60X0542811101000000123456", importo: 1 }), null);
  assert.equal(payloadEpc({ nome: "X", iban: "IT60X0542811101000000123456", importo: 0 }).split("\n")[7], "");
  assert.equal(payloadEpc({ nome: "X", iban: "IT60X0542811101000000123456", importo: 1e10 }).split("\n")[7], "");
  // nome e causale troncati ai limiti dello standard (70 e 140 caratteri)
  const lungo = payloadEpc({ nome: "N".repeat(200), iban: "IT60X0542811101000000123456", causale: "C".repeat(500) });
  assert.equal(lungo.split("\n")[5].length, 70);
  assert.equal(lungo.split("\n")[10].length, 140);
  assert.ok(new TextEncoder().encode(lungo).length <= 331);
});

test("QR: matrice con i tre riquadri di posizione e SVG senza markup iniettato", () => {
  const m = matriceQr("BCD\n002\n1\nSCT\n\nMario Rossi\nIT60X0542811101000000123456\nEUR181.50");
  const n = m.length;
  assert.ok(n >= 21 && (n - 17) % 4 === 0);
  for (const [r, c] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]) {
    assert.ok(m[r][c] && m[r + 6][c + 6] && !m[r + 1][c + 1] && m[r + 3][c + 3], "riquadro di posizione");
  }
  const rett = rettangoliQr(m);
  assert.equal(
    rett.reduce((s, q) => s + q.w, 0),
    m.flat().filter(Boolean).length,
  );
  const svg = svgQr("ciao", { etichetta: '"><script>alert(1)</script>' });
  assert.ok(!svg.includes("<script"));
  assert.match(svg, /^<svg viewBox="0 0 29 29"/);
});

test("calendario .ics: escape dei caratteri speciali, fasce orarie e giornata intera", () => {
  const ics = creaIcs({
    id: "abc/../x",
    titolo: "Rossi, bagno; nuovo\\vecchio",
    data: "2026-10-12",
    fascia: "mattina",
    luogo: "Via Roma 1, Bergamo",
    descrizione: "Riga 1\nRiga 2\r\nEND:VEVENT",
    ora: new Date(Date.UTC(2026, 9, 6, 10, 0, 0)),
  });
  assert.match(ics, /\r\nUID:abcx@preventivolampo\r\n/);
  assert.match(ics, /\r\nDTSTART:20261012T080000\r\nDTEND:20261012T130000\r\n/);
  assert.match(ics, /\r\nSUMMARY:Rossi\\, bagno\\; nuovo\\\\vecchio\r\n/);
  assert.match(ics, /\r\nDESCRIPTION:Riga 1\\nRiga 2\\nEND:VEVENT\r\n/);
  assert.equal(ics.match(/^END:VEVENT$/gm).length, 1, "nessun evento iniettato");
  const giornata = creaIcs({ titolo: "x", data: "2026-12-31", fascia: "giornata" });
  assert.match(giornata, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.equal(creaIcs({ titolo: "x", data: "2026-02-30" }), "");
  // righe lunghe piegate (max 75 caratteri) e nessuna barra "orfana" dopo il taglio
  const lunga = creaIcs({ titolo: ",".repeat(400), data: "2026-10-12" });
  for (const riga of lunga.split("\r\n")) assert.ok([...riga].length <= 75, riga);
  const summary = lunga
    .split("\r\n")
    .filter((r) => r.startsWith("SUMMARY") || r.startsWith(" "))
    .join("")
    .replace(/^SUMMARY:/, "");
  assert.equal(summary.replace(/ /g, ""), "\\,".repeat(300));
});

test("agenda: lavori accettati con data nei prossimi giorni, in ordine", () => {
  const lista = [
    prev({ id: "b", appuntamento: { data: "2026-10-20", fascia: "pomeriggio" } }),
    prev({ id: "a", appuntamento: { data: "2026-10-12", fascia: "mattina" } }),
    prev({ id: "passato", appuntamento: { data: "2026-10-01" } }),
    prev({ id: "lontano", appuntamento: { data: "2027-01-01" } }),
    prev({ id: "bozza", stato: "bozza", appuntamento: { data: "2026-10-13" } }),
    prev({ id: "rotto", appuntamento: { data: "domani" } }),
  ];
  assert.deepEqual(
    prossimiLavori(lista, { oggi: "2026-10-10" }).map((x) => x.prev.id),
    ["a", "b"],
  );
});

test("quote scadute: acconto e saldo con la loro data, interessi quota per quota", () => {
  // Acconto 300 dovuto entro il 05/09 (non pagato), saldo 700 dovuto dal 01/10 (fine lavori 01/10, 0 giorni)
  const p = prev({ incasso: { fineLavori: "2026-10-01", giorniSaldo: 0 } });
  const s = statoIncasso(p, TOT, { oggi: "2026-10-11" });
  assert.deepEqual(s.quote, [
    { tipo: "acconto", importo: 300, dal: "2026-09-05" },
    { tipo: "saldo", importo: 700, dal: "2026-10-01" },
  ]);
  assert.equal(s.importoScaduto, 1000);
  assert.equal(s.scadutoDal, "2026-09-05");
  // 300 per 36 giorni + 700 per 10 giorni al 10%: 2,96 + 1,92 (non 1000 per 36 giorni = 9,86)
  assert.equal(interessiQuote(s.quote, "10", "2026-10-11"), 4.88);
  assert.equal(interessiQuote(s.quote, "10%", "2026-10-11"), 4.88, "il simbolo % non azzera il tasso");
  const m = messaggioSollecito(p, AZIENDA, s, 1);
  assert.match(m, /scaduto in parte dal 05\/09\/2026 e in parte dal 01\/10\/2026/);
  assert.match(m, /causale "Pagamento preventivo n\. 2026-010"/, "acconto + saldo insieme: niente causale 'Acconto'");
  assert.deepEqual(daChiedere(p, s), {
    importo: 1000,
    tipo: "residuo",
    causale: "Pagamento preventivo n. 2026-010",
    scaduto: true,
  });
  // solo l'acconto scaduto
  const solo = statoIncasso(prev(), TOT, { oggi: "2026-09-10" });
  assert.deepEqual(daChiedere(prev(), solo).tipo, "acconto");
  // nulla di scaduto: si chiede la prossima scadenza senza toni duri
  const corso = prev({ incasso: { pagamenti: [{ importo: 300, data: "2026-09-03" }] } });
  const sc = statoIncasso(corso, TOT, { oggi: "2026-09-20" });
  assert.equal(sc.importoScaduto, 0);
  const duro = messaggioSollecito(corso, AZIENDA, sc, 3);
  assert.ok(!/messa in mora|entro 7 giorni/.test(duro), "senza importi scaduti niente minacce");
  assert.match(duro, /del saldo di € 700,00/);
});

test("tono dei solleciti: conta solo i solleciti mandati per il ritardo di adesso", () => {
  const giorno = 864e5;
  // acconto pagato in ritardo dopo due solleciti ad agosto; ora è scaduto il saldo
  const p = prev({
    data: "2026-07-01",
    firma: { img: "x", data: "2026-07-02T10:00:00Z" },
    incasso: {
      pagamenti: [{ importo: 300, data: "2026-08-20" }],
      fineLavori: "2026-09-10",
      giorniSaldo: 0,
      solleciti: [
        { il: Date.UTC(2026, 7, 1), livello: 1 },
        { il: Date.UTC(2026, 7, 10), livello: 2 },
      ],
    },
  });
  const s = statoIncasso(p, TOT, { oggi: "2026-10-01" });
  assert.equal(s.scadutoDal, "2026-09-10");
  assert.equal(sollecitoSuggerito(s, Date.UTC(2026, 9, 1)).livello, 1, "il primo sollecito per il saldo è gentile");
  p.incasso.solleciti.push({ il: Date.UTC(2026, 8, 15), livello: 1 });
  assert.equal(sollecitoSuggerito(statoIncasso(p, TOT, { oggi: "2026-10-01" }), Date.UTC(2026, 9, 1)).livello, 2);
  // nulla di scaduto: si resta al primo livello anche dopo un promemoria
  const corso = prev({
    incasso: { pagamenti: [{ importo: 300 }], solleciti: [{ il: Date.now() - 20 * giorno, livello: 1 }] },
  });
  assert.equal(sollecitoSuggerito(statoIncasso(corso, TOT, { oggi: "2026-09-20" })).livello, 1);
});

test("preventivi accettati prima del registro incassi: nessun falso scaduto finché non si aggiornano", () => {
  const vecchio = prev({ firma: null, data: "2026-01-10", incasso: { storico: true } });
  const s = statoIncasso(vecchio, TOT, { oggi: "2026-10-01" });
  assert.equal(s.fase, "storico");
  assert.equal(s.importoScaduto, 0);
  assert.equal(s.scadenzaAcconto, null);
  assert.equal(daIncassare([vecchio], totaliDi, { oggi: "2026-10-01" }).voci.length, 0);
  // registrando un pagamento o la fine dei lavori torna normale
  vecchio.incasso.fineLavori = "2026-09-01";
  assert.notEqual(statoIncasso(vecchio, TOT, { oggi: "2026-10-01" }).fase, "storico");
});

test("acconto pattuito all'accettazione: aggiungere voci dopo non crea un falso ritardo", () => {
  const p = prev({ incasso: { pagamenti: [{ importo: 300, data: "2026-09-03" }], accontoPattuito: 300 } });
  // il preventivo è stato ampliato: il 30% del nuovo totale sarebbe 360
  const s = statoIncasso(p, { totale: 1200, acconto: 360 }, { oggi: "2026-10-01" });
  assert.equal(s.acconto, 300);
  assert.equal(s.accontoPagato, true);
  assert.equal(s.fase, "in-corso");
  assert.equal(s.residuo, 900);
});

test("da incassare: un 'Ho pagato' arrivato prima dell'accettazione non sparisce", () => {
  const p = prev({
    stato: "inviato",
    incasso: { segnalazioni: [{ il: 1, importo: 300, stato: "attesa", rif: "ab" }] },
  });
  const r = daIncassare([p, prev({ id: "altro" })], totaliDi, { oggi: "2026-09-04" });
  assert.equal(r.voci[0].prev.id, "p1", "gli avvisi da verificare vanno in cima");
  assert.equal(r.daVerificare, 300);
  assert.equal(r.totale, 1000, "il preventivo non accettato non entra nei totali");
});

test("cliente impresa (partita IVA) o privato", () => {
  assert.equal(clienteImpresa({ cfpiva: "01234567890" }), true);
  assert.equal(clienteImpresa({ cfpiva: "IT 01234567890" }), true);
  assert.equal(clienteImpresa({ cfpiva: "RSSMRA80A01H501U" }), false);
  assert.equal(clienteImpresa({}), false);
});
