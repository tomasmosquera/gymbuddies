import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button } from './Button';
import { colors, radii, spacing } from '@/constants/theme';

interface InlineDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  label?: string;
  /** Omit for no lower bound. */
  minimumDate?: Date;
  /** Omit for no upper bound — e.g. an activation date, which is routinely set in the future. */
  maximumDate?: Date;
}

/** iOS gets a self-contained compact tap-to-open pill; Android's picker opens as a modal dialog on button press (it can't stay mounted, since it opens instantly on mount). */
export function InlineDatePicker({ value, onChange, label, minimumDate, maximumDate }: InlineDatePickerProps) {
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
            mode="date"
            display="compact"
            themeVariant="dark"
            accentColor={colors.primary}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={handleChange}
          />
        </View>
      ) : (
        <View style={styles.androidWrapper}>
          <Button label={`📅 ${value.toLocaleDateString('es-CO')}`} variant="secondary" onPress={() => setIsOpen(true)} />
          {isOpen ? (
            <DateTimePicker
              value={value}
              mode="date"
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              onChange={handleChange}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  androidWrapper: { gap: spacing.xs },
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
