import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcolaTotali,
  formatEuro,
  formatQta,
  parseNumero,
  parseDettatura,
  prossimoNumero,
  aggiungiGiorni,
  formatData,
  nomeFilePdf,
  pdfRimasti,
  puoEsportare,
  registraEsportazione,
  telefonoWhatsApp,
  testoWhatsApp,
} from "../public/js/core.js";
import { MESTIERI, vociListino } from "../public/js/mestieri.js";

test("parseNumero accetta formati italiani e internazionali", () => {
  assert.equal(parseNumero("1.234,56"), 1234.56);
  assert.equal(parseNumero("1234.56"), 1234.56);
  assert.equal(parseNumero("12,5"), 12.5);
  assert.equal(parseNumero("1.200"), 1200);
  assert.equal(parseNumero("€ 85"), 85);
  assert.equal(parseNumero(""), 0);
  assert.equal(parseNumero("abc"), 0);
  assert.equal(parseNumero(7), 7);
});

test("formatEuro e formatQta", () => {
  assert.equal(formatEuro(1234.5), "€ 1.234,50");
  assert.equal(formatEuro(0), "€ 0,00");
  assert.equal(formatEuro(1000000), "€ 1.000.000,00");
  assert.equal(formatQta(1.5), "1,5");
  assert.equal(formatQta(3), "3");
  assert.equal(formatQta(0.35), "0,35");
});

test("totali regime ordinario con aliquote miste e sconto globale", () => {
  const prev = {
    righe: [
      { qta: 2, prezzo: 100, sconto: 0, iva: 22, tipo: "man" },
      { qta: 1, prezzo: 50, sconto: 10, iva: 10, tipo: "mat" },
    ],
    scontoGlobale: 10,
    acconto: { tipo: "perc", valore: 30 },
  };
  const t = calcolaTotali(prev, { regime: "ordinario" });
  assert.equal(t.imponibileRighe, 245);
  assert.equal(t.scontoImporto, 24.5);
  assert.equal(t.imponibile, 220.5);
  assert.deepEqual(t.subtotali, { man: 200, mat: 45, altro: 0 });
  const base22 = t.riepilogoIva.find((g) => g.aliquota === 22);
  const base10 = t.riepilogoIva.find((g) => g.aliquota === 10);
  assert.equal(base22.imponibile, 180);
  assert.equal(base10.imponibile, 40.5);
  assert.equal(base22.imposta, 39.6);
  assert.equal(base10.imposta, 4.05);
  assert.equal(t.iva, 43.65);
  assert.equal(t.totale, 264.15);
  assert.equal(t.acconto, 79.25);
  assert.equal(t.saldo, 184.9);
});

test("la somma degli imponibili per aliquota coincide sempre con l'imponibile", () => {
  const prev = {
    righe: [
      { qta: 3, prezzo: 33.33, iva: 22 },
      { qta: 7, prezzo: 1.11, iva: 10 },
      { qta: 1, prezzo: 0.01, iva: 4 },
    ],
    scontoGlobale: 7,
  };
  const t = calcolaTotali(prev, { regime: "ordinario" });
  const somma = t.riepilogoIva.reduce((s, g) => s + g.imponibile, 0);
  assert.equal(Math.round(somma * 100) / 100, t.imponibile);
});

test("regime forfettario: niente IVA, bollo sopra soglia se richiesto", () => {
  const prev = { righe: [{ qta: 1, prezzo: 100, iva: 22 }] };
  const t = calcolaTotali(prev, { regime: "forfettario", addebitaBollo: true });
  assert.equal(t.iva, 0);
  assert.equal(t.bollo, 2);
  assert.equal(t.totale, 102);
  assert.equal(t.forfettario, true);

  const sotto = calcolaTotali({ righe: [{ qta: 1, prezzo: 77.47 }] }, { regime: "forfettario", addebitaBollo: true });
  assert.equal(sotto.bollo, 0);

  const senza = calcolaTotali(prev, { regime: "forfettario", addebitaBollo: false });
  assert.equal(senza.bollo, 0);
});

test("acconto a importo fisso non supera il totale", () => {
  const t = calcolaTotali(
    { righe: [{ qta: 1, prezzo: 100, iva: 0 }], acconto: { tipo: "importo", valore: 500 } },
    { regime: "ordinario" },
  );
  assert.equal(t.acconto, 100);
  assert.equal(t.saldo, 0);
});

test("numerazione progressiva per anno", () => {
  const lista = [
    { anno: 2026, progressivo: 1 },
    { anno: 2026, progressivo: 7 },
    { anno: 2025, progressivo: 40 },
  ];
  assert.equal(prossimoNumero(lista, 2026).numero, "2026-008");
  assert.equal(prossimoNumero(lista, 2027).numero, "2027-001");
  assert.equal(prossimoNumero([], 2026, "P-").numero, "P-2026-001");
});

