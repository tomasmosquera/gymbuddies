import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { InlineDatePicker } from '@/components/ui/InlineDatePicker';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useExcuseRequests } from '@/hooks/useExcuseRequests';
import { excuseProofPath, uploadImage } from '@/lib/supabase/storage';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { excuseRequestSchema } from '@/lib/validation/schemas';
import type { ExcuseType } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

const TYPE_OPTIONS: { key: ExcuseType; label: string }[] = [
  { key: 'travel', label: 'Viaje' },
  { key: 'medical', label: 'Médica' },
  { key: 'other', label: 'Otra' },
];

const MAX_PROOF_PHOTOS = 8;

export default function ExcuseRequestScreen() {
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { createExcuseRequest } = useExcuseRequests(group?.id ?? null, session?.user.id ?? null);

  const [excuseType, setExcuseType] = useState<ExcuseType>('travel');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [reason, setReason] = useState('');
  const [proofUris, setProofUris] = useState<string[]>([]);
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
    const remaining = MAX_PROOF_PHOTOS - proofUris.length;
    if (remaining <= 0) {
      Alert.alert('Máximo alcanzado', `Puedes adjuntar hasta ${MAX_PROOF_PHOTOS} fotos.`);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!result.canceled && result.assets.length > 0) {
      setProofUris((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
    }
  };

  const removeProofAt = (index: number) => {
    setProofUris((prev) => prev.filter((_, i) => i !== index));
  };

  // Keeps the end date from silently pre-dating a start date the user just
  // moved forward — the end picker's own minimumDate stops new invalid
  // picks, but an already-set earlier end date needs correcting too.
  const handleStartDateChange = (date: Date) => {
    setStartDate(date);
    if (date > endDate) setEndDate(date);
  };

  const handleSubmit = async () => {
    const result = excuseRequestSchema.safeParse({
      excuseType,
      startDate: toZonedDateString(startDate, group.timezone),
      endDate: toZonedDateString(endDate, group.timezone),
      reason,
      proofImageUris: proofUris,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      const requestRef = `excuse-${Date.now()}`;
      const proofPaths: string[] = [];
      for (let i = 0; i < result.data.proofImageUris.length; i++) {
        const path = excuseProofPath(group.id, session.user.id, `${requestRef}-${i}`);
        await uploadImage('excuse-proofs', path, result.data.proofImageUris[i]);
        proofPaths.push(path);
      }
      await createExcuseRequest(
        result.data.excuseType,
        result.data.startDate,
        result.data.endDate,
        result.data.reason || undefined,
        proofPaths
      );
      Alert.alert(
        'Excusa enviada',
        'El admin del grupo la va a revisar — puede aprobarla, rechazarla, o ponerla a votación de todo el grupo.'
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
        Viaje y médica requieren prueba (puedes adjuntar varias fotos, por ejemplo cada pasabordo de un viaje con
        escalas). El admin revisa toda solicitud y puede aprobarla, rechazarla, o ponerla a votación del grupo.
      </Text>

      <SegmentedControl options={TYPE_OPTIONS} value={excuseType} onChange={setExcuseType} />

      <View style={styles.form}>
        <InlineDatePicker label="Fecha inicio" value={startDate} onChange={handleStartDateChange} />
        <InlineDatePicker label="Fecha fin" value={endDate} onChange={setEndDate} minimumDate={startDate} />
        <TextField
          label="Motivo (opcional)"
          value={reason}
          onChangeText={setReason}
          multiline
        />
        <Button
          label={
            proofUris.length > 0
              ? `Agregar otra foto (${proofUris.length}/${MAX_PROOF_PHOTOS})`
              : excuseType === 'other'
                ? 'Adjuntar prueba (opcional)'
                : 'Adjuntar prueba'
          }
          variant="secondary"
          onPress={pickProof}
          disabled={proofUris.length >= MAX_PROOF_PHOTOS}
        />
        {proofUris.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewRow}>
            {proofUris.map((uri, index) => (
              <View key={`${uri}-${index}`} style={styles.previewWrap}>
                <Image source={{ uri }} style={styles.preview} />
                <Pressable
                  onPress={() => removeProofAt(index)}
                  hitSlop={8}
                  accessibilityRole="button"
                  style={styles.removeButton}
                >
                  <Ionicons name="close-circle" size={22} color={colors.text} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
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
  previewRow: { gap: spacing.sm },
  previewWrap: { position: 'relative' },
  preview: { width: 140, height: 180, borderRadius: radii.md },
  removeButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.background,
    borderRadius: radii.pill,
  },
  error: { color: colors.danger },
});
