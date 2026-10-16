// Verifica automatica dell'età con Didit. Supabase Edge Function "verifica-eta" (Deno).
//
// Tre indirizzi:
//   POST /verifica-eta           → l'app (utente connesso) chiede una sessione: risponde con il link di Didit.
//   POST /verifica-eta/webhook   → Didit avvisa che la verifica è finita (richiesta firmata con il segreto).
//   GET  /verifica-eta/ritorno   → finita la verifica il browser torna qui e viene rimandato nell'app.
//
// Segreti da impostare in Supabase → Edge Functions → Secrets:
//   DIDIT_API_KEY, DIDIT_WORKFLOW_ID, DIDIT_WEBHOOK_SECRET
// (SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY ci sono già.)
// La funzione va creata con "Verify JWT" SPENTO: Didit non ha un utente Supabase. L'utente dell'app lo
// controlla il codice qui sotto.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DIDIT = 'https://verification.didit.me/v3';
const env = (k: string) => Deno.env.get(k) ?? '';
const SELF = `${env('SUPABASE_URL')}/functions/v1/verifica-eta`;
const APP_RETURN = 'virale://verifica';

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop();
  try {
    if (route === 'webhook' && req.method === 'POST') return await webhook(req);
    if (route === 'ritorno') return Response.redirect(APP_RETURN, 302);
    if (route === 'verifica-eta' && req.method === 'POST') return await start(req);
    return json({ error: 'Indirizzo non valido.' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'Errore interno: riprova tra poco.' }, 500);
  }
});

/** L'app chiede di iniziare: si controlla chi è, poi si apre (o si riprende) la sessione su Didit. */
async function start(req: Request): Promise<Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  const user = auth.user;
  if (!user) return json({ error: 'Accedi di nuovo e riprova.' }, 401);

  const { data: cfg } = await admin.from('arena_config').select('id_provider').limit(1).maybeSingle();
  if (cfg?.id_provider !== 'didit') return json({ error: 'La verifica automatica non è attiva: carica le foto del documento.' }, 409);
  const { data: check } = await admin.from('identity_checks').select('status').eq('user_id', user.id).maybeSingle();
  if (!check) return json({ error: 'Account non trovato.' }, 404);
  if (check.status === 'approved') return json({ error: 'La tua età è già verificata.' }, 409);
  const { data: profile } = await admin.from('profiles').select('banned_at').eq('id', user.id).maybeSingle();
  if (!profile || profile.banned_at) return json({ error: 'Account non attivo.' }, 403);

  // Se c'è già una sessione non finita con lo stesso vendor_data, Didit restituisce quella: niente doppioni.
  const res = await fetch(`${DIDIT}/session/`, {
    method: 'POST',
    headers: { 'x-api-key': env('DIDIT_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_id: env('DIDIT_WORKFLOW_ID'),
      vendor_data: user.id,
      callback: `${SELF}/ritorno`,
      language: 'it',
    }),
  });
  if (!res.ok) {
    console.error('Didit session', res.status, await res.text());
    return json({ error: 'Il servizio di verifica non risponde. Riprova tra poco.' }, 502);
  }
  const session = (await res.json()) as { session_id: string; url: string };
  const { error } = await admin.rpc('identity_provider_start', { p_user_id: user.id, p_session: session.session_id });
  if (error) throw error;
  return json({ url: session.url });
}

/** Didit avvisa: si controlla la firma, poi si rilegge l'esito direttamente da Didit (unica fonte affidabile). */
async function webhook(req: Request): Promise<Response> {
  const raw = await req.text();
  const ts = Number(req.headers.get('x-timestamp'));
  const signature = (req.headers.get('x-signature') ?? '').toLowerCase();
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return json({ error: 'Richiesta scaduta.' }, 401);
  if (!signature || !safeEqual(signature, await hmacHex(env('DIDIT_WEBHOOK_SECRET'), raw))) return json({ error: 'Firma non valida.' }, 401);

  const event = JSON.parse(raw) as { session_id?: string; status?: string; vendor_data?: string; timestamp?: number; created_at?: number | string };
  // L'orario nell'intestazione non è firmato: se c'è, vale quello dentro il corpo (che è firmato).
  const signedAt = typeof event.timestamp === 'number' ? event.timestamp : typeof event.created_at === 'number' ? event.created_at : null;
  if (signedAt !== null && Math.abs(Date.now() / 1000 - signedAt) > 300) return json({ error: 'Richiesta scaduta.' }, 401);
  if (!event.session_id || !event.vendor_data) return json({ ok: true });
  if (!['Approved', 'Declined', 'In Review'].includes(event.status ?? '')) return json({ ok: true });

  const res = await fetch(`${DIDIT}/session/${encodeURIComponent(event.session_id)}/decision/`, { headers: { 'x-api-key': env('DIDIT_API_KEY') } });
  // Se Didit non risponde, un errore fa ripetere l'avviso più tardi.
  if (!res.ok) return json({ error: 'Esito non disponibile.' }, 502);
  const decision = (await res.json()) as {
    status: string;
    vendor_data?: string;
    id_verifications?: { date_of_birth?: string; first_name?: string; last_name?: string }[];
    id_verification?: { date_of_birth?: string; first_name?: string; last_name?: string };
  };
  if (decision.vendor_data && decision.vendor_data !== event.vendor_data) return json({ ok: true });
  const doc = decision.id_verifications?.[0] ?? decision.id_verification;
  // Una data illeggibile non deve far fallire la chiamata (Didit ripeterebbe l'avviso all'infinito).
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(doc?.date_of_birth ?? '') ? doc!.date_of_birth! : null;

  const { data: outcome, error } = await admin.rpc('identity_provider_result', {
    p_user_id: event.vendor_data,
    p_session: event.session_id,
    p_status: decision.status,
    p_birth_date: birth,
    p_first_name: doc?.first_name ?? null,
    p_last_name: doc?.last_name ?? null,
  });
  if (error) throw error;

  // Decisione presa: su Didit non serve più nulla, si cancellano sessione, foto e video.
  // Se invece decide una persona ('review'), la sessione resta finché l'amministratore non l'ha vista.
  if (['approved', 'rejected', 'underage'].includes(String(outcome))) {
    await fetch(`${DIDIT}/session/${encodeURIComponent(event.session_id)}/delete/`, { method: 'DELETE', headers: { 'x-api-key': env('DIDIT_API_KEY') } }).catch(() => undefined);
  }
  return json({ ok: true, outcome });
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
