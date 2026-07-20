import { useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useExcuseRequests } from '@/hooks/useExcuseRequests';
import { excuseProofPath, uploadImage } from '@/lib/supabase/storage';
import { excuseRequestSchema } from '@/lib/validation/schemas';
import type { ExcuseType } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

const TYPE_OPTIONS: { key: ExcuseType; label: string }[] = [
  { key: 'travel', label: 'Viaje' },
  { key: 'medical', label: 'Médica' },
  { key: 'other', label: 'Otra' },
];

export default function ExcuseRequestScreen() {
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { createExcuseRequest } = useExcuseRequests(group?.id ?? null, session?.user.id ?? null);

  const [excuseType, setExcuseType] = useState<ExcuseType>('travel');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (groupLoading || !group || !session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const pickProof = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus fotos para adjuntar la prueba.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) setProofUri(result.assets[0].uri);
  };

  const handleSubmit = async () => {
    const result = excuseRequestSchema.safeParse({
      excuseType,
      startDate,
      endDate,
      reason,
      proofImageUri: proofUri ?? undefined,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      let proofPath: string | undefined;
      if (result.data.proofImageUri) {
        proofPath = excuseProofPath(group.id, session.user.id, `excuse-${Date.now()}`);
        await uploadImage('excuse-proofs', proofPath, result.data.proofImageUri);
      }
      await createExcuseRequest(
        result.data.excuseType,
        result.data.startDate,
        result.data.endDate,
        result.data.reason || undefined,
        proofPath
      );
      Alert.alert(
        excuseType === 'other' ? 'Excusa enviada a votación' : 'Excusa enviada',
        excuseType === 'other'
          ? 'El grupo tiene 72 horas para votar.'
          : 'El admin del grupo debe revisarla y aprobarla.'
      );
      router.replace('/rules');
    } catch (err) {
      Alert.alert('No se pudo enviar la excusa', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>
        Viaje y médica requieren prueba y las aprueba el admin. Otra excusa se somete a votación del grupo.
      </Text>

      <SegmentedControl options={TYPE_OPTIONS} value={excuseType} onChange={setExcuseType} />

      <View style={styles.form}>
        <TextField
          label="Fecha inicio (YYYY-MM-DD)"
          value={startDate}
          onChangeText={setStartDate}
          placeholder="2026-07-20"
        />
        <TextField
          label="Fecha fin (YYYY-MM-DD)"
          value={endDate}
          onChangeText={setEndDate}
          placeholder="2026-07-22"
        />
        <TextField
          label="Motivo (opcional)"
          value={reason}
          onChangeText={setReason}
          multiline
        />
        <Button
          label={proofUri ? 'Cambiar prueba' : excuseType === 'other' ? 'Adjuntar prueba (opcional)' : 'Adjuntar prueba'}
          variant="secondary"
          onPress={pickProof}
        />
        {proofUri ? <Image source={{ uri: proofUri }} style={styles.preview} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Enviar excusa" onPress={handleSubmit} loading={isSubmitting} />
        <Button label="Cancelar" variant="secondary" onPress={() => router.replace('/rules')} disabled={isSubmitting} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  form: { gap: spacing.md },
  preview: { width: '100%', height: 200, borderRadius: radii.md },
  error: { color: colors.danger },
});
