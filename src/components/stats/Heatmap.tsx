import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BadgeDayRecord } from '@/lib/domain/badges';
import { colors, radii, spacing } from '@/constants/theme';

const CELL_SIZE = 11;
const CELL_GAP = 3;

function cellColor(status: BadgeDayRecord['status'] | undefined): string {
  if (status === 'completed') return colors.success;
  if (status === 'failed') return colors.danger;
  if (status === 'excused') return colors.warning;
  return colors.surfaceAlt;
}

/** A GitHub-contributions-style grid: one column per week, one row per weekday (Mon top, Sun bottom). */
export function Heatmap({ weeks }: { weeks: (BadgeDayRecord | null)[][] }) {
  const scrollRef = useRef<ScrollView>(null);

  // Weeks are oldest-first, so a brand-new member/group (with far fewer
  // than HEATMAP_WEEKS_TO_SHOW weeks of real history) renders mostly empty
  // leading columns — without anchoring to the end, the actual data sits
  // off-screen to the right and looks like there's nothing there at all.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [weeks]);

  return (
    <View>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.grid}>
          {weeks.map((week, wi) => (
            <View key={wi} style={styles.column}>
              {week.map((cell, di) => (
                <View key={di} style={[styles.cell, { backgroundColor: cellColor(cell?.status) }]} />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.legendRow}>
        <LegendDot color={colors.success} label="Completado" />
        <LegendDot color={colors.danger} label="Fallado" />
        <LegendDot color={colors.warning} label="Excusado" />
        <LegendDot color={colors.surfaceAlt} label="Sin datos" />
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: CELL_GAP },
  column: { gap: CELL_GAP },
  cell: { width: CELL_SIZE, height: CELL_SIZE, borderRadius: 2 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 10, height: 10, borderRadius: radii.sm / 2 },
  legendText: { color: colors.textMuted, fontSize: 11 },
});
