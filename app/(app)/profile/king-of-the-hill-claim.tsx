import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { TextField } from '@/components/ui/TextField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useKothCatalog } from '@/hooks/useKothCatalog';
import { useKothClaimHistory } from '@/hooks/useKothClaimHistory';
import { useSubmitKothClaim } from '@/hooks/useSubmitKothClaim';
import { beatsCurrentRecord, formatKothValue } from '@/lib/domain/koth';
import { compressVideo } from '@/lib/media/compressVideo';
import { MAX_VIDEO_BYTES } from '@/lib/supabase/storage';
import { colors, radii, spacing, typography } from '@/constants/theme';

const VIDEO_MAX_DURATION_SECONDS = 30;
const MAX_VIDEO_MB = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));

/** Stats a local file directly — the one number worth trusting once compressVideo has already produced a real, freshly-written local file. */
async function getFileSizeBytes(uri: string): Promise<number | null> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? info.size : null;
}

export default function KingOfTheHillClaimScreen() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { exercises, isLoading: catalogLoading } = useKothCatalog();
  const { claims, isLoading: claimsLoading } = useKothClaimHistory(group?.id ?? null, exerciseId ?? null);
  const { submit, isSubmitting, uploadProgress } = useSubmitKothClaim();

  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lbs'>('kg');
  const [video, setVideo] = useState<{ uri: string; mimeType?: string | null } | null>(null);
  const [error, setError] = useState<string | undefined>();
  // True from the moment the picker is launched until the video is either
  // accepted or rejected — covers the native picker's own UI, the
  // compressVideo() pass below, and our own size check after it. Without
  // this the screen shows nothing at all during that stretch, which reads
  // as "stuck" rather than "working".
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  // 0..1 while compressVideo is actively compressing, null otherwise —
  // separate from isProcessingVideo so the hint text can say specifically
  // "compressing" with a percentage instead of a generic "processing".
  const [compressionProgress, setCompressionProgress] = useState<number | null>(null);

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
    setIsProcessingVideo(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: VIDEO_MAX_DURATION_SECONDS,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });
      if (!result.canceled && result.assets[0]) {
        await acceptVideoIfWithinSizeLimit(result.assets[0]);
      }
    } finally {
      setIsProcessingVideo(false);
    }
  };

  const pickVideo = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus videos para adjuntar la prueba.');
      return;
    }
    // videoExportPreset is kept for consistency with recordVideo, but on
    // iOS 14+ a library pick actually goes through PHPickerViewController,
    // where this option is silently ignored (it only takes effect for the
    // older UIImagePickerController flow the camera capture below still
    // uses) — confirmed by a real upload that reached 100% and still got
    // rejected as oversized. The real compression for this path now comes
    // from compressVideo() in acceptVideoIfWithinSizeLimit below, which
    // works regardless of which picker API handed us the file.
    setIsProcessingVideo(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });
      if (!result.canceled && result.assets[0]) {
        await acceptVideoIfWithinSizeLimit(result.assets[0]);
      }
    } finally {
      setIsProcessingVideo(false);
    }
  };

  const acceptVideoIfWithinSizeLimit = async (asset: ImagePicker.ImagePickerAsset) => {
    setCompressionProgress(0);
    try {
      const { uri: processedUri, wasCompressed } = await compressVideo(asset.uri, setCompressionProgress);
      const sizeBytes = await getFileSizeBytes(processedUri);
      if (sizeBytes !== null && sizeBytes > MAX_VIDEO_BYTES) {
        Alert.alert(
          'Video muy pesado',
          `Este video pesa ${(sizeBytes / (1024 * 1024)).toFixed(0)}MB incluso después de comprimirlo. El máximo permitido es ${MAX_VIDEO_MB}MB — intenta con un video más corto.`
        );
        return;
      }
      // A compressed output is always a fresh .mp4 regardless of the
      // source's original container/codec — trusting the original
      // asset.mimeType here (e.g. "video/quicktime" for a .mov source)
      // would mismatch what we're actually about to upload.
      setVideo({ uri: processedUri, mimeType: wasCompressed ? 'video/mp4' : asset.mimeType });
    } finally {
      setCompressionProgress(null);
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
          {isProcessingVideo ? (
            <View style={styles.videoProcessing}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.videoHint}>
                {compressionProgress !== null
                  ? `Comprimiendo video... ${Math.round(compressionProgress * 100)}%`
                  : 'Procesando video...'}
              </Text>
            </View>
          ) : video ? (
            <VideoView player={player} style={styles.videoPreview} nativeControls />
          ) : (
            <Text style={styles.videoHint}>
              Sube un video donde se vea claramente que lograste esta marca — máx. {VIDEO_MAX_DURATION_SECONDS}s si lo
              grabas ahora, o elige uno ya grabado desde tu galería. Se comprime automáticamente antes de subirlo.
            </Text>
          )}
          <View style={styles.videoButtons}>
            <Button label="Grabar video" variant="secondary" onPress={recordVideo} disabled={isProcessingVideo || isSubmitting} />
            <Button
              label="Elegir de la galería"
              variant="secondary"
              onPress={pickVideo}
              disabled={isProcessingVideo || isSubmitting}
            />
          </View>
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isSubmitting && uploadProgress !== null ? (
          <View style={styles.uploadProgress}>
            <ProgressBar progress={uploadProgress} />
            <Text style={styles.uploadProgressText}>
              {uploadProgress < 1 ? `Subiendo video... ${Math.round(uploadProgress * 100)}%` : 'Procesando...'}
            </Text>
          </View>
        ) : null}

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
  videoProcessing: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  videoPreview: { width: '100%', height: 220, borderRadius: radii.md, backgroundColor: colors.background },
  videoButtons: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  error: { color: colors.danger },
  uploadProgress: { gap: spacing.xs },
  uploadProgressText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
