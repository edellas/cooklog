import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { resolveMedia } from '../data/demoMedia';
import { color, radius } from '../design/tokens';
import type { MediaItem } from '../types';
import { CircleMark } from './CircleMark';
import { Icon } from './Icon';
import { haptic, Press } from './Press';
import { Txt } from './Txt';
import { initialProgress, nextProgress } from './videoProgress';

export type VideoProgress = { completed: boolean; rewatched: boolean };

/** Il video sullo schermo, per la barra trascinabile (che sta fuori dal carosello). */
type Seeker = { player: ReturnType<typeof useVideoPlayer>; seek: (fraction: number) => void };

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * La cornice di un post: carosello orizzontale di foto e video.
 * - I video partono solo se la cornice è attiva e l'elemento è quello visibile. Come su TikTok: un tocco
 *   mette in pausa (e riprende), il pulsante in alto accende e spegne l'audio, la barra in basso si trascina.
 * - Doppio tocco: il segno di matita (mi piace). Pressione lunga: le opzioni del post.
 * - Misura completamento e ri-visione dei video: sono segnali della gara.
 * - `viewKey`: quando cambia, il video riparte da capo (una nuova vista); tornando sulla stessa vista riprende da dove era.
 * - `index` e `onIndexChange` permettono di guidare il carosello da fuori (per esempio dalle miniature).
 */
