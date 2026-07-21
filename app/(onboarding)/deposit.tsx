import { useEffect, useState } from 'react';
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

export default function DepositScreen() {
  const { session, signOut } = useAuth();
  const { group, membership, isLoading, refresh } = useActiveGroup();
  const [amount, setAmount] = useState('');
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCheckingExisting, setIsCheckingExisting] = useState(true);

  useEffect(() => {
    if (!group || !session) return;
    let isMounted = true;
    supabase
      .from('wallet_transactions')
      .select('id')
      .eq('group_id', group.id)
      .eq('user_id', session.user.id)
      .eq('type', 'initial_deposit')
      .eq('status', 'pending')
      .maybeSingle()
      .then(({ data }) => {
        if (!isMounted) return;
        if (data) {
          setPendingTransactionId(data.id);
          setJustSubmitted(true);
        }
        setIsCheckingExisting(false);
      });
    return () => {
      isMounted = false;
    };
  }, [group, session]);

  if (isLoading || isCheckingExisting || !group || !membership || !session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const amountValue = amount ? Number(amount) : group.initial_deposit_amount;

  const pickReceipt = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus fotos para adjuntar el comprobante.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setReceiptUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    const result = walletTransactionSchema.safeParse({ amount: amountValue, receiptImageUri: receiptUri ?? '' });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      const path = receiptPath(group.id, session.user.id, `initial-${Date.now()}`);
      await uploadImage('receipts', path, result.data.receiptImageUri);
      const { data: inserted, error: insertError } = await supabase
        .from('wallet_transactions')
        .insert({
          group_id: group.id,
          user_id: session.user.id,
          type: 'initial_deposit',
          amount: result.data.amount,
          status: 'pending',
          receipt_path: path,
        })
        .select('id')
        .single();
      if (insertError) throw new Error(insertError.message);
      setPendingTransactionId(inserted?.id ?? null);
      Alert.alert(
        'Comprobante enviado',
        'El admin del grupo debe confirmar tu transferencia — mientras tanto ya puedes usar la app normalmente.',
        [{ text: 'Ir a Inicio', onPress: () => router.replace('/home') }]
      );
    } catch (err) {
      Alert.alert('No se pudo registrar el depósito', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelfConfirm = async () => {
    if (!pendingTransactionId) return;
    setIsConfirming(true);
    try {
      const { error: updateError } = await supabase
        .from('wallet_transactions')
        .update({ status: 'confirmed' })
        .eq('id', pendingTransactionId);
      if (updateError) throw new Error(updateError.message);
      await refresh();
      router.replace('/home');
    } catch (err) {
      Alert.alert('No se pudo confirmar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Depósito inicial</Text>
      <Text style={styles.subtitle}>
        Transfiere {group.currency} {group.initial_deposit_amount.toLocaleString('es-CO')} para empezar en{' '}
        {group.name}. Esta transferencia se hace por fuera de la app; aquí solo registras el comprobante.
      </Text>

      {group.admin_payment_info ? (
        <Card>
          <Text style={styles.cardLabel}>Datos de pago</Text>
          <Text style={styles.cardValue}>{group.admin_payment_info}</Text>
        </Card>
      ) : null}

      {justSubmitted ? (
        <Card style={styles.pendingCard}>
          <Text style={styles.pendingTitle}>Comprobante enviado</Text>
          <Text style={styles.pendingText}>
            El admin del grupo debe confirmar tu transferencia. Mientras tanto, ya puedes usar la app normalmente.
          </Text>
          {membership.role === 'admin' && pendingTransactionId ? (
            <>
              <Text style={styles.pendingText}>
                Como eres el admin del grupo, puedes confirmar tu propio depósito ahora mismo.
              </Text>
              <Button label="Confirmar mi depósito" onPress={handleSelfConfirm} loading={isConfirming} />
            </>
          ) : null}
          <Button label="Ir a Inicio" onPress={() => router.replace('/home')} />
        </Card>
      ) : (
        <View style={styles.form}>
          <TextField
            label="Monto transferido (COP)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder={group.initial_deposit_amount.toLocaleString('es-CO')}
          />
          <Button
            label={receiptUri ? 'Cambiar comprobante' : 'Adjuntar comprobante'}
            variant="secondary"
            onPress={pickReceipt}
          />
          {receiptUri ? <Image source={{ uri: receiptUri }} style={styles.preview} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Enviar comprobante" onPress={handleSubmit} loading={isSubmitting} />
        </View>
      )}

      <Button label="Cerrar sesión" variant="secondary" onPress={signOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  cardLabel: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  cardValue: { color: colors.text, fontSize: 16, fontWeight: '600' },
  form: { gap: spacing.md },
  preview: { width: '100%', height: 200, borderRadius: radii.md },
  error: { color: colors.danger },
  pendingCard: { gap: spacing.sm },
  pendingTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  pendingText: { color: colors.textMuted },
});
