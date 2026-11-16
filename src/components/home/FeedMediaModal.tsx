import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
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

const PHOTO_PAGE_DURATION_MS = 6000;
const SWIPE_THRESHOLD = 60;
const DISMISS_DISTANCE_THRESHOLD = 120;
const DISMISS_VELOCITY_THRESHOLD = 800;
// A tap within the outer 28% of the width on either side counts as "tap the
// edge to go back/forward", same zones Instagram stories use — a tap
// anywhere in the wide middle does nothing (it's not a dead zone by
// accident, it's so a stray tap mid-photo doesn't surprise-skip a story).
const TAP_ZONE_FRACTION = 0.28;
// Shared between the close button and the name/calories row so their
// vertical centers line up exactly, whichever one actually renders 1 or 2
// lines of text inside it.
const TOP_ROW_HEIGHT = 36;
// How far (in px) a drag has to travel before the backdrop is fully
// transparent — and, doubling as that, how tall a buffer of extra backdrop
// needs to sit ABOVE the screen's top edge so dragging down never uncovers
// a hard edge where the real backdrop "ends": by the time a drag has gone
// far enough to expose that buffer's own top edge, the backdrop has already
// faded to nothing, so there's never anything visible left to reveal.
const DISMISS_FADE_DISTANCE = 400;

/** The bottom date/time/location bar — video only. A photo's date/time/location is already baked into the image itself as a watermark (see CheckinPhotoModal's own doc comment), so a photo page never needs this. */
function VideoInfoOverlay({ overlayText, locationText }: { overlayText: string | null; locationText: string | null }) {
  if (!overlayText && !locationText) return null;
  return (
    <View style={styles.videoOverlay}>
      {overlayText ? <Text style={styles.videoOverlayText}>{overlayText}</Text> : null}
      {locationText ? <Text style={styles.videoOverlayText}>{locationText}</Text> : null}
    </View>
  );
}

/** Mounted only while actually showing a video, same AVPlayer-scoping idiom as CheckinPhotoModal's own VideoModalContent. Reports its real duration once known (so the parent's progress bar times itself to the ACTUAL video length, not a guess, and doesn't start counting down before then) and end-of-playback (to advance) — a video's real length is whatever it is, not the fixed 6s a photo gets. `paused` mirrors the story's own pause state (press-and-hold) onto real playback, so the video doesn't keep rolling behind a frozen progress bar. */
function VideoSide({
  uri,
  overlayText,
  locationText,
  paused,
  onReady,
  onEnd,
}: {
  uri: string;
  overlayText: string | null;
  locationText: string | null;
  paused: boolean;
  onReady: (durationMs: number) => void;
  onEnd: () => void;
}) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.play();
  });
  const reportedDurationRef = useRef(false);

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && player.duration > 0 && !reportedDurationRef.current) {
        reportedDurationRef.current = true;
        onReady(player.duration * 1000);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // playToEnd fires once, right as playback finishes.
  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);

  return (
    <View style={styles.mediaArea}>
      <VideoView style={styles.mediaArea} player={player} nativeControls={false} />
      <VideoInfoOverlay overlayText={overlayText} locationText={locationText} />
    </View>
  );
}

function SideView({
  media,
  timezone,
  paused,
  onReady,
  onVideoEnd,
}: {
  media: SideMedia;
  timezone: string;
  paused: boolean;
  /** Fired once the page's media is actually ready to view — the video's real duration once known, or the fixed photo duration once the image itself has finished loading (not just once its signed URL resolved). The progress bar never starts counting down before this fires. */
  onReady: (durationMs: number) => void;
  onVideoEnd: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired'>('loading');
  const mediaPath = media.videoPath ?? media.photoPath;
  const locationText = useReverseGeocode(media.videoPath ? media.latitude : null, media.videoPath ? media.longitude : null);
  const reportedReadyRef = useRef(false);

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
        paused={paused}
        onReady={onReady}
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
      onLoad={() => {
        if (reportedReadyRef.current) return;
        reportedReadyRef.current = true;
        onReady(PHOTO_PAGE_DURATION_MS);
      }}
    />
  );
}

/**
 * The current page's own progress fill — given its own `key` (the page
 * index) by the caller so a new page gets a genuinely fresh shared value
 * (starting at 0) instead of needing a manual reset, and so this is the
 * ONLY place that ever mutates it: one effect, reacting to both durationMs
 * becoming known and `paused` toggling, is what the lint rule wants here —
 * two separate effects each touching the same shared value previously
 * tripped it (see useOtaForegroundCheck.ts's plain-ref pattern for the same
 * "effect that also needs a prior value" shape, not applicable here since
 * reanimated's own progress.value already IS that prior value).
 */
