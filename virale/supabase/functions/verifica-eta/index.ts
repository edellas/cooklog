// Verifica automatica dell'età con Didit. Supabase Edge Function "verifica-eta" (Deno).
//
// Indirizzi:
//   POST /verifica-eta           → l'app (utente connesso) chiede una sessione: risponde con il link di Didit.
//                                  Con { "action": "diagnosi" } (solo amministratori) prova tutto il collegamento.
//                                  Con { "action": "esito" } legge da Didit l'esito della propria sessione aperta.
//   POST /verifica-eta/webhook   → Didit avvisa che la verifica è finita (richiesta firmata con il segreto).
//   GET  /verifica-eta/ritorno   → finita la verifica il browser torna qui e viene rimandato nell'app.
//   GET  /verifica-eta/stato     → controllo dal browser: quali segreti ci sono e se Didit accetta la chiave.
//                                  Non mostra mai i valori dei segreti.
//   GET  /verifica-eta/apri/post/<id> → link dei post condivisi (anche quelli vecchi): rimanda alla pagina
//                                  di atterraggio del sito (VIRALE_SITO/apri.html) o, senza sito, all'app.
//   POST /verifica-eta/lavori    → lavoro programmato (pg_cron ogni minuto, intestazione x-virale-cron):
//                                  cancella dallo Storage i file rimossi o di account chiusi e invia le
//                                  notifiche push (servizio di Expo).
//   POST /verifica-eta           con { "action": "modera", paths, frames, caption } (utente connesso): controllo
//                                  automatico dei contenuti PRIMA di pubblicare (OpenAI Moderation, gratuito).
//                                  Salva un esito per file in media_checks; senza esito il database non crea il post.
//
// Segreti da impostare in Supabase → Edge Functions → Secrets:
//   DIDIT_API_KEY, DIDIT_WORKFLOW_ID, DIDIT_WEBHOOK_SECRET (verifica automatica dell'età)
//   VIRALE_CRON_SECRET (lo stesso valore di "virale_cron_secret" nel Vault: vedi setup-produzione.sql)
//   VIRALE_SITO (facoltativo: l'indirizzo del sito con apri.html, es. https://nome.github.io/cooklog)
//   EXPO_ACCESS_TOKEN (facoltativo: serve solo se su expo.dev è attivo "Enhanced Security for Push Notifications")
//   OPENAI_API_KEY (controllo automatico di foto, video e didascalie; senza, ogni post va in revisione)
// (SUPABASE_URL e la chiave di servizio ci sono già.)
// La funzione va creata con "Verify JWT" SPENTO: Didit non ha un utente Supabase. L'utente dell'app lo
// controlla il codice qui sotto.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DIDIT = 'https://verification.didit.me/v3';
const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const SELF = `${env('SUPABASE_URL')}/functions/v1/verifica-eta`;
const APP_RETURN = 'virale://verifica';
// Su Android Chrome apre l'app in modo affidabile con un indirizzo "intent://" (e se l'app manca non mostra errori).
const ANDROID_RETURN = 'intent://verifica#Intent;scheme=virale;package=app.virale.mobile;end';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=app.virale.mobile';

