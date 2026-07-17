import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/constants/theme';

interface EmptyStateProps {
  title: string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  description: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
});
