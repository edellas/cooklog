// Archivio locale: tutti i dati restano sul dispositivo dell'utente (IndexedDB).
// Nessun dato dei clienti passa dai nostri server: privacy semplice e costi zero.
import { normalizzaIncasso, normalizzaDisponibilita, normalizzaAppuntamento, dataValida } from "./incassi.js";

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

  // Il file viene controllato e ripulito PRIMA di cancellare qualcosa:
  // un backup danneggiato o costruito ad arte non deve far perdere i dati attuali.
  async importa(dati) {
    const pulito = validaBackup(dati);
    for (const s of ["preventivi", "clienti", "listino"]) {
      await this.svuota(s);
      for (const o of pulito[s]) await this.salva(s, o);
    }
    for (const r of pulito.kv) await this.salva("kv", r);
    return { preventivi: pulito.preventivi.length, clienti: pulito.clienti.length, listino: pulito.listino.length };
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

const oggetto = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
// Gli identificativi finiscono negli indirizzi delle pagine (#/p/<id>): solo caratteri sicuri.
const conId = (o) => oggetto(o) && typeof o.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(o.id);
const testo = (v, max = 5000) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");

export function validaBackup(dati) {
  if (!oggetto(dati) || dati.app !== "preventivolampo") throw new Error("File di backup non valido");
  const lista = (x) => (Array.isArray(x) ? x : []);
  const preventivi = lista(dati.preventivi)
    .filter(conId)
    .map((p) => ({
      ...p,
      numero: testo(p.numero, 60),
      data: /^\d{4}-\d{2}-\d{2}$/.test(p.data) ? p.data : new Date().toISOString().slice(0, 10),
      stato: ["bozza", "inviato", "accettato", "rifiutato"].includes(p.stato) ? p.stato : "bozza",
      cliente: oggetto(p.cliente) ? p.cliente : {},
      righe: lista(p.righe).filter(oggetto),
      acconto: oggetto(p.acconto) ? p.acconto : { tipo: "perc", valore: 0 },
      foto: lista(p.foto).filter(oggetto),
      firma: oggetto(p.firma)
        ? {
            img: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.firma.img) ? p.firma.img : "",
            nome: testo(p.firma.nome, 120),
            luogo: testo(p.firma.luogo, 120),
            data: testo(p.firma.data, 40),
            online: p.firma.online === true,
          }
        : null,
      accettazioneOnline: oggetto(p.accettazioneOnline)
        ? {
            il: Number.isFinite(p.accettazioneOnline.il) ? p.accettazioneOnline.il : 0,
            hash: testo(p.accettazioneOnline.hash, 64).replace(/[^0-9a-f]/g, ""),
            facoltativeAggiunte: lista(p.accettazioneOnline.facoltativeAggiunte)
              .filter((x) => typeof x === "string")
              .slice(0, 200)
              .map((x) => x.slice(0, 600)),
          }
        : null,
      caparra: p.caparra === true,
      disponibilita: normalizzaDisponibilita(p.disponibilita),
      appuntamento: normalizzaAppuntamento(p.appuntamento),
      accettatoIl: dataValida(p.accettatoIl) ? p.accettatoIl : "",
      // Backup di prima del registro incassi: gli accettati restano "da aggiornare" (niente falsi scaduti).
      incasso:
        p.incasso === undefined && p.stato === "accettato"
          ? normalizzaIncasso({ storico: true })
          : p.incasso == null
            ? null
            : normalizzaIncasso(p.incasso),
    }));
  const clienti = lista(dati.clienti).filter(conId);
  const listino = lista(dati.listino)
    .filter(conId)
    .map((v) => ({ ...v, descrizione: testo(v.descrizione, 600) }));
  // Solo impostazioni e contatore: la licenza non si importa mai.
  const kv = lista(dati.kv).filter(
    (r) => oggetto(r) && (r.chiave === "azienda" || r.chiave === "contatore") && oggetto(r.valore),
  );
  if (!preventivi.length && !clienti.length && !listino.length && !kv.length) throw new Error("Il backup è vuoto");
  return { preventivi, clienti, listino, kv };
}
