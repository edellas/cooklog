import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../src/components/Field';
import { Icon, type IconName } from '../src/components/Icon';
import { Masthead } from '../src/components/Masthead';
import { Press } from '../src/components/Press';
import { RecoveryCodeCard } from '../src/components/RecoveryCode';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { DEMO_MEDIA } from '../src/data/demoMedia';
import { MIN_AGE, ownerEmail } from '../src/legal/docs';
import { color, font, radius, space } from '../src/design/tokens';
import {
  createRecoveryCode,
  formatRecoveryCode,
  getSettings,
  isDemo,
  login,
  PASSWORD_MIN,
  recoverPassword,
  register,
  USERNAME_RESERVED,
  USERNAME_RULES,
  usernameAvailable,
  usernameFormatOk,
  usernameReserved,
  validateRegistration,
  type RegisterField,
  type RegistrationProblem,
} from '../src/services/api';
import type { Me, RegisterInput } from '../src/types';
import { useSession } from '../src/state/session';
import { friendlyError } from '../src/services/errors';
import { useNav } from '../src/state/nav';

const COLUMNS = [
  ['cinqueterre', 'gatto-neve', 'selfie', 'lava', 'sposi'],
  ['cane-bagno', 'mercato', 'sub', 'danza', 'strada'],
  ['bimbo', 'montagne', 'monaco', 'cavallo', 'ritratto'],
];
const TILE = 168;

const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'scatta', text: 'Pubblichi foto e video, come sempre.' },
  { icon: 'cerchia', text: 'Chi guarda decide: conta come ti guardano, non quanti follower hai.' },
  { icon: 'copertina', text: 'Ogni giorno un solo post diventa la copertina che vedono tutti.' },
];

