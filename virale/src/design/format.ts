export function formatCount(n: number): string {
  // 999.950 arrotondato sarebbe "1000k": da lì in su si scrive in milioni.
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')} Mln`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace('.', ',').replace(',0', '')}k`;
  return String(n);
}

/** Tempo trascorso in forma breve: "ora", "5 min", "3 h", "2 g". Mai "ieri", che si legge male in "ieri fa". */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 1) return 'ora';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} g`;
}

const DAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export function longDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function shortDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Minuti dalla mezzanotte come orario "14:55". */
export function clockTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** L'orario della copertina detto a parole: "a mezzanotte" o "alle 14:55". */
export function atTime(minutes: number): string {
  return minutes % 1440 === 0 ? 'a mezzanotte' : `alle ${clockTime(minutes)}`;
}
