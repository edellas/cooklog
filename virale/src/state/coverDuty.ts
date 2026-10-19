import { getJson, setJson } from '../services/storage';

/**
 * La copertina obbligatoria: dopo ogni uscita, al primo accesso ognuno la guarda tutta prima di fare altro.
 * Si ricorda per ogni account (e per ogni telefono) l'ultima copertina vista fino in fondo.
 */
const key = (userId: string) => `virale.copertina.vista.${userId}`;

export async function coverSeenDay(userId: string): Promise<string | null> {
  return getJson<string | null>(key(userId), null);
}

export async function markCoverSeen(userId: string, day: string): Promise<void> {
  await setJson(key(userId), day);
}
