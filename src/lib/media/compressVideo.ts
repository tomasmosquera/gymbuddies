import Constants, { ExecutionEnvironment } from 'expo-constants';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type CompressorModule = typeof import('react-native-compressor');

/**
 * react-native-compressor is a Nitro (native) module — its Compressor
 * HybridObject is created at module-load time (see the package's own
 * Main.js: `const Compressor = createCompressor()` runs the instant the
 * module is required, not on first use), so merely importing it throws
 * synchronously inside Expo Go, before any runtime check in a function body
 * ever gets a chance to run. Same treatment as HealthKit (see
 * src/lib/health/appleHealth.ts's loadHealthKit — this mirrors that
 * pattern): never a static top-level `import` here, only a lazy
 * `require()`, gated on not being Expo Go, so `npx expo start` in Expo Go
 * keeps working for everything else in the app — this feature just falls
 * back to the uncompressed original there.
 */
function loadCompressor(): CompressorModule | null {
  if (isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see doc comment above
    return require('react-native-compressor');
  } catch {
    return null;
  }
}

export interface CompressVideoResult {
  uri: string;
  /** False whenever `uri` is just the original, untouched input — Expo Go, an unsupported platform, or any compression failure all fall back to it rather than blocking the caller. */
  wasCompressed: boolean;
}

/**
 * Compresses a local video file with the library's 'auto' method — its own
 * WhatsApp-style behavior, tuned to land well under typical upload limits
 * without needing manual bitrate/resolution tuning. Falls back to handing
 * back the original, unmodified uri (wasCompressed: false) whenever
 * compression isn't available or fails for any reason (e.g. an
 * already-tiny or malformed source) — callers should always be able to
 * proceed with what they get back rather than being blocked by a
 * compression failure; the caller's own size check after this is what
 * actually decides whether the result is small enough to upload.
 *
 * onProgress receives a 0..1 fraction — the native module's own progress
 * value range isn't documented, so a value over 1 is defensively treated
 * as a 0..100 percentage and divided down.
 */
export async function compressVideo(uri: string, onProgress?: (fraction: number) => void): Promise<CompressVideoResult> {
  const compressor = loadCompressor();
  if (!compressor) return { uri, wasCompressed: false };
  try {
    const compressedUri = await compressor.Video.compress(uri, { compressionMethod: 'auto' }, (progress) => {
      onProgress?.(Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress)));
    });
    return { uri: compressedUri, wasCompressed: true };
  } catch {
    return { uri, wasCompressed: false };
  }
}
