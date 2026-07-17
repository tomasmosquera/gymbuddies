import { useCallback, useState } from 'react';
import * as Location from 'expo-location';

export interface LockedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
}

export type LocationLockStatus = 'idle' | 'requesting' | 'locked' | 'denied' | 'error';

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
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
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
