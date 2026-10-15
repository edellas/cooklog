export const colors = {
  bg: '#000000',
  surface: '#121212',
  surfaceAlt: '#1E1E1E',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.7)',
  textSubtle: 'rgba(255,255,255,0.5)',
  accent: '#FF2D55',
  accentAlt: '#FFB800',
  success: '#34C759',
  danger: '#FF453A',
} as const;

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} Mln`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}k`;
  return String(n);
}

export function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${d} ${months[m - 1]} ${y}`;
}
