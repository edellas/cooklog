import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../src/components/Field';
import { FieldError, formStyles } from '../src/components/FormBits';
import { Icon, type IconName } from '../src/components/Icon';
import { Masthead } from '../src/components/Masthead';
import { Press } from '../src/components/Press';
import { RecoveryCodeCard } from '../src/components/RecoveryCode';
import { SocialButton } from '../src/components/SocialButton';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { DEMO_MEDIA } from '../src/data/demoMedia';
import { ownerEmail } from '../src/legal/docs';
import { color, font, radius, space } from '../src/design/tokens';
import { createRecoveryCode, demoSocialAccounts, demoSocialSignIn, formatRecoveryCode, isDemo, login, PASSWORD_MIN, recoverPassword } from '../src/services/api';
import { PROVIDER_NAME, signInWithSocial, takeWebAuthError } from '../src/services/oauth';
import type { Me, SocialProvider } from '../src/types';
import { useSession } from '../src/state/session';
import { friendlyError } from '../src/services/errors';

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

type Step = 'intro' | 'accedi' | 'recupero' | 'codice' | 'demo';
/** Password appena cambiata con il codice: si entra dopo aver visto il codice di recupero nuovo. */
type Pending = { me: Me; code: string; lead?: string };

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { setMe, refreshAuth } = useSession();
  const toast = useToast();
  const [step, setStep] = useState<Step>('intro');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [demoProvider, setDemoProvider] = useState<SocialProvider>('google');
  const scroll = useRef<ScrollView>(null);

  // Sul web, di ritorno da Google/Facebook con un errore: lo si mostra sotto i pulsanti.
  useEffect(() => {
    const e = takeWebAuthError();
    if (e) setSocialError(e);
  }, []);

  // Su Android "indietro" dai moduli torna alla presentazione invece di chiudere l'app. Con il codice di
  // recupero sullo schermo la password è già cambiata: "indietro" non riporta al modulo.
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

  // Dopo il recupero della password prima si mostra il codice di recupero nuovo, poi si entra.
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

  /**
   * Continua con Google / Facebook. Al primo accesso si passa a "Completa il profilo", altrimenti si entra
   * (lo decide il Gate in app/_layout.tsx dallo stato della sessione). In demo l'accesso è simulato.
   */
  const social = async (provider: SocialProvider) => {
    if (busy) return;
    setSocialError(null);
    if (isDemo) {
      setDemoProvider(provider);
      go('demo');
      return;
    }
    try {
      setBusy(provider);
      const res = await signInWithSocial(provider);
      // Sul web la pagina sta andando al provider: il pulsante resta in attesa.
      if (res === 'redirect') return;
      if (res === 'ok') {
        const st = await refreshAuth();
        if (!st.me && !st.pending) setSocialError('Accesso non riuscito. Riprova tra poco.');
      }
      setBusy(null);
    } catch (e) {
      setSocialError(friendlyError(e));
      setBusy(null);
    }
  };

  const demoPick = async (username: string | null) => {
    try {
      const me = await demoSocialSignIn(demoProvider, username);
      if (me) setMe(me);
      else await refreshAuth();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

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
          <View>
            {step === 'intro' ? (
              <Intro busy={busy} error={socialError} onSocial={(p) => void social(p)} onLogin={() => go('accedi')} />
            ) : step === 'demo' ? (
              <DemoChooser provider={demoProvider} onBack={() => go('intro')} onPick={(u) => void demoPick(u)} />
            ) : step === 'accedi' ? (
              <LoginForm onBack={() => go('intro')} onForgot={() => go('recupero')} />
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

function Intro({ busy, error, onSocial, onLogin }: { busy: SocialProvider | null; error: string | null; onSocial: (p: SocialProvider) => void; onLogin: () => void }) {
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
        <SocialButton provider="google" onPress={() => onSocial('google')} busy={busy === 'google'} disabled={busy !== null} />
        <SocialButton provider="facebook" onPress={() => onSocial('facebook')} busy={busy === 'facebook'} disabled={busy !== null} />
        <FieldError text={error} />
        <Txt variant="meta" tone={color.paperFaint} style={{ textAlign: 'center' }}>
          {isDemo
            ? 'Demo: l’accesso è simulato e i dati restano su questo dispositivo.'
            : 'Usiamo il tuo account solo per farti entrare: non pubblichiamo nulla a tuo nome e la tua email non è visibile agli altri utenti.'}
        </Txt>
        <Press onPress={onLogin} style={styles.switch} accessibilityRole="button">
          <Txt variant="small" tone={color.paperDim}>
            Hai un account con password? <Txt variant="small" style={formStyles.link}>Accedi</Txt>
          </Txt>
        </Press>
      </View>
    </View>
  );
}

/** Demo: la scelta dell'account simulato (come quella di Google): uno già creato qui, o uno nuovo. */
function DemoChooser({ provider, onBack, onPick }: { provider: SocialProvider; onBack: () => void; onPick: (username: string | null) => void }) {
  const [accounts, setAccounts] = useState<Me[] | null>(null);
  useEffect(() => {
    demoSocialAccounts(provider)
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [provider]);
  return (
    <View style={{ gap: space[3] }}>
      <FormHead title={`Continua con ${PROVIDER_NAME[provider]}`} onBack={onBack} />
      <Txt variant="small" tone={color.paperDim}>
        {`Nella demo l’accesso con ${PROVIDER_NAME[provider]} è simulato: nessun dato lascia questo dispositivo. Scegli l’account con cui entrare.`}
      </Txt>
      {accounts === null ? <ActivityIndicator color={color.giallo} /> : null}
      {(accounts ?? []).map((a) => (
        <Press key={a.id} style={styles.account} onPress={() => onPick(a.username)} accessibilityRole="button" accessibilityLabel={`Entra come @${a.username}`}>
          <Txt variant="label" style={{ flex: 1 }} numberOfLines={1}>
            {a.displayName}
          </Txt>
          <Txt variant="small" tone={color.paperFaint}>
            @{a.username}
          </Txt>
        </Press>
      ))}
      <Press style={styles.cta} onPress={() => onPick(null)} accessibilityRole="button">
        <Txt variant="label" tone={color.canvas}>
          Nuovo account
        </Txt>
      </Press>
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

function LoginForm({ onBack, onForgot }: { onBack: () => void; onForgot: () => void }) {
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
      <FormHead title="Accedi con la password" onBack={onBack} />
      <Txt variant="small" tone={color.paperDim}>
        Per gli account creati con nome utente e password.
      </Txt>
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
        <Txt variant="small" style={formStyles.link}>
          Password dimenticata?
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
  eye: { position: 'absolute', right: space[4], top: 0, bottom: 0, justifyContent: 'center' },
  switch: { alignSelf: 'center', paddingVertical: space[2] },
  claim: { fontFamily: font.displayBook, fontSize: 22, lineHeight: 29, color: color.paper, textAlign: 'center', maxWidth: 320 },
  point: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  cta: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  off: { opacity: 0.45 },
  account: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.raised, borderRadius: radius.control, paddingHorizontal: space[4], minHeight: 52 },
});
