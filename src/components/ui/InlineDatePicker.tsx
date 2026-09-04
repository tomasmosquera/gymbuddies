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
  /** Wider, centered presentation for when this picker is the whole focus of
   * its own step/section (e.g. create-group-v2's "fecha futura" step) rather
   * than one compact field among several in a form row. */
  wide?: boolean;
}

/** iOS gets a self-contained compact tap-to-open pill; Android's picker opens as a modal dialog on button press (it can't stay mounted, since it opens instantly on mount). */
export function InlineDatePicker({ value, onChange, label, minimumDate, maximumDate, wide }: InlineDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    setIsOpen(false);
    if (event.type === 'set' && date) onChange(date);
  };

  return (
    <View style={[styles.container, wide && styles.containerWide]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {Platform.OS === 'ios' ? (
        <View style={[styles.iosWrapper, wide && styles.iosWrapperWide]}>
          <DateTimePicker
            value={value}
            mode="date"
            display="compact"
            themeVariant="dark"
            accentColor={colors.primary}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={handleChange}
            style={wide ? styles.pickerWide : undefined}
          />
        </View>
      ) : (
        <View style={[styles.androidWrapper, wide && styles.androidWrapperWide]}>
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
  // alignItems: 'center' keeps this a compact, centered chip regardless of
  // how wide the parent form is — without it, a plain column layout
  // stretches this to the full row width, leaving the small date control
  // (or the Android button) sitting left-aligned inside an oversized box.
  container: { gap: spacing.xs, alignItems: 'center' },
  containerWide: { width: '100%' },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  androidWrapper: { gap: spacing.xs, alignItems: 'center' },
  androidWrapperWide: { width: '100%' },
  iosWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  iosWrapperWide: {
    width: '100%',
    paddingVertical: spacing.sm,
  },
  pickerWide: { width: 220 },
});
