import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { bodyPartsToHighlight, type MuscleMapBodyPart } from '@/lib/domain/muscleBodyParts';
import { collectRoutineMuscleGroups } from '@/lib/domain/routineMuscles';
import { MALE_BACK, MALE_FRONT, type MuscleBodyView } from '@/components/ui/muscleMapBodyPaths';
import { MUSCLE_GROUP_LABELS } from '@/constants/muscleGroups';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { MuscleGroup } from '@/lib/supabase/types';

const DIAGRAM_HEIGHT = 220;

function BodyView({ view, highlighted }: { view: MuscleBodyView; highlighted: ReadonlySet<MuscleMapBodyPart> }) {
  const [, , vbWidth, vbHeight] = view.viewBox.split(' ').map(Number);
  const width = (DIAGRAM_HEIGHT * vbWidth) / vbHeight;
  return (
    <Svg width={width} height={DIAGRAM_HEIGHT} viewBox={view.viewBox}>
      {Object.entries(view.parts).map(([part, paths]) =>
        paths.map((d, i) => (
          <Path
            key={`${part}-${i}`}
            d={d}
            fill={highlighted.has(part as MuscleMapBodyPart) ? colors.primary : colors.surfaceAlt}
            stroke={colors.surface}
            strokeWidth={3}
          />
        ))
      )}
    </Svg>
  );
}

/**
 * "Qué músculos trabaja" — a front+back body diagram (real anatomy, not a stylized
 * placeholder — geometry from MuscleMap, see muscleMapBodyPaths.ts) with each trained
 * muscle group highlighted, plus a chip list underneath (including 'cardio'/'full_body',
 * which have no body region of their own to light up — see muscleBodyParts.ts). Used both
 * for a single exercise (one group) and a whole routine (the union across every exercise
 * in it, via collectRoutineMuscleGroups upstream).
 */
export function MuscleDiagram({ muscleGroups }: { muscleGroups: readonly MuscleGroup[] }) {
  const chips = collectRoutineMuscleGroups(muscleGroups);
  const highlighted = bodyPartsToHighlight(muscleGroups);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Qué músculos trabaja</Text>
      <View style={styles.diagramRow}>
        <BodyView view={MALE_FRONT} highlighted={highlighted} />
        <BodyView view={MALE_BACK} highlighted={highlighted} />
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