type Step = 'intro' | 'registrati' | 'accedi' | 'recupero' | 'codice';
/** Account appena creato (o password appena cambiata): si entra dopo aver visto il codice di recupero. */
type Pending = { me: Me; code: string; lead?: string };

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { setMe } = useSession();
  const toast = useToast();
  const [step, setStep] = useState<Step>('intro');
  const [pending, setPending] = useState<Pending | null>(null);
  const scroll = useRef<ScrollView>(null);
  const formY = useRef(0);

  // Su Android "indietro" dai moduli torna alla presentazione invece di chiudere l'app. Con il codice di
  // recupero sullo schermo l'account esiste già: "indietro" non riporta al modulo.
  useEffect(() => {
    if (step === 'intro') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step !== 'codice') setStep(step === 'recupero' ? 'accedi' : 'intro');
      return true;
    });
    return () => sub.remove();
  }, [step]);

  const go = useCallback((next: Step) => {
    setStep(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);

  // Dopo la registrazione (o il recupero della password) prima si mostra il codice di recupero, poi si entra.
  const enter = useCallback(
    async (me: Me, lead?: string) => {
      try {
        const code = await createRecoveryCode();
        setPending({ me, code, lead });
        go('codice');
      } catch {
        setMe(me);
        toast(lead ? 'Password cambiata. Potrai creare il codice di recupero da Impostazioni.' : 'Potrai creare il codice da Impostazioni.');
      }
    },
    [go, setMe, toast],
  );

  /** Porta in vista un punto del modulo (y misurata dentro il modulo). */
  const scrollTo = useCallback((y: number) => scroll.current?.scrollTo({ y: Math.max(0, formY.current + y - space[6]), animated: true }), []);

  return (
    <View style={styles.root}>
      <Wall />
      <LinearGradient colors={['rgba(12,19,34,0.35)', 'rgba(12,19,34,0.88)', color.canvas]} locations={[0, 0.45, 0.72]} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + (step === 'intro' ? space[10] : space[6]), paddingBottom: insets.bottom + space[5] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Nei moduli la testata lascia spazio ai campi. */}
          {step === 'intro' ? (
            <>
              <View style={{ alignItems: 'center', gap: space[3] }}>
                <Masthead size={88} reveal />
                <Txt style={styles.claim}>Ogni giorno una sola copertina. La scegliete voi, guardando.</Txt>
              </View>
              <View style={{ flex: 1, minHeight: space[6] }} />
            </>
          ) : null}
          <View
            onLayout={(e) => {
              formY.current = e.nativeEvent.layout.y;
            }}>
            {step === 'intro' ? (
              <Intro onRegister={() => go('registrati')} onLogin={() => go('accedi')} />
            ) : step === 'registrati' ? (
              <RegisterForm onSwitch={() => go('accedi')} onBack={() => go('intro')} onDone={(me) => enter(me)} scrollTo={scrollTo} />
            ) : step === 'accedi' ? (
              <LoginForm onSwitch={() => go('registrati')} onBack={() => go('intro')} onForgot={() => go('recupero')} />
            ) : step === 'recupero' ? (
              <RecoverForm onBack={() => go('accedi')} onDone={(me) => enter(me, 'Password cambiata. Il codice usato non vale più: eccone uno nuovo.')} />
            ) : pending ? (
              <RecoveryCodeCard code={pending.code} lead={pending.lead} onDone={() => setMe(pending.me)} />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Intro({ onRegister, onLogin }: { onRegister: () => void; onLogin: () => void }) {
  return (
    <View style={{ gap: space[6] }}>
      <View style={{ gap: space[4] }}>
        {POINTS.map((p) => (
          <View key={p.text} style={styles.point}>
            <Icon name={p.icon} size={22} color={color.giallo} />
            <Txt variant="body" style={{ flex: 1 }}>
              {p.text}
            </Txt>
          </View>
        ))}
      </View>
      <View style={{ gap: space[3] }}>
        <Press style={styles.cta} onPress={onRegister} hapticOnPress="light" accessibilityRole="button">
          <Txt variant="label" tone={color.canvas}>
            Crea un account
          </Txt>
        </Press>
        <Press style={styles.ghost} onPress={onLogin} accessibilityRole="button">
          <Txt variant="label">Ho già un account</Txt>
        </Press>
      </View>
    </View>
  );
}

function FormHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.formHead}>
      <Press style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="Indietro">
        <Icon name="indietro" size={22} />
      </Press>
      <Txt variant="heading" style={{ flexShrink: 1 }}>
        {title}
      </Txt>
    </View>
  );
}

function PasswordField({
  value,
  onChange,
  placeholder,
  label,
  onSubmit,
  inputRef,
  invalid,
  isNew,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  onSubmit?: () => void;
  inputRef?: Ref<TextInput>;
  invalid?: boolean;
  /** Password nuova: il gestore delle password del telefono può proporne una e salvarla. */
  isNew?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <View>
      <Field
        ref={inputRef}
        invalid={invalid}
        submitBehavior={onSubmit ? 'submit' : 'blurAndSubmit'}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        secureTextEntry={!shown}
        style={{ paddingRight: 72 }}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType={isNew ? 'newPassword' : 'password'}
        autoComplete={isNew ? 'new-password' : 'password'}
        returnKeyType={onSubmit ? 'go' : 'next'}
        onSubmitEditing={onSubmit}
        accessibilityLabel={label}
        maxLength={72}
      />
      <Press style={styles.eye} onPress={() => setShown((x) => !x)} accessibilityRole="button" accessibilityLabel={shown ? 'Nascondi password' : 'Mostra password'} hitSlop={8}>
        <Txt variant="meta" tone={color.paperFaint}>
          {shown ? 'Nascondi' : 'Mostra'}
        </Txt>
      </Press>
    </View>
  );
}

/** L'errore di un campo, scritto subito sotto (e letto dallo screen reader). */
function FieldError({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <Txt variant="small" tone={color.matita} accessibilityLiveRegion="polite">
      {text}
    </Txt>
  );
}

function Docs() {
  const nav = useNav();
  return (
    <View style={styles.docs}>
      {(
        [
          ['termini', 'Termini'],
          ['linee-guida', 'Linee guida'],
          ['privacy', 'Privacy'],
        ] as const
      ).map(([slug, label]) => (
        <Press key={slug} style={styles.doc} onPress={() => nav.push(`/legale/${slug}`)} accessibilityRole="link" accessibilityLabel={`Leggi ${label}`}>
          <Txt variant="small" style={styles.link}>
            {label}
          </Txt>
        </Press>
      ))}
    </View>
  );
}

/** I blocchi del modulo, per far scorrere fino a quello con l'errore. */
type Block = 'name' | 'birth' | 'username' | 'password' | 'again' | 'terms';
const BLOCK: Record<RegisterField, Block> = { first: 'name', last: 'name', birth: 'birth', username: 'username', password: 'password', again: 'again', terms: 'terms' };
type NameCheck = 'idle' | 'checking' | 'free' | 'taken' | 'reserved';

function RegisterForm({
  onSwitch,
  onBack,
  onDone,
  scrollTo,
}: {
  onSwitch: () => void;
  onBack: () => void;
  onDone: (me: Me) => Promise<void>;
  scrollTo: (y: number) => void;
}) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [username, setUsername] = useState('');
  const [nameCheck, setNameCheck] = useState<NameCheck>('idle');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<RegistrationProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState(7);
  const inFlight = useRef(false);
  const firstRef = useRef<TextInput>(null);
  const lastRef = useRef<TextInput>(null);
  const dayRef = useRef<TextInput>(null);
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const userRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);
  const againRef = useRef<TextInput>(null);
  const ys = useRef<Partial<Record<Block, number>>>({});
  useEffect(() => {
    getSettings()
      .then((st) => setGraceDays(st.idGraceDays))
      .catch(() => undefined);
  }, []);

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
  const input: RegisterInput = { username, firstName: first, lastName: last, birthDate, password, acceptedTerms: accepted };
  const takenText = `@${username} è già preso: prova ad aggiungere un numero.`;

  /** Si modifica il campo con l'errore: l'errore sparisce. */
  const edited = (field: RegisterField) => {
    setError(null);
    setProblem((p) => (p?.field === field ? null : p));
  };

  const show = (p: RegistrationProblem) => {
    setProblem(p);
    scrollTo(ys.current[BLOCK[p.field]] ?? 0);
    const refs: Partial<Record<RegisterField, typeof firstRef>> = { first: firstRef, last: lastRef, username: userRef, password: passRef, again: againRef };
    if (p.field === 'birth') (!day ? dayRef : !month ? monthRef : !year ? yearRef : dayRef).current?.focus();
    else refs[p.field]?.current?.focus();
  };

  const submit = async () => {
    if (inFlight.current) return;
    const p =
      validateRegistration(input, again) ??
      (nameCheck === 'taken' ? ({ field: 'username', message: takenText } as const) : null);
    if (p) return show(p);
    try {
      inFlight.current = true;
      setBusy(true);
      setProblem(null);
      setError(null);
      const me = await register(input);
      await onDone(me);
    } catch (e) {
      const message = friendlyError(e);
      if (/nome utente|un account con questo nome/i.test(message)) show({ field: 'username', message });
      else setError(message);
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  const at = (block: Block) => (e: { nativeEvent: { layout: { y: number } } }) => {
    ys.current[block] = e.nativeEvent.layout.y;
  };
  const bad = (field: RegisterField) => problem?.field === field;
  const userLine =
    problem?.field === 'username'
      ? null
      : nameCheck === 'taken'
        ? takenText
        : nameCheck === 'reserved'
          ? USERNAME_RESERVED
          : null;

  return (
    <View style={{ gap: space[3] }}>
      <FormHead title="Crea un account" onBack={onBack} />
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
              if (y.length === 4) userRef.current?.focus();
            }}
            placeholder="AAAA"
            keyboardType="number-pad"
            maxLength={4}
            accessibilityLabel="Anno di nascita"
          />
        </View>
        <FieldError text={bad('birth') ? problem?.message : null} />
      </View>
      <View style={styles.block} onLayout={at('username')}>
        <Field
          ref={userRef}
          invalid={bad('username') || nameCheck === 'taken' || nameCheck === 'reserved'}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passRef.current?.focus()}
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
        ) : null}
      </View>
      <View style={styles.block} onLayout={at('password')}>
        <PasswordField
          inputRef={passRef}
          invalid={bad('password')}
          isNew
          value={password}
          onChange={(v) => {
            setPassword(v);
            edited('password');
          }}
          placeholder="Password"
          label="Password"
        />
        <FieldError text={bad('password') ? problem?.message : null} />
        <Txt variant="meta" tone={color.paperFaint}>
          Almeno {PASSWORD_MIN} caratteri, con lettere e numeri.
        </Txt>
      </View>
      <View style={styles.block} onLayout={at('again')}>
        <PasswordField
          inputRef={againRef}
          invalid={bad('again')}
          isNew
          value={again}
          onChange={(v) => {
            setAgain(v);
            edited('again');
          }}
          placeholder="Ripeti la password"
          label="Ripeti la password"
          onSubmit={() => void submit()}
        />
        <FieldError text={bad('again') ? problem?.message : null} />
      </View>
      <Txt variant="meta" tone={color.paperFaint}>
        Per pubblicare e votare conferma l’età entro {graceDays} {graceDays === 1 ? 'giorno' : 'giorni'}: bastano 2 minuti, te lo ricordiamo noi.
      </Txt>
      <View style={styles.block} onLayout={at('terms')}>
        <Press
          style={styles.terms}
          scaleTo={1}
          onPress={() => {
            setAccepted((a) => !a);
            edited('terms');
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}>
          <View style={[styles.box, accepted && styles.boxOn, bad('terms') && styles.boxBad]}>{accepted ? <Icon name="check" size={16} color={color.canvas} strokeWidth={2.6} /> : null}</View>
          <Txt variant="small" tone={color.paperDim} style={{ flex: 1 }}>
            Ho almeno {MIN_AGE} anni e accetto Termini e Linee guida. Ho letto l’Informativa privacy.
          </Txt>
        </Press>
        <FieldError text={bad('terms') ? problem?.message : null} />
        <Docs />
      </View>
      <FieldError text={error} />
      <Press style={[styles.cta, busy && styles.off]} onPress={() => void submit()} disabled={busy} accessibilityRole="button">
        {busy ? (
          <ActivityIndicator color={color.canvas} />
        ) : (
          <Txt variant="label" tone={color.canvas}>
            Registrati
          </Txt>
        )}
      </Press>
      <Press onPress={onSwitch} style={styles.switch} accessibilityRole="button">
        <Txt variant="small" tone={color.paperDim}>
          Hai già un account? <Txt variant="small" style={styles.link}>Accedi</Txt>
        </Txt>
      </Press>
      {isDemo ? (
        <Txt variant="meta" tone={color.paperFaint} style={{ textAlign: 'center' }}>
          Demo: i dati e il pubblico simulato restano su questo dispositivo.
        </Txt>
      ) : null}
    </View>
  );
}

