import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../src/components/Field';
import { CheckRow, FieldError, formStyles, LegalLinks } from '../src/components/FormBits';
import { Masthead } from '../src/components/Masthead';
import { Press } from '../src/components/Press';
import { Txt } from '../src/components/Txt';
import { color, radius, space } from '../src/design/tokens';
import { MIN_AGE } from '../src/legal/docs';
import {
  cancelSocialProfile,
  completeSocialProfile,
  getSettings,
  isDemo,
  USERNAME_RESERVED,
  USERNAME_RULES,
  usernameAvailable,
  usernameFormatOk,
  usernameReserved,
  validateProfile,
  type ProfileField,
  type ProfileProblem,
} from '../src/services/api';
import { friendlyError } from '../src/services/errors';
import { PROVIDER_NAME } from '../src/services/oauth';
import { useSession } from '../src/state/session';
import type { ProfileInput } from '../src/types';

/** I blocchi del modulo, per far scorrere fino a quello con l'errore. */
type Block = 'name' | 'birth' | 'username' | 'terms';
const BLOCK: Record<ProfileField, Block> = { first: 'name', last: 'name', birth: 'birth', username: 'username', terms: 'terms' };
type NameCheck = 'idle' | 'checking' | 'free' | 'taken' | 'reserved';

/**
 * Primo accesso con Google o Facebook: prima di usare l'app si completa il profilo, con le stesse regole della
 * registrazione (nome utente libero e non riservato, nome e cognome veri, età minima, termini). Il Gate in
 * app/_layout.tsx non lascia andare altrove finché non è fatto. Poi tutto come per gli altri account.
 */
