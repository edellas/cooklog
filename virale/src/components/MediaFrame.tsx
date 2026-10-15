import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { resolveMedia } from '../data/demoMedia';
import { color, radius } from '../design/tokens';
import type { MediaItem } from '../types';
import { CircleMark } from './CircleMark';
import { Icon } from './Icon';
import { Txt } from './Txt';

export type VideoProgress = { completed: boolean; rewatched: boolean };

/**
 * La cornice di un post: carosello orizzontale di foto e video.
 * - I video partono solo se la cornice è attiva e l'elemento è quello visibile; tocco = audio sì/no.
 * - Doppio tocco: il segno di matita (mi piace).
 * - Misura completamento e ri-visione dei video: sono segnali della gara.
 */
export function MediaFrame({
  media,
  active,
  rounded = true,
  onDoubleTap,
  onVideoProgress,
  muted,
  onToggleMute,
  overlay,
}: {
  media: MediaItem[];
  active: boolean;
  rounded?: boolean;
  onDoubleTap?: () => void;
  onVideoProgress?: (p: VideoProgress) => void;
  muted: boolean;
  onToggleMute: () => void;
  overlay?: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [index, setIndex] = useState(0);
  const [marks, setMarks] = useState<{ id: number; x: number; y: number }[]>([]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const addMark = useCallback(
    (x: number, y: number) => {
      setMarks((m) => [...m.slice(-2), { id: Date.now(), x, y }]);
      onDoubleTap?.();
    },
    [onDoubleTap],
  );
  const toggle = useCallback(() => {
    if (media[index]?.kind === 'video') onToggleMute();
  }, [index, media, onToggleMute]);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd((e, ok) => {
      if (ok) scheduleOnRN(addMark, e.x, e.y);
    });
  const singleTap = Gesture.Tap()
    .requireExternalGestureToFail(doubleTap)
    .onEnd((_e, ok) => {
      if (ok) scheduleOnRN(toggle);
    });

  const many = media.length > 1;

  return (
    <View style={[styles.frame, rounded && styles.rounded]} onLayout={onLayout}>
      {size.w > 0 ? (
        <GestureDetector gesture={Gesture.Exclusive(doubleTap, singleTap)}>
          <View style={StyleSheet.absoluteFill}>
            <FlatList
              data={media}
              horizontal
              pagingEnabled
              bounces={false}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, i) => String(i)}
              getItemLayout={(_, i) => ({ length: size.w, offset: size.w * i, index: i })}
              onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / size.w))}
              onScroll={
                Platform.OS === 'web' ? (e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, size.w))) : undefined
              }
              scrollEventThrottle={64}
              renderItem={({ item, index: i }) => (
                <View style={{ width: size.w, height: size.h }}>
                  {item.kind === 'video' ? (
                    <VideoItem src={item.src} playing={active && i === index} muted={muted} onProgress={onVideoProgress} />
                  ) : (
                    <Image source={resolveMedia(item.src)} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
                  )}
                </View>
              )}
            />
          </View>
        </GestureDetector>
      ) : null}

      {media[index]?.kind === 'video' ? (
        <Pressable onPress={onToggleMute} style={styles.sound} hitSlop={12} accessibilityLabel={muted ? 'Attiva audio' : 'Disattiva audio'}>
          <Icon name={muted ? 'muto' : 'audio'} size={20} />
        </Pressable>
      ) : null}

      {many ? (
        <View style={styles.counter} pointerEvents="none">
          <Txt variant="meta">
            {index + 1} / {media.length}
          </Txt>
        </View>
      ) : null}

      {many ? (
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

function VideoItem({ src, playing, muted, onProgress }: { src: string; playing: boolean; muted: boolean; onProgress?: (p: VideoProgress) => void }) {
  const player = useVideoPlayer(resolveMedia(src) as never, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.25;
  });
  const progress = useRef({ maxRatio: 0, last: 0, loops: 0 });
  const bar = useSharedValue(0);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (playing) {
      progress.current = { maxRatio: 0, last: 0, loops: 0 };
      player.currentTime = 0;
      player.play();
    } else {
      player.pause();
    }
  }, [playing, player]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const d = player.duration;
    if (!d) return;
    const p = progress.current;
    // Il tempo torna indietro di colpo: il video è ripartito (loop) = ri-visione.
    if (currentTime + 0.5 < p.last) p.loops += 1;
    p.last = currentTime;
    p.maxRatio = Math.max(p.maxRatio, currentTime / d);
    // Barra di avanzamento: moto costante, lineare.
    bar.set(withTiming(currentTime / d, { duration: 250 }));
    onProgressRef.current?.({ completed: p.loops > 0 || p.maxRatio >= 0.9, rewatched: p.loops > 0 });
  });

  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: bar.get() }] }));

  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <View style={styles.track} pointerEvents="none">
        <Animated.View style={[styles.trackFill, barStyle]} />
      </View>
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
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(245,243,238,0.2)' },
  trackFill: { height: 3, width: '100%', backgroundColor: color.giallo, transformOrigin: 'left' },
});
