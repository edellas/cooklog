import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Masthead } from '../components/Masthead';
import { MediaFrame } from '../components/MediaFrame';
import { Monogram } from '../components/Monogram';
import { haptic, Press } from '../components/Press';
import { useToast } from '../components/Toast';
import { Txt } from '../components/Txt';
import { resolveMedia } from '../data/demoMedia';
import { clock, formatCount, longDate } from '../design/format';
import { duration, ease } from '../design/motion';
import { color, font, radius, space } from '../design/tokens';
import { msUntilReveal } from '../engine/engine';
import { registerShare, toggleLike, toggleSave } from '../services/api';
import { shareText } from '../services/share';
import { emitPostChange, onPostChange, withRecentChanges } from '../state/postEvents';
import { useSession } from '../state/session';
import { useGoBack } from '../state/useGoBack';
import { queueView } from '../state/views';
import type { Cover } from '../types';

/**
 * La copertina: il post vincitore a tutta pagina, con la testata Virale, il numero dell'uscita e la data.
 * È identica per tutti gli utenti per tutto il giorno.
 */
export function CoverView({
  cover,
  isToday,
  reveal,
  onSimulateMidnight,
  onDayEnd,
}: {
  cover: Cover;
  isToday: boolean;
  /** Prima apertura del giorno: la foto "si sviluppa" e la testata compare lettera per lettera. */
  reveal: boolean;
  onSimulateMidnight?: () => void;
  /** Allo scadere del conto alla rovescia: è uscita la copertina nuova. */
  onDayEnd?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const toast = useToast();
  const reduced = useReducedMotion();
  // I tab restano montati: fuori fuoco la copertina non deve continuare a riprodurre video.
  const focused = useIsFocused();
  const { me, status } = useSession();
  const revealMinutes = status?.settings.revealMinutes ?? 0;
  // Vista della copertina: dopo un secondo sullo schermo.
  useEffect(() => {
    if (!focused) return;
    const id = setTimeout(() => queueView(cover.post.id), 1000);
    return () => clearTimeout(id);
  }, [focused, cover.post.id]);
  const [post, setPost] = useState(() => withRecentChanges(cover.post));
  const [muted, setMuted] = useState(true);

  useEffect(() => setPost(withRecentChanges(cover.post)), [cover.post]);
  // Lo stesso post può essere anche nel feed: mi piace e salvataggi restano allineati.
  useEffect(() => onPostChange(cover.post.id, ({ commented: _c, ...patch }) => setPost((p) => ({ ...p, ...patch }))), [cover.post.id]);

  // Sviluppo: uno strato sfocato statico che svanisce (si anima l'opacità, mai il raggio di sfocatura).
  const blur = useSharedValue(reveal ? 1 : 0);
  const zoom = useSharedValue(reveal && !reduced ? 1.04 : 1);
  useEffect(() => {
    if (!reveal) return;
    blur.set(withTiming(0, { duration: duration.develop, easing: ease.out }));
    zoom.set(withTiming(1, { duration: duration.develop, easing: ease.out }));
  }, [blur, reveal, zoom]);
  const blurStyle = useAnimatedStyle(() => ({ opacity: blur.get() }));
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.get() }] }));

  const first = post.media[0];
  const like = (on: boolean) => {
    if (post.likedByMe === on) return;
    haptic('light');
    const likeCount = Math.max(0, post.likeCount + (on ? 1 : -1));
    setPost((p) => ({ ...p, likedByMe: on, likeCount }));
    emitPostChange(post.id, { likedByMe: on, likeCount });
    toggleLike(post.id, on).catch(() => {
      setPost((p) => ({ ...p, likedByMe: !on, likeCount: post.likeCount }));
      emitPostChange(post.id, { likedByMe: !on, likeCount: post.likeCount });
      toast('Non sono riuscito a salvare il mi piace. Riprova.', 'error');
    });
  };
  const save = () => {
    const on = !post.savedByMe;
    const saveCount = Math.max(0, post.saveCount + (on ? 1 : -1));
    setPost((p) => ({ ...p, savedByMe: on, saveCount }));
    emitPostChange(post.id, { savedByMe: on, saveCount });
    toggleSave(post.id, on).catch(() => {
      setPost((p) => ({ ...p, savedByMe: !on, saveCount: post.saveCount }));
      emitPostChange(post.id, { savedByMe: !on, saveCount: post.saveCount });
      toast('Non sono riuscito a salvarla. Riprova.', 'error');
    });
  };
  const share = async () => {
    const text = isToday ? `La copertina di Virale di oggi: @${post.author.username}` : `La copertina di Virale del ${longDate(cover.featuredOn)}: @${post.author.username}`;
    const res = await shareText(text);
    if (res === 'none') return;
    if (res === 'copied') toast('Testo copiato: incollalo dove vuoi.');
    registerShare(post.id).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
        <MediaFrame
          media={post.media}
          active={focused}
          rounded={false}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          onDoubleTap={() => like(true)}
          controlsTop={insets.top + 132}
        />
      </Animated.View>
      {reveal && first?.kind === 'image' ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]}>
          <Image source={resolveMedia(first.src)} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={28} />
        </Animated.View>
      ) : null}

      <LinearGradient pointerEvents="none" colors={['rgba(12,19,34,0.72)', 'rgba(12,19,34,0)']} style={[styles.topShade, { height: insets.top + 170 }]} />
      <LinearGradient pointerEvents="none" colors={['rgba(12,19,34,0)', 'rgba(12,19,34,0.92)']} style={styles.bottomShade} />

      <View style={[styles.top, { paddingTop: insets.top + space[2] }]} pointerEvents="box-none">
        {!isToday ? (
          <Press style={[styles.back, { top: insets.top + space[2] }]} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
            <Icon name="indietro" />
          </Press>
        ) : null}
        <Masthead size={76} reveal={reveal} />
        <View style={styles.issueRow}>
          <Txt variant="meta" style={styles.issue}>
            N. {cover.issue}
          </Txt>
          <View style={styles.rule} />
          <Txt variant="meta" style={styles.issue}>
            {longDate(cover.featuredOn)}
          </Txt>
        </View>
      </View>

      <View style={[styles.bottom, !isToday && { paddingBottom: insets.bottom + space[4] }]} pointerEvents="box-none">
        <Press
          style={styles.authorRow}
          onPress={() => router.push(`/utente/${post.author.username}` as Href)}
          accessibilityRole="link"
          accessibilityLabel={`Profilo di ${post.author.displayName}, @${post.author.username}`}>
          <Monogram name={post.author.displayName} seed={post.author.username} size={44} />
          <View style={{ flexShrink: 1 }}>
            <Txt variant="heading" numberOfLines={1}>
              {post.author.displayName}
            </Txt>
            <Txt variant="meta" tone={color.paperDim}>
              @{post.author.username}
            </Txt>
          </View>
        </Press>
        {me && post.author.id === me.id ? (
          <View style={styles.mine}>
            <Txt variant="label" tone={color.canvas}>
              {isToday ? 'Sei tu la copertina di oggi: ti vede chiunque apra Virale.' : 'Questa copertina è tua.'}
            </Txt>
          </View>
        ) : null}
        {post.caption ? (
          <Txt variant="body" tone={color.paper} numberOfLines={3}>
            {post.caption}
          </Txt>
        ) : null}
        <Txt variant="meta" tone={color.paperDim}>
          Scelta tra {cover.totalEntries.toLocaleString('it-IT')} {cover.totalEntries === 1 ? 'provino' : 'provini'} · {formatCount(cover.totalViews)} viste in gara
        </Txt>

        <View style={styles.actions}>
          <CoverAction icon="cerchia" label={formatCount(post.likeCount)} on={post.likedByMe} tone={color.matita} onPress={() => like(!post.likedByMe)} a11y="Cerchia" />
          <CoverAction icon="commento" label="Commenta" onPress={() => router.push(`/commenti/${post.id}` as Href)} a11y="Commenti" />
          <CoverAction
            icon="salva"
            label={post.savedByMe ? 'Salvata' : 'Salva'}
            on={post.savedByMe}
            tone={color.giallo}
            onPress={save}
            a11y={post.savedByMe ? 'Togli dai salvati' : 'Salva'}
          />
          <CoverAction
            icon="condividi"
            label="Condividi"
            onPress={() => void share()}
            a11y="Condividi"
          />
          <Press style={styles.more} onPress={() => router.push(`/azioni/${post.id}` as Href)} accessibilityRole="button" accessibilityLabel="Segnala o blocca">
            <Icon name="altro" size={22} color={color.paperDim} />
          </Press>
        </View>

        {isToday ? (
          <View style={styles.band}>
            <Icon name="orologio" size={18} color={color.canvas} strokeWidth={2} />
            <Countdown onEnd={onDayEnd} revealMinutes={revealMinutes} />
            <Press onPress={() => router.push('/regole' as Href)} accessibilityRole="button">
              <Txt variant="meta" tone={color.canvas} style={styles.link}>
                Come si sceglie
              </Txt>
            </Press>
          </View>
        ) : null}
        {isToday && onSimulateMidnight ? (
          <Press onPress={onSimulateMidnight} style={{ alignSelf: 'center' }} accessibilityRole="button">
            <Txt variant="meta" tone={color.paperFaint} style={styles.link}>
              Demo: simula la mezzanotte
            </Txt>
          </Press>
        ) : null}
      </View>
    </View>
  );
}

