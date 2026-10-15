import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../src/components/Field';
import { Icon, type IconName } from '../src/components/Icon';
import { Masthead } from '../src/components/Masthead';
import { Press } from '../src/components/Press';
import { Txt } from '../src/components/Txt';
import { DEMO_MEDIA } from '../src/data/demoMedia';
import { MIN_AGE, OWNER } from '../src/legal/docs';
import { color, font, radius, space } from '../src/design/tokens';
import { getSettings, isDemo, login, PASSWORD_MIN, register, usernameAvailable, validateRegistration } from '../src/services/api';
import type { RegisterInput } from '../src/types';
import { useSession } from '../src/state/session';

const COLUMNS = [
  ['cinqueterre', 'gatto-neve', 'selfie', 'lava', 'sposi'],
  ['cane-bagno', 'mercato', 'sub', 'danza', 'strada'],
  ['bimbo', 'montagne', 'monaco', 'cavallo', 'ritratto'],
];
const TILE = 168;

const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'scatta', text: 'Pubblichi foto e video, come sempre.' },
  { icon: 'cerchia', text: 'Chi guarda decide: conta come ti guardano, non quanti follower hai.' },
  { icon: 'copertina', text: 'A mezzanotte un solo post diventa la copertina che vedono tutti.' },
];

type Step = 'intro' | 'registrati' | 'accedi';

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('intro');

  // Su Android "indietro" dai moduli torna alla presentazione invece di chiudere l'app.
  useEffect(() => {
    if (step === 'intro') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep('intro');
      return true;
    });
    return () => sub.remove();
  }, [step]);

  return (
    <View style={styles.root}>
      <Wall />
      <LinearGradient colors={['rgba(12,19,34,0.35)', 'rgba(12,19,34,0.88)', color.canvas]} locations={[0, 0.45, 0.72]} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + (step === 'intro' ? space[10] : space[6]), paddingBottom: insets.bottom + space[5] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Nei moduli la testata lascia spazio ai campi. */}
          {step === 'intro' ? (
            <>
              <View style={{ alignItems: 'center', gap: space[3] }}>
                <Masthead size={88} reveal />
                <Txt style={styles.claim}>Ogni giorno una sola copertina. La scelgono gli occhi di tutti.</Txt>
              </View>
              <View style={{ flex: 1, minHeight: space[6] }} />
            </>
          ) : null}
          {step === 'intro' ? (
            <Intro onRegister={() => setStep('registrati')} onLogin={() => setStep('accedi')} />
          ) : step === 'registrati' ? (
            <RegisterForm onSwitch={() => setStep('accedi')} onBack={() => setStep('intro')} />
          ) : (
            <LoginForm onSwitch={() => setStep('registrati')} onBack={() => setStep('intro')} />
          )}
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
      <Txt variant="heading">{title}</Txt>
    </View>
  );
}

