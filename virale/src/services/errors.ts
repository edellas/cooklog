/**
 * Errori spiegati in italiano: l'utente non deve mai leggere "Failed to fetch", "JWT expired" o
 * "new row violates row-level security policy". I nostri messaggi (le `raise exception` del database e
 * gli errori scritti in api.ts) sono già in italiano e passano così come sono.
 */

export const GENERIC_ERROR = 'Qualcosa non ha funzionato. Riprova tra poco.';
export const NETWORK_ERROR = 'Connessione assente. Riprova.';
export const SESSION_ERROR = 'Sessione scaduta: accedi di nuovo.';
export const VERIFY_ERROR = 'Per farlo serve la verifica dell’età.';
export const TOO_BIG_ERROR = 'Il file è troppo pesante (massimo 50 MB).';
export const FORMAT_ERROR = 'Formato non supportato: usa foto JPEG, PNG o HEIC e video MP4 o MOV.';

/**
 * Se l'utente può agire (verifica dell'età fatta o ancora nei tempi). Lo aggiorna la sessione a ogni
 * lettura dello stato: serve a spiegare un rifiuto delle regole del database ("serve la verifica").
 */
let canActNow: boolean | null = null;
export function setCanAct(value: boolean | null) {
  canActNow = value;
}
export function canActKnown(): boolean | null {
  return canActNow;
}

type Raw = { message?: unknown; code?: unknown; name?: unknown; status?: unknown; statusCode?: unknown; __isAuthError?: unknown; __isStorageError?: unknown };

/** Errori che arrivano dalle librerie (Supabase, rete) e non da noi: il loro testo non va mostrato. */
const RAW_NAMES = /^(TypeError|AuthApiError|AuthRetryableFetchError|AuthUnknownError|AuthSessionMissingError|StorageApiError|StorageUnknownError|FunctionsHttpError|FunctionsRelayError|FunctionsFetchError|PostgrestError|AbortError)$/;

export function friendlyError(e: unknown): string {
  const err = (typeof e === 'object' && e !== null ? e : { message: e }) as Raw;
  const msg = typeof err.message === 'string' ? err.message : String(err.message ?? '');
  const code = typeof err.code === 'string' ? err.code : '';
  const status = Number(err.status ?? err.statusCode ?? 0);
  const name = typeof err.name === 'string' ? err.name : '';

  // Prima i casi riconoscibili dal testo, qualunque sia la provenienza.
  if (name === 'FunctionsFetchError' || /failed to fetch|network request failed|networkerror|load failed|fetch failed|network error|timed? ?out|ECONNRESET|ENOTFOUND/i.test(msg)) return NETWORK_ERROR;
  if (/jwt expired|invalid jwt|jwt.*(malformed|invalid)|refresh token|auth session missing|session.*(expired|missing|not found)/i.test(msg)) return SESSION_ERROR;
  if (status === 413 || /exceeded the maximum allowed size|payload too large|entity too large/i.test(msg)) return TOO_BIG_ERROR;
  if (/mime type|invalid_mime|not supported.*type/i.test(msg)) return FORMAT_ERROR;
  if (code === '42501' || /row-level security|permission denied|violates.*policy/i.test(msg)) {
    return canActNow === false ? VERIFY_ERROR : 'Non hai i permessi per farlo.';
  }
  // Le nostre eccezioni del database (raise exception) sono già scritte per l'utente.
  if (code === 'P0001') return msg || GENERIC_ERROR;
  if (code === '23505') return 'Già fatto.';
  // check_violation: quelle dei nostri controlli hanno un testo italiano, quelle delle tabelle no.
  if (code === '23514') return /violates|constraint/i.test(msg) ? 'Dati non validi.' : msg || 'Dati non validi.';
  if (code || status || err.__isAuthError || err.__isStorageError || RAW_NAMES.test(name)) return GENERIC_ERROR;
  // Un errore scritto da noi (in italiano): resta com'è.
  return msg && !/^[\x20-\x7E]*\b(error|failed|unexpected|undefined|null|cannot|invalid)\b/i.test(msg) ? msg : GENERIC_ERROR;
}

/** Per i toast delle azioni: il motivo preciso se c'è (verifica, troppi tentativi), altrimenti il testo dell'azione. */
export function actionError(e: unknown, fallback: string): string {
  const msg = friendlyError(e);
  return msg === GENERIC_ERROR ? fallback : msg;
}
