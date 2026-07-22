import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/hooks/useAuth';
import { colors, spacing, typography } from '@/constants/theme';

export default function DeleteAccountScreen() {
  const { session, deleteAccount } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const email = session?.user.email ?? '';
  const emailMatches = confirmEmail.trim().toLowerCase() === email.toLowerCase();

  const handleDelete = () => {
    if (!password) {
      setError('Ingresa tu contraseña');
      return;
    }
    if (!emailMatches) {
      setError('El correo no coincide');
      return;
    }
    setError(undefined);
    Alert.alert(
      'Eliminar cuenta',
      'Esta acción es permanente y no se puede deshacer. Vas a perder acceso a tus grupos, check-ins y saldo. ¿Seguro que quieres continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar mi cuenta', style: 'destructive', onPress: confirmDelete },
      ]
    );
  };

  const confirmDelete = async () => {
    setIsSubmitting(true);
    try {
      await deleteAccount(password);
      router.replace('/sign-in');
    } catch (err) {
      Alert.alert('No se pudo eliminar la cuenta', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card style={styles.warningCard}>
          <Text style={styles.warningTitle}>Esto es permanente</Text>
          <Text style={styles.warningText}>
            Al eliminar tu cuenta se borran tu perfil, tus check-ins, tu historial de saldo y tus votos. Si eres
            administrador de un grupo que todavía tiene otros miembros, primero debes sacarlos a todos o esperar a
            que se vayan — no se puede eliminar la cuenta de un admin mientras el grupo siga activo con otras
            personas.
          </Text>
        </Card>

        <TextField label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry />
        <TextField
          label={`Escribe tu correo (${email}) para confirmar`}
          value={confirmEmail}
          onChangeText={setConfirmEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label="Eliminar mi cuenta"
          variant="danger"
          onPress={handleDelete}
          loading={isSubmitting}
          disabled={!password || !emailMatches}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  warningCard: { gap: spacing.xs },
  warningTitle: { ...typography.heading, color: colors.danger },
  warningText: { color: colors.textMuted },
  error: { color: colors.danger },
});
