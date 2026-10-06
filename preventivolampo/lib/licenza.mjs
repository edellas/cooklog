// Verifica dei codici licenza, condivisa da Netlify e Cloudflare.
// I provider (Polar, Lemon Squeezy) sono "Merchant of Record": incassano, applicano l'IVA
// europea, emettono le ricevute e ti girano il netto. Tu non gestisci IVA estera né fatture ai clienti.
//
// Variabili d'ambiente:
//   LICENZE_PROVIDER        "polar" (predefinito) oppure "lemonsqueezy"
//   POLAR_ORGANIZATION_ID   ID organizzazione Polar (Impostazioni > Generale)
//   POLAR_SANDBOX           "true" per usare l'ambiente di prova di Polar
//   POLAR_BENEFIT_IDS       (facoltativo) ID dei benefit "License key" accettati, separati da virgola
//   LEMONSQUEEZY_STORE_ID   ID negozio Lemon Squeezy (obbligatorio se provider = lemonsqueezy)

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function risposta(stato, corpo) {
  return new Response(JSON.stringify(corpo), { status: stato, headers: JSON_HEADERS });
}

export function mascheraEmail(email) {
  const e = String(email || "");
  const at = e.indexOf("@");
  if (at < 1) return "";
  return e[0] + "***" + e.slice(at);
}

function scaduta(iso, ora) {
  return Boolean(iso) && Date.parse(iso) < ora;
}

async function verificaPolar(chiave, env, fetchImpl, ora) {
  if (!env.POLAR_ORGANIZATION_ID) throw new Error("POLAR_ORGANIZATION_ID non configurato");
  const base = String(env.POLAR_SANDBOX) === "true" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
  const r = await fetchImpl(`${base}/v1/customer-portal/license-keys/validate`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ key: chiave, organization_id: env.POLAR_ORGANIZATION_ID }),
  });
  if (r.status === 404 || r.status === 422)
    return { valida: false, messaggio: "Codice non riconosciuto. Controlla di averlo copiato tutto." };
  if (!r.ok) throw new Error(`Polar ha risposto ${r.status}`);
  const d = await r.json();
  const benefitAmmessi = String(env.POLAR_BENEFIT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (benefitAmmessi.length && !benefitAmmessi.includes(d.benefit_id)) {
    return { valida: false, messaggio: "Questo codice non è valido per PreventivoLampo." };
  }
  if (d.status !== "granted")
    return { valida: false, messaggio: "Abbonamento non attivo. Rinnovalo per continuare a usare Pro." };
  if (scaduta(d.expires_at, ora)) return { valida: false, messaggio: "La licenza è scaduta." };
  return { valida: true, scadenza: d.expires_at || null, email: mascheraEmail(d.customer && d.customer.email) };
}

async function verificaLemonSqueezy(chiave, env, fetchImpl, ora) {
  if (!env.LEMONSQUEEZY_STORE_ID) throw new Error("LEMONSQUEEZY_STORE_ID non configurato");
  const r = await fetchImpl("https://api.lemonsqueezy.com/v1/licenses/validate", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ license_key: chiave }).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status >= 500) throw new Error(`Lemon Squeezy ha risposto ${r.status}`);
  if (!d.valid || !d.license_key)
    return { valida: false, messaggio: "Codice non riconosciuto. Controlla di averlo copiato tutto." };
  // Importante: accetta solo codici del TUO negozio, non di altri prodotti venduti su Lemon Squeezy.
  if (String(d.meta && d.meta.store_id) !== String(env.LEMONSQUEEZY_STORE_ID)) {
    return { valida: false, messaggio: "Questo codice non è valido per PreventivoLampo." };
  }
  const stato = d.license_key.status;
  if (stato !== "active" && stato !== "inactive")
    return { valida: false, messaggio: "Abbonamento non attivo. Rinnovalo per continuare a usare Pro." };
  if (scaduta(d.license_key.expires_at, ora)) return { valida: false, messaggio: "La licenza è scaduta." };
  return { valida: true, scadenza: d.license_key.expires_at || null, email: mascheraEmail(d.meta.customer_email) };
}

export async function verificaLicenza(chiave, env, fetchImpl = fetch, ora = Date.now()) {
  const provider = String(env.LICENZE_PROVIDER || "polar").toLowerCase();
  if (provider === "lemonsqueezy") return verificaLemonSqueezy(chiave, env, fetchImpl, ora);
  return verificaPolar(chiave, env, fetchImpl, ora);
}

// Gestore HTTP standard (Request -> Response), usato da entrambe le piattaforme.
export async function gestisciRichiesta(req, env = {}, fetchImpl = fetch) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return risposta(405, { valida: false, messaggio: "Metodo non consentito" });

  let corpo;
  try {
    corpo = await req.json();
  } catch {
    return risposta(400, { valida: false, messaggio: "Richiesta non valida" });
  }
  const chiave = String((corpo && corpo.chiave) || "").trim();
  if (chiave.length < 8 || chiave.length > 200 || /[\s<>]/.test(chiave)) {
    return risposta(400, { valida: false, messaggio: "Formato del codice non valido" });
  }

  try {
    // Un codice non valido è una risposta normale (200 con valida: false), non un errore HTTP.
    return risposta(200, await verificaLicenza(chiave, env, fetchImpl));
  } catch (err) {
    console.error("Errore verifica licenza:", err && err.message);
    return risposta(503, {
      valida: false,
      messaggio: "Servizio licenze momentaneamente non disponibile, riprova tra poco.",
    });
  }
}
