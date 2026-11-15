import { useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors, radii } from '@/constants/theme';

/**
 * A pulsing gray box standing in for not-yet-loaded content — the same pulse
 * (opacity 0.35↔0.8 over 700ms, infinite reverse) everywhere skeleton
 * loading appears in the app, so switching screens doesn't feel like a
 * different loading idiom each time. Pass `style` for size/shape (width,
 * height, borderRadius) — defaults to a small rounded rectangle.
 */
export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.8, { duration: 700 }), -1, true);
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.base, style, animatedStyle]} />;
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.surfaceAlt, borderRadius: radii.sm, height: 14, width: '100%' },
});
