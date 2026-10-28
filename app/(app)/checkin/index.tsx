import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminPanel } from '@/components/admin/AdminPanel';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useCheckins } from '@/hooks/useCheckins';
import { useAttendanceOverrides } from '@/hooks/useAttendanceOverrides';
import { useElapsedSeconds } from '@/hooks/useElapsedSeconds';
import { useLocationLock } from '@/hooks/useLocationLock';
import { useCheckinDraftStore } from '@/state/checkinDraftStore';
import { cancelCheckoutReminders, stopCheckoutGeofence } from '@/lib/notifications/checkoutReminders';
import { supabase } from '@/lib/supabase/client';
import { requestWorkoutActivitySync } from '@/state/workoutActivitySyncStore';
import { usePostConfirmRedirectStore } from '@/state/postConfirmRedirectStore';
import { logBreadcrumb } from '@/lib/debugBreadcrumb';
import { compressVideo } from '@/lib/media/compressVideo';
import { formatZonedTime12h, formatElapsedClock, toZonedDateString } from '@/lib/domain/dateUtils';
import { colors, radii, spacing, typography } from '@/constants/theme';

/** How long the shutter has to stay held before a tap turns into a video recording instead of a photo. */
const HOLD_TO_RECORD_MS = 350;
const MAX_VIDEO_DURATION_SECONDS = 10;