function LoginForm({ onSwitch, onBack, onForgot }: { onSwitch: () => void; onBack: () => void; onForgot: () => void }) {
  const { setMe } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const passRef = useRef<TextInput>(null);

  const submit = async () => {
    if (inFlight.current) return;
    if (!username || !password) return setError('Scrivi nome utente e password.');
    try {
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setMe(await login(username, password));
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <View style={{ gap: space[3] }}>
      <FormHead title="Accedi" onBack={onBack} />
      <Field
        prefix={
          <Txt variant="body" tone={color.paperFaint}>
            @
          </Txt>
        }
        value={username}
        onChangeText={(v) => {
          setUsername(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''));
          setError(null);
        }}
        placeholder="nomeutente"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        maxLength={24}
        accessibilityLabel="Nome utente"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passRef.current?.focus()}
      />
      <PasswordField inputRef={passRef} value={password} onChange={setPassword} placeholder="Password" label="Password" onSubmit={() => void submit()} />
      <FieldError text={error} />
      <Press style={[styles.cta, busy && styles.off]} onPress={() => void submit()} disabled={busy} accessibilityRole="button">
        {busy ? (
          <ActivityIndicator color={color.canvas} />
        ) : (
          <Txt variant="label" tone={color.canvas}>
            Accedi
          </Txt>
        )}
      </Press>
      <Press onPress={onForgot} style={styles.switch} accessibilityRole="button">
        <Txt variant="small" style={styles.link}>
          Password dimenticata?
        </Txt>
      </Press>
      <Press onPress={onSwitch} style={styles.switch} accessibilityRole="button">
        <Txt variant="small" tone={color.paperDim}>
          Non hai un account? <Txt variant="small" style={styles.link}>Registrati</Txt>
        </Txt>
      </Press>
    </View>
  );
}

