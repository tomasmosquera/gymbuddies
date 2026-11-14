import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
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

/** One "page" in the whole swipeable/auto-advancing sequence — a single item's checkin page, then its checkout page if it has one, then the next item's own pages, and so on. */
interface FeedPage {
  itemIndex: number;
  side: Side;
}

function buildPages(items: PhotoFeedItem[]): FeedPage[] {
  const pages: FeedPage[] = [];
  items.forEach((item, itemIndex) => {
    pages.push({ itemIndex, side: 'checkin' });
    if (sideMediaFor(item, 'checkout')) pages.push({ itemIndex, side: 'checkout' });
  });
  return pages;
}

const PHOTO_PAGE_DURATION_MS = 8000;
const SWIPE_THRESHOLD = 60;
const DISMISS_DISTANCE_THRESHOLD = 120;
const DISMISS_VELOCITY_THRESHOLD = 800;

/** Mounted only while actually showing a video, same AVPlayer-scoping idiom as CheckinPhotoModal's own VideoModalContent. Reports its own playback position (for the progress bar) and end-of-playback (to advance) back up, rather than this story page guessing a duration up front — a video's real length is whatever it is, not a fixed 8s. */
function VideoSide({
  uri,
  overlayText,
  locationText,
  onProgress,
  onEnd,
}: {
  uri: string;
  overlayText: string | null;
  locationText: string | null;
  onProgress: (fraction: number) => void;
  onEnd: () => void;
}) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.play();
  });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });

  useEffect(() => {
    if (player.duration > 0) onProgress(Math.min(currentTime / player.duration, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime]);

  // playToEnd fires once, right as playback finishes — a dedicated listener
  // (rather than reading useEvent's return value) since there's no payload
  // to key a dependency array off of.
  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <View style={styles.mediaArea}>
      <VideoView style={styles.mediaArea} player={player} nativeControls={false} />
      {overlayText || locationText ? (
        <View style={styles.videoOverlay}>
          {overlayText ? <Text style={styles.videoOverlayText}>{overlayText}</Text> : null}
          {locationText ? <Text style={styles.videoOverlayText}>{locationText}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function SideView({
  media,
  timezone,
  onVideoProgress,
  onVideoEnd,
}: {
  media: SideMedia;
  timezone: string;
  onVideoProgress: (fraction: number) => void;
  onVideoEnd: () => void;
}) {
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
    return (
      <VideoSide
        uri={signedUrl}
        overlayText={overlayText}
        locationText={locationText ?? coordsText}
        onProgress={onVideoProgress}
        onEnd={onVideoEnd}
      />
    );
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

/**
 * The feed's own lightbox — Instagram-stories-shaped: each item's checkin
 * page auto-advances to its checkout page (when it has one) after 8s, then
 * on to the next item's checkin, and so on; a video page advances once it
 * finishes playing instead of on a fixed timer. The top progress bar has
 * one segment per page of the CURRENT item (1 or 2), resetting for each new
 * item — same as a story's own bar resetting per user. Swiping left/right
 * moves through this exact same sequence manually (past the current item's
 * pages too, into the next/previous one); swiping down still dismisses.
 *
 * This is deliberately its own component rather than extending
 * CheckinPhotoModal — composing pinch-zoom with a second, competing
 * horizontal-pan-for-paging gesture, on top of an auto-advance timer, isn't
 * worth the risk on that shared, widely-used component. This view trades
 * pinch-zoom for paging + auto-advance; CheckinPhotoModal elsewhere keeps
 * pinch-zoom since it only ever shows one static image with no paging.
 */
export function FeedMediaModal({
  visible,
  items,
  initialIndex,
  onClose,
  onViewItem,
}: {
  visible: boolean;
  items: PhotoFeedItem[];
  /** Which item in `items` was tapped to open this — null while nothing is open. */
  initialIndex: number | null;
  onClose: () => void;
  /** Fired for every item actually shown, the first one included — not just the one that was tapped. */
  onViewItem?: (item: PhotoFeedItem) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {visible && initialIndex !== null ? (
        <FeedMediaModalContent key={initialIndex} items={items} initialItemIndex={initialIndex} onClose={onClose} onViewItem={onViewItem} />
      ) : null}
    </Modal>
  );
}

function FeedMediaModalContent({
  items,
  initialItemIndex,
  onClose,
  onViewItem,
}: {
  items: PhotoFeedItem[];
  initialItemIndex: number;
  onClose: () => void;
  onViewItem?: (item: PhotoFeedItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const pages = useMemo(() => buildPages(items), [items]);
  const [pageIndex, setPageIndex] = useState(() => Math.max(pages.findIndex((p) => p.itemIndex === initialItemIndex), 0));
  const [fraction, setFraction] = useState(0);
  const dismissTranslateY = useSharedValue(0);
  const dismissOpacity = useSharedValue(1);

  const page = pages[pageIndex];
  const item = items[page.itemIndex];
  const media = sideMediaFor(item, page.side)!;
  const segmentCount = sideMediaFor(item, 'checkout') ? 2 : 1;
  const activeSegment = page.side === 'checkin' ? 0 : 1;

  const goNext = () => {
    if (pageIndex + 1 >= pages.length) onClose();
    else setPageIndex(pageIndex + 1);
  };
  const goPrev = () => {
    if (pageIndex > 0) setPageIndex(pageIndex - 1);
  };

  // Latest callback/close in a ref — read from the timer effect below
  // without needing it in that effect's dependency array (which would
  // restart the 8s timer on every unrelated parent re-render).
  const goNextRef = useRef(goNext);
  useEffect(() => {
    goNextRef.current = goNext;
  });
  const onViewItemRef = useRef(onViewItem);
  useEffect(() => {
    onViewItemRef.current = onViewItem;
  });

  useEffect(() => {
    onViewItemRef.current?.(item);
  }, [item]);

  // Photo pages drive their own fixed-duration timer here; video pages
  // report their real playback position via SideView's onVideoProgress/
  // onVideoEnd instead (see VideoSide) — a video's length is whatever it
  // actually is, not a guess.
  useEffect(() => {
    setFraction(0);
    if (media.videoPath) return;
    const start = Date.now();
    const id = setInterval(() => {
      const f = Math.min((Date.now() - start) / PHOTO_PAGE_DURATION_MS, 1);
      setFraction(f);
      if (f >= 1) {
        clearInterval(id);
        goNextRef.current();
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (Math.abs(e.translationX) < Math.abs(e.translationY)) {
        dismissTranslateY.value = e.translationY;
        dismissOpacity.value = Math.max(1 - Math.abs(e.translationY) / 400, 0.4);
      }
    })
    .onEnd((e) => {
      const isHorizontalSwipe = Math.abs(e.translationX) >= Math.abs(e.translationY);
      if (isHorizontalSwipe) {
        if (e.translationX < -SWIPE_THRESHOLD) {
          runOnJS(goNext)();
        } else if (e.translationX > SWIPE_THRESHOLD) {
          runOnJS(goPrev)();
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

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.backdrop, animatedStyle]}>
        <SideView
          key={`${item.checkinId}-${page.side}`}
          media={media}
          timezone={item.groupTimezone}
          onVideoProgress={setFraction}
          onVideoEnd={goNext}
        />

        <View style={[styles.progressRow, { top: insets.top + spacing.sm }]} pointerEvents="none">
          {Array.from({ length: segmentCount }).map((_, i) => (
            <View key={i} style={styles.segmentTrack}>
              <View
                style={[
                  styles.segmentFill,
                  i < activeSegment ? styles.segmentFillDone : i === activeSegment ? { width: `${fraction * 100}%` } : styles.segmentFillNone,
                ]}
              />
            </View>
          ))}
        </View>

        {segmentCount > 1 && activeSegment === 0 ? (
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
  progressRow: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', gap: 4 },
  segmentTrack: { flex: 1, height: 3, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  segmentFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary },
  segmentFillDone: { width: '100%' },
  segmentFillNone: { width: '0%' },
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
