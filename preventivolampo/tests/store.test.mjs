import { test } from "node:test";
import assert from "node:assert/strict";
import { validaBackup } from "../public/js/store.js";

test("backup: file non valido o vuoto rifiutato prima di toccare i dati", () => {
  assert.throws(() => validaBackup(null), /non valido/);
  assert.throws(() => validaBackup({ app: "altro" }), /non valido/);
  assert.throws(() => validaBackup([]), /non valido/);
  assert.throws(() => validaBackup({ app: "preventivolampo", preventivi: "x" }), /vuoto/);
});

test("backup: record malformati scartati o ripuliti, licenza mai importata", () => {
  const r = validaBackup({
    app: "preventivolampo",
    preventivi: [
      {
        id: "ok",
        numero: 7,
        data: "<b>",
        stato: "hackerato",
        cliente: null,
        righe: [null, { descrizione: "x" }, "y"],
        acconto: 3,
      },
      { numero: "senza id" },
      null,
      { id: "", righe: [] },
      { id: "x".repeat(200), righe: [] },
      { id: '"><svg onload=alert(1)>', righe: [] },
    ],
    clienti: [{ id: "c1", nome: "Mario" }, { nome: "senza id" }],
    listino: [{ id: "l1", descrizione: 123 }],
    kv: [
      { chiave: "licenza", valore: { valida: true } },
      { chiave: "azienda", valore: { ragioneSociale: "Ditta" } },
      { chiave: "contatore", valore: "x" },
      { chiave: "__proto__", valore: {} },
    ],
  });
  assert.equal(r.preventivi.length, 1);
  const p = r.preventivi[0];
  assert.equal(p.numero, "7");
  assert.match(p.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p.stato, "bozza");
  assert.deepEqual(p.cliente, {});
  assert.deepEqual(p.righe, [{ descrizione: "x" }]);
  assert.deepEqual(p.acconto, { tipo: "perc", valore: 0 });
  assert.equal(r.clienti.length, 1);
  assert.equal(r.listino[0].descrizione, "123");
  assert.deepEqual(
    r.kv.map((x) => x.chiave),
    ["azienda"],
  );
});

test("backup: incassi, date e appuntamenti ostili vengono ripuliti", () => {
  const { preventivi } = validaBackup({
    app: "preventivolampo",
    preventivi: [
      {
        id: "p1",
        caparra: "sì",
        disponibilita: [{ data: "<script>" }, { data: "2026-10-12", fascia: "notte" }],
        appuntamento: { data: "2026-02-30" },
        accettatoIl: "ieri",
        incasso: {
          pagamenti: [{ importo: "50", metodo: "constructor", data: "x", id: "../x" }, "x"],
          solleciti: "tanti",
          segnalazioni: [{ importo: -1 }],
          fineLavori: "2026-10-01",
          giorniSaldo: 9999,
        },
      },
      { id: "p2" },
    ],
  });
  const [p1, p2] = preventivi;
  assert.equal(p1.caparra, false);
  assert.deepEqual(p1.disponibilita, [{ data: "2026-10-12", fascia: "giornata" }]);
  assert.equal(p1.appuntamento, null);
  assert.equal(p1.accettatoIl, "");
  assert.equal(p1.incasso.pagamenti.length, 1);
  assert.equal(p1.incasso.pagamenti[0].metodo, "altro");
  assert.notEqual(p1.incasso.pagamenti[0].id, "../x");
  assert.deepEqual(p1.incasso.solleciti, []);
  assert.deepEqual(p1.incasso.segnalazioni, []);
  assert.equal(p1.incasso.fineLavori, "2026-10-01");
  assert.equal(p1.incasso.giorniSaldo, 365);
  assert.equal(p2.incasso, null);
  assert.deepEqual(p2.disponibilita, []);
});

test("backup: il riferimento dei lavori extra (variante) viene ripulito", () => {
  const { preventivi } = validaBackup({
    app: "preventivolampo",
    preventivi: [
      { id: "v1", variante: { di: "../<x>orig-1", numero: "2026-004", data: "2026-02-30", altro: "x" } },
      { id: "v2", variante: "orig" },
      { id: "v3" },
    ],
  });
  assert.deepEqual(preventivi[0].variante, { di: "xorig-1", numero: "2026-004", data: "" });
  assert.equal(preventivi[1].variante, null);
  assert.equal(preventivi[2].variante, null);
});

test("backup: firma sul posto e online solo come booleani veri", () => {
  const firma = (extra) => ({
    img: "data:image/png;base64,AA==",
    nome: "Giulia",
    data: "2026-10-01T10:00:00Z",
    ...extra,
  });
  const { preventivi } = validaBackup({
    app: "preventivolampo",
    preventivi: [
      { id: "a", firma: firma({ sulPosto: true, online: false }) },
      { id: "b", firma: firma({ sulPosto: "true", online: 1 }) },
    ],
  });
  assert.equal(preventivi[0].firma.sulPosto, true);
  assert.equal(preventivi[0].firma.online, false);
  assert.equal(preventivi[1].firma.sulPosto, false);
  assert.equal(preventivi[1].firma.online, false);
});
