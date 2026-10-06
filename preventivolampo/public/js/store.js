// Archivio locale: tutti i dati restano sul dispositivo dell'utente (IndexedDB).
// Nessun dato dei clienti passa dai nostri server: privacy semplice e costi zero.

const DB_NOME = "preventivolampo";
const DB_VERSIONE = 1;
const STORES = ["preventivi", "clienti", "listino", "kv"];

let dbPromise = null;

function apriDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("IndexedDB non disponibile"));
      return;
    }
    const req = indexedDB.open(DB_NOME, DB_VERSIONE);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: s === "kv" ? "chiave" : "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, modo, fn) {
  const db = await apriDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, modo);
    const os = t.objectStore(store);
    let risultato;
    Promise.resolve(fn(os)).then((r) => (risultato = r));
    t.oncomplete = () => resolve(risultato);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function richiesta(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  async tutti(store) {
    return tx(store, "readonly", (os) => richiesta(os.getAll()));
  },
  async leggi(store, id) {
    return tx(store, "readonly", (os) => richiesta(os.get(id)));
  },
  async salva(store, oggetto) {
    await tx(store, "readwrite", (os) => richiesta(os.put(oggetto)));
    return oggetto;
  },
  async elimina(store, id) {
    return tx(store, "readwrite", (os) => richiesta(os.delete(id)));
  },
  async svuota(store) {
    return tx(store, "readwrite", (os) => richiesta(os.clear()));
  },
  async get(chiave, predefinito = null) {
    const r = await this.leggi("kv", chiave);
    return r ? r.valore : predefinito;
  },
  async set(chiave, valore) {
    return this.salva("kv", { chiave, valore });
  },

  async esporta() {
    const [preventivi, clienti, listino, kv] = await Promise.all(STORES.map((s) => this.tutti(s)));
    return {
      app: "preventivolampo",
      versione: 1,
      esportatoIl: new Date().toISOString(),
      preventivi,
      clienti,
      listino,
      // La licenza non va nel backup: si riattiva col codice.
      kv: kv.filter((r) => r.chiave !== "licenza"),
    };
  },

  async importa(dati) {
    if (!dati || dati.app !== "preventivolampo") throw new Error("File di backup non valido");
    for (const s of ["preventivi", "clienti", "listino"]) {
      await this.svuota(s);
      for (const o of dati[s] || []) await this.salva(s, o);
    }
    for (const r of dati.kv || []) if (r.chiave !== "licenza") await this.salva("kv", r);
  },

  // Chiede al browser di non cancellare i dati quando manca spazio.
  async rendiPersistente() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch {
      /* non supportato */
    }
    return false;
  },
};
