import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useKothCatalog } from '@/hooks/useKothCatalog';
import { useKothClaimHistory } from '@/hooks/useKothClaimHistory';
import { useSubmitKothClaim } from '@/hooks/useSubmitKothClaim';
import { beatsCurrentRecord, formatKothValue } from '@/lib/domain/koth';
import { colors, radii, spacing, typography } from '@/constants/theme';

const VIDEO_MAX_DURATION_SECONDS = 30;

export default function KingOfTheHillClaimScreen() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { exercises, isLoading: catalogLoading } = useKothCatalog();
  const { claims, isLoading: claimsLoading } = useKothClaimHistory(group?.id ?? null, exerciseId ?? null);
  const { submit, isSubmitting } = useSubmitKothClaim();

  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lbs'>('kg');
  const [video, setVideo] = useState<{ uri: string; mimeType?: string | null } | null>(null);
  const [error, setError] = useState<string | undefined>();

  const player = useVideoPlayer(video?.uri ?? null);

  if (groupLoading || catalogLoading || claimsLoading || !group || !session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const exercise = exercises.find((e) => e.id === exerciseId);
  if (!exercise) {
    return (
      <View style={styles.center}>
        <Text style={styles.subtitle}>Ejercicio no encontrado.</Text>
      </View>
    );
  }

  // Every accepted claim beat the previous record, so the most recent
  // non-invalidated one is by construction the current champion — a
  // practice claim (counts_for_record false, from someone still in their
  // protection period) never was champion of anything, so it's excluded.
  const current = claims.find((c) => c.status !== 'invalidated' && c.counts_for_record) ?? null;
  const isWeightExercise = exercise.metric_type === 'weight_kg';

  const recordVideo = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tu cámara para grabar el video.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: VIDEO_MAX_DURATION_SECONDS,
    });
    if (!result.canceled && result.assets[0]) {
      setVideo({ uri: result.assets[0].uri, mimeType: result.assets[0].mimeType });
    }
  };

  const pickVideo = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus videos para adjuntar la prueba.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (!result.canceled && result.assets[0]) {
      setVideo({ uri: result.assets[0].uri, mimeType: result.assets[0].mimeType });
    }
  };

  const handleSubmit = async () => {
    const numericValue = Number(value);
    if (!value || Number.isNaN(numericValue) || numericValue <= 0) {
      setError('Ingresa un valor mayor a 0.');
      return;
    }
    if (!isWeightExercise && numericValue !== Math.trunc(numericValue)) {
      setError('Las repeticiones deben ser un número entero.');
      return;
    }
    if (!video) {
      setError('Adjunta un video que demuestre tu marca.');
      return;
    }
    const currentValue = current?.value_canonical ?? null;
    if (!beatsCurrentRecord(exercise.metric_type, numericValue, isWeightExercise ? unit : null, currentValue)) {
      setError(
        currentValue !== null
          ? `Tu marca debe superar el récord actual (${formatKothValue(exercise.metric_type, currentValue)}).`
          : 'Ingresa un valor mayor a 0.'
      );
      return;
    }

    setError(undefined);
    try {
      const result = await submit({
        groupId: group.id,
        userId: session.user.id,
        exerciseId: exercise.id,
        exerciseSlug: exercise.slug,
        value: numericValue,
        unit: isWeightExercise ? unit : null,
        videoUri: video.uri,
        videoMimeType: video.mimeType,
      });
      Alert.alert(
        result.counts_for_record ? '¡Reclamación enviada!' : 'Marca de práctica guardada',
        result.counts_for_record
          ? `Ahora eres el nuevo KOTH de ${exercise.name}. El grupo tiene 72 horas para verificar a través de votación. Si nadie invalida tu registro, el récord queda confirmado.`
          : `Superaste el récord actual, pero como todavía estás en tu período de prueba no cuenta como récord real. Vuelve a intentarlo cuando termine tu protección.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err) {
      Alert.alert('No se pudo enviar la reclamación', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{exercise.name}</Text>
      <Text style={styles.subtitle}>
        {current
          ? `Récord actual: ${formatKothValue(exercise.metric_type, current.value_canonical)} (${current.fullName})`
          : 'Todavía nadie tiene el récord de este ejercicio.'}
      </Text>

      <View style={styles.form}>
        {isWeightExercise ? (
          <SegmentedControl
            options={[
              { key: 'kg', label: 'Kilos' },
              { key: 'lbs', label: 'Libras' },
            ]}
            value={unit}
            onChange={setUnit}
          />
        ) : null}
        <TextField
          label={isWeightExercise ? `Peso (${unit})` : 'Repeticiones'}
          value={value}
          onChangeText={setValue}
          keyboardType="numeric"
          placeholder={isWeightExercise ? '100' : '12'}
        />

        <Card style={styles.videoCard}>
          <Text style={styles.videoLabel}>Video de tu marca</Text>
          {video ? (
            <VideoView player={player} style={styles.videoPreview} nativeControls />
          ) : (
            <Text style={styles.videoHint}>
              Sube un video donde se vea claramente que lograste esta marca — máx. {VIDEO_MAX_DURATION_SECONDS}s si lo
              grabas ahora, o elige uno ya grabado desde tu galería.
            </Text>
          )}
          <View style={styles.videoButtons}>
            <Button label="Grabar video" variant="secondary" onPress={recordVideo} />
            <Button label="Elegir de la galería" variant="secondary" onPress={pickVideo} />
          </View>
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Enviar reclamación" onPress={handleSubmit} loading={isSubmitting} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  form: { gap: spacing.md },
  videoCard: { gap: spacing.sm },
  videoLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  videoHint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  videoPreview: { width: '100%', height: 220, borderRadius: radii.md, backgroundColor: colors.background },
  videoButtons: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  error: { color: colors.danger },
});
