import { StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { colors, radii, spacing } from '@/constants/theme';

const DAY_ROW_COUNT = 5;

/**
 * Stands in for Dashboard while its gating data (active group) is still
 * loading — mirrors the real screen's header (period tabs, summary card,
 * view-mode tabs, section title) and a handful of day-row cards, same
 * padding/gaps as the real `styles.container`/`styles.header`, so nothing
 * shifts once the real content swaps in.
 */
export function DashboardSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Skeleton style={styles.pillBar} />
        <Card style={styles.summaryCard}>
          <Skeleton style={{ height: 13, width: '55%' }} />
          <Skeleton style={{ height: 32, width: '30%' }} />
          <Skeleton style={{ height: 12, width: '85%' }} />
        </Card>
        <Skeleton style={styles.pillBar} />
        <Skeleton style={{ height: 13, width: '60%' }} />
      </View>

      <View style={styles.dayRows}>
        {Array.from({ length: DAY_ROW_COUNT }).map((_, i) => (
          <Card key={i} style={styles.dayCard}>
            <Skeleton style={{ height: 14, width: '22%' }} />
            <Skeleton style={{ height: 14, width: '40%' }} />
          </Card>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.background, flex: 1 },
  header: { gap: spacing.md, marginBottom: spacing.md },
  pillBar: { height: 36, width: '100%', borderRadius: radii.pill },
  summaryCard: { gap: spacing.xs },
  dayRows: { gap: spacing.sm },
  dayCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
