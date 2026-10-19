import { StyleSheet, Text, View } from 'react-native';
import { BodySilhouettePair, NEUTRAL_BODY_FILL } from '@/components/ui/BodySilhouette';
import { bodyPartsToHighlight, type MuscleMapBodyPart } from '@/lib/domain/muscleBodyParts';
import { collectRoutineMuscleGroups } from '@/lib/domain/routineMuscles';
import { MUSCLE_GROUP_LABELS } from '@/constants/muscleGroups';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { MuscleGroup } from '@/lib/supabase/types';

// Secondary muscles render at a flat, less saturated green rather than full intensity — the
// same 100%/50% primary/secondary weighting muscleDistribution.ts already uses elsewhere.
const SECONDARY_FILL = '#3A8E6C';

export interface MuscleDiagramExercise {
  muscleGroup: MuscleGroup;
  secondaryMuscles?: readonly string[];
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
  const colorFor = (part: string) => {
    if (highlight.primary.has(part as MuscleMapBodyPart)) return colors.primary;
    if (highlight.secondary.has(part as MuscleMapBodyPart)) return SECONDARY_FILL;
    return NEUTRAL_BODY_FILL;
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Qué músculos trabaja</Text>
      <BodySilhouettePair colorFor={colorFor} />
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
