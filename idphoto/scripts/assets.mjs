// Copies static assets into dist/: client code, MediaPipe runtime, models, public files.
import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function copyAssets(root, dist) {
  await mkdir(dist, { recursive: true });
  await cp(join(root, 'src', 'client'), join(dist, 'app'), { recursive: true });
  const mp = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
  await mkdir(join(dist, 'vendor', 'wasm'), { recursive: true });
  await cp(join(mp, 'vision_bundle.mjs'), join(dist, 'vendor', 'vision_bundle.mjs'));
  // Only the SIMD + no-SIMD classic builds are used by FilesetResolver.
  for (const f of await readdir(join(mp, 'wasm'))) {
    if (f.startsWith('vision_wasm_internal') || f.startsWith('vision_wasm_nosimd_internal')) {
      await cp(join(mp, 'wasm', f), join(dist, 'vendor', 'wasm', f));
    }
  }
  await cp(join(root, 'public'), dist, { recursive: true });
}
