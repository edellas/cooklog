import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { color as palette } from '../design/tokens';

/**
 * Set di icone disegnato per Virale: griglia 24, tratto 1.75, terminazioni tonde.
 * Nessuna emoji, nessun glifo unicode.
 */
export type IconName =
  | 'copertina'
  | 'provini'
  | 'scatta'
  | 'archivio'
  | 'profilo'
  | 'cerchia'
  | 'commento'
  | 'salva'
  | 'condividi'
  | 'chiudi'
  | 'indietro'
  | 'audio'
  | 'muto'
  | 'fotocamera'
  | 'galleria'
  | 'check'
  | 'segnala'
  | 'invia'
  | 'cestino'
  | 'play'
  | 'segui'
  | 'orologio'
  | 'info'
  | 'sinistra'
  | 'destra';

export function Icon({
  name,
  size = 24,
  color = palette.paper,
  strokeWidth = 1.75,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Variante piena (salvato, play). */
  filled?: boolean;
}) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const fill = filled ? color : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {(() => {
        switch (name) {
          case 'copertina':
            return (
              <>
                <Rect x={4.5} y={3} width={15} height={18} rx={2} {...p} />
                <Path d="M4.5 8.5h15M8 13h5M8 16.5h8" {...p} />
              </>
            );
          case 'provini':
            return (
              <>
                <Rect x={3.5} y={3.5} width={7.5} height={7.5} rx={1.5} {...p} />
                <Rect x={13} y={3.5} width={7.5} height={7.5} rx={1.5} {...p} />
                <Rect x={3.5} y={13} width={7.5} height={7.5} rx={1.5} {...p} />
                <Rect x={13} y={13} width={7.5} height={7.5} rx={1.5} {...p} />
              </>
            );
          case 'scatta':
            return <Path d="M12 5v14M5 12h14" {...p} />;
          case 'archivio':
            return (
              <>
                <Rect x={5} y={7} width={14} height={14} rx={2} {...p} />
                <Path d="M7.5 4h9M8.5 11.5h7" {...p} />
              </>
            );
          case 'profilo':
            return (
              <>
                <Circle cx={12} cy={8.5} r={3.75} {...p} />
                <Path d="M4.75 20c1.3-3.7 4.1-5.6 7.25-5.6s5.95 1.9 7.25 5.6" {...p} />
              </>
            );
          case 'cerchia':
            // Un ovale tracciato a mano con la matita grassa: i due capi si sovrappongono.
            return (
              <Path
                d="M16.9 5.6c-1.9-1.3-4.5-1.7-7-1.1C5.7 5.5 3.1 9.3 4 13.1c.9 3.9 5.2 6.1 9.5 5.1 4.3-1 7-4.9 6.1-8.7-.5-2-1.8-3.6-3.6-4.6-1.1-.6-2.3-.9-3.6-1"
                {...p}
              />
            );
          case 'commento':
            return <Path d="M5 7a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7v6.5a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V16H7.5A2.5 2.5 0 0 1 5 13.5Z" {...p} />;
          case 'salva':
            return <Path d="M7 4.5h10v15.5l-5-3.6-5 3.6Z" {...p} fill={fill} />;
          case 'condividi':
            return <Path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" {...p} />;
          case 'chiudi':
            return <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...p} />;
          case 'indietro':
            return <Path d="M14.5 5.5 8 12l6.5 6.5" {...p} />;
          case 'sinistra':
            return <Path d="M14 7l-5 5 5 5" {...p} />;
          case 'destra':
            return <Path d="M10 7l5 5-5 5" {...p} />;
          case 'audio':
            return <Path d="M4.5 9.5v5h3.5l5 4v-13l-5 4ZM16.5 9a4.2 4.2 0 0 1 0 6M19 6.5a7.8 7.8 0 0 1 0 11" {...p} />;
          case 'muto':
            return <Path d="M4.5 9.5v5h3.5l5 4v-13l-5 4ZM16.5 9.5l5 5M21.5 9.5l-5 5" {...p} />;
          case 'fotocamera':
            return (
              <>
                <Path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" {...p} />
                <Circle cx={12} cy={12.5} r={3.5} {...p} />
              </>
            );
          case 'galleria':
            return (
              <>
                <Rect x={4} y={4} width={16} height={16} rx={2.5} {...p} />
                <Circle cx={9} cy={9.5} r={1.6} {...p} />
                <Path d="M20 15.5 15.5 11 6.5 20" {...p} />
              </>
            );
          case 'check':
            return <Path d="M5 12.5 9.5 17 19 7.5" {...p} />;
          case 'segnala':
            return <Path d="M6 21V4M6 4.5h11l-2.2 4L17 12.5H6" {...p} />;
          case 'invia':
            return <Path d="M12 19V5.5M6.5 11 12 5.5 17.5 11" {...p} />;
          case 'cestino':
            return <Path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" {...p} />;
          case 'play':
            return <Path d="M8 5.5v13l10.5-6.5Z" {...p} fill={color} />;
          case 'segui':
            return (
              <>
                <Circle cx={10} cy={8.5} r={3.5} {...p} />
                <Path d="M3.5 20c1.1-3.4 3.6-5.2 6.5-5.2 1.3 0 2.5.4 3.5 1M18 13.5v6M15 16.5h6" {...p} />
              </>
            );
          case 'orologio':
            return (
              <>
                <Circle cx={12} cy={12} r={8} {...p} />
                <Path d="M12 8v4.2l2.8 1.8" {...p} />
              </>
            );
          case 'info':
            return (
              <>
                <Circle cx={12} cy={12} r={8.5} {...p} />
                <Path d="M12 11v5.5M12 7.8v.2" {...p} />
              </>
            );
        }
      })()}
    </Svg>
  );
}
