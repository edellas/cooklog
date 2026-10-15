import { Text, type TextProps } from 'react-native';

import { color, type as typeScale } from '../design/tokens';

export type TxtVariant = keyof typeof typeScale;

/** Testo tipografico: un ruolo della scala, mai dimensioni arbitrarie. */
export function Txt({ variant = 'body', tone = color.paper, style, ...rest }: TextProps & { variant?: TxtVariant; tone?: string }) {
  return <Text {...rest} style={[typeScale[variant], { color: tone }, style]} />;
}
