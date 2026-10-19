import type { DraftMedia } from '../types';

/** Peso massimo di un file da caricare: il bucket accetta 50 MB, si tiene un margine. */
export const MAX_UPLOAD_BYTES = 48 * 1024 * 1024;

/**
 * Sul web (e nella demo) i video si caricano così come sono: la compressione c'è solo sul telefono
 * (vedi video.native.ts, che Metro usa al posto di questo file su Android e iOS).
 */
export async function prepareVideo(item: DraftMedia, _onFraction?: (f: number) => void, _signal?: AbortSignal): Promise<DraftMedia> {
  return item;
}
