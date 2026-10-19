import { StyleSheet, Text, View } from 'react-native';
import { BodySilhouettePair, NEUTRAL_BODY_FILL, mixBodyFill } from '@/components/ui/BodySilhouette';
import { ALL_DRAWABLE_BODY_PARTS, type MuscleMapBodyPart } from '@/lib/domain/muscleBodyParts';
import { computeMuscleVolume, dateDaysAgo, type MuscleTrainingEntry } from '@/lib/domain/muscleTraining';
import { colors, radii, spacing, typography } from '@/constants/theme';

/**
 * The compact diagram-only card on the main Stats screen — rolling last 7 days (not the Mon-Sun
 * "Semana" window the full exercise-stats screen's selector offers), no tabs/list/chips. "Ver
 * más información" on that screen is where the rest (Fatiga, other windows, the ranked list)
 * lives, so this card stays a single glance, not a second copy of the full one.
 */
export function WeeklyMuscleBalanceCard({ entries }: { entries: readonly MuscleTrainingEntry[] }) {
  const todayString = new Date().toISOString().slice(0, 10);
  const counts = computeMuscleVolume(entries, dateDaysAgo(todayString, 7));
  const maxVolume = Math.max(0, ...ALL_DRAWABLE_BODY_PARTS.map((p) => counts[p] ?? 0));

  const colorFor = (part: string) => {
    const value = counts[part as MuscleMapBodyPart] ?? 0;
    if (value <= 0 || maxVolume <= 0) return NEUTRAL_BODY_FILL;
    return mixBodyFill(value / maxVolume);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Balance muscular — últimos 7 días</Text>
      <BodySilhouettePair colorFor={colorFor} />
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
  title: { ...typography.heading, fontSize: 15, color: colors.text, textAlign: 'center' },
});
