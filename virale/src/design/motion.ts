import { Easing } from 'react-native-reanimated';

/**
 * Motion secondo le regole di Emil Kowalski (animate-expo):
 * curve personalizzate, mai ease-in sulla UI, animazioni d'interfaccia sotto i 300 ms,
 * molle quando c'è di mezzo un dito, riduzione del movimento rispettata ovunque.
 */
export const ease = {
  /** Entrate, uscite, feedback. */
  out: Easing.bezier(0.23, 1, 0.32, 1),
  /** Movimenti sullo schermo. */
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  /** Pannelli (curva dei fogli iOS). */
  sheet: Easing.bezier(0.32, 0.72, 0, 1),
} as const;

export const duration = {
  press: 120,
  toggle: 180,
  toast: 240,
  toastOut: 180,
  /** Il segno di matita: momento raro, può durare di più. */
  mark: 420,
  /** La copertina che "si sviluppa" alla prima apertura del giorno: momento raro. */
  develop: 900,
} as const;

export const spring = {
  settle: { duration: 400, dampingRatio: 1 },
  snapBack: { duration: 400, dampingRatio: 0.8 },
  sheet: { duration: 300, dampingRatio: 0.8 },
} as const;

/** Scala alla pressione: tra 0.95 e 0.98. */
export const PRESS_SCALE = 0.97;
