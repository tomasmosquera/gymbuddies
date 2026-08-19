import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button } from './Button';
import { colors, radii, spacing } from '@/constants/theme';

interface InlineTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  label?: string;
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** InlineDatePicker's sibling for hour:minute — same compact-pill-on-iOS / modal-on-press-on-Android split, just mode="time" instead of "date". */
export function InlineTimePicker({ value, onChange, label }: InlineTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    setIsOpen(false);
    if (event.type === 'set' && date) onChange(date);
  };

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {Platform.OS === 'ios' ? (
        <View style={styles.iosWrapper}>
          <DateTimePicker
            value={value}
            mode="time"
            display="compact"
            themeVariant="dark"
            accentColor={colors.primary}
            onChange={handleChange}
          />
        </View>
      ) : (
        <View style={styles.androidWrapper}>
          <Button label={`🕒 ${formatTime(value)}`} variant="secondary" onPress={() => setIsOpen(true)} />
          {isOpen ? <DateTimePicker value={value} mode="time" onChange={handleChange} /> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, alignItems: 'center' },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  androidWrapper: { gap: spacing.xs, alignItems: 'center' },
  iosWrapper: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
});
