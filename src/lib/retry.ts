import { isTransientNetworkError } from '@/lib/domain/errorMessages';

/**
 * Retries `fn` up to `maxAttempts` times, but ONLY when it fails with a
 * transient network error (connection lost/dropped — see
 * isTransientNetworkError) — anything else (a validation error, a business
 * rule the server rejected, an auth failure) is real and surfaces
 * immediately, never silently retried.
 *
 * Built for the gym-wifi-flakes-mid-set pattern reported against
 * workout-session.tsx: logging a set right after unlocking the phone (or
 * with patchy gym wifi/cellular) can kill the in-flight request with
 * NSURLErrorDomain -1005, but the connection is typically back within a
 * second — one member hit this ~20 times across a single routine, each one
 * needing a manual re-tap of the checkmark. This absorbs that instead,
 * so a brief blip resolves on its own before ever reaching the member.
 */
export async function retryOnTransientNetworkError<T>(fn: () => Promise<T>, maxAttempts = 3, delayMs = 800): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientNetworkError(err) || attempt >= maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
