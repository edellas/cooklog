import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { resolveMedia } from '../data/demoMedia';
import { color, radius } from '../design/tokens';
import type { MediaItem } from '../types';
import { Icon } from './Icon';

/**
 * Miniatura di un post: la prima immagine (o un fotogramma del video, qui reso dall'icona play).
 * Indica con un'icona se è un video o un carosello.
 */
export function Thumb({ media, rounded = radius.card }: { media: MediaItem[]; rounded?: number }) {
  const first = media[0];
  const stillOf = media.find((m) => m.kind === 'image');
  return (
    <View style={[styles.box, { borderRadius: rounded }]}>
      {stillOf ? (
        <Image source={resolveMedia(stillOf.src)} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} recyclingKey={stillOf.src} />
      ) : null}
      {first?.kind === 'video' ? (
        <View style={styles.badge}>
          <Icon name="play" size={14} color={color.paper} />
        </View>
      ) : media.length > 1 ? (
        <View style={styles.badge}>
          <Icon name="provini" size={14} color={color.paper} strokeWidth={2} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, overflow: 'hidden', backgroundColor: color.raised },
  badge: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: color.scrim, alignItems: 'center', justifyContent: 'center' },
});
