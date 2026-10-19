import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { color } from '../design/tokens';
import { Monogram } from './Monogram';

/**
 * La foto profilo; se non c'è (o non si carica) il monogramma, l'iniziale su disco d'inchiostro.
 * Le foto restano in cache anche su disco: le stesse facce tornano in ogni feed.
 */
export function Avatar({ name, seed, uri, size = 36, ring }: { name: string; seed: string; uri?: string | null; size?: number; ring?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  if (!uri || failed) return <Monogram name={name} seed={seed} size={size} ring={ring} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: color.raised, borderWidth: ring ? 2 : 0, borderColor: color.canvas }}>
      <Image
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={120}
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
      />
    </View>
  );
}
