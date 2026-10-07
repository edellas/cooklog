import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcolaTotali,
  calcolaSuperfici,
  somiglianza,
  cercaNelListino,
  dividiDettatura,
  parseDettaturaMultipla,
  daRicontattare,
  messaggioRicontatto,
  statistiche,
  scadenzaDi,
} from "../public/js/core.js";

const LISTINO = [
  { descrizione: "Sostituzione miscelatore lavabo (manodopera)", um: "cad", prezzo: 70, tipo: "man" },
  { descrizione: "Miscelatore lavabo monocomando", um: "cad", prezzo: 85, tipo: "mat", costo: 52 },
  { descrizione: "Disostruzione scarico lavello", um: "cad", prezzo: 90, tipo: "man" },
  { descrizione: "Manodopera idraulico", um: "ora", prezzo: 38, tipo: "man" },
  { descrizione: "Tinteggiatura pareti idropittura traspirante (2 mani)", um: "mq", prezzo: 6.5, tipo: "man" },
];

test("voci facoltative: escluse dal totale ma restituite a parte", () => {
  const t = calcolaTotali(
    {
      righe: [
        { qta: 1, prezzo: 100, iva: 22 },
        { qta: 1, prezzo: 45, iva: 22, opzionale: true, descrizione: "Sifone" },
      ],
    },
    { regime: "ordinario" },
  );
  assert.equal(t.imponibile, 100);
  assert.equal(t.totale, 122);
  assert.equal(t.opzionali.length, 1);
  assert.equal(t.opzionali[0].importo, 45);
  assert.equal(t.righe.length, 1);
});

test("guadagno stimato: imponibile meno costi d'acquisto delle voci incluse", () => {
  const t = calcolaTotali(
    {
      righe: [
        { qta: 2, prezzo: 85, costo: 52, tipo: "mat" },
        { qta: 3, prezzo: 38, tipo: "man" },
        { qta: 1, prezzo: 45, costo: 20, opzionale: true },
      ],
      scontoGlobale: 10,
    },
    { regime: "ordinario" },
  );
  // imponibile = (170 + 114) * 0.9 = 255.6; costi = 104 -> margine 151.6
  assert.equal(t.imponibile, 255.6);
  assert.equal(t.costi, 104);
  assert.equal(t.margine, 151.6);
  assert.equal(t.marginePerc, 59.31);
  const vuoto = calcolaTotali({ righe: [] }, {});
  assert.equal(vuoto.marginePerc, 0);
});

test("calcolatore superfici: pareti, soffitto, pavimento e detrazioni", () => {
  const r = calcolaSuperfici([
    { lunghezza: "4", larghezza: "3", altezza: "2,7", pareti: true, soffitto: true, detrazioni: "2" },
    { lunghezza: 2, larghezza: 2, altezza: 2.5, pavimento: true },
  ]);
  assert.equal(r.stanze[0].pareti_mq, 37.8);
  assert.equal(r.stanze[0].soffitto_mq, 12);
  assert.equal(r.stanze[0].totale, 47.8);
  assert.equal(r.stanze[1].totale, 4);
  assert.equal(r.totale, 51.8);
  // detrazioni maggiori della superficie non danno valori negativi
  assert.equal(calcolaSuperfici([{ lunghezza: 1, larghezza: 1, pavimento: true, detrazioni: 9 }]).totale, 0);
  assert.equal(calcolaSuperfici([{ lunghezza: -5, larghezza: "abc", altezza: 3, pareti: true }]).totale, 0);
});

test("somiglianza e ricerca nel listino", () => {
  assert.ok(somiglianza("sostituzione miscelatore", "Sostituzione miscelatore lavabo (manodopera)") > 0.6);
  assert.equal(somiglianza("", "qualcosa"), 0);
  assert.equal(cercaNelListino("miscelatore monocomando", LISTINO).voce.descrizione, "Miscelatore lavabo monocomando");
  assert.equal(cercaNelListino("rifacimento tetto", LISTINO), null);
  // plurali e accenti
  assert.ok(cercaNelListino("disostruzioni scarichi", LISTINO));
});

test("dividi dettatura in più voci", () => {
  assert.deepEqual(dividiDettatura("sostituzione miscelatore, disostruzione scarico e poi 2 ore di manodopera"), [
    "sostituzione miscelatore",
    "disostruzione scarico",
    "2 ore di manodopera",
  ]);
  assert.deepEqual(dividiDettatura("sifone 45 euro e guarnizioni 10 euro"), ["sifone 45 euro", "guarnizioni 10 euro"]);
  // la virgola decimale non spezza la voce
  assert.deepEqual(dividiDettatura("tinteggiatura 20 metri quadri 6,5 euro"), [
    "tinteggiatura 20 metri quadri 6,5 euro",
  ]);
  assert.deepEqual(dividiDettatura("pittura 3 virgola 5 euro"), ["pittura 3,5 euro"]);
  // "taglio e smaltimento" resta una voce sola
  assert.deepEqual(dividiDettatura("taglio e smaltimento siepe 80 euro"), ["taglio e smaltimento siepe 80 euro"]);
  assert.deepEqual(dividiDettatura("  , . "), []);
});

