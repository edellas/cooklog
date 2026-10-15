/**
 * Virale · design tokens.
 * Mondo: una rivista fotografica quotidiana. I post sono provini su un tavolo luminoso
 * d'inchiostro, la vincitrice del giorno è la copertina. Palette definita in OKLCH
 * (valori originali nei commenti) e convertita in esadecimale per React Native.
 */
export const color = {
  /** oklch(0.19 0.032 264) inchiostro: il fondo dell'app, mai nero puro. */
  canvas: '#0C1322',
  /** oklch(0.23 0.034 264) superfici in rilievo. */
  raised: '#151D2D',
  /** oklch(0.27 0.034 264) fogli e pannelli. */
  sheet: '#1E2637',
  /** oklch(0.38 0.03 264) filetti e bordi. */
  line: '#3A4253',
  /** oklch(0.965 0.008 95) carta: testo principale (16.7:1 sul fondo). */
  paper: '#F5F3EE',
  /** oklch(0.83 0.02 264) testo secondario (10.9:1). */
  paperDim: '#C1C8D5',
  /** oklch(0.69 0.026 264) testo terziario (6.7:1). */
  paperFaint: '#939CAC',
  /** oklch(0.89 0.175 98) giallo stampa: la copertina e l'azione principale. */
  giallo: '#FADB2C',
  /** oklch(0.80 0.165 88) giallo premuto. */
  gialloDeep: '#EAB600',
  /** oklch(0.66 0.205 29) matita grassa rossa: il segno con cui si "cerchia" un post. */
  matita: '#F65041',
  /** oklch(0.80 0.15 155) conferme. */
  verde: '#61DA92',
  /** Velo sulle foto per leggere il testo. */
  scrim: 'rgba(8, 12, 22, 0.55)',
} as const;

export const font = {
  /** Bodoni: il carattere italiano per eccellenza (Parma, 1798). Testata, numeri di copertina, titoli. */
  display: 'BodoniModa_700Bold',
  displayHeavy: 'BodoniModa_900Black',
  displayBook: 'BodoniModa_500Medium',
  /** Schibsted Grotesk: grottesco nato in una redazione, per tutta l'interfaccia. */
  ui: 'SchibstedGrotesk_400Regular',
  uiMedium: 'SchibstedGrotesk_500Medium',
  uiBold: 'SchibstedGrotesk_700Bold',
} as const;

/** Scala tipografica (rapporto ~1.25, con salti netti tra i ruoli). */
export const type = {
  meta: { fontFamily: font.uiMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.1 },
  small: { fontFamily: font.ui, fontSize: 14, lineHeight: 20 },
  body: { fontFamily: font.ui, fontSize: 16, lineHeight: 23 },
  label: { fontFamily: font.uiBold, fontSize: 15, lineHeight: 20 },
  title: { fontFamily: font.uiBold, fontSize: 20, lineHeight: 25, letterSpacing: -0.2 },
  heading: { fontFamily: font.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.4 },
  numeral: { fontFamily: font.display, fontSize: 44, lineHeight: 46, letterSpacing: -0.8 },
  masthead: { fontFamily: font.displayHeavy, fontSize: 72, lineHeight: 74, letterSpacing: -2 },
} as const;

/** Spaziatura su griglia di 4. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

export const radius = { frame: 22, card: 16, control: 14, pill: 999 } as const;

/** Ombre con offset e sfocatura (mai aloni colorati a offset zero). */
export const shadow = {
  lifted: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
} as const;
