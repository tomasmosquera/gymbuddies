import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { getSignedUrl } from '@/lib/supabase/storage';
import { formatZonedTime12h } from '@/lib/domain/dateUtils';
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

/** One labeled photo OR video (inicial/final) with its captured time and reverse-geocoded location. Exactly one of photoPath/videoPath is ever set, matching the DB's own invariant. */
export function CheckinPhotoColumn({
  label,
  photoPath,
  videoPath,
  capturedAt,
  latitude,
  longitude,
  timezone,
  onPress,
}: {
  label: string;
  photoPath: string | null;
  videoPath?: string | null;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
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

  const openMap = () => {
    if (latitude === null || longitude === null) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`).catch(() => {});
  };

  return (
    <View style={styles.column}>
      <Pressable onPress={onPress} disabled={!videoPath && status !== 'ready'}>
        {videoPath ? (
          // No thumbnail decode here on purpose — just a placeholder tile;
          // the real frame plays once opened in CheckinPhotoModal.
          <View style={[styles.photo, styles.photoPlaceholder, styles.videoPlaceholder]}>
            <Text style={styles.videoPlayIcon}>▶️</Text>
            <Text style={styles.missingText}>Video</Text>
          </View>
        ) : status === 'ready' && signedUrl ? (
          <Image
            source={{ uri: signedUrl, cacheKey: photoPath ?? undefined }}
            style={styles.photo}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            {status === 'loading' ? <ActivityIndicator color={colors.primary} size="small" /> : null}
            {status === 'none' ? <Text style={styles.missingText}>Sin foto</Text> : null}
            {status === 'expired' ? <Text style={styles.missingText}>Foto expirada{'\n'}(se borran a los 7 días)</Text> : null}
          </View>
        )}
      </Pressable>
      <Text style={styles.label}>{label}</Text>
      {capturedAt ? <Text style={styles.meta}>{formatZonedTime12h(new Date(capturedAt), timezone)}</Text> : null}
      {latitude !== null ? (
        <Pressable onPress={openMap} hitSlop={4}>
          <Text style={[styles.meta, styles.locationLink]} numberOfLines={2}>
            📍 {locationText ?? coordsText}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, gap: 2 },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  videoPlaceholder: { backgroundColor: colors.surface, gap: 2 },
  videoPlayIcon: { fontSize: 22 },
  missingText: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  label: { color: colors.text, fontWeight: '600', fontSize: 13, marginTop: spacing.xs },
  meta: { color: colors.textMuted, fontSize: 12 },
  locationLink: { textDecorationLine: 'underline' },
});
