/**
 * Richiesta di aprire i Provini su una sezione precisa (per esempio "In gara" dal pulsante della
 * Copertina): la legge la schermata dei Provini quando torna in primo piano. Così l'indirizzo resta
 * pulito (niente parametri che restano attaccati alla scheda).
 */
export type Section = 'gara' | 'esplora' | 'seguiti';

let wanted: Section | null = null;
const listeners = new Set<(s: Section) => void>();

export function requestSection(section: Section) {
  wanted = section;
  for (const fn of listeners) fn(section);
}

export function takeSection(): Section | null {
  const s = wanted;
  wanted = null;
  return s;
}

export function onSectionRequest(fn: (s: Section) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
