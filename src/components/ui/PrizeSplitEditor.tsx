import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { colors, radii, spacing } from '@/constants/theme';

const PLACE_LABELS = ['1er', '2do', '3er', '4to', '5to', '6to', '7mo', '8vo', '9no', '10mo'];
const MAX_PLACES = PLACE_LABELS.length;

interface PrizeSplitEditorProps {
  /** One raw text entry per prize place, in order (1st place first) — kept as strings, like every other numeric field in this app, so typing never flashes NaN. */
  values: string[];
  onChange: (values: string[]) => void;
}

/** Editor for "% of the prize per place" — a dynamic list of place rows (add/remove) with a live running total, replacing a comma-separated text field. */
export function PrizeSplitEditor({ values, onChange }: PrizeSplitEditorProps) {
  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);

  const updateAt = (index: number, next: string) => {
    onChange(values.map((v, i) => (i === index ? next : v)));
  };

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const addPlace = () => {
    if (values.length >= MAX_PLACES) return;
    onChange([...values, '']);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Premio por puesto</Text>
      <Text style={styles.hint}>Qué % del fondo de Liga se lleva cada puesto del ranking al terminar el ciclo.</Text>
      {values.map((value, index) => (
        <View key={index} style={styles.row}>
          <Text style={styles.placeLabel}>{PLACE_LABELS[index] ?? `${index + 1}°`} puesto</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={(t) => updateAt(index, t)}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.percentSign}>%</Text>
          <Pressable onPress={() => removeAt(index)} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
      <View style={styles.footer}>
        <Button
          label="+ Agregar puesto"
          variant="secondary"
          onPress={addPlace}
          disabled={values.length >= MAX_PLACES}
        />
        <Text style={[styles.total, total > 100 && styles.totalOver]}>Total: {total}%</Text>
      </View>
      {total > 100 ? <Text style={styles.error}>La suma no puede superar 100%</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  placeLabel: { color: colors.text, width: 64 },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 16,
  },
  percentSign: { color: colors.textMuted },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  total: { color: colors.textMuted, fontWeight: '600' },
  totalOver: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});
