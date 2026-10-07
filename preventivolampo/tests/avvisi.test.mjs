import { test } from "node:test";
import assert from "node:assert/strict";
import { pianificaAvvisi, idAvviso, MAX_AVVISI, GIRO_CONTI } from "../public/js/avvisi.js";
import { orariEvento } from "../public/js/incassi.js";

const ora = new Date(2026, 9, 7, 12, 0); // 7 ottobre 2026, mezzogiorno
const giorno = (n) => {
  const d = new Date(2026, 9, 7 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const statoDi = (p) => p.__stato || null;

test("avvisi: scadenza del saldo, ritardo e lavoro di domani, con gli orari giusti", () => {
  const prev = {
    id: "p1",
    numero: "2026-001",
    stato: "accettato",
    cliente: { nome: "Giulia Bianchi" },
    appuntamento: { data: giorno(3), fascia: "mattina", da: "cliente" },
    __stato: { residuo: 204.05, prossima: { tipo: "saldo", importo: 204.05, data: giorno(2) } },
  };
  const lista = pianificaAvvisi([prev], { ora, statoDi });
  const titoli = lista.map((a) => a.titolo);
  assert.deepEqual(titoli, [
    "Oggi scade il saldo di Giulia Bianchi",
    "Domani: lavoro da Giulia Bianchi",
    "Giulia Bianchi è in ritardo di 3 giorni",
  ]);
  assert.equal(lista[0].quando.getHours(), 9);
  assert.equal(lista[0].rotta, "#/p/p1?sez=incassi");
  assert.equal(lista[1].quando.getHours(), 18);
  assert.equal(lista[1].quando.getDate(), new Date(2026, 9, 9).getDate());
  assert.equal(lista[2].rotta, "#/p/p1?sez=incassi&azione=sollecito");
  assert.match(lista[0].testo, /€ 204,05/);
});

test("avvisi: niente avvisi nel passato, niente se è tutto pagato o rifiutato", () => {
  const pagato = { id: "a", stato: "accettato", cliente: {}, __stato: { residuo: 0, prossima: null } };
  const scaduto = {
    id: "b",
    stato: "accettato",
    cliente: {},
    __stato: { residuo: 50, prossima: { tipo: "acconto", importo: 50, data: giorno(-10) } },
  };
  const rifiutato = { id: "c", stato: "rifiutato", cliente: {}, inviatoIl: ora.getTime() - 86400000 };
  assert.deepEqual(pianificaAvvisi([pagato, scaduto, rifiutato], { ora, statoDi }), []);
});

test("avvisi: cliente che non risponde e preventivo che scade, dall'ultimo contatto", () => {
  const inviato = {
    id: "p2",
    numero: "2026-002",
    stato: "inviato",
    cliente: { nome: "Luca Verdi" },
    data: giorno(0),
    validitaGiorni: 10,
    inviatoIl: ora.getTime(),
  };
  const lista = pianificaAvvisi([inviato], { ora, statoDi, giorniRicontatto: 3 });
  assert.equal(lista.length, 2);
  assert.equal(lista[0].titolo, "Luca Verdi non ha ancora risposto");
  assert.equal(lista[0].quando.getDate(), new Date(2026, 9, 10).getDate());
  assert.equal(lista[1].titolo, "Il preventivo per Luca Verdi scade dopodomani");
  assert.equal(lista[1].quando.getDate(), new Date(2026, 9, 15).getDate());
  // ricontattato: l'avviso si sposta
  const dopo = pianificaAvvisi([{ ...inviato, ricontattatoIl: ora.getTime() + 2 * 86400000 }], { ora, statoDi });
  assert.equal(dopo[0].quando.getDate(), new Date(2026, 9, 12).getDate());
  assert.notEqual(dopo[0].id, lista[0].id);
});

test("avvisi: numeri stabili e diversi, limite di iOS rispettato, giro dei conti settimanale", () => {
  assert.equal(idAvviso("x"), idAvviso("x"));
  assert.notEqual(idAvviso("x"), idAvviso("y"));
  for (const k of ["a", "b", "p1:scade:saldo:2026-10-09", "giro-dei-conti"]) {
    const n = idAvviso(k);
    assert.ok(Number.isInteger(n) && n > 0 && n < 2 ** 31, `${k}: ${n}`);
  }
  const tanti = Array.from({ length: 80 }, (_, i) => ({
    id: `p${i}`,
    stato: "inviato",
    cliente: { nome: `Cliente ${i}` },
    inviatoIl: ora.getTime() + i * 3600000,
  }));
  const lista = pianificaAvvisi(tanti, { ora, statoDi, conti: true });
  assert.equal(lista.length, MAX_AVVISI);
  assert.deepEqual(lista.at(-1).ogniSettimana, GIRO_CONTI);
  assert.equal(new Set(lista.map((a) => a.id)).size, lista.length);
  // i più vicini per primi
  for (let i = 1; i < lista.length - 1; i++) assert.ok(lista[i].quando >= lista[i - 1].quando);
  // dati strani non rompono niente
  assert.deepEqual(pianificaAvvisi(null, { ora }), []);
  assert.deepEqual(pianificaAvvisi([null, {}, { id: "z", stato: "accettato" }], { ora }), []);
});

test("calendario: orari dell'evento come nel file .ics", () => {
  const m = orariEvento("2026-10-12", "mattina");
  assert.equal(m.inizio.getHours(), 8);
  assert.equal(m.fine.getHours(), 13);
  assert.equal(m.tuttoIlGiorno, false);
  const g = orariEvento("2026-10-12", "giornata");
  assert.equal(g.tuttoIlGiorno, true);
  assert.equal(g.fine.getDate(), 13);
  assert.equal(orariEvento("2026-02-30", "mattina"), null);
});
