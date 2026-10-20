/**
 * Accesso con Google e Facebook (Supabase Auth, OAuth con PKCE), senza moduli nativi in più:
 * l'indirizzo di accesso lo prepara supabase-js, la pagina del provider si apre nel browser di sistema
 * (expo-web-browser), il ritorno arriva su `virale://auth?code=…` e il codice si scambia con la sessione.
 *
 * Sul telefono il ritorno può arrivare in due modi: come risultato del browser (iPhone, quasi sempre Android)
 * oppure come link che apre l'app (Android, a volte; o l'app riaperta da zero dopo essere stata chiusa dal
 * sistema). Nel secondo caso lo riceve la rotta app/auth.tsx. Il codice vale una volta sola: entrambe le strade
 * passano da exchangeCode, che lo scambia una volta.
 *
 * Sul web la pagina va al provider e torna sull'origine del sito (`https://sito/?code=…`): al caricamento
 * finishWebRedirect scambia il codice prima di leggere l'account.
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import type { SocialProvider } from '../types';
import { GENERIC_ERROR, NETWORK_ERROR } from './errors';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

export const PROVIDER_NAME: Record<SocialProvider, string> = { google: 'Google', facebook: 'Facebook' };

/** Dove Supabase rimanda dopo l'accesso, sul telefono: lo schema dell'app (app.json "scheme"). Va negli "Redirect URLs" di Supabase. */
export const NATIVE_REDIRECT = 'virale://auth';
/** Sul web: il provider scelto prima di lasciare la pagina (al ritorno si sa che il codice nell'indirizzo è nostro). */
const WEB_FLAG = 'virale-oauth';

/** L'utente ha chiuso la pagina del provider o non ha dato il consenso: nessun errore da mostrare. */
const CANCELLED = 'annullato';

type Callback = { code: string | null; error: string | null; description: string | null };

/** Parametri del ritorno, sia nella query (PKCE) sia dopo il cancelletto (errori di alcuni provider). */
export function parseCallback(url: string): Callback {
  const params: Record<string, string> = {};
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const query = beforeHash.includes('?') ? beforeHash.slice(beforeHash.indexOf('?') + 1) : '';
  const hash = hashAt >= 0 ? url.slice(hashAt + 1) : '';
  for (const part of [query, hash]) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const decode = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, ' '));
        } catch {
          return s;
        }
      };
      params[decode(eq >= 0 ? pair.slice(0, eq) : pair)] = decode(eq >= 0 ? pair.slice(eq + 1) : '');
    }
  }
  return { code: params.code || null, error: params.error_code || params.error || null, description: params.error_description || null };
}

/** L'errore del ritorno in italiano (CANCELLED se l'utente ha solo rinunciato, null se non c'è errore). */
export function callbackProblem(cb: Callback, provider: SocialProvider | null): string | null {
  if (!cb.error && !cb.description) return null;
  const name = provider ? PROVIDER_NAME[provider] : 'l’account esterno';
  const text = `${cb.error ?? ''} ${cb.description ?? ''}`;
  if (/access_denied|user_cancel|cancel+ed|denied/i.test(text)) return CANCELLED;
  if (/needs_verification|unverified email|verify the email|confirm.*email/i.test(text)) return `Conferma prima la tua email su ${name}, poi riprova.`;
  if (/getting user email|no email|email.*(missing|required|not provided)/i.test(text)) {
    return `${name} non ci ha comunicato un indirizzo email: aggiungine uno al tuo account ${name}, oppure usa l’altro pulsante.`;
  }
  if (/signup.*(disabled|not allowed)|signups not allowed/i.test(text)) return 'Le nuove iscrizioni sono chiuse in questo momento.';
  if (/banned/i.test(text)) return 'Questo account è stato chiuso.';
  if (/provider.*(not enabled|disabled)|unsupported provider/i.test(text)) return `L’accesso con ${name} non è ancora attivo.`;
  return provider ? `Accesso con ${name} non riuscito. Riprova tra poco.` : 'Accesso non riuscito. Riprova tra poco.';
}

function exchangeMessage(error: { name?: string; message?: string }): string {
  if (/verifier/i.test(`${error.name} ${error.message}`)) return 'Accesso non completato: riprova da qui, toccando di nuovo il pulsante.';
  if (/fetch|network|timed? ?out/i.test(`${error.name} ${error.message}`)) return NETWORK_ERROR;
  if (/expired|invalid.*(code|grant)|flow state/i.test(error.message ?? '')) return 'L’accesso è scaduto: tocca di nuovo il pulsante.';
  return 'Accesso non riuscito. Riprova tra poco.';
}

const exchanges = new Map<string, Promise<void>>();

/** Scambia il codice del ritorno con la sessione, una volta sola anche se arriva da due strade. */
export function exchangeCode(code: string, flowId?: string | null): Promise<void> {
  let job = exchanges.get(code);
  if (!job) {
    job = (async () => {
      if (!supabase) throw new Error(GENERIC_ERROR);
      const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (!error) return;
      // Scambiato nel frattempo dall'altra strada: la sessione c'è già.
      const { data } = await supabase.auth.getSession();
      if (data.session) return;
      throw new Error(exchangeMessage(error));
    })();
    exchanges.set(code, job);
  }
  return job;
}

