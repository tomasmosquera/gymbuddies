import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MALE_BACK, MALE_FRONT, type MuscleBodyView } from '@/components/ui/muscleMapBodyPaths';
import { colors, spacing } from '@/constants/theme';

const DEFAULT_HEIGHT = 220;

/** The "nothing to show here" fill every body diagram in the app falls back to —
 * colors.surfaceAlt (the card's own tone) nearly matched the app's dark background, so an
 * untrained/neutral region needs its own lighter gray to still read as a body. */
export const NEUTRAL_BODY_FILL = '#5A6472';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear interpolation from NEUTRAL_BODY_FILL to colors.primary at `ratio` (0-1, clamped) — the
 * shared "how much of this part's own busiest neighbor" gradient for any volume-based diagram
 * (Stats' Balance muscular), so a lightly-trained muscle still reads as visibly lit, not just
 * on/off. */
export function mixBodyFill(ratio: number): string {
  const [r1, g1, b1] = hexToRgb(NEUTRAL_BODY_FILL);
  const [r2, g2, b2] = hexToRgb(colors.primary);
  const t = Math.max(0, Math.min(1, ratio));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

function SingleView({ view, height, colorFor }: { view: MuscleBodyView; height: number; colorFor: (part: string) => string }) {
  const [, , vbWidth, vbHeight] = view.viewBox.split(' ').map(Number);
  const width = (height * vbWidth) / vbHeight;
  return (
    <Svg width={width} height={height} viewBox={view.viewBox}>
      {Object.entries(view.parts).map(([part, paths]) =>
        paths.map((d, i) => <Path key={`${part}-${i}`} d={d} fill={colorFor(part)} stroke={colors.surface} strokeWidth={3} />)
      )}
    </Svg>
  );
}

/**
 * The shared front+back silhouette renderer behind every body-diagram use in the app (routine/
 * exercise "qué músculos trabaja" in MuscleDiagram.tsx, Stats' "Balance muscular"/"Fatiga") —
 * only the per-part fill color differs between them, via `colorFor`, so each caller owns its own
 * color model (binary highlight, continuous volume gradient, 3-state fatigue) while the geometry,
 * layout and stroke stay in one place. `colorFor` also receives the silhouette-only parts (head,
 * hair, neck, hands, feet, knees, ankles) — callers that don't highlight those can just fall
 * through to their own neutral/default color for any part they don't recognize.
 */
export function BodySilhouettePair({ height = DEFAULT_HEIGHT, colorFor }: { height?: number; colorFor: (part: string) => string }) {
  return (
    <View style={styles.row}>
      <SingleView view={MALE_FRONT} height={height} colorFor={colorFor} />
      <SingleView view={MALE_BACK} height={height} colorFor={colorFor} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
});
