import * as FileSystem from 'expo-file-system/legacy';

import type { DraftMedia } from '../types';

/** Peso massimo di un file da caricare: il bucket accetta 50 MB, si tiene un margine. */
export const MAX_UPLOAD_BYTES = 48 * 1024 * 1024;
const MB = 1024 * 1024;
const TOO_HEAVY = 'Questo video è troppo pesante anche dopo la compressione. Accorcialo e riprova.';

type Compressor = typeof import('react-native-compressor');

/**
 * La libreria di compressione si carica solo quando serve: in una build senza il modulo nativo
 * (Expo Go, piano di ripiego senza la libreria) l'app non si ferma, semplicemente non comprime.
 */
function compressor(): Compressor | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-compressor') as Compressor;
  } catch {
    return null;
  }
}

async function sizeOf(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size : null;
  } catch {
    return null;
  }
}

export class CompressionAborted extends Error {
  constructor() {
    super('Compressione annullata.');
    this.name = 'CompressionAborted';
  }
}

/**
 * Un video del telefono pronto da caricare. Un minuto in 1080p dalla fotocamera pesa 100-150 MB: si
 * riduce a 720p e circa 3 Mbit/s (20-25 MB al minuto), che sul feed di un telefono si vede bene.
 * Si comprime solo se serve: file oltre 40 MB, lato lungo oltre 1280 o più di 4,5 Mbit/s.
 * onFraction riceve l'avanzamento della compressione (0-1) e viene chiamata solo se si comprime.
 */
export async function prepareVideo(item: DraftMedia, onFraction?: (f: number) => void, signal?: AbortSignal): Promise<DraftMedia> {
  const size = (await sizeOf(item.uri)) ?? 0;
  const seconds = Math.max(1, (item.durationMs ?? 0) / 1000);
  const longSide = Math.max(item.width || 0, item.height || 0);
  const heavy = size > 40 * MB || longSide > 1280 || (size * 8) / seconds > 4_500_000;
  if (!heavy) return item;

  const lib = compressor();
  const fallback = () => {
    if (size && size <= MAX_UPLOAD_BYTES) return item;
    throw new Error(TOO_HEAVY);
  };
  if (!lib) return fallback();

  let cancelId: string | null = null;
  const onAbort = () => {
    if (cancelId) {
      try {
        lib.Video.cancelCompression(cancelId);
      } catch {
        // già finita
      }
    }
  };
  signal?.addEventListener('abort', onAbort);
  try {
    // Due tentativi: 720p a 3 Mbit/s, poi (se pesa ancora troppo) 540p a 2 Mbit/s.
    const passes = [
      { maxSize: 1280, bitrate: 3_000_000 },
      { maxSize: 960, bitrate: 2_000_000 },
    ];
    for (const [i, pass] of passes.entries()) {
      if (signal?.aborted) throw new CompressionAborted();
      const out = await lib.Video.compress(
        item.uri,
        {
          compressionMethod: 'manual',
          maxSize: pass.maxSize,
          bitrate: pass.bitrate,
          minimumFileSizeForCompress: 0,
          getCancellationId: (id) => {
            cancelId = id;
          },
        },
        (p) => {
          const f = Math.max(0, Math.min(1, p > 1 ? p / 100 : p));
          // Il secondo passaggio continua la barra da metà: la percentuale non torna mai indietro.
          onFraction?.(i === 0 ? f * 0.5 : 0.5 + f * 0.5);
        },
      );
      if (signal?.aborted) throw new CompressionAborted();
      const uri = out.startsWith('file://') || out.startsWith('content://') ? out : `file://${out}`;
      const outSize = await sizeOf(uri);
      if (outSize !== null && outSize <= MAX_UPLOAD_BYTES) {
        onFraction?.(1);
        // Misure dal file risultante, con l'orientamento del video scelto (non ruotate).
        const scale = longSide > pass.maxSize ? pass.maxSize / longSide : 1;
        return { ...item, uri, width: Math.round(item.width * scale), height: Math.round(item.height * scale), mimeType: 'video/mp4' };
      }
    }
    throw new Error(TOO_HEAVY);
  } catch (e) {
    if (e instanceof CompressionAborted || signal?.aborted) throw new CompressionAborted();
    if ((e as Error).message === TOO_HEAVY) throw e;
    // La compressione non è riuscita (formato strano, memoria): si prova con l'originale, se ci sta.
    return fallback();
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