test("dettatura multipla abbinata al listino con prezzi e unità", () => {
  const r = parseDettaturaMultipla(
    "sostituzione miscelatore poi miscelatore monocomando 2 pezzi poi 3 ore di manodopera poi tinteggiatura pareti 40 metri quadri poi rifacimento tetto 2000 euro",
    LISTINO,
  );
  assert.equal(r.length, 5);
  assert.deepEqual(
    r.map((x) => [x.descrizione, x.qta, x.um, x.prezzo, x.tipo, x.dalListino]),
    [
      ["Sostituzione miscelatore lavabo (manodopera)", 1, "cad", 70, "man", true],
      ["Miscelatore lavabo monocomando", 2, "cad", 85, "mat", true],
      ["Manodopera idraulico", 3, "ora", 38, "man", true],
      ["Tinteggiatura pareti idropittura traspirante (2 mani)", 40, "mq", 6.5, "man", true],
      ["Rifacimento tetto", 1, "cad", 2000, "man", false],
    ],
  );
  assert.equal(r[1].costo, 52);
  // un prezzo detto a voce vince su quello del listino
  assert.equal(parseDettaturaMultipla("disostruzione scarico 120 euro", LISTINO)[0].prezzo, 120);
});

test("preventivi da ricontattare: inviati da almeno 3 giorni, non scaduti, non appena ricontattati", () => {
  const ora = new Date(2026, 9, 10, 12).getTime();
  const giorni = (n) => ora - n * 24 * 3600 * 1000;
  const lista = [
    { id: "a", stato: "inviato", data: "2026-10-01", validitaGiorni: 30, inviatoIl: giorni(5) },
    { id: "b", stato: "inviato", data: "2026-10-09", validitaGiorni: 30, inviatoIl: giorni(1) },
    { id: "c", stato: "accettato", data: "2026-10-01", validitaGiorni: 30, inviatoIl: giorni(9) },
    { id: "d", stato: "inviato", data: "2026-09-01", validitaGiorni: 15, inviatoIl: giorni(39) },
    {
      id: "e",
      stato: "inviato",
      data: "2026-10-01",
      validitaGiorni: 30,
      inviatoIl: giorni(8),
      ricontattatoIl: giorni(1),
    },
    { id: "f", stato: "inviato", data: "2026-10-01", validitaGiorni: 30, inviatoIl: giorni(8) },
  ];
  const r = daRicontattare(lista, ora);
  assert.deepEqual(
    r.map((x) => x.prev.id),
    ["f", "a"],
  );
  assert.equal(r[0].giorniDaInvio, 8);
  assert.equal(scadenzaDi(lista[0]), "2026-10-31");
});

test("messaggio di ricontatto", () => {
  const m = messaggioRicontatto(
    { numero: "2026-004", oggetto: "Bagno", data: "2026-10-01", validitaGiorni: 30, cliente: { nome: "Luca" } },
    { ragioneSociale: "Idraulica Rossi" },
  );
  assert.match(m, /Buongiorno Luca/);
  assert.match(m, /n\. 2026-004 per "Bagno"/);
  assert.match(m, /31\/10\/2026/);
  assert.match(m, /Idraulica Rossi$/);
});

test("statistiche: tasso di accettazione e ultimi 6 mesi", () => {
  const lista = [
    { stato: "accettato", data: "2026-10-02", t: 100 },
    { stato: "rifiutato", data: "2026-10-03", t: 50 },
    { stato: "inviato", data: "2026-09-10", t: 80 },
    { stato: "bozza", data: "2026-09-12", t: 999 },
    { stato: "accettato", data: "2026-05-01", t: 300 },
  ];
  const s = statistiche(lista, (p) => p.t, new Date(2026, 9, 6));
  assert.equal(s.tassoAccettazione, 50);
  assert.equal(s.mesi.length, 6);
  assert.equal(s.mesi[0].mese, "2026-05");
  assert.equal(s.mesi[0].accettato, 300);
  assert.equal(s.mesi[5].mese, "2026-10");
  assert.equal(s.mesi[5].preventivato, 150);
  assert.equal(s.mesi[5].accettato, 100);
  assert.equal(s.mesi[4].numero, 2);
  assert.equal(statistiche([], () => 0).tassoAccettazione, null);
});

test("da ricontattare: non si sollecita chi ha già pagato o dice di averlo fatto", () => {
  const ora = new Date(2026, 9, 10, 12).getTime();
  const fa = (n) => ora - n * 864e5;
  const base = { stato: "inviato", data: "2026-10-01", validitaGiorni: 30, inviatoIl: fa(6) };
  const lista = [
    { ...base, id: "a" },
    { ...base, id: "b", incasso: { pagamenti: [{ importo: 100 }] } },
    { ...base, id: "c", incasso: { segnalazioni: [{ importo: 100, stato: "attesa" }] } },
    { ...base, id: "d", incasso: { segnalazioni: [{ importo: 100, stato: "respinta" }] } },
  ];
  assert.deepEqual(
    daRicontattare(lista, ora).map((x) => x.prev.id),
    ["a", "d"],
  );
});

test("PDF: caratteri fuori dal font standard resi leggibili, non storpiati", async () => {
  const { testoPdf } = await import("../public/js/pdf.js");
  assert.equal(testoPdf("Ștefan Țurcanu, Via Mățău 3"), "Stefan Turcanu, Via Matau 3");
  assert.equal(testoPdf("Łódź ✓ ≥ 10 😀"), "Lódz v >= 10 ");
  assert.equal(testoPdf("Città più € “ok” — àèìòù ñ"), "Città più € “ok” — àèìòù ñ", "l'italiano resta com'è");
  assert.equal(testoPdf("riga1\nriga2"), "riga1\nriga2");
  // tab e spazi "strani" incollati da Word o dal web diventano spazi normali, non spariscono
  assert.equal(testoPdf("Posa\tpiastrelle\u00a0e\u2009stucco"), "Posa piastrelle e stucco");
});
