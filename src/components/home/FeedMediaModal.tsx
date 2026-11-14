import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { getSignedUrl } from '@/lib/supabase/storage';
import { useReverseGeocode } from '@/components/checkin/CheckinPhotoColumn';
import { formatZonedDateTime12h } from '@/lib/domain/dateUtils';
import type { PhotoFeedItem } from '@/hooks/useGroupsPhotoFeed';
import { colors, radii, spacing } from '@/constants/theme';

type Side = 'checkin' | 'checkout';

interface SideMedia {
  photoPath: string | null;
  videoPath: string | null;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

function sideMediaFor(item: PhotoFeedItem, side: Side): SideMedia | null {
  if (side === 'checkin') {
    return {
      photoPath: item.photoPath,
      videoPath: item.videoPath,
      capturedAt: item.capturedAt,
      latitude: item.latitude,
      longitude: item.longitude,
    };
  }
  if (!item.checkoutPhotoPath && !item.checkoutVideoPath) return null;
  return {
    photoPath: item.checkoutPhotoPath,
    videoPath: item.checkoutVideoPath,
    capturedAt: item.checkoutCapturedAt,
    latitude: item.checkoutLatitude,
    longitude: item.checkoutLongitude,
  };
}

/** Mounted only while actually showing a video, same AVPlayer-scoping idiom as CheckinPhotoModal's own VideoModalContent. */
function VideoSide({ uri, overlayText, locationText }: { uri: string; overlayText: string | null; locationText: string | null }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.play();
  });
  return (
    <View style={styles.mediaArea}>
      <VideoView style={styles.mediaArea} player={player} nativeControls fullscreenOptions={{ enable: true }} />
      {overlayText || locationText ? (
        <View style={styles.videoOverlay}>
          {overlayText ? <Text style={styles.videoOverlayText}>{overlayText}</Text> : null}
          {locationText ? <Text style={styles.videoOverlayText}>{locationText}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function SideView({ media, timezone }: { media: SideMedia; timezone: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired'>('loading');
  const mediaPath = media.videoPath ?? media.photoPath;
  const locationText = useReverseGeocode(media.videoPath ? media.latitude : null, media.videoPath ? media.longitude : null);

  useEffect(() => {
    if (!mediaPath) {
      setStatus('expired');
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

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (status === 'expired' || !signedUrl) {
    return (
      <View style={styles.center}>
        <Text style={styles.expiredText}>
          {media.videoPath
            ? 'Este video ya no está disponible — se guardan solo por 1 semana.'
            : 'Esta foto ya no está disponible — las fotos solo se guardan por 1 semana.'}
        </Text>
      </View>
    );
  }

  const coordsText = media.latitude != null && media.longitude != null ? `${media.latitude.toFixed(5)}, ${media.longitude.toFixed(5)}` : null;
  const overlayText = media.capturedAt ? formatZonedDateTime12h(new Date(media.capturedAt), timezone) : null;

  if (media.videoPath) {
    return <VideoSide uri={signedUrl} overlayText={overlayText} locationText={locationText ?? coordsText} />;
  }
  return (
    <Image
      source={{ uri: signedUrl, cacheKey: media.photoPath ?? undefined }}
      style={styles.mediaArea}
      contentFit="contain"
      cachePolicy="memory-disk"
    />
  );
}

const SWIPE_THRESHOLD = 60;
const DISMISS_DISTANCE_THRESHOLD = 120;
const DISMISS_VELOCITY_THRESHOLD = 800;

/**
 * The feed's own lightbox: checkin media by default, swipe left for the
 * checkout half when this check-in has one (swipe right to go back) — the
 * 2-dot bar at the top doubles as both the position indicator and the
 * affordance that there's a second page to see, same idiom as a story
 * progress bar. Swipe DOWN (not left/right) still dismisses, same feel as
 * ZoomableImage elsewhere, but this is deliberately its own component
 * rather than reusing ZoomableImage — composing pinch-zoom with a second,
 * competing horizontal-pan-for-paging gesture on the same image isn't worth
 * the risk here, so this view trades pinch-zoom for paging; the plain
 * CheckinPhotoModal used everywhere else keeps pinch-zoom since it only
 * ever shows one side at a time with no swipe gesture of its own.
 */
export function FeedMediaModal({ visible, item, onClose }: { visible: boolean; item: PhotoFeedItem | null; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Keyed by checkinId rather than reset via a useEffect: a fresh key
          means fresh useState/useSharedValue initial values for free (no
          lingering drag/fade from whatever the PREVIOUS item was left at),
          and sidesteps mutating a shared value from inside an effect. */}
      {item ? <FeedMediaModalContent key={item.checkinId} item={item} onClose={onClose} /> : null}
    </Modal>
  );
}

function FeedMediaModalContent({ item, onClose }: { item: PhotoFeedItem; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [side, setSide] = useState<Side>('checkin');
  const dismissTranslateY = useSharedValue(0);
  const dismissOpacity = useSharedValue(1);

  const hasCheckout = !!sideMediaFor(item, 'checkout');

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (Math.abs(e.translationX) < Math.abs(e.translationY)) {
        dismissTranslateY.value = e.translationY;
        dismissOpacity.value = Math.max(1 - Math.abs(e.translationY) / 400, 0.4);
      }
    })
    .onEnd((e) => {
      const isHorizontalSwipe = Math.abs(e.translationX) >= Math.abs(e.translationY);
      if (isHorizontalSwipe && hasCheckout) {
        if (side === 'checkin' && e.translationX < -SWIPE_THRESHOLD) {
          runOnJS(setSide)('checkout');
        } else if (side === 'checkout' && e.translationX > SWIPE_THRESHOLD) {
          runOnJS(setSide)('checkin');
        }
        return;
      }
      if (Math.abs(e.translationY) > DISMISS_DISTANCE_THRESHOLD || Math.abs(e.velocityY) > DISMISS_VELOCITY_THRESHOLD) {
        runOnJS(onClose)();
      } else {
        dismissTranslateY.value = withSpring(0);
        dismissOpacity.value = withSpring(1);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: dismissOpacity.value,
    transform: [{ translateY: dismissTranslateY.value }],
  }));

  const media = sideMediaFor(item, side);

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.backdrop, animatedStyle]}>
        {media ? <SideView key={`${item.checkinId}-${side}`} media={media} timezone={item.groupTimezone} /> : null}

        {hasCheckout ? (
          <View style={[styles.dotsRow, { top: insets.top + spacing.sm }]} pointerEvents="none">
            <View style={[styles.dot, side === 'checkin' && styles.dotActive]} />
            <View style={[styles.dot, side === 'checkout' && styles.dotActive]} />
          </View>
        ) : null}

        {hasCheckout && side === 'checkin' ? (
          <View style={styles.swipeHint} pointerEvents="none">
            <Text style={styles.swipeHintText}>Desliza para ver el final ‹›</Text>
          </View>
        ) : null}

        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={16} style={[styles.closeButton, { top: insets.top + spacing.md }]}>
          <Text style={styles.closeButtonText}>Cerrar ✕</Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  mediaArea: { flex: 1 },
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
  expiredText: { color: colors.text, textAlign: 'center' },
  dotsRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 28, height: 3, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: colors.primary },
  swipeHint: {
    position: 'absolute',
    bottom: spacing.xl,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  swipeHintText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
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
});