export function MediaFrame({
  media,
  active,
  rounded = true,
  onDoubleTap,
  onLongPress,
  onVideoProgress,
  muted,
  onToggleMute,
  overlay,
  viewKey = 0,
  index: controlled,
  onIndexChange,
  controlsTop = 12,
  dots = true,
  label,
}: {
  media: MediaItem[];
  active: boolean;
  viewKey?: number;
  index?: number;
  onIndexChange?: (i: number) => void;
  /** Distanza dall'alto dei controlli (audio, contatore): sulle copertine a tutto schermo va sotto la barra di stato. */
  controlsTop?: number;
  /** I pallini sotto il carosello (sulla copertina basta il contatore "1 / 2"). */
  dots?: boolean;
  /** Per chi usa lo screen reader: "di @autore: inizio della didascalia" (diventa "Foto 2 di 3 di @autore: …"). */
  label?: string;
  rounded?: boolean;
  onDoubleTap?: () => void;
  onLongPress?: () => void;
  onVideoProgress?: (p: VideoProgress) => void;
  muted: boolean;
  onToggleMute: () => void;
  overlay?: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [index, setIndexState] = useState(0);
  const [marks, setMarks] = useState<{ id: number; x: number; y: number }[]>([]);
  const list = useRef<FlatList<MediaItem>>(null);
  /**
   * Scorrimento comandato da fuori (una miniatura toccata): finché non arriva a destinazione,
   * gli eventi di scroll intermedi non cambiano l'indice.
   */
  const steeringTo = useRef<number | null>(null);
  const lastLength = useRef(media.length);
  const offset = useRef(0);
  const lastWidth = useRef(0);
  /** Messo in pausa con un tocco. Scorrendo via (o a una nuova vista) riparte da solo. */
  const [paused, setPaused] = useState(false);
  useEffect(() => setPaused(false), [active, viewKey, index]);
  /** Barra del video sullo schermo: la muove il video, o il dito mentre la trascina. */
  const bar = useSharedValue(0);
  const dragging = useSharedValue(false);
  const seeker = useRef<Seeker | null>(null);
  const [scrub, setScrub] = useState<{ at: number; duration: number } | null>(null);
  const [buffering, setBuffering] = useState(false);
  /** Elementi che non si sono caricati (per indice) e tentativi: "Riprova" rimonta l'elemento. */
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const [attempts, setAttempts] = useState<Record<number, number>>({});
  const markFailed = useCallback((i: number, on: boolean) => setFailed((f) => (Boolean(f[i]) === on ? f : { ...f, [i]: on })), []);
  const retry = useCallback((i: number) => {
    setFailed((f) => ({ ...f, [i]: false }));
    setAttempts((a) => ({ ...a, [i]: (a[i] ?? 0) + 1 }));
  }, []);
  const bufferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // La rotellina compare solo se il caricamento dura: un attimo di attesa non deve far lampeggiare nulla.
  const onBuffering = useCallback((on: boolean) => {
    if (bufferTimer.current) clearTimeout(bufferTimer.current);
    bufferTimer.current = null;
    if (on) bufferTimer.current = setTimeout(() => setBuffering(true), 400);
    else setBuffering(false);
  }, []);
  useEffect(() => () => {
    if (bufferTimer.current) clearTimeout(bufferTimer.current);
  }, []);

  const setIndex = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(media.length - 1, i));
      setIndexState(clamped);
      onIndexChange?.(clamped);
    },
    [media.length, onIndexChange],
  );

  // Indice guidato da fuori, e sempre dentro i limiti quando gli elementi cambiano (tolti o spostati).
  useEffect(() => {
    const target = Math.max(0, Math.min(media.length - 1, controlled ?? index));
    const lengthChanged = lastLength.current !== media.length || lastWidth.current !== size.w;
    lastLength.current = media.length;
    lastWidth.current = size.w;
    // Se l'indice è già quello mostrato (l'ha scelto l'utente scorrendo) non si tocca lo scroll.
    if (target === index && !lengthChanged) return;
    if (target !== index) setIndexState(target);
    if (size.w > 0 && media.length) {
      const to = target * size.w;
      // Già lì: nessun evento di scroll arriverà, quindi niente da aspettare.
      if (Math.abs(offset.current - to) >= 1) {
        steeringTo.current = to;
        // Rete di sicurezza: se l'animazione viene interrotta, dopo poco si torna a seguire il dito.
        setTimeout(() => {
          if (steeringTo.current === to) steeringTo.current = null;
        }, 900);
      }
      list.current?.scrollToOffset({ offset: target * size.w, animated: controlled !== undefined && !lengthChanged });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled, media.length, size.w]);

  const onScrollAt = (x: number, settled: boolean) => {
    offset.current = x;
    if (steeringTo.current !== null) {
      if (Math.abs(x - steeringTo.current) < 1 || settled) steeringTo.current = null;
      else return;
    }
    setIndex(Math.round(x / Math.max(1, size.w)));
  };

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const addMark = useCallback(
    (x: number, y: number) => {
      setMarks((m) => [...m.slice(-2), { id: Date.now(), x, y }]);
      onDoubleTap?.();
    },
    [onDoubleTap],
  );
  const toggle = useCallback(() => {
    if (media[index]?.kind === 'video') setPaused((p) => !p);
  }, [index, media]);
  const longPress = useCallback(() => {
    if (!onLongPress) return;
    haptic('medium');
    onLongPress();
  }, [onLongPress]);

  // Un tocco che si sposta (uno scorrimento) non è un tocco: niente pausa o cerchio per sbaglio.
  const gesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(260)
      .maxDistance(10)
      .onEnd((e, ok) => {
        if (ok) scheduleOnRN(addMark, e.x, e.y);
      });
    const singleTap = Gesture.Tap()
      .maxDistance(10)
      .requireExternalGestureToFail(doubleTap)
      .onEnd((_e, ok) => {
        if (ok) scheduleOnRN(toggle);
      });
    const hold = Gesture.LongPress()
      .minDuration(450)
      .maxDistance(10)
      .onStart(() => {
        scheduleOnRN(longPress);
      });
    // Chi arriva prima vince: tenendo premuto non parte anche il tocco.
    return Gesture.Race(hold, Gesture.Exclusive(doubleTap, singleTap));
  }, [addMark, longPress, toggle]);

  const commitSeek = useCallback((f: number) => {
    seeker.current?.seek(f);
    setScrub(null);
  }, []);
  const showScrub = useCallback((f: number) => {
    const d = seeker.current?.player.duration ?? 0;
    setScrub(d ? { at: f * d, duration: d } : null);
  }, []);
  // Barra trascinabile: solo in orizzontale, così scorrere il feed in verticale non la tocca.
  const w = size.w;
  const seekGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .failOffsetY([-14, 14])
        .hitSlop({ top: 12 })
        .onStart((e) => {
          dragging.set(true);
          const f = Math.min(1, Math.max(0, e.x / Math.max(1, w)));
          bar.set(f);
          scheduleOnRN(showScrub, f);
        })
        .onUpdate((e) => {
          const f = Math.min(1, Math.max(0, e.x / Math.max(1, w)));
          bar.set(f);
          scheduleOnRN(showScrub, f);
        })
        .onEnd(() => {
          scheduleOnRN(commitSeek, bar.get());
        })
        .onFinalize(() => {
          dragging.set(false);
        }),
    [bar, commitSeek, dragging, showScrub, w],
  );
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: bar.get() }] }));
  const trackStyle = useAnimatedStyle(() => ({ height: dragging.get() ? 6 : 3 }));

  const many = media.length > 1;

  return (
    <View style={[styles.frame, rounded && styles.rounded]} onLayout={onLayout}>
      {size.w > 0 ? (
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill}>
            <FlatList
              ref={list}
              data={media}
              horizontal
              pagingEnabled
              bounces={false}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, i) => String(i)}
              onScrollEndDrag={Platform.OS !== 'web' ? (e) => (offset.current = e.nativeEvent.contentOffset.x) : undefined}
              getItemLayout={(_, i) => ({ length: size.w, offset: size.w * i, index: i })}
              onMomentumScrollEnd={(e) => onScrollAt(e.nativeEvent.contentOffset.x, true)}
              onScroll={Platform.OS === 'web' ? (e) => onScrollAt(e.nativeEvent.contentOffset.x, false) : undefined}
              scrollEventThrottle={64}
              initialNumToRender={1}
              maxToRenderPerBatch={1}
              windowSize={3}
              renderItem={({ item, index: i }) => (
                <View
                  style={{ width: size.w, height: size.h }}
                  accessible={Boolean(label)}
                  accessibilityRole={label ? 'image' : undefined}
                  accessibilityLabel={label ? `${item.kind === 'video' ? 'Video' : 'Foto'} ${many ? `${i + 1} di ${media.length} ` : ''}${label}` : undefined}>
                  {item.kind === 'video' ? (
                    // Un lettore video solo per l'elemento visibile e i vicini: i decoder del telefono sono pochi.
                    Math.abs(i - index) <= 1 ? (
                      <VideoItem
                        src={item.src}
                        attempt={attempts[i] ?? 0}
                        onFailed={(on) => markFailed(i, on)}
                        poster={item.poster}
                        fit={fitFor(item, size)}
                        playing={active && i === index && !paused}
                        current={i === index}
                        muted={muted}
                        viewKey={viewKey}
                        onProgress={onVideoProgress}
                        bar={bar}
                        dragging={dragging}
                        seeker={seeker}
                        onBuffering={onBuffering}
                      />
                    ) : item.poster ? (
                      <Image source={{ uri: item.poster }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : null
                  ) : fitFor(item, size) === 'contain' ? (
                    // Foto molto più larga (o più alta) della cornice: intera, su uno sfondo sfocato di sé stessa.
                    <View key={attempts[i] ?? 0} style={StyleSheet.absoluteFill}>
                      <Image source={resolveMedia(item.src)} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} />
                      <Image
                        source={resolveMedia(item.src)}
                        style={StyleSheet.absoluteFill}
                        contentFit="contain"
                        transition={120}
                        onError={() => markFailed(i, true)}
                        onLoad={() => markFailed(i, false)}
                      />
                    </View>
                  ) : (
                    <Image
                      key={attempts[i] ?? 0}
                      source={resolveMedia(item.src)}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={120}
                      onError={() => markFailed(i, true)}
                      onLoad={() => markFailed(i, false)}
                    />
                  )}
                </View>
              )}
            />
          </View>
        </GestureDetector>
      ) : null}

      {failed[index] ? (
        // Non si è caricato: lo si dice, con "Riprova" (fuori dai gesti del carosello: il tocco non mette in pausa).
        <View style={styles.center} pointerEvents="box-none">
          <View style={styles.failBox}>
            <Icon name="info" size={26} color={color.paper} />
            <Txt variant="label">Non si carica.</Txt>
            <Press style={styles.retry} onPress={() => retry(index)} accessibilityRole="button" accessibilityLabel="Riprova a caricare">
              <Txt variant="label" tone={color.canvas}>
                Riprova
              </Txt>
            </Press>
          </View>
        </View>
      ) : media[index]?.kind === 'video' && paused ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.playBadge}>
            <Icon name="play" size={34} color={color.paper} />
          </View>
        </View>
      ) : media[index]?.kind === 'video' && buffering && active ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={color.paper} size="large" />
        </View>
      ) : null}

      {media[index]?.kind === 'video' && scrub ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.scrubLabel}>
            <Txt variant="label">
              {mmss(scrub.at)} / {mmss(scrub.duration)}
            </Txt>
          </View>
        </View>
      ) : null}

      {media[index]?.kind === 'video' ? (
        <GestureDetector gesture={seekGesture}>
          <View style={styles.seekZone} accessible={false}>
            <Animated.View style={[styles.track, trackStyle]}>
              <Animated.View style={[styles.trackFill, barStyle]} />
            </Animated.View>
          </View>
        </GestureDetector>
      ) : null}

      {media[index]?.kind === 'video' ? (
        <Pressable onPress={onToggleMute} style={[styles.sound, { top: controlsTop }]} hitSlop={12} accessibilityRole="button" accessibilityLabel={muted ? 'Attiva audio' : 'Disattiva audio'}>
          <Icon name={muted ? 'muto' : 'audio'} size={20} />
        </Pressable>
      ) : null}

      {many ? (
        <View style={[styles.counter, { top: controlsTop }]} pointerEvents="none">
          <Txt variant="meta">{`${index + 1} / ${media.length}`}</Txt>
        </View>
      ) : null}

      {many && dots ? (
        <View style={styles.dots} pointerEvents="none">
          {media.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}

      {overlay}

      {marks.map((m) => (
        <CircleMark key={m.id} x={m.x} y={m.y} onDone={() => setMarks((all) => all.filter((x) => x.id !== m.id))} />
      ))}
    </View>
  );
}

