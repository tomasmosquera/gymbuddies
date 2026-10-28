import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { logBreadcrumb } from '@/lib/debugBreadcrumb';
import { colors, radii, spacing, typography } from '@/constants/theme';

const MAX_DURATION_SECONDS = 10;

/**
 * Isolated reproduction of the AVPlayer crash seen in useRestTimer/KOTH (see
 * project_avplayer_crash_instability memory) — mounted only while actually
 * previewing a video, and unmounted (via "Volver a grabar") the instant
 * we're done with it, so a leaked player can never be blamed for whatever
 * happens here. Breadcrumbs bracket both player creation and play() so a
 * real crash tells us exactly which one it was, same idiom as
 * useRestTimer.ts.
 */
function VideoPreview({ uri, userId, onReset }: { uri: string; userId: string | null; onReset: () => void }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
  });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  useEffect(() => {
    if (userId) logBreadcrumb(userId, 'videotest:status_change', { status, error: error?.message ?? null });
  }, [status, error, userId]);

  return (
    <View style={styles.flex}>
      <VideoView style={styles.video} player={player} nativeControls={false} contentFit="contain" />
      <View style={styles.previewOverlay}>
        <Text style={styles.statusLine}>Estado del reproductor: {status}{error ? ` — ${error.message}` : ''}</Text>
        <View style={styles.row}>
          <Button
            label={isPlaying ? 'Pausar' : 'Reproducir'}
            onPress={() => {
              if (userId) logBreadcrumb(userId, isPlaying ? 'videotest:pause_pressed' : 'videotest:play_pressed');
              if (isPlaying) player.pause();
              else player.play();
            }}
          />
          <Button label="Volver a grabar" variant="secondary" onPress={onReset} />
        </View>
      </View>
    </View>
  );
}

export default function VideoTestScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearElapsedInterval = () => {
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    elapsedIntervalRef.current = null;
  };

  useEffect(() => clearElapsedInterval, []);

  const handleStartRecording = () => {
    if (!cameraRef.current || !isCameraReady || isRecording) return;
    setIsRecording(true);
    setElapsedSeconds(0);
    elapsedIntervalRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    if (userId) logBreadcrumb(userId, 'videotest:record_start');
    cameraRef.current
      .recordAsync({ maxDuration: MAX_DURATION_SECONDS })
      .then((video) => {
        clearElapsedInterval();
        setIsRecording(false);
        if (video?.uri) {
          if (userId) logBreadcrumb(userId, 'videotest:record_done', { uri: video.uri });
          setRecordedUri(video.uri);
        }
      })
      .catch((err) => {
        clearElapsedInterval();
        setIsRecording(false);
        if (userId) logBreadcrumb(userId, 'videotest:record_error', { message: err instanceof Error ? err.message : String(err) });
      });
  };

  const handleStopRecording = () => {
    if (!isRecording) return;
    cameraRef.current?.stopRecording();
  };

  const handleReset = () => {
    setRecordedUri(null);
    setIsCameraReady(false);
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Necesitamos acceso a tu cámara"
          description="Solo para esta prueba — no se usa en tu check-in real ni se sube a ningún lado."
        />
        <Button label="Continuar" onPress={requestPermission} />
      </View>
    );
  }

  if (recordedUri) {
    return <VideoPreview uri={recordedUri} userId={userId} onReset={handleReset} />;
  }

  return (
    <View style={styles.flex}>
      <CameraView ref={cameraRef} style={styles.camera} mode="video" facing="back" mute onCameraReady={() => setIsCameraReady(true)} />
      <Pressable accessibilityRole="button" style={styles.closeButton} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color="#fff" />
      </Pressable>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>Prueba interna — este video no se sube a ningún lado ni afecta tu check-in real.</Text>
      </View>
      <View style={styles.overlay}>
        {isRecording ? (
          <Text style={styles.timer}>{elapsedSeconds}s / {MAX_DURATION_SECONDS}s</Text>
        ) : (
          <Text style={styles.hint}>Mantén presionado para grabar (máx. {MAX_DURATION_SECONDS}s)</Text>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={!isCameraReady}
          onPressIn={handleStartRecording}
          onPressOut={handleStopRecording}
          style={[styles.shutter, isRecording && styles.shutterRecording, !isCameraReady && styles.shutterDisabled]}
        >
          <View style={[styles.shutterInner, isRecording && styles.shutterInnerRecording]} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: 'black' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  camera: { flex: 1 },
  video: { flex: 1 },
  closeButton: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 1,
  },
  banner: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.xl + 56,
    right: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  bannerText: { color: colors.warning, fontSize: 12, fontWeight: '600' },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  hint: { color: colors.text, ...typography.caption },
  timer: { color: colors.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  shutterRecording: { borderColor: 'rgba(255,0,0,0.6)' },
  shutterDisabled: { opacity: 0.4 },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primary },
  shutterInnerRecording: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#ff3b30' },
  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  statusLine: { color: colors.text, ...typography.caption },
  row: { flexDirection: 'row', gap: spacing.md },
});
