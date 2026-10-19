// Verifica automatica dell'età con Didit. Supabase Edge Function "verifica-eta" (Deno).
//
// Indirizzi:
//   POST /verifica-eta           → l'app (utente connesso) chiede una sessione: risponde con il link di Didit.
//                                  Con { "action": "diagnosi" } (solo amministratori) prova tutto il collegamento.
//   POST /verifica-eta/webhook   → Didit avvisa che la verifica è finita (richiesta firmata con il segreto).
//   GET  /verifica-eta/ritorno   → finita la verifica il browser torna qui e viene rimandato nell'app.
//   GET  /verifica-eta/stato     → controllo dal browser: quali segreti ci sono e se Didit accetta la chiave.
//                                  Non mostra mai i valori dei segreti.
//   GET  /verifica-eta/apri/post/<id> → link dei post condivisi (anche quelli vecchi): rimanda alla pagina
//                                  di atterraggio del sito (VIRALE_SITO/apri.html) o, senza sito, all'app.
//   POST /verifica-eta/lavori    → lavoro programmato (pg_cron ogni minuto, intestazione x-virale-cron):
//                                  cancella dallo Storage i file rimossi o di account chiusi e invia le
//                                  notifiche push (servizio di Expo).
//   POST /verifica-eta/recupero  → password dimenticata: { username, code, password } con il codice di
//                                  recupero (vale una volta sola). Cambia la password e scollega i dispositivi.
//
// Segreti da impostare in Supabase → Edge Functions → Secrets:
//   DIDIT_API_KEY, DIDIT_WORKFLOW_ID, DIDIT_WEBHOOK_SECRET (verifica automatica dell'età)
//   VIRALE_CRON_SECRET (lo stesso valore di "virale_cron_secret" nel Vault: vedi setup-produzione.sql)
//   VIRALE_SITO (facoltativo: l'indirizzo del sito con apri.html, es. https://nome.github.io/cooklog)
//   EXPO_ACCESS_TOKEN (facoltativo: serve solo se su expo.dev è attivo "Enhanced Security for Push Notifications")
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
    if (route === 'recupero' && req.method === 'POST') return await recupero(req);
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
    webhook_da_impostare_su_didit: `${SELF}/webhook`,
  });
}

/** L'app chiede di iniziare: si controlla chi è, poi si apre (o si riprende) la sessione su Didit. */
async function start(req: Request): Promise<Response> {
  const missing = missingSecrets().filter((k) => k !== 'DIDIT_WEBHOOK_SECRET');
  if (missing.length) return json({ error: `Verifica automatica non configurata: su Supabase mancano i segreti ${missing.join(', ')}.` }, 500);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  const user = auth.user;
  if (!user) return json({ error: 'Accedi di nuovo e riprova.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === 'diagnosi') return await diagnosi(user.id);

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
      await fetch(`${DIDIT}/session/${encodeURIComponent(s.session_id)}/delete/`, { method: 'DELETE', headers: { 'x-api-key': env('DIDIT_API_KEY') } }).catch(() => undefined);
    } else {
      checks.push(`✗ ${await diditProblem(res, 'diagnosi')}`);
    }
  }
  checks.push(`Indirizzo del webhook da mettere su Didit: ${SELF}/webhook`);
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
  if (!['Approved', 'Declined', 'In Review'].includes(event.status ?? '')) return json({ ok: true });

  const res = await fetch(`${DIDIT}/session/${encodeURIComponent(event.session_id)}/decision/`, { headers: { 'x-api-key': env('DIDIT_API_KEY') } });
  // Se Didit non risponde, un errore fa ripetere l'avviso più tardi.
  if (!res.ok) return json({ error: await diditProblem(res, 'decision') }, 502);
  const decision = (await res.json()) as {
    status: string;
    vendor_data?: string;
    id_verifications?: { date_of_birth?: string; first_name?: string; last_name?: string; document_number?: string }[];
    id_verification?: { date_of_birth?: string; first_name?: string; last_name?: string; document_number?: string };
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
    // Il numero del documento non si salva: il database ne tiene solo un'impronta per riconoscere i doppioni.
    p_document_number: typeof doc?.document_number === 'string' ? doc.document_number.slice(0, 40) : null,
  });
  if (error) throw error;

  // Decisione presa: su Didit non serve più nulla, si cancellano sessione, foto e video.
  // Se invece decide una persona ('review'), la sessione resta finché l'amministratore non l'ha vista.
  if (['approved', 'rejected', 'underage'].includes(String(outcome))) {
    await fetch(`${DIDIT}/session/${encodeURIComponent(event.session_id)}/delete/`, { method: 'DELETE', headers: { 'x-api-key': env('DIDIT_API_KEY') } }).catch(() => undefined);
  }
  return json({ ok: true, outcome });
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

const RECOVERY_WRONG = 'Nome utente o codice non validi.';

/** Le stesse regole della password dell'app (passwordProblem in src/services/api.ts). */
function passwordProblem(password: string, username: string): string | null {
  if (password.length < 8) return 'La password deve avere almeno 8 caratteri.';
  if (password.length > 72) return 'La password può avere al massimo 72 caratteri.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La password deve contenere almeno una lettera e un numero.';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'La password non può contenere il nome utente.';
  return null;
}

/**
 * Password dimenticata, con il codice di recupero. Prima si controlla il codice senza consumarlo, poi si cambia
 * la password e solo allora lo si invalida: se Supabase rifiuta la password nuova (per esempio perché comparsa
 * in furti di dati) il codice resta valido. Stessa risposta per nome sbagliato, codice sbagliato o account chiuso.
 */
async function recupero(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { username?: unknown; code?: unknown; password?: unknown };
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().replace(/^@+/, '') : '';
  const code = typeof body.code === 'string' ? body.code.slice(0, 64) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !code) return json({ error: RECOVERY_WRONG }, 400);
  const weak = passwordProblem(password, username);
  if (weak) return json({ error: weak }, 400);
  const check = await admin.rpc('recovery_redeem', { p_username: username, p_code: code, p_consume: false });
  if (check.error) {
    if (/Troppi tentativi/.test(check.error.message)) return json({ error: 'Troppi tentativi: riprova tra un’ora.' }, 429);
    throw check.error;
  }
  const id = check.data as string | null;
  if (!id) return json({ error: RECOVERY_WRONG }, 400);
  const { error: updateError } = await admin.auth.admin.updateUserById(id, { password });
  if (updateError) {
    const m = updateError.message;
    if (/weak|leaked|pwned/i.test(m)) return json({ error: 'Password troppo debole o già comparsa in furti di dati: scegline un’altra.' }, 400);
    if (/at least \d+ characters|too short/i.test(m)) return json({ error: 'La password deve avere almeno 8 caratteri.' }, 400);
    throw updateError;
  }
  const used = await admin.rpc('recovery_redeem', { p_username: username, p_code: code, p_consume: true });
  if (used.error) throw used.error;
  // Chi aveva preso la password (o un telefono perso) resta fuori: tutti i dispositivi devono rientrare.
  const { error: revokeError } = await admin.rpc('revoke_sessions', { p_user_id: id });
  if (revokeError) console.error('verifica-eta: recupero, sessioni', revokeError.message);
  return json({ ok: true });
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
