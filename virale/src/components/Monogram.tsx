import { View } from 'react-native';

import { color, font } from '../design/tokens';
import { Txt } from './Txt';

/** Inchiostri da tipografia per i monogrammi: il colore deriva dallo username, sempre lo stesso. */
const INKS = ['#FADB2C', '#F65041', '#7FB2FF', '#61DA92', '#F2A6D6', '#FF9B54', '#B9A7FF'];

export function inkFor(seed: string): string {
  let h = 7;
  for (const c of seed) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return INKS[h % INKS.length];
}

/** Avatar tipografico: iniziale in Bodoni su disco d'inchiostro. */
export function Monogram({ name, seed, size = 36, ring }: { name: string; seed: string; size?: number; ring?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: inkFor(seed),
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 0,
        borderColor: color.canvas,
      }}>
      <Txt
        style={{ fontFamily: font.display, fontSize: size * 0.5, lineHeight: size * 0.62, marginTop: size * 0.02 }}
        tone={color.canvas}>
        {name.trim().slice(0, 1).toUpperCase() || '·'}
      </Txt>
    </View>
  );
}
