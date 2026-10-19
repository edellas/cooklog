import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { resolveMedia } from '../data/demoMedia';
import { color, radius } from '../design/tokens';
import type { MediaItem } from '../types';
import { Icon } from './Icon';

/**
 * Miniatura di un post: la prima immagine, o l'anteprima del video quando c'è.
 * Indica con un'icona se è un video o un carosello.
 */
export function Thumb({ media, rounded = radius.card }: { media: MediaItem[]; rounded?: number }) {
  const first = media[0];
  // La prima foto, oppure l'anteprima del primo video (i video pubblicati ne hanno una).
  const image = media.find((m) => m.kind === 'image');
  const poster = media.find((m) => m.poster)?.poster;
  const still = image ? resolveMedia(image.src) : poster ? { uri: poster } : null;
  return (
    <View style={[styles.box, { borderRadius: rounded }]}>
      {still ? <Image source={still} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} recyclingKey={JSON.stringify(still)} /> : null}
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