/**
 * Come riempire la cornice: "cover" se le proporzioni sono simili (si taglia poco), altrimenti "contain"
 * (una foto orizzontale in una cornice verticale perderebbe metà dell'immagine).
 */
function fitFor(item: MediaItem, size: { w: number; h: number }): 'cover' | 'contain' {
  if (!item.width || !item.height || !size.w || !size.h) return 'cover';
  const ratio = item.width / item.height / (size.w / size.h);
  return ratio > 1.25 || ratio < 0.8 ? 'contain' : 'cover';
}

function VideoItem({
  src,
  attempt,
  onFailed,
  poster,
  fit,
  playing,
  current,
  muted,
  viewKey,
  onProgress,
  bar,
  dragging,
  seeker,
  onBuffering,
}: {
  src: string;
  /** Cresce a ogni "Riprova": il video si ricarica. */
  attempt: number;
  onFailed: (on: boolean) => void;
  poster?: string;
  fit: 'cover' | 'contain';
  playing: boolean;
  /** È l'elemento del carosello sullo schermo: comanda la barra e la rotellina. */
  current: boolean;
  muted: boolean;
  viewKey: number;
  onProgress?: (p: VideoProgress) => void;
  bar: SharedValue<number>;
  dragging: SharedValue<boolean>;
  seeker: React.RefObject<Seeker | null>;
  onBuffering: (on: boolean) => void;
}) {
  const [firstFrame, setFirstFrame] = useState(false);
  const player = useVideoPlayer(resolveMedia(src) as never, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.25;
  });
  const progress = useRef(initialProgress());
  /** Ultimo spostamento a mano (o ripartenza da capo): per 600 ms gli aggiornamenti non contano. */
  const seekedAt = useRef<number | null>(null);
  const onProgressRef = useRef(onProgress);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  // "Riprova": si ricarica la stessa sorgente.
  const firstAttempt = useRef(attempt);
  useEffect(() => {
    if (attempt === firstAttempt.current) return;
    firstAttempt.current = attempt;
    setFirstFrame(false);
    try {
      player.replace(resolveMedia(src) as never);
    } catch {
      onFailedRef.current(true);
    }
  }, [attempt, player, src]);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Riparte da zero solo per una nuova vista; chiudendo i commenti o tornando sul tab riprende da dove era.
  const playedKey = useRef<number | null>(null);
  useEffect(() => {
    if (playing) {
      if (playedKey.current !== viewKey) {
        playedKey.current = viewKey;
        progress.current = initialProgress();
        seekedAt.current = Date.now();
        player.currentTime = 0;
      }
      player.play();
    } else {
      player.pause();
    }
  }, [playing, player, viewKey]);

  // Il video sullo schermo si fa comandare dalla barra; uno spostamento a mano non conta come ri-visione.
  useEffect(() => {
    if (!current) return;
    const mine: Seeker = {
      player,
      seek: (f) => {
        if (!player.duration) return;
        seekedAt.current = Date.now();
        player.currentTime = f * player.duration;
      },
    };
    seeker.current = mine;
    bar.set(player.duration ? player.currentTime / player.duration : 0);
    onBuffering(player.status === 'loading');
    return () => {
      if (seeker.current === mine) seeker.current = null;
      onBuffering(false);
    };
  }, [bar, current, onBuffering, player, seeker]);

  useEventListener(player, 'statusChange', ({ status }) => {
    if (current) onBuffering(status === 'loading');
    if (status === 'error') onFailedRef.current(true);
    else if (status === 'readyToPlay') onFailedRef.current(false);
  });

  // Quanto è stato guardato davvero (videoProgress.ts): trascinare la barra non completa il video.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const d = player.duration;
    if (!d) return;
    const p = nextProgress(progress.current, { time: currentTime, duration: d, seekedAt: seekedAt.current, now: Date.now() });
    progress.current = p;
    // Barra di avanzamento: moto costante, lineare (ferma mentre la si trascina).
    if (current && !dragging.get()) bar.set(withTiming(currentTime / d, { duration: 250 }));
    onProgressRef.current?.({ completed: p.completed, rewatched: p.rewatched });
  });

  return (
    <>
      {poster && fit === 'contain' ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} /> : null}
      <VideoView
        player={player}
        // Sul web il <video> non si allarga con top/bottom 0 (resta alto 150 px): servono le misure esplicite.
        style={styles.video}
        contentFit={fit}
        nativeControls={false}
        // Android: "textureView" rispetta gli angoli arrotondati e non lampeggia scorrendo il feed.
        surfaceType="textureView"
        onFirstFrameRender={() => setFirstFrame(true)}
      />
      {/* Finché il primo fotogramma non c'è, si vede l'anteprima invece di un rettangolo scuro. */}
      {poster && !firstFrame ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit={fit} pointerEvents="none" /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: color.raised, overflow: 'hidden' },
  rounded: { borderRadius: radius.frame },
  sound: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: color.scrim,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(245,243,238,0.45)' },
  dotOn: { backgroundColor: color.paper, width: 16 },
  video: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.scrim, alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  scrubLabel: { backgroundColor: color.scrim, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  failBox: { alignItems: 'center', gap: 10, backgroundColor: color.scrim, borderRadius: radius.card, paddingHorizontal: 22, paddingVertical: 18 },
  retry: { backgroundColor: color.giallo, borderRadius: radius.pill, paddingHorizontal: 20, minHeight: 44, justifyContent: 'center' },
  // Zona di presa alta 24 punti per una barra sottile: si prende col pollice senza mirare.
  seekZone: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 24, justifyContent: 'flex-end' },
  track: { height: 3, backgroundColor: 'rgba(245,243,238,0.2)', overflow: 'hidden' },
  trackFill: { height: '100%', width: '100%', backgroundColor: color.giallo, transformOrigin: 'left' },
});
