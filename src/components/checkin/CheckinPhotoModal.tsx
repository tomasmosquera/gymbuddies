import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getSignedUrl } from '@/lib/supabase/storage';
import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { formatZonedDateTime12h } from '@/lib/domain/dateUtils';
import { useReverseGeocode } from '@/components/checkin/CheckinPhotoColumn';
import { colors, radii, spacing } from '@/constants/theme';

interface CheckinPhotoModalProps {
  visible: boolean;
  photoPath: string | null;
  videoPath?: string | null;
  /** Only needed for a video — its date/location bar is rendered live here instead of baked into the file (see preview.tsx's VideoPreviewWithOverlay for why). Unused for a photo, whose watermark is already in the image. */
  capturedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string;
  onClose: () => void;
}

/** Mounted only while the modal is actually showing a video — same AVPlayer-scoping idiom as every other video preview in this app. */
function VideoModalContent({
  uri,
  overlayText,
  locationText,
}: {
  uri: string;
  overlayText: string | null;
  locationText: string | null;
}) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.play();
  });
  return (
    <View style={styles.imageArea}>
      <VideoView style={styles.video} player={player} nativeControls fullscreenOptions={{ enable: true }} />
      {overlayText || locationText ? (
        <View style={styles.videoOverlay}>
          {overlayText ? <Text style={styles.videoOverlayText}>{overlayText}</Text> : null}
          {locationText ? <Text style={styles.videoOverlayText}>{locationText}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export function CheckinPhotoModal({ visible, photoPath, videoPath, capturedAt, latitude, longitude, timezone, onClose }: CheckinPhotoModalProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired'>('loading');
  const insets = useSafeAreaInsets();
  const mediaPath = videoPath ?? photoPath;
  const locationText = useReverseGeocode(visible && videoPath ? latitude ?? null : null, visible && videoPath ? longitude ?? null : null);

  useEffect(() => {
    if (!visible || !mediaPath) return;
    setStatus('loading');
    setSignedUrl(null);
    getSignedUrl('checkins', mediaPath)
      .then((url) => {
        setSignedUrl(url);
        setStatus('ready');
      })
      .catch(() => setStatus('expired'));
  }, [visible, mediaPath]);

  const coordsText = latitude != null && longitude != null ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : null;
  const overlayText = capturedAt && timezone ? formatZonedDateTime12h(new Date(capturedAt), timezone) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
        {status === 'expired' ? (
          <View style={styles.center}>
            <Text style={styles.expiredText}>
              {videoPath
                ? 'Este video ya no está disponible — se guardan solo por 1 semana.'
                : 'Esta foto ya no está disponible — las fotos solo se guardan por 1 semana.'}
            </Text>
          </View>
        ) : null}
        {status === 'ready' && signedUrl && videoPath ? (
          <VideoModalContent key={signedUrl} uri={signedUrl} overlayText={overlayText} locationText={locationText ?? coordsText} />
        ) : status === 'ready' && signedUrl ? (
          <ZoomableImage
            key={signedUrl}
            uri={signedUrl}
            cacheKey={photoPath ?? undefined}
            style={styles.imageArea}
            onDismiss={onClose}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          hitSlop={16}
          style={[styles.closeButton, { top: insets.top + spacing.md }]}
        >
          <Text style={styles.closeButtonText}>Cerrar ✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  imageArea: { flex: 1 },
  video: { flex: 1 },
  videoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: spacing.md,
    gap: 2,
  },
  videoOverlayText: { color: 'white', fontSize: 13, fontWeight: '700' },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 10,
    elevation: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeButtonText: { color: colors.text, fontWeight: '700' },
  expiredText: { color: colors.text, textAlign: 'center', padding: spacing.lg },
});
