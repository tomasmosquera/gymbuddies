import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { colors, spacing } from '@/constants/theme';

export default function AdminEditGroupScreen() {
  const { group, refresh } = useActiveGroup();
  const [name, setName] = useState(group?.name ?? '');
  const [adminPaymentInfo, setAdminPaymentInfo] = useState(group?.admin_payment_info ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!group) return;
    if (name.trim().length < 3) {
      Alert.alert('Nombre inválido', 'El nombre debe tener al menos 3 caracteres.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('groups')
        .update({ name: name.trim(), admin_payment_info: adminPaymentInfo.trim() || null })
        .eq('id', group.id);
      if (error) throw new Error(error.message);
      await refresh();
      router.replace('/profile/admin');
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <TextField label="Nombre del grupo" value={name} onChangeText={setName} />
          <TextField
            label="Datos de pago (Nequi, Bancolombia, etc.)"
            value={adminPaymentInfo}
            onChangeText={setAdminPaymentInfo}
            placeholder="Ej: Nequi 300 123 4567"
          />
          <Button label="Guardar cambios" onPress={handleSubmit} loading={isSubmitting} />
          <Button
            label="Cancelar"
            variant="secondary"
            onPress={() => router.replace('/profile/admin')}
            disabled={isSubmitting}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg },
  form: { gap: spacing.md },
});
