import { TextField } from './TextField';

interface MoneyFieldProps {
  label: string;
  hint?: string;
  /** Raw digits only (e.g. "100000"), never a formatted string — the display formatting is purely visual. */
  value: string;
  onChangeValue: (raw: string) => void;
  /** Shown formatted (e.g. 100000 -> "100.000") as the placeholder — the value used if the field is left empty. */
  defaultValue?: number;
  error?: string;
}

function formatThousands(digits: string): string {
  if (!digits) return '';
  return Number(digits).toLocaleString('es-CO');
}

/** A money TextField that shows Colombian thousand-separator formatting ("100.000") as the user types, while exposing the plain digit string for validation/submission. */
export function MoneyField({ label, hint, value, onChangeValue, defaultValue, error }: MoneyFieldProps) {
  return (
    <TextField
      label={label}
      hint={hint}
      value={formatThousands(value)}
      onChangeText={(text) => onChangeValue(text.replace(/[^0-9]/g, ''))}
      keyboardType="numeric"
      returnKeyType="done"
      placeholder={defaultValue !== undefined ? defaultValue.toLocaleString('es-CO') : undefined}
      error={error}
    />
  );
}
