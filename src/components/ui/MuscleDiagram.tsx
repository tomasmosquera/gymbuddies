import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { collectRoutineMuscleGroups, DRAWABLE_MUSCLE_GROUPS } from '@/lib/domain/routineMuscles';
import { MUSCLE_GROUP_LABELS } from '@/constants/muscleGroups';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { MuscleGroup } from '@/lib/supabase/types';

const WIDTH = 108;
const HEIGHT = 250;

type RectRegion = { group: MuscleGroup | null; x: number; y: number; width: number; height: number; rx: number };
type CircleRegion = { group: null; cx: number; cy: number; r: number };
type Region = RectRegion | CircleRegion;

/** A mirrored left/right pair of the same rect, e.g. both biceps. */
function pair(group: MuscleGroup | null, x: number, y: number, width: number, height: number, rx: number): RectRegion[] {
  return [
    { group, x, y, width, height, rx },
    { group, x: WIDTH - x - width, y, width, height, rx },
  ];
}

// A deliberately simple, stylized figure (rounded boxes, not real anatomy) —
// same hand-drawn-SVG house style as RadarChart/LineChart. Front and back
// share one coordinate system so the two silhouettes line up; each view only
// highlights the groups actually visible from that side (e.g. hamstrings are
// drawn on the back, quads on the front) so nothing is ever drawn twice.
const FRONT_REGIONS: Region[] = [
  { group: null, cx: 54, cy: 18, r: 15 }, // head
  { group: null, x: 46, y: 30, width: 16, height: 10, rx: 4 }, // neck
  ...pair('shoulders', 10, 38, 28, 18, 9),
  { group: 'chest', x: 30, y: 42, width: 48, height: 34, rx: 10 },
  { group: 'core', x: 34, y: 74, width: 40, height: 34, rx: 8 },
  ...pair('biceps', 4, 52, 18, 42, 9),
  ...pair('forearms', 4, 92, 16, 46, 8),
  { group: null, x: 30, y: 106, width: 48, height: 22, rx: 8 }, // hips
  ...pair('quads', 25, 126, 27, 58, 10),
  ...pair(null, 28, 184, 21, 56, 8), // shins (calves are highlighted on the back view instead)
];

const BACK_REGIONS: Region[] = [
  { group: null, cx: 54, cy: 18, r: 15 }, // head
  { group: null, x: 46, y: 30, width: 16, height: 10, rx: 4 }, // neck
  { group: 'back', x: 18, y: 38, width: 72, height: 68, rx: 12 },
  ...pair('triceps', 4, 52, 18, 42, 9),
  ...pair(null, 4, 92, 16, 46, 8), // forearms already highlighted on the front view
  { group: 'glutes', x: 28, y: 106, width: 52, height: 28, rx: 10 },
  ...pair('hamstrings', 25, 136, 27, 50, 10),
  ...pair('calves', 28, 184, 21, 56, 8),
];

function Silhouette({ regions, highlighted }: { regions: Region[]; highlighted: ReadonlySet<MuscleGroup> }) {
  return (
    <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {regions.map((region, i) => {
        const active = region.group !== null && highlighted.has(region.group);
        const fill = active ? colors.primary : colors.surfaceAlt;
        if ('r' in region) return <Circle key={i} cx={region.cx} cy={region.cy} r={region.r} fill={fill} />;
        return <Rect key={i} x={region.x} y={region.y} width={region.width} height={region.height} rx={region.rx} fill={fill} />;
      })}
    </Svg>
  );
}

/**
 * "Qué músculos trabaja" — a front+back body diagram with each trained
 * muscle group highlighted, plus a chip list underneath (including
 * 'cardio'/'full_body', which have no body region of their own to light up).
 * Used both for a single exercise (one group) and a whole routine (the union
 * across every exercise in it, via collectRoutineMuscleGroups upstream).
 */
export function MuscleDiagram({ muscleGroups }: { muscleGroups: readonly MuscleGroup[] }) {
  const chips = collectRoutineMuscleGroups(muscleGroups);
  const isFullBody = muscleGroups.includes('full_body');
  const highlighted = new Set<MuscleGroup>(isFullBody ? DRAWABLE_MUSCLE_GROUPS : muscleGroups);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Qué músculos trabaja</Text>
      <View style={styles.diagramRow}>
        <Silhouette regions={FRONT_REGIONS} highlighted={highlighted} />
        <Silhouette regions={BACK_REGIONS} highlighted={highlighted} />
      </View>
      <View style={styles.chipRow}>
        {chips.map((group) => {
          const active = group === 'full_body' || group === 'cardio' || highlighted.has(group);
          return (
            <View key={group} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{MUSCLE_GROUP_LABELS[group]}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { ...typography.heading, fontSize: 15, color: colors.text },
  diagramRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center' },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: 'rgba(61, 220, 151, 0.15)', borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: colors.primary },
});
