/**
 * Testo contato in caratteri, come fa il database (length() di Postgres): un'emoji è un carattere,
 * non due come per `maxLength` e `.length` di JavaScript (che contano in UTF-16).
 */
export function charCount(s: string): number {
  return Array.from(s).length;
}

/** Il testo tagliato a `max` caratteri, senza spezzare un'emoji a metà. */
export function clampChars(s: string, max: number): string {
  return charCount(s) <= max ? s : Array.from(s).slice(0, max).join('');
}

/** Il primo carattere (un'emoji intera, non metà): per le iniziali dei monogrammi. */
export function firstChar(s: string): string {
  for (const ch of s) return ch;
  return '';
}