/** Conto alla rovescia in un componente suo: aggiornarlo ogni secondo non ridisegna la copertina (e il video). */
function Countdown({ onEnd, revealMinutes }: { onEnd?: () => void; revealMinutes: number }) {
  const [left, setLeft] = useState(() => msUntilReveal(revealMinutes));
  const prev = useRef(left);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    // Se l'amministratore sposta l'orario si riparte da capo: non è un "nuovo giorno".
    const start = msUntilReveal(revealMinutes);
    prev.current = start;
    setLeft(start);
    const id = setInterval(() => {
      const next = msUntilReveal(revealMinutes);
      // Passata la rivelazione il conto risale a 24 ore: è il segnale che c'è una copertina nuova.
      if (next > prev.current + 60_000) endRef.current?.();
      prev.current = next;
      setLeft(next);
    }, 1000);
    return () => clearInterval(id);
  }, [revealMinutes]);
  return (
    <Txt variant="label" tone={color.canvas} style={{ flex: 1 }}>
      Prossima copertina tra {clock(left)}
    </Txt>
  );
}

function CoverAction({
  icon,
  label,
  on,
  tone,
  onPress,
  a11y,
}: {
  icon: 'cerchia' | 'commento' | 'salva' | 'condividi';
  label: string;
  on?: boolean;
  tone?: string;
  onPress: () => void;
  a11y: string;
}) {
  const c = on && tone ? tone : color.paper;
  // Sotto i 430 punti (quasi tutti gli iPhone non Max, molti Android) le etichette non ci stanno: resta solo il conteggio.
  const compact = useWindowDimensions().width < 430 && icon !== 'cerchia';
  return (
    <Press style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: !!on }}>
      <Icon name={icon} size={24} color={c} strokeWidth={on ? 2.4 : 1.75} filled={icon === 'salva' && on} />
      {compact ? null : (
        <Txt variant="meta" tone={on && tone ? tone : color.paperDim}>
          {label}
        </Txt>
      )}
    </Press>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', gap: space[1] },
  back: { position: 'absolute', left: space[4], width: 40, height: 40, borderRadius: 20, backgroundColor: color.scrim, alignItems: 'center', justifyContent: 'center' },
  issueRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  issue: { fontFamily: font.uiBold, color: color.paper },
  rule: { width: 18, height: 1, backgroundColor: color.paper },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space[5], paddingBottom: space[4], gap: space[2] },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  actions: { flexDirection: 'row', gap: space[5], marginTop: space[2], marginBottom: space[2] },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  more: { marginLeft: 'auto', minHeight: 36, minWidth: 32, alignItems: 'center', justifyContent: 'center' },
  mine: { alignSelf: 'flex-start', backgroundColor: color.giallo, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: color.giallo,
    borderRadius: radius.control,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  link: { fontFamily: font.uiBold, textDecorationLine: 'underline' },
});