test("date", () => {
  assert.equal(aggiungiGiorni("2026-01-31", 30), "2026-03-02");
  assert.equal(formatData("2026-10-06"), "06/10/2026");
});

test("dettatura vocale: quantità, unità e prezzo", () => {
  assert.deepEqual(parseDettatura("sostituzione rubinetto cucina 2 pezzi 85 euro"), {
    descrizione: "Sostituzione rubinetto cucina",
    qta: 2,
    um: "cad",
    prezzo: 85,
  });
  assert.deepEqual(parseDettatura("manodopera 3 ore a 35 euro l'ora"), {
    descrizione: "Manodopera",
    qta: 3,
    um: "ora",
    prezzo: 35,
  });
  assert.deepEqual(parseDettatura("posa piastrelle 20 metri quadri 30 euro"), {
    descrizione: "Posa piastrelle",
    qta: 20,
    um: "mq",
    prezzo: 30,
  });
  assert.deepEqual(parseDettatura("tinteggiatura soffitto due ore 40,50 euro"), {
    descrizione: "Tinteggiatura soffitto",
    qta: 2,
    um: "ora",
    prezzo: 40.5,
  });
  assert.deepEqual(parseDettatura("sopralluogo 50 €"), {
    descrizione: "Sopralluogo",
    qta: 1,
    um: "cad",
    prezzo: 50,
  });
  assert.deepEqual(parseDettatura("caldaia a condensazione 1.500 euro"), {
    descrizione: "Caldaia a condensazione",
    qta: 1,
    um: "cad",
    prezzo: 1500,
  });
  assert.deepEqual(parseDettatura("pulizia vetri"), {
    descrizione: "Pulizia vetri",
    qta: 1,
    um: "cad",
    prezzo: 0,
  });
});

test("nome file PDF senza caratteri strani", () => {
  assert.equal(
    nomeFilePdf({ numero: "2026-001", cliente: { nome: "Niccolò D'Amato" } }),
    "Preventivo-2026-001-Niccolo-D-Amato.pdf",
  );
});

test("limite piano gratuito: preventivi distinti al mese, riesportare non consuma", () => {
  const ott = new Date(2026, 9, 6);
  const nov = new Date(2026, 10, 1);
  let c = null;
  assert.equal(pdfRimasti(c, 3, ott), 3);
  c = registraEsportazione(c, "a", ott);
  c = registraEsportazione(c, "a", ott);
  assert.equal(pdfRimasti(c, 3, ott), 2);
  c = registraEsportazione(c, "b", ott);
  c = registraEsportazione(c, "c", ott);
  assert.equal(pdfRimasti(c, 3, ott), 0);
  assert.equal(puoEsportare(c, 3, "a", ott), true);
  assert.equal(puoEsportare(c, 3, "d", ott), false);
  assert.equal(pdfRimasti(c, 3, nov), 3);
  assert.equal(puoEsportare(c, 3, "d", nov), true);
});

test("telefono per WhatsApp", () => {
  assert.equal(telefonoWhatsApp("333 123 4567"), "393331234567");
  assert.equal(telefonoWhatsApp("+39 333 1234567"), "393331234567");
  assert.equal(telefonoWhatsApp("0039 333 1234567"), "393331234567");
  assert.equal(telefonoWhatsApp(""), "");
});

test("testo WhatsApp", () => {
  const txt = testoWhatsApp(
    { numero: "2026-001", oggetto: "Bagno", cliente: { nome: "Mario" } },
    { ragioneSociale: "Idraulica Rossi", telefono: "333" },
    { totale: 100, forfettario: false },
  );
  assert.match(txt, /Buongiorno Mario/);
  assert.match(txt, /€ 100,00 IVA inclusa/);
  assert.match(txt, /Idraulica Rossi - 333/);
});

test("dati mestieri completi e coerenti", () => {
  const ids = new Set();
  for (const m of MESTIERI) {
    assert.ok(/^[a-z-]+$/.test(m.id), m.id);
    assert.ok(!ids.has(m.id), "id duplicato " + m.id);
    ids.add(m.id);
    assert.ok(m.nome && m.oggetto && m.iva && m.consigli.length >= 3, m.id);
    const voci = vociListino(m);
    assert.ok(voci.length >= 6, m.id);
    for (const v of voci) {
      assert.ok(v.descrizione && v.um, m.id);
      assert.ok(v.prezzo > 0, m.id + " " + v.descrizione);
      assert.ok(v.tipo === "man" || v.tipo === "mat", m.id);
    }
  }
  assert.ok(MESTIERI.length >= 25);
});

test("WhatsApp anche verso i numeri fissi italiani (WhatsApp Business)", () => {
  assert.equal(telefonoWhatsApp("035 123456"), "39035123456");
  assert.equal(telefonoWhatsApp("02 1234 5678"), "390212345678");
  assert.equal(telefonoWhatsApp("+39 035 123456"), "39035123456");
});
