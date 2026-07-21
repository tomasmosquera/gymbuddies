import { useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { receiptPath, uploadImage } from '@/lib/supabase/storage';
import { walletTransactionSchema } from '@/lib/validation/schemas';
import { colors, radii, spacing, typography } from '@/constants/theme';

export default function RechargeScreen() {
  const { session } = useAuth();
  const { group, isLoading } = useActiveGroup();
  const [amount, setAmount] = useState('');
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading || !group || !session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const pickReceipt = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus fotos para adjuntar el comprobante.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) setReceiptUri(result.assets[0].uri);
  };

  const handleSubmit = async () => {
    const result = walletTransactionSchema.safeParse({
      amount: Number(amount),
      receiptImageUri: receiptUri ?? '',
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      const path = receiptPath(group.id, session.user.id, `recharge-${Date.now()}`);
      await uploadImage('receipts', path, result.data.receiptImageUri);
      const { error: insertError } = await supabase.from('wallet_transactions').insert({
        group_id: group.id,
        user_id: session.user.id,
        type: 'recharge',
        amount: result.data.amount,
        status: 'pending',
        receipt_path: path,
      });
      if (insertError) throw new Error(insertError.message);
      Alert.alert('Comprobante enviado', 'El admin del grupo debe confirmar tu recarga.');
      router.back();
    } catch (err) {
      Alert.alert('No se pudo registrar la recarga', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>
        Transfiere el monto que quieras recargar y adjunta el comprobante. El admin debe confirmarlo.
      </Text>

      {group.admin_payment_info ? (
        <Card>
          <Text style={styles.cardLabel}>Datos de pago</Text>
          <Text style={styles.cardValue}>{group.admin_payment_info}</Text>
        </Card>
      ) : null}

      <View style={styles.form}>
        <TextField label="Monto (COP)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
        <Button
          label={receiptUri ? 'Cambiar comprobante' : 'Adjuntar comprobante'}
          variant="secondary"
          onPress={pickReceipt}
        />
        {receiptUri ? <Image source={{ uri: receiptUri }} style={styles.preview} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Enviar comprobante" onPress={handleSubmit} loading={isSubmitting} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  cardLabel: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  cardValue: { color: colors.text, fontSize: 16, fontWeight: '600' },
  form: { gap: spacing.md },
  preview: { width: '100%', height: 200, borderRadius: radii.md },
  error: { color: colors.danger },
});
