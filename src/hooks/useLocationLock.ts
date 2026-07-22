import { useCallback, useState } from 'react';
import * as Location from 'expo-location';

export interface LockedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
}

export type LocationLockStatus = 'idle' | 'requesting' | 'locked' | 'denied' | 'error';

const HIGH_ACCURACY_ATTEMPTS = 2;
const BALANCED_ACCURACY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * iOS's CoreLocation frequently fails a single fix attempt indoors (gyms are
 * usually indoor/concrete, weakening GPS signal) with kCLErrorLocationUnknown
 * — Apple's own docs call this transient and say to just try again. Retries
 * a couple of times at high accuracy, then falls back to balanced accuracy
 * (which also leans on WiFi/cell triangulation, often available indoors even
 * when GPS satellites aren't) before finally giving up.
 */
async function getCurrentPositionWithFallback(): Promise<Location.LocationObject> {
  let lastError: unknown;

  for (let attempt = 0; attempt < HIGH_ACCURACY_ATTEMPTS; attempt++) {
    try {
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    } catch (err) {
      lastError = err;
      if (attempt < HIGH_ACCURACY_ATTEMPTS - 1) await delay(RETRY_DELAY_MS);
    }
  }

  for (let attempt = 0; attempt < BALANCED_ACCURACY_ATTEMPTS; attempt++) {
    try {
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch (err) {
      lastError = err;
      if (attempt < BALANCED_ACCURACY_ATTEMPTS - 1) await delay(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

/**
 * A check-in photo must carry real GPS, so the shutter stays disabled until
 * a fix is locked — there is no "skip location" fallback by product design.
 */
export function useLocationLock() {
  const [status, setStatus] = useState<LocationLockStatus>('idle');
  const [location, setLocation] = useState<LockedLocation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestLock = useCallback(async () => {
    setStatus('requesting');
    setErrorMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setStatus('denied');
        return;
      }
      const position = await getCurrentPositionWithFallback();
      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      });
      setStatus('locked');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo obtener tu ubicación');
      setStatus('error');
    }
  }, []);

  return { status, location, errorMessage, requestLock };
}
