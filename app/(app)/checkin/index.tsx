import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useCheckins } from '@/hooks/useCheckins';
import { useLocationLock } from '@/hooks/useLocationLock';
import { useCheckinDraftStore } from '@/state/checkinDraftStore';
import { cancelCheckoutReminders, stopCheckoutGeofence } from '@/lib/notifications/checkoutReminders';
import { supabase } from '@/lib/supabase/client';
import { formatBogotaDateTime } from '@/lib/domain/dateUtils';
import { colors, radii, spacing, typography } from '@/constants/theme';

export default function CheckinCameraScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading } = useActiveGroup();
  const { todayCheckin, isLoading: checkinsLoading, refresh: refreshCheckins } = useCheckins(
    group?.id ?? null,
    session?.user.id ?? null
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

  const checkoutRequired = group?.require_checkout_photo ?? false;
  const needsCheckout = checkoutRequired && !!todayCheckin && !todayCheckin.checkout_captured_at;
  const isCheckoutFlow = needsCheckout && checkoutRequested;

  // This tab stays mounted across switches, so simply returning to it after
  // taking a photo elsewhere (or having the admin change something) would
  // otherwise keep showing whatever todayCheckin was at the last mount.
  useFocusEffect(
    useCallback(() => {
      refreshCheckins();
    }, [refreshCheckins])
  );

  useEffect(() => {
    if (locationStatus === 'idle') requestLock();
  }, [locationStatus, requestLock]);

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

  // Switching front/back re-negotiates the native camera session too.
  useEffect(() => {
    setIsCameraReady(false);
  }, [facing]);

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
        photoUri: photo.uri,
        capturedAt: new Date().toISOString(),
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters,
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

  const confirmDeleteToday = () => {
    if (!todayCheckin) return;
    Alert.alert(
      'Eliminar registro de hoy',
      'Se borrará tu foto (y la de salida, si ya la tomaste) de hoy. El día queda en blanco, a la espera de una foto nueva — no cuenta como exitoso.',
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
      await cancelCheckoutReminders(todayCheckin.id);
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
        <EmptyState
          title="Paso 2: foto final"
          description={`Registraste tu foto inicial a las ${formatBogotaDateTime(new Date(todayCheckin.captured_at)).split(' ')[1]}. Este grupo pide una segunda foto cuando termines de entrenar, para medir cuánto duró tu sesión — tócala cuando estés por irte del gimnasio.`}
        />
        <Button label="Tomar foto final 🏁" onPress={() => setCheckoutRequested(true)} />
        <Button label="Eliminar registro de hoy" variant="danger" onPress={confirmDeleteToday} loading={isDeleting} />
      </View>
    );
  }

  if (todayCheckin && !needsCheckout && !retakeRequested) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Ya hiciste check-in hoy 💪"
          description={
            checkoutRequired
              ? 'Ya registraste tu foto inicial y tu foto final hoy. Puedes volver a tomar la foto inicial si quieres reemplazarla.'
              : 'Puedes volver a tomar la foto de hoy si quieres reemplazarla.'
          }
        />
        <Button label="Volver a tomar la foto" variant="secondary" onPress={() => setRetakeRequested(true)} />
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
        <Button label="Dar permiso de cámara" onPress={requestPermission} />
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

  const isLocked = locationStatus === 'locked';

  return (
    <View style={styles.flex}>
      <CameraView
        key={facing}
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        onCameraReady={() => setIsCameraReady(true)}
      />
      <Pressable
        accessibilityRole="button"
        style={styles.flipButton}
        onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
      >
        <Text style={styles.flipButtonText}>🔄</Text>
      </Pressable>
      <View style={styles.overlay}>
        <View style={styles.modePill}>
          <Text style={styles.modePillText}>{isCheckoutFlow ? 'Foto Final 🏁' : 'Foto Inicial 📸'}</Text>
        </View>
        <View style={styles.statusPill}>
          {isLocked && isCameraReady ? (
            <Text style={styles.statusText}>📍 Ubicación lista</Text>
          ) : (
            <>
              <ActivityIndicator color={colors.text} size="small" />
              <Text style={styles.statusText}>{isLocked ? 'Preparando cámara...' : 'Ubicando...'}</Text>
            </>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!isLocked || !isCameraReady || isCapturing}
          onPress={handleCapture}
          style={[styles.shutter, (!isLocked || !isCameraReady || isCapturing) && styles.shutterDisabled]}
        >
          {isCapturing ? <ActivityIndicator color={colors.background} /> : <View style={styles.shutterInner} />}
        </Pressable>
        <Text style={styles.hint}>{membership?.status === 'needs_recharge' ? 'Recuerda recargar tu saldo' : ' '}</Text>
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
  flipButtonText: { fontSize: 20 },
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
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primary },
  hint: { color: colors.warning, fontSize: 12 },
});