function PasswordField({ value, onChange, placeholder, label, onSubmit }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; onSubmit?: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <View>
      <Field
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        secureTextEntry={!shown}
        style={{ paddingRight: 72 }}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        autoComplete="password"
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

function Docs() {
  const router = useRouter();
  return (
    <View style={styles.docs}>
      {(
        [
          ['termini', 'Termini'],
          ['linee-guida', 'Linee guida'],
          ['privacy', 'Privacy'],
        ] as const
      ).map(([slug, label]) => (
        <Press key={slug} style={styles.doc} onPress={() => router.push(`/legale/${slug}` as Href)} accessibilityRole="link" accessibilityLabel={`Leggi ${label}`}>
          <Txt variant="small" style={styles.link}>
            {label}
          </Txt>
        </Press>
      ))}
    </View>
  );
}

function RegisterForm({ onSwitch, onBack }: { onSwitch: () => void; onBack: () => void }) {
  const { setMe } = useSession();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [username, setUsername] = useState('');
  const [taken, setTaken] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState(7);
  useEffect(() => {
    getSettings()
      .then((st) => setGraceDays(st.idGraceDays))
      .catch(() => undefined);
  }, []);

  const birthDate = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const input: RegisterInput = { username, firstName: first, lastName: last, birthDate, password, acceptedTerms: accepted };
  const complete = first.trim() && last.trim() && day && month && year.length === 4 && username.length >= 3 && password && again && accepted;

  const checkName = () => {
    if (username.length < 3) return;
    usernameAvailable(username)
      .then((ok) => setTaken(!ok))
      .catch(() => undefined);
  };

  const submit = async () => {
    const problem = validateRegistration(input) ?? (password !== again ? 'Le due password non coincidono.' : null);
    if (problem) return setError(problem);
    try {
      setBusy(true);
      setError(null);
      setMe(await register(input));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space[3] }}>
      <FormHead title="Crea un account" onBack={onBack} />
      <View style={styles.row}>
        <Field containerStyle={{ flex: 1 }} value={first} onChangeText={setFirst} placeholder="Nome" autoComplete="given-name" textContentType="givenName" maxLength={60} accessibilityLabel="Nome" />
        <Field containerStyle={{ flex: 1 }} value={last} onChangeText={setLast} placeholder="Cognome" autoComplete="family-name" textContentType="familyName" maxLength={60} accessibilityLabel="Cognome" />
      </View>
      <Txt variant="meta" tone={color.paperFaint}>
        Gli altri vedono solo il nome e l’iniziale del cognome.
      </Txt>
      <Txt variant="label" style={{ marginTop: space[1] }}>
        Data di nascita
      </Txt>
      <View style={styles.row}>
        <Field containerStyle={{ flex: 1 }} value={day} onChangeText={(v) => setDay(v.replace(/\D/g, '').slice(0, 2))} placeholder="GG" keyboardType="number-pad" maxLength={2} accessibilityLabel="Giorno di nascita" />
        <Field containerStyle={{ flex: 1 }} value={month} onChangeText={(v) => setMonth(v.replace(/\D/g, '').slice(0, 2))} placeholder="MM" keyboardType="number-pad" maxLength={2} accessibilityLabel="Mese di nascita" />
        <Field containerStyle={{ flex: 1.6 }} value={year} onChangeText={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))} placeholder="AAAA" keyboardType="number-pad" maxLength={4} accessibilityLabel="Anno di nascita" />
      </View>
      <Field
        prefix={
          <Txt variant="body" tone={color.paperFaint}>
            @
          </Txt>
        }
        value={username}
        onChangeText={(v) => {
          setUsername(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''));
          setTaken(false);
          setError(null);
        }}
        onBlur={checkName}
        placeholder="nomeutente"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        maxLength={24}
        accessibilityLabel="Nome utente"
      />
      {taken ? (
        <Txt variant="small" tone={color.matita}>
          @{username} è già preso: prova ad aggiungere un numero.
        </Txt>
      ) : null}
      <PasswordField value={password} onChange={setPassword} placeholder="Password" label="Password" />
      <Txt variant="meta" tone={color.paperFaint}>
        Almeno {PASSWORD_MIN} caratteri, con lettere e numeri.
      </Txt>
      <PasswordField value={again} onChange={setAgain} placeholder="Ripeti la password" label="Ripeti la password" onSubmit={() => void submit()} />
      <Txt variant="meta" tone={color.paperFaint}>
        Entro {graceDays} {graceDays === 1 ? 'giorno' : 'giorni'} ti chiederemo una foto del documento d’identità per confermare l’età: senza, potrai solo guardare.
      </Txt>
      <Press style={styles.terms} scaleTo={1} onPress={() => setAccepted((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
        <View style={[styles.box, accepted && styles.boxOn]}>{accepted ? <Icon name="check" size={16} color={color.canvas} strokeWidth={2.6} /> : null}</View>
        <Txt variant="small" tone={color.paperDim} style={{ flex: 1 }}>
          Ho almeno {MIN_AGE} anni e accetto Termini e Linee guida. Ho letto l’Informativa privacy.
        </Txt>
      </Press>
      <Docs />
      {error ? (
        <Txt variant="small" tone={color.matita} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      <Press style={[styles.cta, (!complete || busy) && styles.off]} onPress={() => void submit()} disabled={!complete || busy} accessibilityRole="button">
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

function LoginForm({ onSwitch, onBack }: { onSwitch: () => void; onBack: () => void }) {
  const { setMe } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!username || !password) return setError('Scrivi nome utente e password.');
    try {
      setBusy(true);
      setError(null);
      setMe(await login(username, password));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
      />
      <PasswordField value={password} onChange={setPassword} placeholder="Password" label="Password" onSubmit={() => void submit()} />
      {error ? (
        <Txt variant="small" tone={color.matita} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      <Press style={[styles.cta, busy && styles.off]} onPress={() => void submit()} disabled={busy} accessibilityRole="button">
        {busy ? (
          <ActivityIndicator color={color.canvas} />
        ) : (
          <Txt variant="label" tone={color.canvas}>
            Accedi
          </Txt>
        )}
      </Press>
      <Txt variant="meta" tone={color.paperFaint} style={{ textAlign: 'center' }}>
        Password dimenticata? Scrivi a {OWNER.email}: te la reimpostiamo dopo aver verificato che l’account è tuo.
      </Txt>
      <Press onPress={onSwitch} style={styles.switch} accessibilityRole="button">
        <Txt variant="small" tone={color.paperDim}>
          Non hai un account? <Txt variant="small" style={styles.link}>Registrati</Txt>
        </Txt>
      </Press>
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
  link: { color: color.paper, textDecorationLine: 'underline', fontFamily: font.uiMedium },
  docs: { flexDirection: 'row', gap: space[2], marginTop: -space[2] },
  doc: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[2] },
});
