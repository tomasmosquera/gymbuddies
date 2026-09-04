import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/constants/theme';

interface VersusBarProps {
  label: string;
  mine: number | null;
  theirs: number | null;
  theirName: string;
  /** Formats a non-null value for display, e.g. `(v) => \`${v}%\`` . */
  format: (value: number) => string;
}

/**
 * One metric, two bars stacked (me in emerald, the picked teammate in
 * amber) — the "Cara a cara" comparison's building block. Both bars share
 * the same scale (the larger of the two values), so length alone already
 * tells the story before either label is read.
 */
export function VersusBar({ label, mine, theirs, theirName, format }: VersusBarProps) {
  const max = Math.max(mine ?? 0, theirs ?? 0, 1);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Text style={[styles.name, styles.nameMe]} numberOfLines={1}>
          Tú
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, styles.fillMe, { width: `${(Math.max(mine ?? 0, 0) / max) * 100}%` }]} />
        </View>
        <Text style={styles.value}>{mine !== null ? format(mine) : '—'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.name} numberOfLines={1}>
          {theirName}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, styles.fillThem, { width: `${(Math.max(theirs ?? 0, 0) / max) * 100}%` }]} />
        </View>
        <Text style={styles.value}>{theirs !== null ? format(theirs) : '—'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { width: 72, color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  nameMe: { color: colors.primary },
  track: {
    flex: 1,
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radii.pill },
  fillMe: { backgroundColor: colors.primary },
  fillThem: { backgroundColor: colors.warning },
  value: { width: 52, textAlign: 'right', color: colors.text, fontSize: 12, fontWeight: '700' },
});
