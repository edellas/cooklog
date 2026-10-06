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
