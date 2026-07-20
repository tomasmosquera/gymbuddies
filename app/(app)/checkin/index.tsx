import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useCheckins } from '@/hooks/useCheckins';
import { useLocationLock } from '@/hooks/useLocationLock';
import { useCheckinDraftStore } from '@/state/checkinDraftStore';
import { formatBogotaDateTime } from '@/lib/domain/dateUtils';
import { colors, radii, spacing, typography } from '@/constants/theme';

export default function CheckinCameraScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading } = useActiveGroup();
  const { todayCheckin, isLoading: checkinsLoading } = useCheckins(group?.id ?? null, session?.user.id ?? null);
  const [permission, requestPermission] = useCameraPermissions();
  const { status: locationStatus, location, errorMessage: locationError, requestLock } = useLocationLock();
  const setDraft = useCheckinDraftStore((s) => s.setDraft);
  const cameraRef = useRef<CameraView>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [retakeRequested, setRetakeRequested] = useState(false);
  const [checkoutRequested, setCheckoutRequested] = useState(false);

  const checkoutRequired = group?.require_checkout_photo ?? false;
  const needsCheckout = checkoutRequired && !!todayCheckin && !todayCheckin.checkout_captured_at;
  const isCheckoutFlow = needsCheckout && checkoutRequested;

  useEffect(() => {
    if (locationStatus === 'idle') requestLock();
  }, [locationStatus, requestLock]);

  const handleCapture = async () => {
    if (!cameraRef.current || !location || !group || !session) return;
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
        <EmptyState
          title="Check-in inicial hecho ✓"
          description={`Entraste a las ${formatBogotaDateTime(new Date(todayCheckin.captured_at)).split(' ')[1]}. Cuando termines de entrenar, registra tu salida.`}
        />
        <Button label="Registrar salida 🏁" onPress={() => setCheckoutRequested(true)} />
      </View>
    );
  }

  if (todayCheckin && !needsCheckout && !retakeRequested) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Ya hiciste check-in hoy 💪"
          description="Puedes volver a tomar la foto de hoy si quieres reemplazarla."
        />
        <Button label="Volver a tomar la foto" variant="secondary" onPress={() => setRetakeRequested(true)} />
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
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={styles.overlay}>
        {isCheckoutFlow ? (
          <View style={styles.modePill}>
            <Text style={styles.modePillText}>Foto de salida</Text>
          </View>
        ) : null}
        <View style={styles.statusPill}>
          {isLocked ? (
            <Text style={styles.statusText}>📍 Ubicación lista</Text>
          ) : (
            <>
              <ActivityIndicator color={colors.text} size="small" />
              <Text style={styles.statusText}>Ubicando...</Text>
            </>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!isLocked || isCapturing}
          onPress={handleCapture}
          style={[styles.shutter, (!isLocked || isCapturing) && styles.shutterDisabled]}
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
  camera: { flex: 1 },
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
