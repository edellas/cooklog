import { useIsFocused } from '@react-navigation/native';
import { useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaFrame, type VideoProgress } from '../src/components/MediaFrame';
import { Press } from '../src/components/Press';
import { Txt } from '../src/components/Txt';
import { longDate } from '../src/design/format';
import { color, radius, space } from '../src/design/tokens';
import { getTodayCover } from '../src/services/api';
import { markCoverSeen } from '../src/state/coverDuty';
import { useSession } from '../src/state/session';
import { toggleMute, useMuted } from '../src/state/sound';
import type { Cover } from '../src/types';

/** Quanto resta sullo schermo ogni foto della copertina prima di poter andare avanti. */
const IMAGE_MS = 3000;

/**
 * La copertina appena uscita, a tutto schermo: si guarda per intero (ogni foto qualche secondo, ogni video fino
 * alla fine) prima di poter usare l'app. Non si chiude con il gesto né con "indietro": solo con "Continua",
 * che si accende quando è stata vista tutta.
 */
export default function CoverDutyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const muted = useMuted();
  const { me } = useSession();
  const [cover, setCover] = useState<Cover | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const indexRef = useRef(0);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/' as Href);
  }, [router]);

  useEffect(() => {
    getTodayCover()
      .then((c) => setCover(c))
      .catch(() => setCover(null));
  }, []);
  // Nessuna copertina (o non si carica): non si blocca nessuno.
  useEffect(() => {
    if (cover === null) leave();
  }, [cover, leave]);

  // Il tasto "indietro" di Android non chiude la copertina.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const mark = useCallback((i: number) => setSeen((s) => (s.has(i) ? s : new Set(s).add(i))), []);

  // Le foto contano come viste dopo qualche secondo sullo schermo.
  const media = cover?.post.media ?? [];
  const current = media[index];
  useEffect(() => {
    if (!current || current.kind !== 'image' || seen.has(index)) return;
    const t = setTimeout(() => mark(index), IMAGE_MS);
    return () => clearTimeout(t);
  }, [current, index, mark, seen]);

  const onIndexChange = useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
  }, []);
  // I video contano come visti quando sono stati guardati davvero fino in fondo (trascinare la barra non vale).
  const onVideoProgress = useCallback(
    (p: VideoProgress) => {
      if (p.completed) mark(indexRef.current);
    },
    [mark],
  );

  const all = media.length > 0 && media.every((_, i) => seen.has(i));
  const finish = async () => {
    if (!cover || !all) return;
    if (me) await markCoverSeen(me.id, cover.featuredOn).catch(() => undefined);
    leave();
  };

  if (!cover) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={color.giallo} />
      </View>
    );
  }

  const missing = media.length - seen.size;
  const hint = all
    ? 'Ora puoi entrare.'
    : current?.kind === 'video' && !seen.has(index)
      ? 'Guarda il video fino alla fine.'
      : media.length > 1
        ? `Scorri e guarda ${missing === 1 ? 'l’ultimo elemento' : `gli altri ${missing} elementi`}.`
        : 'Un attimo…';

  return (
    <View style={styles.root}>
      <MediaFrame
        media={media}
        active={focused}
        rounded={false}
        muted={muted}
        onToggleMute={toggleMute}
        onVideoProgress={onVideoProgress}
        onIndexChange={onIndexChange}
        controlsTop={insets.top + 96}
        label={`di @${cover.post.author.username}`}
      />
      <LinearGradient pointerEvents="none" colors={['rgba(12,19,34,0.85)', 'rgba(12,19,34,0)']} style={[styles.topShade, { height: insets.top + 140 }]} />
      <View style={[styles.top, { paddingTop: insets.top + space[3] }]} pointerEvents="none">
        <Txt variant="meta" tone={color.giallo} style={styles.kicker}>
          È uscita la copertina · {longDate(cover.featuredOn)}
        </Txt>
        <Txt variant="title" numberOfLines={1}>
          {cover.post.author.displayName} · @{cover.post.author.username}
        </Txt>
      </View>
      <LinearGradient pointerEvents="none" colors={['rgba(12,19,34,0)', 'rgba(12,19,34,0.92)']} style={styles.bottomShade} />
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[4] }]} pointerEvents="box-none">
        {cover.post.caption ? (
          <Txt variant="small" tone={color.paperDim} numberOfLines={3} style={{ marginBottom: space[2] }}>
            {cover.post.caption}
          </Txt>
        ) : null}
        <Txt variant="meta" tone={color.paperDim} accessibilityLiveRegion="polite">
          {hint}
        </Txt>
        <Press
          style={[styles.cta, !all && styles.ctaOff]}
          onPress={() => void finish()}
          disabled={!all}
          accessibilityRole="button"
          accessibilityState={{ disabled: !all }}
          accessibilityLabel={all ? 'Continua' : 'Continua, disponibile dopo aver guardato la copertina'}>
          <Txt variant="label" tone={all ? color.canvas : color.paperFaint}>
            Continua
          </Txt>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  center: { alignItems: 'center', justifyContent: 'center' },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space[5], gap: 2 },
  kicker: { fontFamily: 'SchibstedGrotesk_700Bold', textTransform: 'uppercase', letterSpacing: 0.6 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 260 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space[5], gap: space[2] },
  cta: { marginTop: space[2], backgroundColor: color.giallo, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center' },
  ctaOff: { backgroundColor: color.raised },
});