/** Password dimenticata: nome utente, codice di recupero e password nuova. Poi si entra e si riceve un codice nuovo. */
function RecoverForm({ onBack, onDone }: { onBack: () => void; onDone: (me: Me) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const codeRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);
  const againRef = useRef<TextInput>(null);
  const email = ownerEmail();

  const submit = async () => {
    if (inFlight.current) return;
    if (!username || !code || !password || !again) return setError('Compila tutti i campi.');
    if (password !== again) return setError('Le due password nuove non coincidono.');
    try {
      inFlight.current = true;
      setBusy(true);
      setError(null);
      const me = await recoverPassword(username, code, password);
      await onDone(me);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <View style={{ gap: space[3] }}>
      <FormHead title="Scegli una nuova password" onBack={onBack} />
      <Field
        prefix={
          <Txt variant="body" tone={color.paperFaint}>
            @
          </Txt>
        }
        value={username}
        onChangeText={(v) => {
          setUsername(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''));
          setError(null);
        }}
        placeholder="nomeutente"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        maxLength={24}
        accessibilityLabel="Nome utente"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => codeRef.current?.focus()}
      />
      <Txt variant="label" style={{ marginTop: space[1] }}>
        Codice di recupero
      </Txt>
      <Field
        ref={codeRef}
        value={code}
        onChangeText={(v) => {
          setCode(formatRecoveryCode(v));
          setError(null);
        }}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        maxLength={24}
        accessibilityLabel="Codice di recupero"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passRef.current?.focus()}
      />
      <PasswordField inputRef={passRef} isNew value={password} onChange={setPassword} placeholder="Nuova password" label="Nuova password" />
      <Txt variant="meta" tone={color.paperFaint}>
        Almeno {PASSWORD_MIN} caratteri, con lettere e numeri.
      </Txt>
      <PasswordField inputRef={againRef} isNew value={again} onChange={setAgain} placeholder="Ripeti la nuova password" label="Ripeti la nuova password" onSubmit={() => void submit()} />
      <FieldError text={error} />
      <Press style={[styles.cta, busy && styles.off]} onPress={() => void submit()} disabled={busy} accessibilityRole="button">
        {busy ? (
          <ActivityIndicator color={color.canvas} />
        ) : (
          <Txt variant="label" tone={color.canvas}>
            Cambia password
          </Txt>
        )}
      </Press>
      {email ? (
        <Txt variant="meta" tone={color.paperFaint} style={{ textAlign: 'center' }}>
          {`Non hai il codice? Scrivi a ${email}: verifichiamo che l’account è tuo e ti aiutiamo.`}
        </Txt>
      ) : null}
    </View>
  );
}