function ActiveSegmentBar({
  durationMs,
  paused,
  isVideo,
  onComplete,
}: {
  durationMs: number | null;
  paused: boolean;
  isVideo: boolean;
  onComplete: () => void;
}) {
  const progress = useSharedValue(0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    if (durationMs === null) return;
    if (paused) {
      cancelAnimation(progress);
      return;
    }
    // Starts fresh at 0 on mount (a new page); resumes from wherever it was
    // frozen when `paused` flips back to false over whatever time is left.
    const remaining = durationMs * (1 - progress.value);
    progress.value = withTiming(1, { duration: remaining }, (finished) => {
      if (finished && !isVideo) runOnJS(onCompleteRef.current)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, paused]);

  const style = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  return <Animated.View style={[styles.segmentFill, style]} />;
}

/**
 * The feed's own lightbox — Instagram-stories-shaped: each item's checkin
 * page auto-advances to its checkout page (when it has one) after 8s, then
 * on to the next item's checkin, and so on; a video page advances once it
 * finishes playing instead of on a fixed timer. The top progress bar has
 * one segment per page of the CURRENT item (1 or 2), resetting for each new
 * item — same as a story's own bar resetting per user, and its fill tracks
 * the real remaining time smoothly (Reanimated's UI-thread withTiming, not
 * a JS setInterval re-rendering every 100ms).
 *
 * Three ways to move, same as the real thing: swipe left/right moves
 * through this same flat sequence (past the current item's pages too, into
 * the next/previous one); tapping near the right/left edge does the exact
 * same thing as swiping that direction; press-and-hold anywhere pauses the
 * timer/video until released, to read a caption or just look longer.
 * Swiping down still dismisses.
 *
 * This is deliberately its own component rather than extending
 * CheckinPhotoModal — composing pinch-zoom with tap zones, a pause gesture,
 * and a second competing horizontal-pan-for-paging gesture on top of an
 * auto-advance timer isn't worth the risk on that shared, widely-used
 * component. This view trades pinch-zoom for all of that; CheckinPhotoModal
 * elsewhere keeps pinch-zoom since it only ever shows one static image.
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
  // null until the current page's media is actually ready — a video's real
  // duration once known, or the fixed photo duration once the image itself
  // has finished loading — so the bar never starts counting down (let alone
  // toward a guessed length) before there's something to actually look at.
  const [mediaDurationMs, setMediaDurationMs] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const dismissTranslateY = useSharedValue(0);
  const dismissOpacity = useSharedValue(1);

  const page = pages[pageIndex];
  const item = items[page.itemIndex];
  const media = sideMediaFor(item, page.side)!;
  const segmentCount = sideMediaFor(item, 'checkout') ? 2 : 1;
  const activeSegment = page.side === 'checkin' ? 0 : 1;
  const caloriesText = item.caloriesKcal != null ? `🔥 ${Math.round(item.caloriesKcal)} kcal` : null;

  const goNext = () => {
    if (pageIndex + 1 >= pages.length) onClose();
    else setPageIndex(pageIndex + 1);
  };
  const goPrev = () => {
    if (pageIndex > 0) setPageIndex(pageIndex - 1);
  };

  const onViewItemRef = useRef(onViewItem);
  useEffect(() => {
    onViewItemRef.current = onViewItem;
  });

  useEffect(() => {
    onViewItemRef.current?.(item);
  }, [item]);

  // A fresh page always starts playing (never carries over a pause from
  // whatever page came before it), and its media is considered not-ready
  // again until SideView reports it.
  useEffect(() => {
    setIsPaused(false);
    setMediaDurationMs(null);
  }, [pageIndex]);

  const handleContainerLayout = (e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  };

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (Math.abs(e.translationX) < Math.abs(e.translationY)) {
        dismissTranslateY.value = e.translationY;
        dismissOpacity.value = Math.max(1 - Math.abs(e.translationY) / DISMISS_FADE_DISTANCE, 0);
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

  // Tapping the right/left edge is just a one-touch shortcut for swiping
  // that direction — a tap in the wide middle does nothing.
  const tapGesture = Gesture.Tap()
    .maxDuration(200)
    .onEnd((e) => {
      if (containerWidth <= 0) return;
      if (e.x < containerWidth * TAP_ZONE_FRACTION) {
        runOnJS(goPrev)();
      } else if (e.x > containerWidth * (1 - TAP_ZONE_FRACTION)) {
        runOnJS(goNext)();
      }
    });

  // Exclusive with tapGesture (below Gesture.Exclusive) so a long-enough
  // hold "wins" and the matching tap never also fires on release.
  const longPressGesture = Gesture.LongPress()
    .minDuration(200)
    .onStart(() => {
      runOnJS(setIsPaused)(true);
    })
    .onFinalize(() => {
      runOnJS(setIsPaused)(false);
    });

  // Race against panGesture: real movement activates the pan (swipe) first;
  // a mostly-stationary touch instead resolves to the long-press-vs-tap
  // pair, long-press winning once it's held past its own minDuration.
  const composedGesture = Gesture.Race(panGesture, Gesture.Exclusive(longPressGesture, tapGesture));

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: dismissOpacity.value,
    transform: [{ translateY: dismissTranslateY.value }],
  }));

  return (
    <View style={styles.root}>
      {/* The close button is a SIBLING, not a descendant, of the gesture-
          detected surface below — painted on top, so it claims its own taps
          outright instead of racing the edge-tap/long-press/swipe gestures
          covering the whole screen underneath it. It still gets its own
          Animated.View with the SAME animatedStyle as the backdrop below, so
          it visually slides/fades together with the photo during
          drag-to-dismiss, without actually living inside the gesture-
          detected tree (which would reintroduce the touch-priority problem
          this split was meant to avoid). The progress bar, name/calories and
          swipe hint are decorative (pointerEvents="none") and were never
          meant to intercept touches, so they live directly INSIDE the
          animated view instead.

          animatedStyle (translateY + opacity) is on this OUTER wrapper, not
          on `backdrop` itself, so `backdropOverscan` — a same-colored panel
          sitting just above the screen's top edge — moves and fades right
          along with it. Without that buffer, dragging down would slide
          `backdrop`'s own top edge away from y=0 and lay bare whatever
          happens to be behind this transparent Modal for however far it's
          been dragged; with it, that gap is covered by more backdrop until
          DISMISS_FADE_DISTANCE's worth of dragging has also faded the whole
          thing to nothing, so there's nothing left to notice uncovering. */}
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.backdropWrap, animatedStyle]} onLayout={handleContainerLayout}>
          <View style={styles.backdropOverscan} pointerEvents="none" />
          <View style={styles.backdrop}>
            <SideView
              key={`${item.checkinId}-${page.side}`}
              media={media}
              timezone={item.groupTimezone}
              paused={isPaused}
              onReady={setMediaDurationMs}
              onVideoEnd={goNext}
            />

            <View style={[styles.progressRow, { top: insets.top + spacing.sm }]} pointerEvents="none">
              {Array.from({ length: segmentCount }).map((_, i) => (
                <View key={i} style={styles.segmentTrack}>
                  {i < activeSegment ? (
                    <View style={[styles.segmentFill, styles.segmentFillDone]} />
                  ) : i === activeSegment ? (
                    <ActiveSegmentBar key={pageIndex} durationMs={mediaDurationMs} paused={isPaused} isVideo={!!media.videoPath} onComplete={goNext} />
                  ) : null}
                </View>
              ))}
            </View>

            {/* Same vertical level as the close button regardless of whether
                calories renders a second line — both share TOP_ROW_HEIGHT and
                center their content inside it, so the PAIR's vertical middle
                always lines up with the button's, not just the name's. */}
            <View style={[styles.topInfo, { top: insets.top + spacing.md }]} pointerEvents="none">
              <Text style={styles.topInfoName}>{item.fullName}</Text>
              {caloriesText ? <Text style={styles.topInfoCalories}>{caloriesText}</Text> : null}
            </View>

            {segmentCount > 1 && activeSegment === 0 ? (
              <View style={styles.swipeHint} pointerEvents="none">
                <Text style={styles.swipeHintText}>Desliza para ver el final ‹›</Text>
              </View>
            ) : null}
          </View>
        </Animated.View>
      </GestureDetector>

      <Animated.View style={[styles.closeButtonWrap, { top: insets.top + spacing.md }, animatedStyle]}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={16} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>Cerrar ✕</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdropWrap: { flex: 1 },
  // Same color as `backdrop` — sits just above the screen's top edge so a
  // downward drag never outruns it before the whole thing has already
  // faded away. See the doc comment above this component's JSX.
  backdropOverscan: {
    position: 'absolute',
    top: -DISMISS_FADE_DISTANCE,
    left: 0,
    right: 0,
    height: DISMISS_FADE_DISTANCE,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
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
  // Name + calories, for every page (photo or video) — centered in a row
  // the same fixed height as the close button (TOP_ROW_HEIGHT) so the
  // PAIR's vertical middle lines up with the button's whether calories
  // renders a second line or not, rather than just the name's top edge.
  topInfo: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    height: TOP_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topInfoName: { color: 'white', fontSize: 14, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  topInfoCalories: { color: 'white', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  segmentTrack: { flex: 1, height: 3, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  segmentFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary },
  segmentFillDone: { width: '100%' },
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
  closeButtonWrap: { position: 'absolute', right: spacing.lg, zIndex: 10, elevation: 10 },
  closeButton: {
    height: TOP_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeButtonText: { color: colors.text, fontWeight: '700' },
});
