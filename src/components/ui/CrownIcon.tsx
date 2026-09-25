import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/constants/theme';

interface CrownIconProps {
  size?: number;
  color?: string;
}

/**
 * A drawn (SVG, not an emoji) three-point crown — what a Liga champion's
 * avatar shows in place of their initials (see AvatarWithLevel/AvatarLevelRing).
 * Drawn on a 24x24 grid: the body is one closed path (three peaks over a
 * flat band), with a small jewel on each peak so it still reads as a crown
 * and not a generic zig-zag at 14-16px.
 */
export function CrownIcon({ size = 16, color = colors.gold }: CrownIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 18.5 L2 8 L7.5 12.5 L12 5 L16.5 12.5 L22 8 L21 18.5 Z" fill={color} />
      <Path d="M3.5 20 H20.5 V22 H3.5 Z" fill={color} />
      <Circle cx="2" cy="7" r="1.6" fill={color} />
      <Circle cx="12" cy="4" r="1.6" fill={color} />
      <Circle cx="22" cy="7" r="1.6" fill={color} />
    </Svg>
  );
}
