import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BarList } from '@/components/stats/BarList';
import { BodySilhouettePair, NEUTRAL_BODY_FILL, mixBodyFill } from '@/components/ui/BodySilhouette';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ALL_DRAWABLE_BODY_PARTS, type MuscleMapBodyPart } from '@/lib/domain/muscleBodyParts';
import {
  classifyFatigue,
  computeDaysSinceTrained,
  computeMuscleVolume,
  windowSinceDate,
  type FatigueState,
  type MuscleTrainingEntry,
  type MuscleVolumeWindow,
} from '@/lib/domain/muscleTraining';
import { MUSCLE_BODY_PART_LABELS } from '@/constants/muscleBodyPartLabels';
import { colors, radii, spacing } from '@/constants/theme';

type Tab = 'balance' | 'fatiga';

const TAB_OPTIONS: { key: Tab; label: string }[] = [
  { key: 'balance', label: 'Balance muscular' },
  { key: 'fatiga', label: 'Fatiga' },
];

const WINDOW_OPTIONS: { key: MuscleVolumeWindow; label: string }[] = [
  { key: 'week', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'all', label: 'Todo' },
];

const FATIGUE_COLORS: Record<FatigueState, string> = {
  fatigued: colors.danger,
  recovering: colors.warning,
  ready: NEUTRAL_BODY_FILL,
};
const FATIGUE_LABELS: Record<FatigueState, string> = {
  fatigued: 'Fatigado',
  recovering: 'Recuperando',
  ready: 'Listo',
};

/**
 * Stats screen's "Balance muscular" / "Fatiga" card — same body diagram geometry as
 * MuscleDiagram.tsx, but driven by actually-logged sets (via `entries`, see
 * useMuscleTrainingHistory) instead of a routine's static plan. Balance shows each drawable
 * part's weighted set volume (primary muscle_group full, secondary_muscles half — see
 * computeMuscleVolume) over a selectable window, as a diagram gradient + ranked bar list, with
 * untrained parts called out separately. Fatiga shows the same diagram colored by how recently
 * each part was last touched, regardless of window — Fatigado/Recuperando/Listo, a simple
 * days-since-trained heuristic (see classifyFatigue), not a real recovery model.
 */
export function MuscleBalanceFatigueCard({ entries }: { entries: readonly MuscleTrainingEntry[] }) {
  const [tab, setTab] = useState<Tab>('balance');
  const [volumeWindow, setVolumeWindow] = useState<MuscleVolumeWindow>('week');
  const todayString = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const volumeCounts = useMemo(
    () => computeMuscleVolume(entries, windowSinceDate(volumeWindow, todayString)),
    [entries, volumeWindow, todayString]
  );
  const daysSinceTrained = useMemo(() => computeDaysSinceTrained(entries, todayString), [entries, todayString]);

  const trainedParts = ALL_DRAWABLE_BODY_PARTS.filter((p) => (volumeCounts[p] ?? 0) > 0).sort(
    (a, b) => (volumeCounts[b] ?? 0) - (volumeCounts[a] ?? 0)
  );
  const untrainedParts = ALL_DRAWABLE_BODY_PARTS.filter((p) => !(volumeCounts[p] ?? 0));
  const maxVolume = trainedParts.length > 0 ? (volumeCounts[trainedParts[0]] ?? 0) : 0;

  const colorForBalance = (part: string) => {
    const value = volumeCounts[part as MuscleMapBodyPart] ?? 0;
    if (value <= 0 || maxVolume <= 0) return NEUTRAL_BODY_FILL;
    return mixBodyFill(value / maxVolume);
  };
  const colorForFatigue = (part: string) => FATIGUE_COLORS[classifyFatigue(daysSinceTrained[part as MuscleMapBodyPart])];

  return (
    <View style={styles.card}>
      <SegmentedControl options={TAB_OPTIONS} value={tab} onChange={setTab} />

      {tab === 'balance' ? (
        <>
          <SegmentedControl options={WINDOW_OPTIONS} value={volumeWindow} onChange={setVolumeWindow} />
          <BodySilhouettePair colorFor={colorForBalance} />
          {trainedParts.length > 0 ? (
            <>
              <BarList
                items={trainedParts.map((part) => ({
                  label: MUSCLE_BODY_PART_LABELS[part],
                  ratio: maxVolume > 0 ? (volumeCounts[part] ?? 0) / maxVolume : 0,
                  valueLabel: (volumeCounts[part] ?? 0).toFixed(1),
                  highlight: true,
                }))}
                color={colors.primary}
              />
              <Text style={styles.caption}>
                El número es la cantidad de series en el período: cada serie cuenta 1 para el músculo principal del
                ejercicio y 0.5 para cada secundario.
              </Text>
            </>
          ) : (
            <Text style={styles.emptyText}>Sin series registradas en este período.</Text>
          )}
          {untrainedParts.length > 0 ? (
            <View style={styles.untrainedBlock}>
              <Text style={styles.untrainedLabel}>No entrenado en este período</Text>
              <View style={styles.chipWrap}>
                {untrainedParts.map((part) => (
                  <View key={part} style={styles.chip}>
                    <Text style={styles.chipText}>{MUSCLE_BODY_PART_LABELS[part]}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <>
          <BodySilhouettePair colorFor={colorForFatigue} />
          <View style={styles.legendRow}>
            {(['fatigued', 'recovering', 'ready'] as FatigueState[]).map((state) => (
              <View key={state} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: FATIGUE_COLORS[state] }]} />
                <Text style={styles.legendText}>{FATIGUE_LABELS[state]}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.caption}>
            La fatiga muestra qué tan reciente se entrenó cada músculo — menos de 2 días: fatigado, 2 a 4: recuperando, más de 4 (o nunca): listo.
          </Text>
        </>
      )}
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
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.sm },
  untrainedBlock: { gap: spacing.xs, marginTop: spacing.xs },
  untrainedLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
