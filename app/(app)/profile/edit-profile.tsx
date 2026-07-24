import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/hooks/useAuth';
import { updateProfileSchema } from '@/lib/validation/schemas';
import { colors, spacing, typography } from '@/constants/theme';

export default function EditProfileScreen() {
  const { profile, session, updateProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const result = updateProfileSchema.safeParse({ fullName, phone });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      await updateProfile(result.data.fullName, result.data.phone || null);
      Alert.alert('Listo', 'Tu información fue actualizada.');
      router.back();
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>Actualiza tu nombre y teléfono. Tu correo no se puede cambiar aquí.</Text>

        <TextField label="Nombre completo" value={fullName} onChangeText={setFullName} />
        <TextField label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <TextField label="Correo" value={session?.user.email ?? ''} editable={false} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Guardar cambios" onPress={handleSubmit} loading={isSubmitting} />

        <Button
          label="Cambiar contraseña"
          variant="secondary"
          onPress={() => router.push('/profile/change-password')}
        />
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
