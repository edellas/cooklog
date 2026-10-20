import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FieldError } from '../src/components/FormBits';
import { Icon, type IconName } from '../src/components/Icon';
import { Masthead } from '../src/components/Masthead';
import { Press } from '../src/components/Press';
import { SocialButton } from '../src/components/SocialButton';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { DEMO_MEDIA } from '../src/data/demoMedia';
import { color, font, radius, space } from '../src/design/tokens';
import { demoSocialAccounts, demoSocialSignIn, isDemo } from '../src/services/api';
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

/** Si entra solo con Google o Facebook; in demo c'è un passo in più per scegliere l'account simulato. */
type Step = 'intro' | 'demo';

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { setMe, refreshAuth } = useSession();
  const toast = useToast();
  const [step, setStep] = useState<Step>('intro');
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [demoProvider, setDemoProvider] = useState<SocialProvider>('google');
  const scroll = useRef<ScrollView>(null);

  // Sul web, di ritorno da Google/Facebook con un errore: lo si mostra sotto i pulsanti.
  useEffect(() => {
    const e = takeWebAuthError();
    if (e) setSocialError(e);
  }, []);

  // Su Android "indietro" dalla scelta dell'account (demo) torna alla presentazione invece di chiudere l'app.
  useEffect(() => {
    if (step === 'intro') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep('intro');
      return true;
    });
    return () => sub.remove();
  }, [step]);

  const go = useCallback((next: Step) => {
    setStep(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);

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
      <View style={styles.fill}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + (step === 'intro' ? space[10] : space[6]), paddingBottom: insets.bottom + space[5] }]}
          showsVerticalScrollIndicator={false}>
          {/* Nella scelta dell'account (demo) la testata lascia spazio all'elenco. */}
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
              <Intro busy={busy} error={socialError} onSocial={(p) => void social(p)} />
            ) : (
              <DemoChooser provider={demoProvider} onBack={() => go('intro')} onPick={(u) => void demoPick(u)} />
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function Intro({ busy, error, onSocial }: { busy: SocialProvider | null; error: string | null; onSocial: (p: SocialProvider) => void }) {
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
  formHead: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[1] },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  claim: { fontFamily: font.displayBook, fontSize: 22, lineHeight: 29, color: color.paper, textAlign: 'center', maxWidth: 320 },
  point: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  cta: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  account: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.raised, borderRadius: radius.control, paddingHorizontal: space[4], minHeight: 52 },
});
