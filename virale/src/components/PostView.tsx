import { useEventListener } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import type { Post } from '../types';

export type VideoProgress = { completed: boolean; rewatched: boolean };

function gradientOf(background: string): [string, string] {
  const [a, b] = background.split(',').map((c) => c.trim());
  return [a || '#111111', b || a || '#111111'];
}

/** Un contenuto a tutto schermo: video, foto o testo. */
export function PostView({
  post,
  active,
  onVideoProgress,
  compact,
}: {
  post: Post;
  /** Miniatura (profilo, albo d'oro): testo piccolo, nessuna riproduzione. */
  compact?: boolean;
  /** Il contenuto è quello visibile: i video partono solo se attivi. */
  active: boolean;
  onVideoProgress?: (progress: VideoProgress) => void;
}) {
  if (post.mediaType === 'video' && post.mediaUrl) {
    if (compact) {
      return (
        <View style={[styles.fill, styles.textWrap]}>
          <Text style={styles.compactText}>▶︎</Text>
        </View>
      );
    }
    return <VideoPost uri={post.mediaUrl} active={active} onProgress={onVideoProgress} />;
  }
  if (post.mediaType === 'image' && post.mediaUrl) {
    return (
      <View style={styles.fill}>
        <Image source={{ uri: post.mediaUrl }} style={styles.fill} resizeMode="cover" />
      </View>
    );
  }
  const [from, to] = gradientOf(post.background);
  return (
    <LinearGradient colors={[from, to]} style={[styles.fill, compact ? styles.compactWrap : styles.textWrap]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <Text style={compact ? styles.compactText : styles.text} adjustsFontSizeToFit numberOfLines={compact ? 6 : 12}>
        {post.body}
      </Text>
    </LinearGradient>
  );
}

function VideoPost({ uri, active, onProgress }: { uri: string; active: boolean; onProgress?: (p: VideoProgress) => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    // Il web blocca l'autoplay con audio: lì parte muto.
    p.muted = Platform.OS === 'web';
    p.timeUpdateEventInterval = 0.25;
  });
  const progress = useRef({ maxRatio: 0, lastTime: 0, loops: 0 });
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    if (active) {
      progress.current = { maxRatio: 0, lastTime: 0, loops: 0 };
      player.currentTime = 0;
      player.play();
    } else {
      player.pause();
    }
  }, [active, player]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const duration = player.duration;
    if (!duration) return;
    const p = progress.current;
    // Il tempo torna indietro di colpo: il video è ripartito (loop) = ri-visione.
    if (currentTime + 0.5 < p.lastTime) p.loops += 1;
    p.lastTime = currentTime;
    p.maxRatio = Math.max(p.maxRatio, currentTime / duration);
    onProgressRef.current?.({ completed: p.loops > 0 || p.maxRatio >= 0.9, rewatched: p.loops > 0 });
  });

  return <VideoView player={player} style={styles.fill} contentFit="cover" nativeControls={false} />;
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  textWrap: { justifyContent: 'center', paddingHorizontal: 28 },
  compactWrap: { justifyContent: 'center', paddingHorizontal: 6 },
  compactText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  text: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', lineHeight: 40, textAlign: 'center' },
});