export default function CheckinCameraScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading } = useActiveGroup();
  const { todayCheckin, isLoading: checkinsLoading, refresh: refreshCheckins } = useCheckins(
    group?.id ?? null,
    session?.user.id ?? null,
    group?.timezone ?? 'America/Bogota'
  );
  const { weekOverrides, refresh: refreshOverrides } = useAttendanceOverrides(
    group?.id ?? null,
    session?.user.id ?? null,
    group?.timezone ?? 'America/Bogota'
  );
  const [permission, requestPermission] = useCameraPermissions();
  const { status: locationStatus, location, errorMessage: locationError, requestLock } = useLocationLock();
  const setDraft = useCheckinDraftStore((s) => s.setDraft);
  const cameraRef = useRef<CameraView>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [retakeRequested, setRetakeRequested] = useState(false);
  const [checkoutRequested, setCheckoutRequested] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [isCameraReady, setIsCameraReady] = useState(false);
  // 'video' only while the shutter is held past HOLD_TO_RECORD_MS — see
  // handleShutterPressIn/Out below. Switching this remounts <CameraView>
  // (key includes it, same idiom as the facing flip) since a single native
  // camera session is configured for either still or movie output, not
  // both at once — recordAsync was validated crash-free in this mode via
  // the debug screen under Ajustes > "Probar video" before this shipped.
  const [cameraMode, setCameraMode] = useState<'picture' | 'video'>('picture');
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoElapsedSeconds, setVideoElapsedSeconds] = useState(0);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  // Forces a fresh <CameraView> mount (bumped into its key below) when the
  // native session seems to have gotten stuck mid-reconfiguration and never
  // calls onCameraReady — see cameraStuck's own effect further down.
  const [cameraRetryKey, setCameraRetryKey] = useState(0);
  const [cameraStuck, setCameraStuck] = useState(false);
  const cameraStuckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoElapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set when the shutter is released before recordAsync's own promise
  // actually starts (released during the brief camera-mode-switch window) —
  // checked right before recordAsync is called so that ultra-short hold
  // doesn't start (and then immediately have to stop) a real recording.
  const stopRequestedRef = useRef(false);

  // Set by the lock-screen workout timer's "Tomar foto final" button (gymbuddies://checkin?checkout=1).
  const { checkout: checkoutParam } = useLocalSearchParams<{ checkout?: string }>();
  const checkoutRequired = group?.require_checkout_photo ?? false;
  const needsCheckout = checkoutRequired && !!todayCheckin && !todayCheckin.checkout_captured_at;
  const isCheckoutFlow = needsCheckout && checkoutRequested;

  // Opens the final-photo step straight away when arriving from the workout timer's button; the
  // param is consumed either way so it cannot re-trigger on a later visit to this tab.
  useEffect(() => {
    if (checkoutParam !== '1' || groupLoading || checkinsLoading) return;
    if (needsCheckout) setCheckoutRequested(true);
    router.setParams({ checkout: undefined });
  }, [checkoutParam, groupLoading, checkinsLoading, needsCheckout]);
  const elapsedSeconds = useElapsedSeconds(needsCheckout && todayCheckin ? todayCheckin.captured_at : null);
  const todayString = toZonedDateString(new Date(), group?.timezone ?? 'America/Bogota');
  // A day invalidated (photo challenge vote, or the admin directly) can
  // still be retaken — submit_checkin clears the invalidation itself once a
  // new photo is in place, so this is purely to explain *why* a retake is
  // being asked for here instead of the usual "quieres reemplazarla" copy.
  const todayWasInvalidated = todayCheckin && weekOverrides.some((o) => o.override_date === todayString && o.status === 'failed');

  // This tab stays mounted across switches, so simply returning to it after
  // taking a photo elsewhere (or having the admin change something) would
  // otherwise keep showing whatever todayCheckin was at the last mount.
  useFocusEffect(
    useCallback(() => {
      refreshCheckins();
      refreshOverrides();
    }, [refreshCheckins, refreshOverrides])
  );

  // The other half of preview.tsx's checkout onPress — see its own comment for why closing the
  // modal (router.dismiss()) and jumping to another tab are now two separate steps instead of one
  // compound router.dismissTo() call. This fires once this screen (same tab as the now-dismissed
  // modal) actually regains focus, and does the tab switch from here instead — a context that
  // isn't itself mid-teardown. Also doubles as a diagnostic: if 'checkin_index:focused' never logs
  // after a checkout, even router.dismiss()'s plain POP isn't completing; if it logs but
  // 'checkin_index:redirect_called' is never followed by Home actually gaining focus, the tab-jump
  // itself is still the part that's unreliable.
  useFocusEffect(
    useCallback(() => {
      if (session) logBreadcrumb(session.user.id, 'checkin_index:focused');
      const pendingHref = usePostConfirmRedirectStore.getState().pendingHref;
      if (pendingHref) {
        usePostConfirmRedirectStore.getState().setPendingHref(null);
        if (session) logBreadcrumb(session.user.id, 'checkin_index:consuming_pending_redirect', { pendingHref });
        router.replace(pendingHref);
        if (session) logBreadcrumb(session.user.id, 'checkin_index:redirect_called');
      }
    }, [session])
  );

  // Same "stays mounted" issue applies to location: a lock taken the last
  // time this tab was focused (e.g. at home, before leaving for the gym)
  // would otherwise sit there stale — a photo taken minutes or hours later
  // must never carry an old fix. Re-lock on every focus, not just first
  // mount, so both the initial and (if the screen was left and re-entered
  // mid check-in) the checkout photo always use a fresh position.
  useFocusEffect(
    useCallback(() => {
      requestLock();
    }, [requestLock])
  );

  // The more common version of the same problem: the screen never lost
  // navigation focus at all — the whole app was just backgrounded (locked
  // phone, switched apps) while walking from home to the gym, so
  // useFocusEffect above never re-fires. Re-lock when the app comes back
  // to the foreground too.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') requestLock();
    });
    return () => subscription.remove();
  }, [requestLock]);

  // A fresh capture (retake or checkout) must never reuse an earlier lock —
  // this screen's tab instance can stay mounted across a whole visit to the
  // gym, so without this the checkout photo would silently carry the same
  // coordinates as the original check-in, even after actually walking away.
  // Each of these transitions also means <CameraView> goes from unrendered
  // (hidden behind an earlier-return branch) to freshly mounted again, so
  // the "camera ready" flag has to be dropped too — otherwise the shutter
  // re-enables the instant location relocks, racing the native camera
  // session and throwing "Camera is not ready yet."
  useEffect(() => {
    if (retakeRequested || checkoutRequested) {
      requestLock();
      setIsCameraReady(false);
    }
  }, [retakeRequested, checkoutRequested, requestLock]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (videoElapsedIntervalRef.current) clearInterval(videoElapsedIntervalRef.current);
      if (cameraStuckTimeoutRef.current) clearTimeout(cameraStuckTimeoutRef.current);
    };
  }, []);

  // A real device occasionally leaves the native camera session stuck
  // mid-reconfiguration after a mode/facing switch — onCameraReady just
  // never fires, no error, nothing to catch — so a plain "Preparando
  // cámara..." spinner with no way out would otherwise strand the member
  // here. Offers a manual retry (forces a brand new <CameraView> mount) once
  // it's been stuck for a few seconds.
  useEffect(() => {
    if (cameraStuckTimeoutRef.current) clearTimeout(cameraStuckTimeoutRef.current);
    if (isCameraReady) {
      setCameraStuck(false);
      return;
    }
    cameraStuckTimeoutRef.current = setTimeout(() => setCameraStuck(true), 5000);
    return () => {
      if (cameraStuckTimeoutRef.current) clearTimeout(cameraStuckTimeoutRef.current);
    };
  }, [isCameraReady, cameraRetryKey]);

  const handleRetryCamera = () => {
    setCameraStuck(false);
    setIsCameraReady(false);
    setCameraMode('picture');
    setCameraRetryKey((k) => k + 1);
  };

  // Safety net for when the geofence's exit event never fired (e.g. the app
  // was killed before it could): whenever this screen loads and there's no
  // pending checkout, make sure no stale geofence is still being monitored.
  useEffect(() => {
    if (!groupLoading && !checkinsLoading && !needsCheckout) {
      stopCheckoutGeofence();
    }
  }, [groupLoading, checkinsLoading, needsCheckout]);

  const handleCapture = async () => {
    if (!cameraRef.current || !location || !group || !session || !isCameraReady) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo) throw new Error('No se pudo tomar la foto');
      setDraft({
        media: { kind: 'photo', uri: photo.uri },
        capturedAt: new Date().toISOString(),
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters,
        locationMocked: location.mocked,
        address: null,
        existingCheckinId: todayCheckin?.id ?? null,
        mode: isCheckoutFlow ? 'checkout' : 'checkin',
      });
      router.push('/checkin/preview');
    } catch (err) {
      Alert.alert('No se pudo tomar la foto', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsCapturing(false);
    }
  };

  const startVideoRecording = async () => {
    if (!cameraRef.current) return;
    if (stopRequestedRef.current) {
      // Released during the mode-switch window — too short to count as a
      // real hold; drop back to picture mode instead of recording anything.
      stopRequestedRef.current = false;
      setIsCameraReady(false);
      setCameraMode('picture');
      return;
    }
    setIsRecordingVideo(true);
    setVideoElapsedSeconds(0);
    videoElapsedIntervalRef.current = setInterval(() => setVideoElapsedSeconds((s) => s + 1), 1000);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_DURATION_SECONDS });
      if (video?.uri && location) {
        setIsProcessingVideo(true);
        const { uri: processedUri } = await compressVideo(video.uri).finally(() => setIsProcessingVideo(false));
        setDraft({
          media: { kind: 'video', uri: processedUri },
          capturedAt: new Date().toISOString(),
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: location.accuracyMeters,
          locationMocked: location.mocked,
          address: null,
          existingCheckinId: todayCheckin?.id ?? null,
          mode: isCheckoutFlow ? 'checkout' : 'checkin',
        });
        router.push('/checkin/preview');
      }
    } catch (err) {
      Alert.alert('No se pudo grabar el video', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      if (videoElapsedIntervalRef.current) clearInterval(videoElapsedIntervalRef.current);
      videoElapsedIntervalRef.current = null;
      setIsRecordingVideo(false);
      setIsCameraReady(false);
      setCameraMode('picture');
    }
  };

  // Fires the instant the just-switched-to-video session reports ready —
  // recordAsync can't be called any earlier than this (same "Camera is not
  // ready yet" risk noted on the facing-flip effect above applies here too).
  useEffect(() => {
    if (cameraMode === 'video' && isCameraReady && !isRecordingVideo) {
      startVideoRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode, isCameraReady]);

  const handleShutterPressIn = () => {
    if (!isLocked || !isCameraReady || isCapturing || cameraMode === 'video') return;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Both state updates in the same handler so they land in the same
      // render/commit — splitting setIsCameraReady(false) into its own
      // effect keyed off [cameraMode] left a window where the OTHER effect
      // (the one that calls recordAsync once ready) could still read the
      // PREVIOUS render's isCameraReady === true before this effect's own
      // reset had a chance to run, firing recordAsync against the brand new
      // (not yet actually ready) video-mode session — observed as
      // "CameraOutputNotReadyException: Camera is not ready yet" on the very
      // first hold after a mode switch.
      setIsCameraReady(false);
      setCameraMode('video');
    }, HOLD_TO_RECORD_MS);
  };

  const handleShutterPressOut = () => {
    if (holdTimerRef.current) {
      // Released before the hold threshold — a plain tap, take the photo.
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      void handleCapture();
      return;
    }
    if (isRecordingVideo) {
      cameraRef.current?.stopRecording();
    } else {
      // Already past the threshold (mode switching to 'video') but released
      // before recordAsync actually started — see startVideoRecording's own
      // check of this flag.
      stopRequestedRef.current = true;
    }
  };

  const confirmDeleteToday = () => {
    if (!todayCheckin) return;
    Alert.alert(
      'Eliminar registro de hoy',
      'Se borrará tu foto o video (y el de salida, si ya lo tomaste) de hoy. El día queda en blanco, a la espera de un registro nuevo — no cuenta como exitoso.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: handleDeleteToday },
      ]
    );
  };

  const handleDeleteToday = async () => {
    if (!todayCheckin) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_own_checkin', { p_checkin_id: todayCheckin.id });
      if (error) throw new Error(error.message);
      await cancelCheckoutReminders();
      requestWorkoutActivitySync();
      setRetakeRequested(false);
      setCheckoutRequested(false);
      setIsCameraReady(false);
      await refreshCheckins();
    } catch (err) {
      Alert.alert('No se pudo eliminar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeleting(false);
    }
  };

  if (groupLoading || checkinsLoading || !permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Not a participating member — nothing to check in for. This tab becomes
  // the group admin panel instead, so the space isn't dead for someone who
  // never trains but opens the app daily to keep an eye on the group.
  if (membership?.status === 'admin_only') {
    return <AdminPanel />;
  }

  if (todayCheckin && needsCheckout && !checkoutRequested) {
    return (
      <View style={styles.center}>
        <View style={styles.stepsRow}>
          <View style={styles.stepPill}>
            <Text style={styles.stepPillText}>1. Foto Inicial ✓</Text>
          </View>
          <Text style={styles.stepsArrow}>→</Text>
          <View style={[styles.stepPill, styles.stepPillPending]}>
            <Text style={styles.stepPillText}>2. Foto Final</Text>
          </View>
        </View>
        {elapsedSeconds !== null ? (
          <View style={styles.bigTimerBlock}>
            <Text style={styles.bigTimer}>{formatElapsedClock(elapsedSeconds)}</Text>
            <Text style={styles.bigTimerLabel}>Tiempo de Entreno</Text>
          </View>
        ) : null}
        <EmptyState
          title="Paso 2: Foto Final"
          description={`Registraste tu foto inicial a las ${formatZonedTime12h(new Date(todayCheckin.captured_at), group?.timezone ?? 'America/Bogota')}. Este grupo pide una segunda foto cuando termines de entrenar, para medir cuánto duró tu sesión — tócala cuando estés por irte del gimnasio.`}
        />
        <Button label="Tomar Foto Final" onPress={() => setCheckoutRequested(true)} />
        <Button label="Eliminar registro de hoy" variant="danger" onPress={confirmDeleteToday} loading={isDeleting} />
      </View>
    );
  }

  if (todayCheckin && !needsCheckout && !retakeRequested) {
    return (
      <View style={styles.center}>
        <EmptyState
          title={todayWasInvalidated ? 'Tu registro de hoy fue invalidado' : 'Ya hiciste check-in hoy 💪'}
          description={
            todayWasInvalidated
              ? `El grupo${checkoutRequired ? ' (o el administrador)' : ''} marcó tu foto de hoy como no válida. Sube una foto nueva${checkoutRequired ? ' — inicial y final' : ''} y, si es válida, este día vuelve a contar.`
              : checkoutRequired
                ? 'Ya registraste tu foto inicial y tu foto final hoy. Puedes volver a tomar la foto inicial si quieres reemplazarla.'
                : 'Puedes volver a tomar la foto de hoy si quieres reemplazarla.'
          }
        />
        <Button
          label={todayWasInvalidated ? 'Subir foto nueva' : 'Volver a tomar la foto'}
          variant="secondary"
          onPress={() => setRetakeRequested(true)}
        />
        <Button label="Eliminar registro de hoy" variant="danger" onPress={confirmDeleteToday} loading={isDeleting} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Necesitamos acceso a tu cámara"
          description="El check-in solo se puede hacer con una foto tomada en el momento, no desde tu galería."
        />
        {/* Apple rejected 1.1.0 (Guideline 5.1.1(iv)) over this button's old
            label ("Dar permiso de cámara") — wording that itself frames
            granting the permission as the action isn't allowed; a neutral
            "Continuar" that leads to the system's own permission dialog is
            what they asked for instead. */}
        <Button label="Continuar" onPress={requestPermission} />
      </View>
    );
  }

  if (locationStatus === 'denied') {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Necesitamos tu ubicación"
          description="Tu check-in debe incluir la ubicación de donde entrenas. Actívala en los ajustes del sistema."
        />
        <Button label="Abrir ajustes" onPress={() => Linking.openSettings()} />
      </View>
    );
  }

  if (locationStatus === 'error') {
    return (
      <View style={styles.center}>
        <EmptyState title="No pudimos ubicarte" description={locationError ?? 'Intenta de nuevo'} />
        <Button label="Reintentar" onPress={requestLock} />
      </View>
    );
  }

  // Caught before the camera ever renders — the RPC would reject this
  // submission anyway (defense in depth against a scripted call straight to
  // it), but blocking here saves the member from taking a photo just to see
  // it fail on submit.
  if (locationStatus === 'locked' && location?.mocked) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Ubicación simulada detectada"
          description="Detectamos una app de ubicación falsa activa en tu teléfono. Desactívala en Opciones de Desarrollador para poder hacer check-in."
        />
        <Button label="Reintentar" onPress={requestLock} />
      </View>
    );
  }

  const isLocked = locationStatus === 'locked';

  return (
    <View style={styles.flex}>
      <CameraView
        key={`${facing}-${cameraMode}-${cameraRetryKey}`}
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode={cameraMode}
        mute
        onCameraReady={() => setIsCameraReady(true)}
      />
      <Pressable
        accessibilityRole="button"
        style={styles.flipButton}
        onPress={() => {
          setIsCameraReady(false);
          setFacing((f) => (f === 'back' ? 'front' : 'back'));
        }}
        disabled={cameraMode === 'video'}
      >
        <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
      </Pressable>
      <View style={styles.overlay}>
        <View style={styles.modePill}>
          <Text style={styles.modePillText}>{isCheckoutFlow ? 'Foto Final 🏁' : 'Foto Inicial 📸'}</Text>
        </View>
        {isRecordingVideo ? (
          <Text style={styles.recordingTimer}>{videoElapsedSeconds}s / {MAX_VIDEO_DURATION_SECONDS}s</Text>
        ) : (
          <View style={styles.statusPill}>
            {isLocked && isCameraReady ? (
              <Text style={styles.statusText}>📍 Ubicación lista</Text>
            ) : isLocked && cameraStuck ? (
              <Pressable onPress={handleRetryCamera} hitSlop={8}>
                <Text style={styles.statusText}>⚠️ La cámara no responde — toca para reintentar</Text>
              </Pressable>
            ) : (
              <>
                <ActivityIndicator color={colors.text} size="small" />
                <Text style={styles.statusText}>{isLocked ? 'Preparando cámara...' : 'Ubicando...'}</Text>
              </>
            )}
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={!isLocked || !isCameraReady || isCapturing}
          onPressIn={handleShutterPressIn}
          onPressOut={handleShutterPressOut}
          style={[
            styles.shutter,
            (!isLocked || !isCameraReady || isCapturing) && styles.shutterDisabled,
            isRecordingVideo && styles.shutterRecording,
          ]}
        >
          {isCapturing ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <View style={[styles.shutterInner, isRecordingVideo && styles.shutterInnerRecording]} />
          )}
        </Pressable>
        <Text style={styles.hint}>
          {membership?.status === 'needs_recharge'
            ? 'Recuerda recargar tu saldo'
            : isRecordingVideo
              ? 'Suelta para terminar'
              : `Mantén presionado para grabar video (máx. ${MAX_VIDEO_DURATION_SECONDS}s)`}
        </Text>
      </View>
      {isProcessingVideo ? (
        <View style={styles.processingOverlay}>
          <ActivityIndicator color={colors.text} />
          <Text style={styles.statusText}>Procesando video...</Text>
        </View>
      ) : null}
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
  stepsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: '#123424',
  },
  stepPillPending: { backgroundColor: colors.surfaceAlt },
  stepPillText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  stepsArrow: { color: colors.textMuted },
  bigTimerBlock: { alignItems: 'center' },
  bigTimer: { color: colors.text, fontSize: 56, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bigTimerLabel: { color: colors.textMuted, fontSize: 13, marginTop: -spacing.xs },
  camera: { flex: 1 },
  flipButton: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
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
  modePill: {
    position: 'absolute',
    top: -48,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  modePillText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  statusText: { color: colors.text, ...typography.caption, fontWeight: '600' },
  recordingTimer: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
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
  shutterDisabled: { opacity: 0.4 },
  shutterRecording: { borderColor: 'rgba(255,0,0,0.6)' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primary },
  shutterInnerRecording: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#ff3b30' },
  hint: { color: colors.warning, fontSize: 12 },
  processingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
