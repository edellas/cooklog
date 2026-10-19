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
  | 'video'
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
  | 'destra'
  | 'altro'
  | 'impostazioni'
  | 'blocca'
  | 'scudo'
  | 'posta'
  | 'documento'
  | 'campanella'
  | 'occhio'
  | 'esci'
  | 'chiave'
  | 'persone'
  | 'meno'
  | 'piu'
  | 'cerca';

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
          case 'video':
            return (
              <>
                <Rect x={3.5} y={6.5} width={12.5} height={11} rx={2.5} {...p} />
                <Path d="m16 10.5 4.5-2.5v8L16 13.5" {...p} />
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
          case 'altro':
            return (
              <>
                <Circle cx={5.5} cy={12} r={1.4} fill={color} stroke="none" />
                <Circle cx={12} cy={12} r={1.4} fill={color} stroke="none" />
                <Circle cx={18.5} cy={12} r={1.4} fill={color} stroke="none" />
              </>
            );
          case 'impostazioni':
            return (
              <>
                <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" {...p} />
                <Circle cx={15} cy={7} r={2.2} {...p} />
                <Circle cx={9} cy={17} r={2.2} {...p} />
              </>
            );
          case 'blocca':
            return (
              <>
                <Circle cx={12} cy={12} r={8.25} {...p} />
                <Path d="M6.2 6.2l11.6 11.6" {...p} />
              </>
            );
          case 'scudo':
            return <Path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z M9 12l2.2 2.2L15.5 10" {...p} />;
          case 'posta':
            return (
              <>
                <Rect x={3.5} y={5.5} width={17} height={13} rx={2.5} {...p} />
                <Path d="m4.5 7 7.5 6 7.5-6" {...p} />
              </>
            );
          case 'documento':
            return <Path d="M7 3.5h7l4 4v13H7Z M14 3.5v4h4 M9.5 12h6M9.5 15.5h6" {...p} />;
          case 'campanella':
            return <Path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5ZM10 20.5a2.2 2.2 0 0 0 4 0" {...p} />;
          case 'occhio':
            return (
              <>
                <Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" {...p} />
                <Circle cx={12} cy={12} r={2.8} {...p} />
              </>
            );
          case 'esci':
            return <Path d="M14 4.5H7.5A2 2 0 0 0 5.5 6.5v11a2 2 0 0 0 2 2H14M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" {...p} />;
          case 'chiave':
            return (
              <>
                <Circle cx={8} cy={14} r={4} {...p} />
                <Path d="M11 11l8.5-8.5M16.5 5.5l2.5 2.5M14.5 7.5l2 2" {...p} />
              </>
            );
          case 'persone':
            return (
              <>
                <Circle cx={9} cy={8.5} r={3.25} {...p} />
                <Path d="M3 19.5c.9-3.2 3.2-4.8 6-4.8s5.1 1.6 6 4.8M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.9c1.7.5 2.9 2 3.5 4.6" {...p} />
              </>
            );
          case 'cerca':
            return (
              <>
                <Circle cx={10.5} cy={10.5} r={6} {...p} />
                <Path d="m15 15 5 5" {...p} />
              </>
            );
          case 'meno':
            return <Path d="M6 12h12" {...p} />;
          case 'piu':
            return <Path d="M12 6v12M6 12h12" {...p} />;
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
