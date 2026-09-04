import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/constants/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Icon-badge + title header used to open a Card-wrapped section — the
 * visual language introduced in create-group.tsx's step headers. Reused
 * anywhere a screen is a continuous scroll of otherwise-independent
 * settings sections (admin-edit-group.tsx, admin-members.tsx) rather than
 * a sequential wizard, so editing a group still reads as the same visual
 * system as creating one.
 */
export function SectionHeader({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(61, 220, 151, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.heading, color: colors.text },
});
