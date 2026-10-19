import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Masthead } from '../components/Masthead';
import { MediaFrame } from '../components/MediaFrame';
import { Avatar } from '../components/Avatar';
import { haptic, Press } from '../components/Press';
import { useToast } from '../components/Toast';
import { Txt } from '../components/Txt';
import { resolveMedia } from '../data/demoMedia';
import { atTime, formatCount, longDate, relTime, relTimeLong } from '../design/format';
import { duration, ease } from '../design/motion';
import { mediaLabel } from '../design/text';
import { color, font, radius, space } from '../design/tokens';
import { msUntil, msUntilReveal } from '../engine/engine';
import { postLink, registerShare, toggleLike, toggleSave } from '../services/api';
import { actionError } from '../services/errors';
import { shareText } from '../services/share';
import { useNav } from '../state/nav';
import { emitPostChange, onPostChange, withRecentChanges } from '../state/postEvents';
import { firstCircleHint, savedToast } from '../state/hints';
import { requestSection } from '../state/sections';
import { useActGuard } from '../state/useActGuard';
import { useSession } from '../state/session';
import { toggleMute, useMuted } from '../state/sound';
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
  // Telefono in orizzontale (o finestra bassa): testata piccola, niente didascalia né statistiche.
  const compact = useWindowDimensions().height < 600;
  const nav = useNav();
  const goBack = useGoBack('/archivio');
  const canAct = useActGuard();
  const toast = useToast();
  const reduced = useReducedMotion();
  // I tab restano montati: fuori fuoco la copertina non deve continuare a riprodurre video.
  const focused = useIsFocused();
  const muted = useMuted();
  const { me, status } = useSession();
  const revealMinutes = status?.settings.revealMinutes ?? 0;
  // Vista della copertina: dopo un secondo sullo schermo.
  useEffect(() => {
    if (!focused) return;
    const id = setTimeout(() => queueView(cover.post.id), 1000);
    return () => clearTimeout(id);
  }, [focused, cover.post.id]);
  const [post, setPost] = useState(() => withRecentChanges(cover.post));

  useEffect(() => setPost(withRecentChanges(cover.post)), [cover.post]);
  // Lo stesso post può essere anche nel feed: mi piace e salvataggi restano allineati.
  useEffect(() => onPostChange(cover.post.id, ({ commented: _c, ...patch }) => setPost((p) => ({ ...p, ...patch }))), [cover.post.id]);

  // Sviluppo: uno strato sfocato statico che svanisce (si anima l'opacità, mai il raggio di sfocatura).
  const blur = useSharedValue(reveal ? 1 : 0);
  const zoom = useSharedValue(reveal && !reduced ? 1.04 : 1);
  // Finito lo sviluppo lo strato sfocato si toglie (non resta sopra la foto, invisibile).
  const [developing, setDeveloping] = useState(reveal);
  useEffect(() => {
    if (!reveal) return;
    blur.set(withTiming(0, { duration: duration.develop, easing: ease.out }));
    zoom.set(withTiming(1, { duration: duration.develop, easing: ease.out }));
    const id = setTimeout(() => setDeveloping(false), duration.develop + 100);
    return () => clearTimeout(id);
  }, [blur, reveal, zoom]);
  const blurStyle = useAnimatedStyle(() => ({ opacity: blur.get() }));
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.get() }] }));

  const first = post.media[0];
  const like = (on: boolean) => {
    if (post.likedByMe === on) return;
    if (on && !canAct()) return;
    haptic('light');
    const likeCount = Math.max(0, post.likeCount + (on ? 1 : -1));
    setPost((p) => ({ ...p, likedByMe: on, likeCount }));
    emitPostChange(post.id, { likedByMe: on, likeCount });
    if (on) firstCircleHint(me?.id, toast);
    toggleLike(post.id, on).catch((e: unknown) => {
      setPost((p) => ({ ...p, likedByMe: !on, likeCount: post.likeCount }));
      emitPostChange(post.id, { likedByMe: !on, likeCount: post.likeCount });
      toast(actionError(e, 'Cerchio non salvato. Riprova.'), 'error');
    });
  };
  const save = () => {
    const on = !post.savedByMe;
    if (on && !canAct()) return;
    const saveCount = Math.max(0, post.saveCount + (on ? 1 : -1));
    setPost((p) => ({ ...p, savedByMe: on, saveCount }));
    emitPostChange(post.id, { savedByMe: on, saveCount });
    if (on) savedToast(toast, nav.push);
    toggleSave(post.id, on).catch((e: unknown) => {
      setPost((p) => ({ ...p, savedByMe: !on, saveCount: post.saveCount }));
      emitPostChange(post.id, { savedByMe: !on, saveCount: post.saveCount });
      toast(actionError(e, 'Salvataggio non riuscito. Riprova.'), 'error');
    });
  };
  const share = async () => {
    if (!canAct()) return;
    const text = isToday ? `La copertina di Virale di oggi: @${post.author.username}` : `La copertina di Virale del ${longDate(cover.featuredOn)}: @${post.author.username}`;
    const link = postLink(post.id);
    const res = await shareText(link ? `${text}\n${link}` : text);
    if (res === 'none') return;
    if (res === 'copied') toast(link ? 'Link copiato: incollalo dove vuoi.' : 'Testo copiato: incollalo dove vuoi.');
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
          onToggleMute={toggleMute}
          onDoubleTap={() => like(true)}
          onLongPress={() => nav.push(`/azioni/${post.id}`)}
          controlsTop={insets.top + (compact ? 84 : 132)}
          dots={false}
          label={mediaLabel(post.author.username, post.caption)}
        />
      </Animated.View>
      {reveal && developing && first?.kind === 'image' ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
        <Masthead size={compact ? 48 : 76} reveal={reveal} />
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
          onPress={() => nav.push(`/utente/${post.author.username}`)}
          accessibilityRole="link"
          accessibilityLabel={`Profilo di ${post.author.displayName}, @${post.author.username}`}>
          <Avatar name={post.author.displayName} seed={post.author.username} uri={post.author.avatar} size={44} />
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
              {isToday ? 'Hai vinto! Sei la copertina di oggi: ti vede chiunque apra Virale.' : 'Questa copertina è tua.'}
            </Txt>
          </View>
        ) : null}
        {/* In orizzontale (schermo basso) didascalia e statistiche lasciano spazio a foto e pulsanti. */}
        {post.caption && !compact ? (
          <Txt variant="body" tone={color.paper} numberOfLines={3}>
            {post.caption}
          </Txt>
        ) : null}
        {compact ? null : (
          <Txt variant="meta" tone={color.paperDim}>
            {`Scelta tra ${cover.totalEntries.toLocaleString('it-IT')} ${cover.totalEntries === 1 ? 'provino' : 'provini'} · ${formatCount(cover.totalViews)} ${cover.totalViews === 1 ? 'visualizzazione' : 'visualizzazioni'} in gara`}
          </Txt>
        )}

        <View style={styles.actions}>
          <CoverAction
            icon="cerchia"
            label={formatCount(post.likeCount)}
            on={post.likedByMe}
            tone={color.matita}
            onPress={() => like(!post.likedByMe)}
            a11y={post.likedByMe ? 'Togli il cerchio' : 'Cerchia'}
          />
          <CoverAction icon="commento" label="Commenta" onPress={() => nav.push(`/commenti/${post.id}`)} a11y="Commenti" />
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
          <Press style={styles.more} onPress={() => nav.push(`/azioni/${post.id}`)} accessibilityRole="button" accessibilityLabel="Segnala o blocca">
            <Icon name="altro" size={22} color={color.paperDim} />
          </Press>
        </View>

        {isToday ? (
          <>
            {/* L'invito principale è guardare i provini di oggi: il conto alla rovescia passa sotto, piccolo. */}
            <Press
              style={[styles.cta, compact && styles.ctaCompact]}
              onPress={() => {
                requestSection('gara');
                nav.navigate('/provini');
              }}
              accessibilityRole="button">
              <Txt variant="label" tone={color.canvas}>
                Guarda i provini di oggi
              </Txt>
            </Press>
            {/* Una riga sola anche a 375 punti: testo piccolo, e se proprio non ci sta si accorcia il tempo. */}
            <View style={styles.timeRow}>
              <Countdown onEnd={onDayEnd} revealMinutes={revealMinutes} closesAt={status?.settings.closesAt} />
              <Txt variant="meta" tone={color.paperDim} style={styles.small}>
                ·
              </Txt>
              <Press style={styles.rules} onPress={() => nav.push('/regole')} accessibilityRole="link" hitSlop={4}>
                <Txt variant="meta" tone={color.paper} style={[styles.link, styles.small]} numberOfLines={1}>
                  Come si sceglie
                </Txt>
              </Press>
            </View>
          </>
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

/**
 * Quanto manca alla nuova copertina, a parole ("tra 14 h 27 min"), in un componente suo: il controllo gira
 * ogni secondo (per accorgersi subito della fine della gara) ma il testo cambia solo quando cambia il minuto,
 * così la copertina (e il video) non si ridisegnano.
 */
function Countdown({ onEnd, revealMinutes, closesAt }: { onEnd?: () => void; revealMinutes: number; closesAt?: string }) {
  const [left, setLeft] = useState(() => msUntil(closesAt, msUntilReveal(revealMinutes)));
  const prev = useRef(left);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    // Se l'amministratore sposta l'orario si riparte da capo: non è un "nuovo giorno".
    const start = msUntil(closesAt, msUntilReveal(revealMinutes));
    prev.current = start;
    setLeft(start);
    const id = setInterval(() => {
      const next = msUntil(closesAt, msUntilReveal(revealMinutes));
      // Arrivati a zero la gara è finita: la copertina nuova esce entro un minuto.
      if (next === 0 && prev.current > 0) endRef.current?.();
      // Passata la rivelazione il conto risale a 24 ore: è il segnale che c'è una copertina nuova.
      if (next > prev.current + 60_000) endRef.current?.();
      prev.current = next;
      setLeft((cur) => (relTime(cur) === relTime(next) ? cur : next));
    }, 1000);
    return () => clearInterval(id);
  }, [revealMinutes, closesAt]);
  return (
    <Txt
      variant="meta"
      tone={color.paperDim}
      numberOfLines={1}
      style={[styles.small, { flexShrink: 1 }]}
      accessibilityLabel={`Nuova copertina ${atTime(revealMinutes)}, tra ${relTimeLong(left)}`}>
      {`Nuova copertina ${atTime(revealMinutes)} · tra ${relTime(left)}`}
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
  cta: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  ctaCompact: { paddingVertical: 8, minHeight: 44 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  small: { fontSize: 11, lineHeight: 15, letterSpacing: 0 },
  rules: { minHeight: 44, justifyContent: 'center' },
  link: { fontFamily: font.uiBold, textDecorationLine: 'underline' },
});
