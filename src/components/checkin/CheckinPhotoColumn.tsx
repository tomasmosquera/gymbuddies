import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { getSignedUrl } from '@/lib/supabase/storage';
import { formatBogotaDateTime } from '@/lib/domain/dateUtils';
import { colors, radii, spacing } from '@/constants/theme';

export function useReverseGeocode(latitude: number | null, longitude: number | null): string | null {
  const [locationText, setLocationText] = useState<string | null>(null);

  useEffect(() => {
    if (latitude === null || longitude === null) {
      setLocationText(null);
      return;
    }
    Location.reverseGeocodeAsync({ latitude, longitude })
      .then((results) => {
        const place = results[0];
        setLocationText(place ? [place.street, place.city, place.region].filter(Boolean).join(', ') : null);
      })
      .catch(() => setLocationText(null));
  }, [latitude, longitude]);

  return locationText;
}

/** One labeled photo (inicial/final) with its captured time and reverse-geocoded location. */
export function CheckinPhotoColumn({
  label,
  photoPath,
  capturedAt,
  latitude,
  longitude,
  onPress,
}: {
  label: string;
  photoPath: string | null;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  onPress: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'none' | 'loading' | 'ready' | 'expired'>(photoPath ? 'loading' : 'none');
  const locationText = useReverseGeocode(latitude, longitude);

  useEffect(() => {
    if (!photoPath) {
      setSignedUrl(null);
      setStatus('none');
      return;
    }
    setStatus('loading');
    setSignedUrl(null);
    getSignedUrl('checkins', photoPath)
      .then((url) => {
        setSignedUrl(url);
        setStatus('ready');
      })
      .catch(() => setStatus('expired'));
  }, [photoPath]);

  const coordsText = latitude !== null && longitude !== null ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : null;

  return (
    <View style={styles.column}>
      <Pressable onPress={onPress} disabled={status !== 'ready'}>
        {status === 'ready' && signedUrl ? (
          <Image source={{ uri: signedUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            {status === 'loading' ? <ActivityIndicator color={colors.primary} size="small" /> : null}
            {status === 'none' ? <Text style={styles.missingText}>Sin foto</Text> : null}
            {status === 'expired' ? <Text style={styles.missingText}>Foto expirada{'\n'}(se borran a los 7 días)</Text> : null}
          </View>
        )}
      </Pressable>
      <Text style={styles.label}>{label}</Text>
      {capturedAt ? <Text style={styles.meta}>{formatBogotaDateTime(new Date(capturedAt)).split(' ')[1]}</Text> : null}
      {latitude !== null ? (
        <Text style={styles.meta} numberOfLines={2}>
          📍 {locationText ?? coordsText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, gap: 2 },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  missingText: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  label: { color: colors.text, fontWeight: '600', fontSize: 13, marginTop: spacing.xs },
  meta: { color: colors.textMuted, fontSize: 12 },
});
