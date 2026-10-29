import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, type VideoThumbnail } from 'expo-video';
import { useEvent } from 'expo';
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

/** Grabs the first frame of a video as a static thumbnail — mounted only while a video tile needs one; the real playback happens in CheckinPhotoModal once opened. */
function VideoThumbnailTile({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (status !== 'readyToPlay' || requestedRef.current) return;
    requestedRef.current = true;
    player
      .generateThumbnailsAsync(0)
      .then(([thumb]) => {
        if (thumb) setThumbnail(thumb);
      })
      .catch(() => {});
  }, [status, player]);

  return (
    <View style={styles.videoTileWrap}>
      {thumbnail ? (
        <Image source={thumbnail} style={styles.photo} contentFit="cover" />
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}>
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
      )}
      <View style={styles.videoPlayBadge}>
        <Text style={styles.videoPlayBadgeIcon}>▶️</Text>
      </View>
    </View>
  );
}

/**
 * One labeled photo OR video (inicial/final) with its captured time and reverse-geocoded
 * location. Exactly one of photoPath/videoPath is ever set, matching the DB's own invariant.
 * videoThumbnailPath, when present, is a small pre-generated JPEG (0166_checkin_video_thumbnail.sql)
 * — loads as fast as a real photo. Older/thumbnail-less videos fall back to generating one live
 * (VideoThumbnailTile), which has to buffer the actual remote video first and is noticeably slower.
 */
export function CheckinPhotoColumn({
  label,
  photoPath,
  videoPath,
  videoThumbnailPath,
  capturedAt,
  latitude,
  longitude,
  timezone,
  onPress,
}: {
  label: string;
  photoPath: string | null;
  videoPath?: string | null;
  videoThumbnailPath?: string | null;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  onPress: () => void;
}) {
  // Prefer the pre-generated thumbnail over the full video — same loading cost as a photo.
  const mediaPath = photoPath ?? videoThumbnailPath ?? videoPath ?? null;
  const needsLiveThumbnail = !photoPath && !videoThumbnailPath && !!videoPath;
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'none' | 'loading' | 'ready' | 'expired'>(mediaPath ? 'loading' : 'none');
  const locationText = useReverseGeocode(latitude, longitude);

  useEffect(() => {
    if (!mediaPath) {
      setSignedUrl(null);
      setStatus('none');
      return;
    }
    setStatus('loading');
    setSignedUrl(null);
    getSignedUrl('checkins', mediaPath)
      .then((url) => {
        setSignedUrl(url);
        setStatus('ready');
      })
      .catch(() => setStatus('expired'));
  }, [mediaPath]);

  const coordsText = latitude !== null && longitude !== null ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : null;

  const openMap = () => {
    if (latitude === null || longitude === null) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`).catch(() => {});
  };

  return (
    <View style={styles.column}>
      <Pressable onPress={onPress} disabled={status !== 'ready'}>
        {status === 'ready' && signedUrl && needsLiveThumbnail ? (
          <VideoThumbnailTile uri={signedUrl} />
        ) : status === 'ready' && signedUrl && videoPath ? (
          <View style={styles.videoTileWrap}>
            <Image source={{ uri: signedUrl, cacheKey: mediaPath ?? undefined }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" />
            <View style={styles.videoPlayBadge}>
              <Text style={styles.videoPlayBadgeIcon}>▶️</Text>
            </View>
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
            {status === 'expired' ? (
              <Text style={styles.missingText}>
                {videoPath ? 'Video expirado' : 'Foto expirada'}
                {'\n'}(se borran a los 7 días)
              </Text>
            ) : null}
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
  videoTileWrap: { position: 'relative' },
  videoPlayBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  videoPlayBadgeIcon: { fontSize: 12 },
  missingText: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  label: { color: colors.text, fontWeight: '600', fontSize: 13, marginTop: spacing.xs },
  meta: { color: colors.textMuted, fontSize: 12 },
  locationLink: { textDecorationLine: 'underline' },
});