/** Il provider è acceso in Supabase? null se non si riesce a saperlo (si prova comunque). */
async function providerEnabled(provider: SocialProvider): Promise<boolean | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey }, signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { external?: Record<string, boolean> };
    return typeof body.external?.[provider] === 'boolean' ? body.external[provider] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Accesso con Google o Facebook. 'ok': c'è la sessione (il profilo può essere ancora da completare);
 * 'cancel': l'utente ha chiuso la pagina; 'redirect' (web): la pagina sta andando al provider.
 * Gli errori arrivano già in italiano.
 */
export async function signInWithSocial(provider: SocialProvider): Promise<'ok' | 'cancel' | 'redirect'> {
  if (!supabase) throw new Error(GENERIC_ERROR);
  const name = PROVIDER_NAME[provider];
  if ((await providerEnabled(provider)) === false) throw new Error(`L’accesso con ${name} non è ancora attivo. Riprova più tardi o usa l’altro pulsante.`);

  if (Platform.OS === 'web') {
    try {
      window.sessionStorage.setItem(WEB_FLAG, provider);
    } catch {
      throw new Error('Il browser blocca i dati del sito: consenti i cookie per questo sito e riprova.');
    }
    const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin, skipBrowserRedirect: true } });
    if (error || !data.url) throw new Error(/fetch|network/i.test(error?.message ?? '') ? NETWORK_ERROR : `Accesso con ${name} non riuscito. Riprova tra poco.`);
    window.location.assign(data.url);
    return 'redirect';
  }

  const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true } });
  if (error || !data.url) throw new Error(/fetch|network/i.test(error?.message ?? '') ? NETWORK_ERROR : `Accesso con ${name} non riuscito. Riprova tra poco.`);

  // Su Android il ritorno può arrivare come link all'app invece che come risultato del browser.
  let linked: string | null = null;
  const sub = Linking.addEventListener('url', ({ url }) => {
    if (url.startsWith(NATIVE_REDIRECT)) linked = url;
  });
  let url: string | null = null;
  try {
    const res = await WebBrowser.openAuthSessionAsync(data.url, NATIVE_REDIRECT);
    if (res.type === 'success') url = res.url;
    else if (Platform.OS === 'android') {
      // "dismiss" può arrivare un attimo prima del link: lo si aspetta un poco.
      for (let i = 0; i < 15 && !linked; i += 1) await sleep(100);
    }
  } catch {
    throw new Error(`Non riesco ad aprire la pagina di ${name}. Riprova.`);
  } finally {
    sub.remove();
  }
  url ??= linked;
  if (!url) return 'cancel';
  const cb = parseCallback(url);
  const problem = callbackProblem(cb, provider);
  if (problem === CANCELLED) return 'cancel';
  if (problem) throw new Error(problem);
  if (!cb.code) throw new Error(`Accesso con ${name} non riuscito. Riprova tra poco.`);
  await exchangeCode(cb.code, data.flowId);
  return 'ok';
}

/** Il ritorno ricevuto dalla rotta /auth (link aperto dall'app): 'ok', 'cancel' o un errore in italiano. */
export async function finishCallback(params: { code?: string; error?: string; error_code?: string; error_description?: string }): Promise<'ok' | 'cancel'> {
  const cb: Callback = { code: params.code || null, error: params.error_code || params.error || null, description: params.error_description || null };
  const problem = callbackProblem(cb, null);
  if (problem === CANCELLED) return 'cancel';
  if (problem) throw new Error(problem);
  if (!cb.code) return 'cancel';
  await exchangeCode(cb.code);
  return 'ok';
}

let webError: string | null = null;

/** L'errore del ritorno sul web (una volta sola), da mostrare nel benvenuto. */
export function takeWebAuthError(): string | null {
  const e = webError;
  webError = null;
  return e;
}

/** Sul web, al caricamento: se si torna dal provider si scambia il codice e si pulisce l'indirizzo. */
export async function finishWebRedirect(): Promise<void> {
  if (Platform.OS !== 'web' || !supabase || typeof window === 'undefined') return;
  let provider: SocialProvider | null = null;
  try {
    provider = window.sessionStorage.getItem(WEB_FLAG) as SocialProvider | null;
    window.sessionStorage.removeItem(WEB_FLAG);
  } catch {
    provider = null;
  }
  const cb = parseCallback(window.location.href);
  // Solo al ritorno da un accesso partito da qui: un "code" nell'indirizzo per altri motivi non si tocca.
  if (!provider || (!cb.code && !cb.error && !cb.description)) return;
  // Codice ed eventuali errori non restano nell'indirizzo né nella cronologia.
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  } catch {
    // Pazienza: l'indirizzo resta com'è.
  }
  const problem = callbackProblem(cb, provider);
  if (problem === CANCELLED) return;
  if (problem) {
    webError = problem;
    return;
  }
  if (!cb.code) return;
  try {
    await exchangeCode(cb.code);
  } catch (e) {
    webError = (e as Error).message;
  }
}
