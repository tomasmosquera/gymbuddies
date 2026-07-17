import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useCheckinDraftStore } from '@/state/checkinDraftStore';
import { supabase } from '@/lib/supabase/client';
import { checkinPhotoPath, uploadImage } from '@/lib/supabase/storage';
import { formatBogotaDateTime, toBogotaDateString } from '@/lib/domain/dateUtils';
import { colors, radii, spacing, typography } from '@/constants/theme';

export default function CheckinPreviewScreen() {
  const { session } = useAuth();
  const { group } = useActiveGroup();
  const draft = useCheckinDraftStore((s) => s.draft);
  const setDraft = useCheckinDraftStore((s) => s.setDraft);
  const [address, setAddress] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const viewShotRef = useRef<ComponentRef<typeof ViewShot>>(null);

  useEffect(() => {
    if (!draft) {
      router.replace('/checkin');
      return;
    }
    Location.reverseGeocodeAsync({ latitude: draft.latitude, longitude: draft.longitude })
      .then((results) => {
        const place = results[0];
        if (place) {
          setAddress([place.street, place.city, place.region].filter(Boolean).join(', '));
        }
      })
      .catch(() => {
        // Best-effort only — coordinates alone are still shown on the overlay.
      });
  }, [draft]);

  if (!draft || !group || !session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const capturedAtDate = new Date(draft.capturedAt);
  const overlayText = formatBogotaDateTime(capturedAtDate);
  const coordsText = `${draft.latitude.toFixed(5)}, ${draft.longitude.toFixed(5)}`;

  const handleRetake = () => {
    setDraft(null);
    router.back();
  };

  const handleConfirm = async () => {
    if (!viewShotRef.current) return;
    setIsSubmitting(true);
    try {
      const flattenedUri = await captureRef(viewShotRef, { format: 'jpg', quality: 0.85 });
      const checkinDate = toBogotaDateString(capturedAtDate);
      const path = checkinPhotoPath(group.id, session.user.id, checkinDate);
      await uploadImage('checkins', path, flattenedUri);

      const { error } = draft.existingCheckinId
        ? await supabase
            .from('checkins')
            .update({
              captured_at: draft.capturedAt,
              latitude: draft.latitude,
              longitude: draft.longitude,
              location_accuracy_m: draft.accuracyMeters,
              photo_path: path,
            })
            .eq('id', draft.existingCheckinId)
        : await supabase.from('checkins').insert({
            group_id: group.id,
            user_id: session.user.id,
            captured_at: draft.capturedAt,
            latitude: draft.latitude,
            longitude: draft.longitude,
            location_accuracy_m: draft.accuracyMeters,
            photo_path: path,
          });
      if (error) throw new Error(error.message);

      setDraft(null);
      Alert.alert(
        draft.existingCheckinId ? 'Foto actualizada 💪' : '¡Check-in registrado! 💪',
        'Tu día de hoy ya cuenta.'
      );
      router.replace('/home');
    } catch (err) {
      Alert.alert('No se pudo registrar el check-in', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <ViewShot ref={viewShotRef} style={styles.shotWrapper} options={{ format: 'jpg', quality: 0.85 }}>
        <Image source={{ uri: draft.photoUri }} style={styles.photo} />
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>{overlayText}</Text>
          <Text style={styles.overlayText}>{address ?? coordsText}</Text>
        </View>
      </ViewShot>

      <View style={styles.actions}>
        <Button label="Repetir foto" variant="secondary" onPress={handleRetake} disabled={isSubmitting} />
        <Button label="Confirmar check-in" onPress={handleConfirm} loading={isSubmitting} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  shotWrapper: { flex: 1, borderRadius: radii.lg, overflow: 'hidden' },
  photo: { flex: 1, width: '100%' },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: spacing.md,
    gap: 2,
  },
  overlayText: { color: 'white', ...typography.caption, fontWeight: '700' },
  actions: { gap: spacing.sm },
});
