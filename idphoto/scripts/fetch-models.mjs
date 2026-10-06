// Downloads the MediaPipe models into public/models/ (skipped when already present).
// Models are self-hosted so the app never depends on third-party CDNs at runtime
// and no photo ever leaves the visitor's browser.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'https://storage.googleapis.com/mediapipe-models/';
const models = {
  'face_landmarker.task': 'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'selfie_multiclass_256x256.tflite':
    'image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
};

const outDir = join(root, 'public', 'models');
await mkdir(outDir, { recursive: true });

for (const [name, path] of Object.entries(models)) {
  const target = join(outDir, name);
  try {
    if ((await stat(target)).size > 0) {
      console.log(`model ok: ${name}`);
      continue;
    }
  } catch {}
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(base + path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(target, Buffer.from(await res.arrayBuffer()));
      console.log(`downloaded: ${name}`);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  if (lastError) {
    console.error(`failed to download ${name}: ${lastError.message}`);
    process.exit(1);
  }
}