/** Chiave di servizio: quella classica o, nei progetti con le chiavi nuove, la prima di SUPABASE_SECRET_KEYS. */
function serviceKey(): string {
  if (env('SUPABASE_SERVICE_ROLE_KEY')) return env('SUPABASE_SERVICE_ROLE_KEY');
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

const admin = createClient(env('SUPABASE_URL'), serviceKey(), { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** I segreti mancanti, per nome (mai i valori). */
function missingSecrets(): string[] {
  const missing = ['DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET'].filter((k) => !env(k));
  if (!serviceKey()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  const route = path.split('/').pop();
  try {
    const shared = /\/apri\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
    if (shared && req.method === 'GET') {
      // Link vecchi (o senza sito): un rimando. Con il sito, alla pagina di atterraggio (apre l'app o lo store);
      // senza, direttamente all'app, e su Android con il Play Store se l'app non c'è.
      // Il post lo carica l'app, con i permessi di chi lo apre.
      const site = env('VIRALE_SITO').replace(/\/+$/, '');
      if (/^https:\/\//.test(site)) return new Response(null, { status: 302, headers: { Location: `${site}/apri.html?p=${shared[1]}` } });
      const android = /android/i.test(req.headers.get('user-agent') ?? '');
      const to = android
        ? `intent://post/${shared[1]}#Intent;scheme=virale;package=app.virale.mobile;S.browser_fallback_url=${encodeURIComponent(PLAY_URL)};end`
        : `virale://post/${shared[1]}`;
      return new Response(null, { status: 302, headers: { Location: to } });
    }
    if (route === 'webhook' && req.method === 'POST') return await webhook(req);
    if (route === 'lavori' && req.method === 'POST') return await lavori(req);
    if (route === 'ritorno') {
      const android = /android/i.test(req.headers.get('user-agent') ?? '');
      return new Response(null, { status: 302, headers: { Location: android ? ANDROID_RETURN : APP_RETURN } });
    }
    if (route === 'stato') return await stato();
    if (route === 'verifica-eta' && req.method === 'POST') return await start(req);
    return json({ error: 'Indirizzo non valido.' }, 404);
  } catch (e) {
    // Il dettaglio finisce nei log (Supabase → Edge Functions → verifica-eta → Logs), non a chi chiama.
    console.error('verifica-eta', e);
    return json({ error: 'Errore interno della funzione verifica-eta: guarda i log su Supabase.' }, 500);
  }
});

/** Spiega in italiano perché Didit ha rifiutato la richiesta. */
async function diditProblem(res: Response, what: string): Promise<string> {
  const body = (await res.text()).slice(0, 300);
  console.error(`Didit ${what}`, res.status, body);
  if (res.status === 401 || res.status === 403) return `Didit rifiuta la chiave (errore ${res.status}): controlla il segreto DIDIT_API_KEY su Supabase.`;
  if (res.status === 404 || res.status === 400) return `Didit non accetta la richiesta (errore ${res.status}): controlla DIDIT_WORKFLOW_ID e che il workflow sia pubblicato. Dettaglio: ${body}`;
  if (res.status === 429) return 'Troppe verifiche in poco tempo: riprova tra un minuto.';
  return `Il servizio di verifica non risponde (Didit, errore ${res.status}). Riprova tra poco.`;
}

/** Ultimo controllo della chiave: al massimo uno al minuto, così questa pagina pubblica non consuma i limiti di Didit. */
let keyCheck: { at: number; result: string } | null = null;

/** Ultimo controllo della chiave di OpenAI (anche questo al massimo uno al minuto). */
let openaiCheck: { at: number; result: string } | null = null;

async function openaiStatus(): Promise<string> {
  if (!env('OPENAI_API_KEY')) return 'manca OPENAI_API_KEY: i post nuovi vanno in revisione';
  if (openaiCheck && Date.now() - openaiCheck.at < 60_000) return openaiCheck.result;
  const result = (await scan({ text: 'ciao' })) ? 'attivo (OpenAI accetta la chiave)' : 'OpenAI RIFIUTA la chiave o non risponde: i post nuovi vanno in revisione';
  openaiCheck = { at: Date.now(), result };
  return result;
}

/** Controllo dal browser del telefono: https://<progetto>.supabase.co/functions/v1/verifica-eta/stato */
async function stato(): Promise<Response> {
  const missing = missingSecrets();
  let chiave = 'non controllata (manca DIDIT_API_KEY)';
  if (env('DIDIT_API_KEY')) {
    if (keyCheck && Date.now() - keyCheck.at < 60_000) {
      chiave = keyCheck.result;
    } else {
      // Una sessione che non esiste: con una chiave buona Didit risponde "non trovata", con una sbagliata "non autorizzato".
      const res = await fetch(`${DIDIT}/session/00000000-0000-0000-0000-000000000000/decision/`, { headers: { 'x-api-key': env('DIDIT_API_KEY') } });
      chiave = res.status === 401 || res.status === 403 ? `RIFIUTATA da Didit (errore ${res.status})` : `accettata (Didit ha risposto ${res.status})`;
      keyCheck = { at: Date.now(), result: chiave };
    }
  }
  const { data: cfg, error } = await admin.from('arena_config').select('id_provider').limit(1).maybeSingle();
  return json({
    funzione: 'raggiunta',
    segreti_mancanti: missing,
    chiave_didit: chiave,
    database: error ? `non raggiungibile: ${error.message}` : 'raggiungibile',
    metodo_nell_app: cfg?.id_provider ?? 'sconosciuto',
    controllo_contenuti: await openaiStatus(),
    webhook_da_impostare_su_didit: `${SELF}/webhook`,
  });
}

/** L'app chiede di iniziare: si controlla chi è, poi si apre (o si riprende) la sessione su Didit. */
async function start(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  // Il controllo dei contenuti non dipende da Didit: funziona anche senza i suoi segreti.
  if (body.action === 'modera') {
    if (!serviceKey()) return json({ error: 'Controllo dei contenuti non configurato: su Supabase manca la chiave di servizio.' }, 500);
    const who = await caller(req);
    if (!who) return json({ error: 'Accedi di nuovo e riprova.' }, 401);
    return await modera(who, body as ModeraBody);
  }

  const missing = missingSecrets().filter((k) => k !== 'DIDIT_WEBHOOK_SECRET');
  if (missing.length) return json({ error: `Verifica automatica non configurata: su Supabase mancano i segreti ${missing.join(', ')}.` }, 500);

  const user = await caller(req);
  if (!user) return json({ error: 'Accedi di nuovo e riprova.' }, 401);

  if (body.action === 'diagnosi') return await diagnosi(user.id);
  if (body.action === 'esito') return await esito(user.id);

  const { data: cfg } = await admin.from('arena_config').select('id_provider').limit(1).maybeSingle();
  if (cfg?.id_provider !== 'didit') return json({ error: 'La verifica automatica non è attiva: carica le foto del documento.' }, 409);
  const { data: check } = await admin.from('identity_checks').select('status').eq('user_id', user.id).maybeSingle();
  if (!check) return json({ error: 'Account non trovato.' }, 404);
  if (check.status === 'approved') return json({ error: 'La tua età è già verificata.' }, 409);
  const { data: profile } = await admin.from('profiles').select('banned_at').eq('id', user.id).maybeSingle();
  if (!profile || profile.banned_at) return json({ error: 'Account non attivo.' }, 403);

  // Se c'è già una sessione non finita con lo stesso vendor_data, Didit restituisce quella: niente doppioni.
  const res = await createSession(user.id);
  if (!res.ok) return json({ error: await diditProblem(res, 'session') }, 502);
  const session = (await res.json()) as { session_id: string; url: string };
  const { error } = await admin.rpc('identity_provider_start', { p_user_id: user.id, p_session: session.session_id });
  if (error) throw error;
  return json({ url: session.url });
}

/** L'utente dell'app che chiama (dal suo token), o null. */
async function caller(req: Request): Promise<{ id: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user ? { id: data.user.id } : null;
}

function createSession(vendorData: string): Promise<Response> {
  return fetch(`${DIDIT}/session/`, {
    method: 'POST',
    headers: { 'x-api-key': env('DIDIT_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow_id: env('DIDIT_WORKFLOW_ID'), vendor_data: vendorData, callback: `${SELF}/ritorno`, language: 'it' }),
  });
}

/** Solo per l'amministratore: apre e cancella subito una sessione di prova, così si sa se chiave e workflow vanno. */
async function diagnosi(userId: string): Promise<Response> {
  const { data: me } = await admin.from('profiles').select('is_admin, banned_at').eq('id', userId).maybeSingle();
  if (!me?.is_admin || me.banned_at) return json({ error: 'Solo per gli amministratori.' }, 403);
  const checks: string[] = [];
  const missing = missingSecrets();
  checks.push(missing.length ? `✗ Segreti mancanti su Supabase: ${missing.join(', ')}` : '✓ Segreti presenti');
  if (env('DIDIT_API_KEY') && env('DIDIT_WORKFLOW_ID')) {
    const res = await createSession(`diagnosi-${userId}`);
    if (res.ok) {
      const s = (await res.json()) as { session_id: string };
      checks.push('✓ Didit accetta chiave e workflow');
      await deleteSession(s.session_id, (s as { session_number?: number }).session_number);
    } else {
      checks.push(`✗ ${await diditProblem(res, 'diagnosi')}`);
    }
  }
  checks.push(`Indirizzo del webhook da mettere su Didit: ${SELF}/webhook`);
  // Controllo automatico dei contenuti: una prova con un testo innocuo.
  if (!env('OPENAI_API_KEY')) checks.push('✗ Manca il segreto OPENAI_API_KEY: ogni post nuovo va in revisione');
  else checks.push((await scan({ text: 'ciao' })) ? '✓ OpenAI accetta la chiave (controllo dei contenuti)' : '✗ OpenAI non accetta OPENAI_API_KEY o non risponde: i post nuovi vanno in revisione');
  return json({ ok: !checks.some((c) => c.startsWith('✗')), checks });
}

/** Didit avvisa: si controlla la firma, poi si rilegge l'esito direttamente da Didit (unica fonte affidabile). */
async function webhook(req: Request): Promise<Response> {
  if (!env('DIDIT_WEBHOOK_SECRET')) {
    console.error('verifica-eta: manca DIDIT_WEBHOOK_SECRET');
    return json({ error: 'Webhook non configurato.' }, 500);
  }
  const raw = await req.text();
  const ts = Number(req.headers.get('x-timestamp'));
  const signature = (req.headers.get('x-signature') ?? '').toLowerCase();
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return json({ error: 'Richiesta scaduta.' }, 401);
  if (!signature || !safeEqual(signature, await hmacHex(env('DIDIT_WEBHOOK_SECRET'), raw))) {
    console.error('verifica-eta: firma del webhook non valida (controlla DIDIT_WEBHOOK_SECRET)');
    return json({ error: 'Firma non valida.' }, 401);
  }

  const event = JSON.parse(raw) as { session_id?: string; status?: string; vendor_data?: string; timestamp?: number; created_at?: number | string };
  // L'orario nell'intestazione non è firmato: se c'è, vale quello dentro il corpo (che è firmato).
  const signedAt = typeof event.timestamp === 'number' ? event.timestamp : typeof event.created_at === 'number' ? event.created_at : null;
  if (signedAt !== null && Math.abs(Date.now() / 1000 - signedAt) > 300) return json({ error: 'Richiesta scaduta.' }, 401);
  if (!event.session_id || !event.vendor_data || event.vendor_data.startsWith('diagnosi-')) return json({ ok: true });
  // "Testa Webhook" della console di Didit: firma giusta, ma sessione e utente sono finti. Si risponde ok.
  const test = req.headers.get('x-didit-test-webhook') === 'true' || (event as { metadata?: { test_webhook?: boolean } }).metadata?.test_webhook === true;
  if (test) return json({ ok: true, test: true });
  // vendor_data è sempre l'id dell'utente Virale: altro (vecchie sessioni, prove) si ignora.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.vendor_data)) return json({ ok: true, ignored: true });
  if (!['Approved', 'Declined', 'In Review'].includes(event.status ?? '')) return json({ ok: true });

  const res = await fetch(`${DIDIT}/session/${encodeURIComponent(event.session_id)}/decision/`, { headers: { 'x-api-key': env('DIDIT_API_KEY') } });
  // Sessione non più su Didit (già decisa e cancellata): niente da fare, e Didit non deve ritentare.
  if (res.status === 404) return json({ ok: true, ignored: true });
  // Se Didit non risponde, un errore fa ripetere l'avviso più tardi.
  if (!res.ok) return json({ error: await diditProblem(res, 'decision') }, 502);
  const decision = (await res.json()) as Decision;
  if (decision.vendor_data && decision.vendor_data !== event.vendor_data) return json({ ok: true });
  const outcome = await applyDecision(event.vendor_data, event.session_id, decision);
  return json({ ok: true, outcome });
}

type Decision = {
  status: string;
  vendor_data?: string;
  session_number?: number;
  id_verifications?: { date_of_birth?: string; first_name?: string; last_name?: string; document_number?: string }[];
  id_verification?: { date_of_birth?: string; first_name?: string; last_name?: string; document_number?: string };
};

/**
 * L'app chiede l'esito appena torna da Didit: si legge la decisione direttamente da Didit per la sessione aperta
 * di chi chiama. Così l'esito arriva anche se l'avviso (webhook) di Didit tarda o non è configurato bene.
 */
async function esito(userId: string): Promise<Response> {
  const { data: check } = await admin.from('identity_checks').select('status, provider_session').eq('user_id', userId).maybeSingle();
  if (!check?.provider_session || check.status === 'approved') return json({ outcome: 'none' });
  const res = await fetch(`${DIDIT}/session/${encodeURIComponent(check.provider_session)}/decision/`, { headers: { 'x-api-key': env('DIDIT_API_KEY') } });
  if (!res.ok) return json({ error: await diditProblem(res, 'decision') }, 502);
  const decision = (await res.json()) as Decision;
  if (decision.vendor_data && decision.vendor_data !== userId) return json({ outcome: 'none' });
  // Didit sta ancora lavorando (o l'utente non ha finito): si riprova fra poco.
  if (!['Approved', 'Declined', 'In Review'].includes(decision.status)) return json({ outcome: 'waiting', status: decision.status });
  return json({ outcome: await applyDecision(userId, check.provider_session, decision) });
}

/**
 * Cancella una sessione su Didit (foto, video, dati). Prima l'indirizzo della singola sessione; se Didit non lo
 * accetta, la cancellazione a gruppi documentata (POST /v3/sessions/delete/ con il numero della sessione).
 * Mai un errore verso chi chiama: al massimo resta la conservazione automatica impostata nella console.
 */
async function deleteSession(sessionId: string, sessionNumber?: number): Promise<void> {
  const headers = { 'x-api-key': env('DIDIT_API_KEY'), 'Content-Type': 'application/json' };
  try {
    const res = await fetch(`${DIDIT}/session/${encodeURIComponent(sessionId)}/delete/`, { method: 'DELETE', headers });
    if (res.ok) return;
    if (typeof sessionNumber === 'number') {
      const batch = await fetch(`${DIDIT}/sessions/delete/`, { method: 'POST', headers, body: JSON.stringify({ session_numbers: [sessionNumber] }) });
      if (batch.ok) return;
      console.error('verifica-eta: cancellazione della sessione su Didit non riuscita', res.status, batch.status);
    } else {
      console.error('verifica-eta: cancellazione della sessione su Didit non riuscita', res.status);
    }
  } catch (e) {
    console.error('verifica-eta: cancellazione della sessione su Didit non riuscita', e);
  }
}

/** Registra la decisione di Didit e, se è definitiva, cancella la sessione su Didit. Usata dal webhook e da "esito". */
async function applyDecision(userId: string, sessionId: string, decision: Decision): Promise<string> {
  const doc = decision.id_verifications?.[0] ?? decision.id_verification;
  // Una data illeggibile non deve far fallire la chiamata (Didit ripeterebbe l'avviso all'infinito).
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(doc?.date_of_birth ?? '') ? doc!.date_of_birth! : null;

  const { data: outcome, error } = await admin.rpc('identity_provider_result', {
    p_user_id: userId,
    p_session: sessionId,
    p_status: decision.status,
    p_birth_date: birth,
    p_first_name: doc?.first_name ?? null,
    p_last_name: doc?.last_name ?? null,
    // Il numero del documento non si salva: il database ne tiene solo un'impronta per riconoscere i doppioni.
    p_document_number: typeof doc?.document_number === 'string' ? doc.document_number.slice(0, 40) : null,
  });
  if (error) throw error;

  // Decisione presa: su Didit non serve più nulla, si cancellano sessione, foto e video.
  // Se invece decide una persona ('review'), la sessione resta finché l'amministratore non l'ha vista.
  if (['approved', 'rejected', 'underage'].includes(String(outcome))) {
    await deleteSession(sessionId, decision.session_number);
  }
  return String(outcome);
}

/**
 * Il lavoro programmato: lo chiama pg_cron ogni minuto (setup-produzione.sql) con il segreto condiviso.
 * Senza segreto configurato non fa nulla: la pulizia resta all'app dell'amministratore.
 */
async function lavori(req: Request): Promise<Response> {
  const secret = env('VIRALE_CRON_SECRET');
  const given = req.headers.get('x-virale-cron') ?? '';
  if (!secret || !given || !safeEqual(given, secret)) return json({ error: 'Non autorizzato.' }, 401);
  const purged = await purgeFiles();
  const pushed = await sendPushes();
  return json({ ok: true, purged, pushed });
}

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
type PushMessage = { to: string; title: string; body: string; data: { url: string | null }; channelId: string };
type PushTicket = { status?: 'ok' | 'error'; message?: string; details?: { error?: string } };

/** Il formato dei token di Expo (lo stesso controllo di register_push_token in schema.sql). */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

/** Una richiesta a Expo: lo stato HTTP (0 se Expo non risponde) e un esito per messaggio. */
async function expoPost(messages: PushMessage[], headers: Record<string, string>): Promise<{ status: number; tickets: PushTicket[] }> {
  try {
    const res = await fetch(EXPO_PUSH, { method: 'POST', headers, body: JSON.stringify(messages) });
    if (res.ok) return { status: res.status, tickets: ((await res.json()) as { data?: PushTicket[] }).data ?? [] };
    console.error('verifica-eta: push', res.status, (await res.text()).slice(0, 300));
    return { status: res.status, tickets: [] };
  } catch (e) {
    // Expo non risponde: si riprova al prossimo giro (al massimo 5 volte per notifica).
    console.error('verifica-eta: push', e);
    return { status: 0, tickets: [] };
  }
}

/**
 * Invia a Expo a blocchi di 100 (il massimo per richiesta). Per ogni messaggio dice se è partito; i telefoni
 * che Expo dà per non più registrati (app disinstallata) o con un token non valido si raccolgono per dimenticarli.
 * Se Expo rifiuta un blocco intero (per esempio un token di un altro progetto Expo in mezzo agli altri), i
 * messaggi di quel blocco si inviano uno per uno: un token sbagliato non ferma le notifiche degli altri.
 */
async function expoSend(messages: PushMessage[]): Promise<{ sent: boolean[]; dead: string[]; delivered: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (env('EXPO_ACCESS_TOKEN')) headers.Authorization = `Bearer ${env('EXPO_ACCESS_TOKEN')}`;
  const sent: boolean[] = new Array<boolean>(messages.length).fill(false);
  const dead: string[] = [];
  let delivered = 0;
  const valid: number[] = [];
  messages.forEach((m, i) => (EXPO_TOKEN.test(m.to) ? valid.push(i) : dead.push(m.to)));
  for (let i = 0; i < valid.length; i += 100) {
    const idx = valid.slice(i, i + 100);
    const chunk = idx.map((k) => messages[k]);
    const first = await expoPost(chunk, headers);
    let tickets = first.tickets;
    if (first.status === 400 && chunk.length > 1) {
      tickets = [];
      for (const m of chunk) tickets.push((await expoPost([m], headers)).tickets[0] ?? {});
    }
    idx.forEach((k, j) => {
      const t = tickets[j];
      if (t?.details?.error === 'DeviceNotRegistered') dead.push(messages[k].to);
      if (t?.status === 'ok') delivered += 1;
      // Un telefono che non c'è più non va ritentato: per lui la notifica è chiusa.
      sent[k] = t?.status === 'ok' || t?.details?.error === 'DeviceNotRegistered';
    });
  }
  return { sent, dead, delivered };
}

/** Le notifiche push in attesa (personali, poi "nuova copertina" a tutti, al massimo 2.000 telefoni a giro). */
async function sendPushes(): Promise<number> {
  const { data, error } = await admin.rpc('push_claim', { p_limit: 500 });
  if (error) throw error;
  const rows = (data ?? []) as { ids: number[]; tokens: string[]; title: string; body: string; url: string | null }[];
  const owner: number[] = [];
  const messages: PushMessage[] = [];
  rows.forEach((r, k) => {
    for (const to of r.tokens) {
      messages.push({ to, title: r.title, body: r.body, data: { url: r.url }, channelId: 'default' });
      owner.push(k);
    }
  });
  const { sent, dead, delivered } = await expoSend(messages);
  const done = new Set<number>();
  sent.forEach((ok, i) => ok && done.add(owner[i]));
  const ids = rows.filter((_, k) => done.has(k)).flatMap((r) => r.ids);
  let pushed = delivered;
  const gone = [...dead];
  if (ids.length) {
    const { error: doneError } = await admin.rpc('push_done', { p_ids: ids });
    if (doneError) throw doneError;
  }
  for (let round = 0; round < 4; round += 1) {
    const { data: b, error: takeError } = await admin.rpc('push_broadcast_take', { p_limit: 500 });
    if (takeError) throw takeError;
    const batch = (b ?? []) as { tokens: string[]; title: string; body: string; url: string | null }[];
    if (!batch.length) break;
    for (const x of batch) {
      const res = await expoSend(x.tokens.map((to) => ({ to, title: x.title, body: x.body, data: { url: x.url }, channelId: 'default' })));
      pushed += res.delivered;
      gone.push(...res.dead);
    }
  }
  if (gone.length) {
    const { error: dropError } = await admin.rpc('push_drop_tokens', { p_tokens: gone });
    if (dropError) console.error('verifica-eta: push, telefoni da dimenticare', dropError.message);
  }
  return pushed;
}

/** Cancella dallo Storage i file in coda (post rimossi, account chiusi, foto profilo sostituite), a gruppi di 100. */
async function purgeFiles(): Promise<number> {
  const { data, error } = await admin.rpc('storage_purge_take', { p_limit: 500 });
  if (error) throw error;
  const rows = (data ?? []) as { bucket: string; path: string }[];
  let purged = 0;
  for (const bucket of [...new Set(rows.map((r) => r.bucket))]) {
    const paths = rows.filter((r) => r.bucket === bucket).map((r) => r.path);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error: removeError } = await admin.storage.from(bucket).remove(chunk);
      // Se lo Storage non risponde i file restano in coda: si riprova al prossimo giro.
      if (removeError) {
        console.error('verifica-eta: pulizia', bucket, removeError.message);
        continue;
      }
      const { error: doneError } = await admin.rpc('storage_purge_finish', { p_bucket: bucket, p_paths: chunk });
      if (doneError) throw doneError;
      purged += chunk.length;
    }
  }
  return purged;
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

// ---------------------------------------------------------------------------------------------------------
// Controllo automatico dei contenuti, prima della pubblicazione (azione "modera").
// Servizio: OpenAI Moderation, modello omni-moderation-latest (gratuito), chiave nel segreto OPENAI_API_KEY.
// I contenuti si mandano a OpenAI solo per questo controllo. Le regole qui sotto decidono l'esito di ogni file:
//   blocked → il post non esce e i file si cancellano subito;
//   review  → il post esce nascosto e finisce nella coda dell'amministratore (Moderazione: Approva / Rimuovi);
//   ok      → il post esce subito.
// Senza chiave, o se OpenAI non risponde, l'esito è "review": mai pubblicare senza controllo.
// ---------------------------------------------------------------------------------------------------------
const OPENAI_MODERATION = 'https://api.openai.com/v1/moderations';
const MODERATION_MODEL = 'omni-moderation-latest';

/** Bloccato se OpenAI segnala (flagged) il contenuto in una di queste categorie. */
const BLOCK_IF_FLAGGED = ['sexual/minors', 'sexual', 'violence/graphic', 'self-harm/intent', 'self-harm/instructions'];
/** Bloccato anche se il punteggio (0-1) arriva a queste soglie, segnalato o no. Sui minori si è severissimi. */
const BLOCK_SCORES: Record<string, number> = {
  'sexual/minors': 0.2,
  sexual: 0.8,
  'violence/graphic': 0.8,
  'self-harm/intent': 0.7,
  'self-harm/instructions': 0.7,
};
/** In revisione (una persona decide) dai punteggi intermedi in su. */
const REVIEW_SCORES: Record<string, number> = {
  'sexual/minors': 0.05,
  sexual: 0.3,
  violence: 0.5,
  'violence/graphic': 0.3,
  'self-harm': 0.3,
  'self-harm/intent': 0.2,
  'self-harm/instructions': 0.2,
};
/** Solo per la didascalia: segnalata per odio, molestie, minacce o attività illecite violente → in revisione. */
const REVIEW_IF_FLAGGED_TEXT = ['hate', 'hate/threatening', 'harassment', 'harassment/threatening', 'violence', 'illicit/violent'];
/** Fotogrammi per video (li genera l'app lungo la durata) e limiti della richiesta. */
const MAX_FRAMES_PER_VIDEO = 6;
const MAX_PATHS = 20;
/** Oltre questo peso un'immagine non si manda a OpenAI: va in revisione. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Richieste a OpenAI in parallelo, e quanto si aspetta ciascuna. */
const MODERATION_CONCURRENCY = 4;
const MODERATION_TIMEOUT_MS = 20_000;

type Verdict = 'ok' | 'review' | 'blocked';
type ModeraBody = { action: 'modera'; bucket?: unknown; paths?: unknown; frames?: unknown; caption?: unknown };
/** Esito di OpenAI per un contenuto (null = controllo non riuscito). */
type Scan = { flagged: string[]; scores: Record<string, number> } | null;
type Outcome = { verdict: Verdict; categories: string[]; scores: Record<string, number>; note: string | null };

const RANK: Record<Verdict, number> = { ok: 0, review: 1, blocked: 2 };
const worst = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);
const VIDEO = /\.(mp4|mov|m4v)$/i;
const IMAGE_TYPE: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Decide l'esito dai risultati di OpenAI (per un video: tutti i fotogrammi insieme). */
function judge(scans: Scan[], text: boolean): Outcome {
  if (!scans.length || scans.some((s) => s === null)) return { verdict: 'review', categories: [], scores: {}, note: 'non_disponibile' };
  const flagged = new Set<string>();
  const scores: Record<string, number> = {};
  for (const s of scans as NonNullable<Scan>[]) {
    s.flagged.forEach((c) => flagged.add(c));
    for (const [c, v] of Object.entries(s.scores)) if (typeof v === 'number' && v > (scores[c] ?? 0)) scores[c] = v;
  }
  const over = (limits: Record<string, number>) => Object.keys(limits).filter((c) => (scores[c] ?? 0) >= limits[c]);
  // Si salvano solo i punteggi che contano (arrotondati): servono all'amministratore per capire il perché.
  const kept: Record<string, number> = {};
  for (const [c, v] of Object.entries(scores)) if (v >= 0.01) kept[c] = Math.round(v * 1000) / 1000;
  const blocked = [...new Set([...BLOCK_IF_FLAGGED.filter((c) => flagged.has(c)), ...over(BLOCK_SCORES)])];
  if (blocked.length) return { verdict: 'blocked', categories: blocked, scores: kept, note: null };
  const review = [...new Set([...over(REVIEW_SCORES), ...(text ? REVIEW_IF_FLAGGED_TEXT.filter((c) => flagged.has(c)) : [])])];
  if (review.length) return { verdict: 'review', categories: review, scores: kept, note: null };
  return { verdict: 'ok', categories: [], scores: kept, note: null };
}

/** Una richiesta a OpenAI: un'immagine (data URL) o un testo. null se la chiave manca o OpenAI non risponde. */
async function scan(input: { image: string } | { text: string }): Promise<Scan> {
  const key = env('OPENAI_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch(OPENAI_MODERATION, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        input: 'image' in input ? [{ type: 'image_url', image_url: { url: input.image } }] : input.text,
      }),
      signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('verifica-eta: OpenAI moderation', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const out = (await res.json()) as { results?: { categories?: Record<string, boolean>; category_scores?: Record<string, number> }[] };
    const r = out.results?.[0];
    if (!r?.categories || !r.category_scores) return null;
    return { flagged: Object.keys(r.categories).filter((c) => r.categories![c]), scores: r.category_scores };
  } catch (e) {
    console.error('verifica-eta: OpenAI moderation', e);
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Scarica un'immagine dallo Storage (con la chiave di servizio, non dalla cache pubblica) e la fa controllare. */
async function scanFile(bucket: string, path: string): Promise<Scan | 'troppo_grande' | 'formato'> {
  const type = IMAGE_TYPE[path.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) return 'formato';
  if (!env('OPENAI_API_KEY')) return null;
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) {
    console.error('verifica-eta: modera, download', path, error?.message);
    return null;
  }
  if (data.size > MAX_IMAGE_BYTES) return 'troppo_grande';
  return await scan({ image: `data:${type};base64,${toBase64(new Uint8Array(await data.arrayBuffer()))}` });
}

/** Esegue i lavori al massimo n alla volta, nell'ordine. */
async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

/**
 * Controllo prima della pubblicazione. Chiede l'app, dopo aver caricato i file e prima di creare il post:
 *   { action: 'modera', paths: [...file del post e anteprime], frames: { <video>: [<fotogrammi>] }, caption }
 *   con bucket: 'avatars' e un solo percorso, per la foto profilo.
 * Risponde { verdict: 'ok' | 'review' | 'blocked', unchecked } (unchecked: il controllo non era disponibile).
 */
async function modera(user: { id: string }, body: ModeraBody): Promise<Response> {
  const bad = (why: string) => json({ error: `Richiesta di controllo non valida (${why}).` }, 400);
  const avatar = body.bucket === 'avatars';
  const bucket = avatar ? 'avatars' : 'media';
  const own = (p: unknown): p is string => typeof p === 'string' && p.startsWith(`${user.id}/`) && /^[^/]+\/[A-Za-z0-9._-]{1,100}$/.test(p);

  const paths = Array.isArray(body.paths) ? body.paths : [];
  if (!paths.length || paths.length > MAX_PATHS || !paths.every(own) || new Set(paths).size !== paths.length) return bad('file');
  if (avatar && (paths.length !== 1 || !/\/avatar-\d{10,16}\.jpg$/.test(paths[0]))) return bad('foto profilo');

  const frames: Record<string, string[]> = {};
  const rawFrames = body.frames && typeof body.frames === 'object' && !avatar ? (body.frames as Record<string, unknown>) : {};
  for (const [video, list] of Object.entries(rawFrames)) {
    if (!paths.includes(video) || !VIDEO.test(video) || !Array.isArray(list) || list.length > MAX_FRAMES_PER_VIDEO) return bad('fotogrammi');
    if (!list.every((f) => own(f) && /\.jpg$/i.test(f) && !paths.includes(f))) return bad('fotogrammi');
    frames[video] = list as string[];
  }
  const allFrames = [...new Set(Object.values(frames).flat())];

  const caption = !avatar && typeof body.caption === 'string' ? body.caption : '';
  if ([...caption].length > 300) return bad('didascalia');

  // Fotogrammi: file temporanei, si cancellano comunque alla fine (se resta qualcosa, la pulizia notturna).
  const dropFrames = async () => {
    if (allFrames.length) await admin.storage.from('media').remove(allFrames).catch(() => undefined);
  };

  // Chi chiama può pubblicare, non esagera, i file sono suoi e non già pubblicati; l'id di ogni file si
  // legge adesso, prima del controllo (se il file cambia dopo, il database rifiuta il post).
  const started = await admin.rpc('media_check_start', { p_owner: user.id, p_kind: avatar ? 'avatar' : 'file', p_paths: paths });
  if (started.error) {
    await dropFrames();
    const m = started.error.message;
    if (/Troppe/.test(m)) return json({ error: m }, 429);
    if (/verifica dell|già pubblicato|non trovato|non valida/i.test(m)) return json({ error: m }, 409);
    throw started.error;
  }
  const objectIds = (started.data ?? {}) as Record<string, string | null>;

  type Job = { path: string; text: boolean; run: () => Promise<Scan | 'troppo_grande' | 'formato'> };
  const jobs: Job[] = [];
  for (const path of paths) {
    if (VIDEO.test(path)) for (const f of frames[path] ?? []) jobs.push({ path, text: false, run: () => scanFile('media', f) });
    else jobs.push({ path, text: false, run: () => scanFile(bucket, path) });
  }
  if (caption !== '') jobs.push({ path: '', text: true, run: () => scan({ text: caption }) });
  const results = await pool(jobs.map((j) => j.run), MODERATION_CONCURRENCY);
  await dropFrames();

  const outcomeFor = (path: string, text: boolean): Outcome => {
    const mine = results.filter((_, i) => jobs[i].path === path && jobs[i].text === text);
    if (!text && VIDEO.test(path) && !mine.length) return { verdict: 'review', categories: [], scores: {}, note: 'senza_fotogrammi' };
    const special = mine.find((r) => r === 'troppo_grande' || r === 'formato');
    if (typeof special === 'string') return { verdict: 'review', categories: [], scores: {}, note: special };
    return judge(mine as Scan[], text);
  };

  const items: Record<string, unknown>[] = [];
  let verdict: Verdict = 'ok';
  let unchecked = false;
  for (const path of paths) {
    const o = outcomeFor(path, false);
    verdict = worst(verdict, o.verdict);
    unchecked ||= o.note === 'non_disponibile';
    items.push({ kind: avatar ? 'avatar' : 'file', path, verdict: o.verdict, categories: o.categories, scores: o.scores, note: o.note, object_id: objectIds[path] ?? null });
  }
  if (caption !== '') {
    const o = outcomeFor('', true);
    verdict = worst(verdict, o.verdict);
    unchecked ||= o.note === 'non_disponibile';
    items.push({ kind: 'caption', caption, verdict: o.verdict, categories: o.categories, scores: o.scores, note: o.note });
  }
  const saved = await admin.rpc('media_check_save', { p_owner: user.id, p_items: items });
  if (saved.error) throw saved.error;

  // Bloccato: niente post, e i file non restano raggiungibili dal loro indirizzo pubblico.
  if (verdict === 'blocked') {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) console.error('verifica-eta: modera, cancellazione', error.message);
  }
  return json({ verdict, unchecked });
}
