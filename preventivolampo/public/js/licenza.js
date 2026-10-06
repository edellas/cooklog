// Gestione licenza Pro lato app. La verifica vera avviene nella funzione
// serverless /api/licenza, che interroga Polar o Lemon Squeezy.

const GIORNO = 24 * 60 * 60 * 1000;

export function isPro(lic, config, ora = Date.now()) {
  if (!lic || !lic.valida) return false;
  if (lic.scadenza && Date.parse(lic.scadenza) < ora) return false;
  // Senza connessione resta Pro per un periodo di tolleranza dall'ultima verifica.
  return ora - (lic.verificataIl || 0) < config.giorniTolleranzaOffline * GIORNO;
}

export async function verifica(chiave, config) {
  const risposta = await fetch(config.apiLicenza, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chiave: String(chiave || "").trim() }),
  });
  let dati = {};
  try {
    dati = await risposta.json();
  } catch {
    /* risposta non JSON */
  }
  if (!risposta.ok) {
    const err = new Error(dati.messaggio || "Servizio licenze non raggiungibile, riprova tra poco.");
    err.temporaneo = true;
    throw err;
  }
  return {
    chiave: String(chiave).trim(),
    valida: Boolean(dati.valida),
    scadenza: dati.scadenza || null,
    email: dati.email || "",
    messaggio: dati.messaggio || "",
    verificataIl: Date.now(),
  };
}

// Ricontrolla la licenza ogni N giorni. Se la rete non c'è, mantiene lo stato attuale.
export async function rivalidaSeServe(lic, config, salva) {
  if (!lic || !lic.chiave) return lic;
  if (Date.now() - (lic.verificataIl || 0) < config.giorniRevalidazione * GIORNO) return lic;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return lic;
  try {
    const nuova = await verifica(lic.chiave, config);
    await salva(nuova);
    return nuova;
  } catch {
    return lic;
  }
}
