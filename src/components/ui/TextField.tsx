import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radii, spacing } from '@/constants/theme';

interface TextFieldProps extends TextInputProps {
  label: string;
  /** Short explanation of what this field actually does — shown under the label, above the input. */
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, style, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor={colors.textMuted}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginTop: -4 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    color: colors.text,
    fontSize: 16,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});
