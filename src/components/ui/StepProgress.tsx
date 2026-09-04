import { StyleSheet, View } from 'react-native';
import { colors } from '@/constants/theme';

/** Segmented progress bar for a step wizard — one thin bar per step, filled
 * up through the current one. Introduced in create-group.tsx; reused
 * anywhere else a multi-step flow needs the same "Paso X de Y" treatment. */
export function StepProgress({ total, currentIndex }: { total: number; currentIndex: number }) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.segment, i <= currentIndex && styles.segmentDone]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  segmentDone: { backgroundColor: colors.primary },
});