export default function CompleteProfile() {
  const insets = useSafeAreaInsets();
  const { pending, setMe } = useSession();
  const [first, setFirst] = useState(pending?.firstName ?? '');
  const [last, setLast] = useState(pending?.lastName ?? '');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [username, setUsername] = useState('');
  const [nameCheck, setNameCheck] = useState<NameCheck>('idle');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState<ProfileProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState(7);
  const inFlight = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const formY = useRef(0);
  const ys = useRef<Partial<Record<Block, number>>>({});
  const firstRef = useRef<TextInput>(null);
  const lastRef = useRef<TextInput>(null);
  const dayRef = useRef<TextInput>(null);
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const userRef = useRef<TextInput>(null);

  useEffect(() => {
    getSettings()
      .then((st) => setGraceDays(st.idGraceDays))
      .catch(() => undefined);
  }, []);

  // Nome e cognome arrivano dal provider un attimo dopo (la sessione si legge all'avvio): si propongono se vuoti.
  useEffect(() => {
    if (!pending) return;
    setFirst((v) => v || pending.firstName);
    setLast((v) => v || pending.lastName);
  }, [pending]);

  // Nome utente: la disponibilità si controlla mentre si scrive (dopo mezzo secondo di pausa).
  useEffect(() => {
    if (username.length < 3 || !usernameFormatOk(username)) {
      setNameCheck('idle');
      return;
    }
    if (usernameReserved(username)) {
      setNameCheck('reserved');
      return;
    }
    let alive = true;
    setNameCheck('checking');
    const id = setTimeout(() => {
      usernameAvailable(username)
        .then((ok) => alive && setNameCheck(ok ? 'free' : 'taken'))
        .catch(() => alive && setNameCheck('idle'));
    }, 500);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [username]);

  const birthDate = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const input: ProfileInput = { username, firstName: first, lastName: last, birthDate, acceptedTerms: accepted };
  const takenText = `@${username} è già preso: prova ad aggiungere un numero.`;
  const providerName = pending ? PROVIDER_NAME[pending.provider] : null;

  /** Si modifica il campo con l'errore: l'errore sparisce. */
  const edited = (field: ProfileField) => {
    setError(null);
    setProblem((p) => (p?.field === field ? null : p));
  };

  const show = (p: ProfileProblem) => {
    setProblem(p);
    scroll.current?.scrollTo({ y: Math.max(0, formY.current + (ys.current[BLOCK[p.field]] ?? 0) - space[6]), animated: true });
    const refs: Partial<Record<ProfileField, typeof firstRef>> = { first: firstRef, last: lastRef, username: userRef };
    if (p.field === 'birth') (!day ? dayRef : !month ? monthRef : !year ? yearRef : dayRef).current?.focus();
    else refs[p.field]?.current?.focus();
  };

  const submit = async () => {
    if (inFlight.current || leaving) return;
    const p = validateProfile(input) ?? (nameCheck === 'taken' ? ({ field: 'username', message: takenText } as const) : null);
    if (p) return show(p);
    try {
      inFlight.current = true;
      setBusy(true);
      setProblem(null);
      setError(null);
      setMe(await completeSocialProfile(input));
    } catch (e) {
      const message = friendlyError(e);
      if (/nome utente/i.test(message)) show({ field: 'username', message });
      else if (/anni|nascita/i.test(message)) show({ field: 'birth', message });
      else if (/nome e cognome|nome non è disponibile/i.test(message)) show({ field: 'first', message });
      else setError(message);
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  /** Si rinuncia: si esce, e i dati ricevuti dal provider si cancellano (il profilo non c'era). */
  const leave = async () => {
    if (busy || leaving) return;
    setLeaving(true);
    await cancelSocialProfile().catch(() => undefined);
    setMe(null);
  };

  const at = (block: Block) => (e: { nativeEvent: { layout: { y: number } } }) => {
    ys.current[block] = e.nativeEvent.layout.y;
  };
  const bad = (field: ProfileField) => problem?.field === field;
  const userLine = problem?.field === 'username' ? null : nameCheck === 'taken' ? takenText : nameCheck === 'reserved' ? USERNAME_RESERVED : null;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[6] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center' }}>
            <Masthead size={44} />
          </View>
          <View style={{ gap: space[2] }}>
            <Txt variant="heading" accessibilityRole="header">
              Completa il profilo
            </Txt>
            <Txt variant="body" tone={color.paperDim}>
              {providerName
                ? `Sei entrato con ${providerName}${pending?.email ? ` (${pending.email})` : ''}. Ancora un passo: scegli il nome utente e conferma i tuoi dati.`
                : 'Ancora un passo: scegli il nome utente e conferma i tuoi dati.'}
            </Txt>
            <Txt variant="meta" tone={color.paperFaint}>
              {isDemo ? 'Demo: l’accesso è simulato, i dati restano su questo dispositivo.' : 'La tua email non è visibile agli altri utenti e non pubblichiamo nulla sui tuoi social.'}
            </Txt>
          </View>
          <View
            style={{ gap: space[3] }}
            onLayout={(e) => {
              formY.current = e.nativeEvent.layout.y;
            }}>
            <View style={styles.block} onLayout={at('username')}>
              <Txt variant="label">Nome utente</Txt>
              <Field
                ref={userRef}
                invalid={bad('username') || nameCheck === 'taken' || nameCheck === 'reserved'}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => firstRef.current?.focus()}
                prefix={
                  <Txt variant="body" tone={color.paperFaint}>
                    @
                  </Txt>
                }
                value={username}
                onChangeText={(v) => {
                  setUsername(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''));
                  edited('username');
                }}
                onBlur={() => {
                  if (username && !usernameFormatOk(username) && !problem) setProblem({ field: 'username', message: USERNAME_RULES });
                }}
                placeholder="nomeutente"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username-new"
                textContentType="username"
                maxLength={24}
                accessibilityLabel="Nome utente"
              />
              <FieldError text={bad('username') ? problem?.message : userLine} />
              {nameCheck === 'free' && !bad('username') ? (
                <Txt variant="meta" tone={color.paperDim}>
                  {`@${username} è libero.`}
                </Txt>
              ) : (
                <Txt variant="meta" tone={color.paperFaint}>
                  È il nome con cui ti trovano gli altri.
                </Txt>
              )}
            </View>
            <View style={styles.block} onLayout={at('name')}>
              <View style={styles.row}>
                <Field
                  ref={firstRef}
                  invalid={bad('first')}
                  containerStyle={{ flex: 1 }}
                  value={first}
                  onChangeText={(v) => {
                    setFirst(v);
                    edited('first');
                  }}
                  placeholder="Nome"
                  autoComplete="given-name"
                  textContentType="givenName"
                  maxLength={60}
                  accessibilityLabel="Nome"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => lastRef.current?.focus()}
                />
                <Field
                  ref={lastRef}
                  invalid={bad('last')}
                  containerStyle={{ flex: 1 }}
                  value={last}
                  onChangeText={(v) => {
                    setLast(v);
                    edited('last');
                  }}
                  placeholder="Cognome"
                  autoComplete="family-name"
                  textContentType="familyName"
                  maxLength={60}
                  accessibilityLabel="Cognome"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => dayRef.current?.focus()}
                />
              </View>
              <FieldError text={bad('first') || bad('last') ? problem?.message : null} />
              <Txt variant="meta" tone={color.paperFaint}>
                Gli altri vedono solo il nome e l’iniziale del cognome.
              </Txt>
            </View>
            <View style={styles.block} onLayout={at('birth')}>
              <Txt variant="label" style={{ marginTop: space[1] }}>
                Data di nascita
              </Txt>
              <View style={styles.row}>
                <Field
                  ref={dayRef}
                  invalid={bad('birth')}
                  containerStyle={{ flex: 1 }}
                  value={day}
                  onChangeText={(v) => {
                    const d = v.replace(/\D/g, '').slice(0, 2);
                    setDay(d);
                    edited('birth');
                    if (d.length === 2) monthRef.current?.focus();
                  }}
                  placeholder="GG"
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel="Giorno di nascita"
                />
                <Field
                  ref={monthRef}
                  invalid={bad('birth')}
                  containerStyle={{ flex: 1 }}
                  value={month}
                  onChangeText={(v) => {
                    const m = v.replace(/\D/g, '').slice(0, 2);
                    setMonth(m);
                    edited('birth');
                    if (m.length === 2) yearRef.current?.focus();
                  }}
                  placeholder="MM"
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel="Mese di nascita"
                />
                <Field
                  ref={yearRef}
                  invalid={bad('birth')}
                  containerStyle={{ flex: 1.6 }}
                  value={year}
                  onChangeText={(v) => {
                    const y = v.replace(/\D/g, '').slice(0, 4);
                    setYear(y);
                    edited('birth');
                  }}
                  placeholder="AAAA"
                  keyboardType="number-pad"
                  maxLength={4}
                  accessibilityLabel="Anno di nascita"
                />
              </View>
              <FieldError text={bad('birth') ? problem?.message : null} />
            </View>
            <Txt variant="meta" tone={color.paperFaint}>
              Per pubblicare e votare conferma l’età entro {graceDays} {graceDays === 1 ? 'giorno' : 'giorni'}: bastano 2 minuti, te lo ricordiamo noi.
            </Txt>
            <View style={styles.block} onLayout={at('terms')}>
              <CheckRow
                checked={accepted}
                invalid={bad('terms')}
                onToggle={() => {
                  setAccepted((a) => !a);
                  edited('terms');
                }}>
                {`Ho almeno ${MIN_AGE} anni e accetto Termini e Linee guida. Ho letto l’Informativa privacy.`}
              </CheckRow>
              <FieldError text={bad('terms') ? problem?.message : null} />
              <LegalLinks />
            </View>
            <FieldError text={error} />
            <Press style={[styles.cta, (busy || leaving) && styles.off]} onPress={() => void submit()} disabled={busy || leaving} accessibilityRole="button">
              {busy ? (
                <ActivityIndicator color={color.canvas} />
              ) : (
                <Txt variant="label" tone={color.canvas}>
                  Entra in Virale
                </Txt>
              )}
            </Press>
            <Press onPress={() => void leave()} style={styles.switch} disabled={busy || leaving} accessibilityRole="button">
              <Txt variant="small" tone={color.paperDim}>
                {leaving ? 'Esco…' : 'Non ora? '}
                {leaving ? null : <Txt variant="small" style={formStyles.link}>Annulla ed esci</Txt>}
              </Txt>
            </Press>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space[6], gap: space[6] },
  block: { gap: space[2] },
  row: { flexDirection: 'row', gap: space[2] },
  cta: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  off: { opacity: 0.45 },
  switch: { alignSelf: 'center', paddingVertical: space[2] },
});
