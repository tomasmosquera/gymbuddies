import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { bodyPartsToHighlight, type MuscleBodyHighlight, type MuscleMapBodyPart } from '@/lib/domain/muscleBodyParts';
import { collectRoutineMuscleGroups } from '@/lib/domain/routineMuscles';
import { MALE_BACK, MALE_FRONT, type MuscleBodyView } from '@/components/ui/muscleMapBodyPaths';
import { MUSCLE_GROUP_LABELS } from '@/constants/muscleGroups';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { MuscleGroup } from '@/lib/supabase/types';

const DIAGRAM_HEIGHT = 220;
// colors.surfaceAlt (the card's own tone) made untrained muscles nearly invisible against the
// app's dark blue theme — a lighter, visibly gray fill so the body itself reads clearly even
// where nothing is highlighted.
const INACTIVE_FILL = '#5A6472';
// Secondary muscles render at half intensity (fillOpacity, over the transparent SVG canvas) —
// the same 100%/50% primary/secondary weighting muscleDistribution.ts already uses elsewhere.
const SECONDARY_OPACITY = 0.45;

export interface MuscleDiagramExercise {
  muscleGroup: MuscleGroup;
  secondaryMuscles?: readonly string[];
}

function BodyView({ view, highlight }: { view: MuscleBodyView; highlight: MuscleBodyHighlight }) {
  const [, , vbWidth, vbHeight] = view.viewBox.split(' ').map(Number);
  const width = (DIAGRAM_HEIGHT * vbWidth) / vbHeight;
  return (
    <Svg width={width} height={DIAGRAM_HEIGHT} viewBox={view.viewBox}>
      {Object.entries(view.parts).map(([part, paths]) =>
        paths.map((d, i) => {
          const isPrimary = highlight.primary.has(part as MuscleMapBodyPart);
          const isSecondary = !isPrimary && highlight.secondary.has(part as MuscleMapBodyPart);
          return (
            <Path
              key={`${part}-${i}`}
              d={d}
              fill={isPrimary || isSecondary ? colors.primary : INACTIVE_FILL}
              fillOpacity={isSecondary ? SECONDARY_OPACITY : 1}
              stroke={colors.surface}
              strokeWidth={3}
            />
          );
        })
      )}
    </Svg>
  );
}

/**
 * "Qué músculos trabaja" — a front+back body diagram (real anatomy, not a stylized
 * placeholder — geometry from MuscleMap, see muscleMapBodyPaths.ts). Each exercise's own
 * primary muscle_group lights up at full intensity, its secondary_muscles at half (see
 * bodyPartsToHighlight), plus a chip list underneath for the primary groups only (including
 * 'cardio'/'full_body', which have no body region of their own to light up). Used both for a
 * single exercise (one-element array) and a whole routine (every exercise in it).
 */
export function MuscleDiagram({ exercises }: { exercises: readonly MuscleDiagramExercise[] }) {
  const chips = collectRoutineMuscleGroups(exercises.map((e) => e.muscleGroup));
  const highlight = bodyPartsToHighlight(exercises);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Qué músculos trabaja</Text>
      <View style={styles.diagramRow}>
        <BodyView view={MALE_FRONT} highlight={highlight} />
        <BodyView view={MALE_BACK} highlight={highlight} />
      </View>
      <View style={styles.chipRow}>
        {chips.map((group) => (
          <View key={group} style={[styles.chip, styles.chipActive]}>
            <Text style={[styles.chipText, styles.chipTextActive]}>{MUSCLE_GROUP_LABELS[group]}</Text>
          </View>
        ))}
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
