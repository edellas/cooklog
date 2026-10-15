import AsyncStorage from '@react-native-async-storage/async-storage';

// Lo storage può non essere disponibile (navigazione privata, anteprime): l'app deve funzionare comunque.
const memory = new Map<string, string>();

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    // Prima la memoria: se una scrittura su disco fallisce (spazio pieno) non si rilegge una copia vecchia.
    const raw = memory.get(key) ?? (await AsyncStorage.getItem(key)) ?? null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    const raw = memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  }
}

export async function setJson<T>(key: string, value: T): Promise<void> {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    await AsyncStorage.setItem(key, raw);
  } catch {
    // Resta in memoria per questa sessione.
  }
}

export async function removeKey(key: string): Promise<void> {
  memory.delete(key);
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Ignora.
  }
}
