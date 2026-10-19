import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MALE_BACK, MALE_FRONT, type MuscleBodyView } from '@/components/ui/muscleMapBodyPaths';
import { colors, spacing } from '@/constants/theme';

const DEFAULT_HEIGHT = 220;

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
