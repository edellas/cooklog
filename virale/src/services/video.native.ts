import * as FileSystem from 'expo-file-system/legacy';

import type { DraftMedia } from '../types';

/** Peso massimo di un file da caricare: il bucket accetta 50 MB, si tiene un margine. */
export const MAX_UPLOAD_BYTES = 48 * 1024 * 1024;
const MB = 1024 * 1024;

async function sizeOf(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * Un video del telefono pronto da caricare. Non si ricomprime sul telefono (la libreria di compressione
 * impediva di installare l'app su alcuni telefoni): se il file supera il limite lo si dice subito, prima
 * di caricare, con il peso e cosa fare.
 */
export async function prepareVideo(item: DraftMedia, _onFraction?: (f: number) => void, _signal?: AbortSignal): Promise<DraftMedia> {
  const size = await sizeOf(item.uri);
  if (size !== null && size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Questo video pesa ${Math.round(size / MB)} MB: il massimo è ${Math.floor(MAX_UPLOAD_BYTES / MB)} MB. Accorcialo, oppure registralo in 720p o 1080p (non 4K) e riprova.`,
    );
  }
  return item;
}
