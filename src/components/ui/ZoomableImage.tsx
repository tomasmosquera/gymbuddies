import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Image } from 'expo-image';

const AnimatedImage = Animated.createAnimatedComponent(Image);

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE_THRESHOLD = 120;
const DISMISS_VELOCITY_THRESHOLD = 800;

interface ZoomableImageProps {
  uri: string;
  style?: StyleProp<ViewStyle>;
  /** Called when the user drags the (unzoomed) image down far/fast enough to dismiss — e.g. close the modal it's shown in. Dragging while zoomed in always pans instead, never dismisses. */
  onDismiss?: () => void;
  /** Stable identity for the underlying photo (e.g. its storage path), independent of `uri` — signed URLs get a new token on every fetch, so without this expo-image's cache would miss every time even for a photo already downloaded. */
  cacheKey?: string;
}

/**
 * Pinch-to-zoom + pan + double-tap-to-zoom + swipe-down-to-dismiss, for
 * viewing photo detail (check-in photos, excuse proof photos) — not a
 * gallery/swiper, just one image at a time. Give it a `key={uri}` from the
 * caller when swapping between photos in the same mounted modal, so zoom/
 * pan/dismiss state resets per photo instead of carrying over.
 */
export function ZoomableImage({ uri, style, onDismiss, cacheKey }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const dismissTranslateY = useSharedValue(0);
  const dismissOpacity = useSharedValue(1);

  const resetZoom = () => {
    'worklet';
    scale.value = withSpring(1);
    savedScale.value = 1;
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(1, savedScale.value * e.scale), MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) resetZoom();
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      } else if (onDismiss) {
        dismissTranslateY.value = e.translationY;
        dismissOpacity.value = Math.max(1 - Math.abs(e.translationY) / 400, 0.4);
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }
      if (!onDismiss) return;
      if (Math.abs(e.translationY) > DISMISS_DISTANCE_THRESHOLD || Math.abs(e.velocityY) > DISMISS_VELOCITY_THRESHOLD) {
        runOnJS(onDismiss)();
      } else {
        dismissTranslateY.value = withSpring(0);
        dismissOpacity.value = withSpring(1);
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        resetZoom();
      } else {
        scale.value = withSpring(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
      }
    });

  const composedGesture = Gesture.Race(doubleTapGesture, Gesture.Simultaneous(pinchGesture, panGesture));

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: dismissOpacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value + dismissTranslateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.container, style]}>
        <AnimatedImage
          source={{ uri, cacheKey }}
          style={[styles.image, animatedStyle]}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: '100%' },
  image: { width: '100%', height: '100%' },
});