/** Muro di provini che scorre lento: moto costante, lineare. Con "riduci movimento" resta fermo. */
function Wall() {
  return (
    <View style={styles.wall} pointerEvents="none">
      {COLUMNS.map((col, i) => (
        <Column key={i} names={col} speed={i === 1 ? 52000 : 64000} reverse={i === 1} />
      ))}
    </View>
  );
}

function Column({ names, speed, reverse }: { names: string[]; speed: number; reverse?: boolean }) {
  const reduced = useReducedMotion();
  const span = names.length * (TILE * 1.5 + 8);
  const y = useSharedValue(reverse ? -span : 0);
  useEffect(() => {
    if (reduced) return;
    y.set(withRepeat(withTiming(reverse ? 0 : -span, { duration: speed, easing: Easing.linear }), -1, false));
  }, [reduced, reverse, span, speed, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return (
    <Animated.View style={[styles.column, style]}>
      {[...names, ...names].map((n, i) => (
        <Image key={i} source={DEMO_MEDIA[n]} style={styles.tile} contentFit="cover" />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  wall: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', gap: 8, paddingHorizontal: 4, opacity: 0.9 },
  column: { flex: 1, gap: 8 },
  tile: { width: '100%', height: TILE * 1.5, borderRadius: 12, backgroundColor: color.raised },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space[6] },
  ghost: { borderWidth: 1.5, borderColor: color.paper, borderRadius: radius.control, paddingVertical: 15, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[1] },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space[2] },
  eye: { position: 'absolute', right: space[4], top: 0, bottom: 0, justifyContent: 'center' },
  switch: { alignSelf: 'center', paddingVertical: space[2] },
  claim: { fontFamily: font.displayBook, fontSize: 22, lineHeight: 29, color: color.paper, textAlign: 'center', maxWidth: 320 },
  point: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  cta: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  off: { opacity: 0.45 },
  terms: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingVertical: space[1] },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: color.paperDim, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: color.giallo, borderColor: color.giallo },
  boxBad: { borderColor: color.matita },
  block: { gap: space[2] },
  link: { color: color.paper, textDecorationLine: 'underline', fontFamily: font.uiMedium },
  docs: { flexDirection: 'row', gap: space[2], marginTop: -space[2] },
  doc: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[2] },
});
