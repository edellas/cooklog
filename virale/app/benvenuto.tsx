import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../src/components/Field';
import { Icon, type IconName } from '../src/components/Icon';
import { Masthead } from '../src/components/Masthead';
import { Press } from '../src/components/Press';
import { Txt } from '../src/components/Txt';
import { DEMO_MEDIA } from '../src/data/demoMedia';
import { color, font, radius, space } from '../src/design/tokens';
import { createAccount, isDemo } from '../src/services/api';
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

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'intro' | 'nome'>('intro');

  return (
    <View style={styles.root}>
      <Wall />
      <LinearGradient colors={['rgba(12,19,34,0.35)', 'rgba(12,19,34,0.88)', color.canvas]} locations={[0, 0.45, 0.72]} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView style={[styles.content, { paddingTop: insets.top + space[10], paddingBottom: insets.bottom + space[5] }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ alignItems: 'center', gap: space[3] }}>
          <Masthead size={88} reveal />
          <Txt style={styles.claim}>Ogni giorno una sola copertina. La scelgono gli occhi di tutti.</Txt>
        </View>
        <View style={{ flex: 1 }} />
        {step === 'intro' ? <Intro onNext={() => setStep('nome')} /> : <NameForm />}
      </KeyboardAvoidingView>
    </View>
  );
}

function Intro({ onNext }: { onNext: () => void }) {
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
      <Press style={styles.cta} onPress={onNext} hapticOnPress="light" accessibilityRole="button">
        <Txt variant="label" tone={color.canvas}>
          Inizia
        </Txt>
      </Press>
    </View>
  );
}

function NameForm() {
  const { setMe } = useSession();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      setBusy(true);
      setError(null);
      setMe(await createAccount(username, name));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space[3] }}>
      <Txt variant="title">Come ti chiami qui?</Txt>
      <Field
          prefix={
            <Txt variant="body" tone={color.paperFaint}>
              @
            </Txt>
          }
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/\s/g, ''))}
          placeholder="nomeutente"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={24}
          accessibilityLabel="Nome utente"
        />
      <Field
          value={name}
          onChangeText={setName}
          placeholder="Nome che vedranno gli altri (facoltativo)"
          maxLength={40}
          accessibilityLabel="Nome visualizzato"
        />
      {error ? (
        <Txt variant="small" tone={color.matita}>
          {error}
        </Txt>
      ) : null}
      <Press style={[styles.cta, !username && styles.off]} onPress={() => void submit()} disabled={!username || busy} accessibilityRole="button">
        {busy ? (
          <ActivityIndicator color={color.canvas} />
        ) : (
          <Txt variant="label" tone={color.canvas}>
            Entra
          </Txt>
        )}
      </Press>
      {isDemo ? (
        <Txt variant="meta" tone={color.paperFaint} style={{ textAlign: 'center' }}>
          Demo: i dati e il pubblico simulato restano su questo dispositivo.
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
  content: { flex: 1, paddingHorizontal: space[6] },
  claim: { fontFamily: font.displayBook, fontSize: 22, lineHeight: 29, color: color.paper, textAlign: 'center', maxWidth: 320 },
  point: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  cta: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  off: { opacity: 0.45 },
});
