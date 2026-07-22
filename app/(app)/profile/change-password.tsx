import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/hooks/useAuth';
import { changePasswordSchema } from '@/lib/validation/schemas';
import { colors, spacing, typography } from '@/constants/theme';

export default function ChangePasswordScreen() {
  const { updatePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const result = changePasswordSchema.safeParse({ currentPassword, newPassword, confirmPassword });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      await updatePassword(result.data.currentPassword, result.data.newPassword);
      Alert.alert('Listo', 'Tu contraseña fue actualizada.');
      router.back();
    } catch (err) {
      Alert.alert('No se pudo cambiar la contraseña', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>Ingresa tu contraseña actual y la nueva contraseña que quieres usar.</Text>
        <TextField
          label="Contraseña actual"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
        />
        <TextField label="Nueva contraseña" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <TextField
          label="Confirmar nueva contraseña"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Cambiar contraseña" onPress={handleSubmit} loading={isSubmitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  error: { color: colors.danger },
});
