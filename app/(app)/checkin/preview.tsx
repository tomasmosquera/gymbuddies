import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useMyMemberships, type MembershipWithGroup } from '@/hooks/useMyMemberships';
import { useCheckinDraftStore } from '@/state/checkinDraftStore';
import { supabase } from '@/lib/supabase/client';
import { checkinPhotoPath, checkoutPhotoPath, uploadImage } from '@/lib/supabase/storage';
import { formatZonedDateTime12h, toZonedDateString } from '@/lib/domain/dateUtils';
import { cancelCheckoutReminders, scheduleCheckoutReminders } from '@/lib/notifications/checkoutReminders';
import { getActiveEnergyBurnedKcal } from '@/lib/health/appleHealth';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface FanOutParams {
  otherGroups: MembershipWithGroup[];
  userId: string;
  flattenedUri: string;
  capturedAtDate: Date;
  capturedAtIso: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  locationMocked: boolean;
}

/**
 * Auto check-in fan-out (profile.auto_checkin_other_groups): the same
 * photo/location that just satisfied one group also gets submitted to
 * every other group the user actively belongs to. Each group gets its own
 * uploaded copy of the photo — the 'checkins' storage bucket's read policy
 * scopes access by the group_id folder segment of the path, so reusing one
 * path across groups would silently break photo viewing for the other
 * groups' members. Best-effort per group (own try/catch) — a failure or a
 * skip in one other group must never affect the primary check-in, which
 * has already succeeded by the time this runs.
 */
async function fanOutCheckinToOtherGroups(params: FanOutParams) {
  const { otherGroups, userId, flattenedUri, capturedAtDate, capturedAtIso, latitude, longitude, accuracyMeters, locationMocked } =
    params;
  await Promise.all(
    otherGroups.map(async (m) => {
      try {
        const otherDate = toZonedDateString(capturedAtDate, m.group.timezone);
        const path = checkinPhotoPath(m.group_id, userId, otherDate);
        await uploadImage('checkins', path, flattenedUri);
        const { data } = await supabase.rpc('submit_checkin', {
          p_group_id: m.group_id,
          p_captured_at: capturedAtIso,
          p_latitude: latitude,
          p_longitude: longitude,
          p_location_accuracy_m: accuracyMeters,
          p_photo_path: path,
          p_location_mocked: locationMocked,
          p_auto_created: true,
        });
        // data is null when a genuinely separate manual check-in already
        // existed that day in this group — respected as-is, nothing to do.
        if (data && m.group.require_checkout_photo) {
          await scheduleCheckoutReminders(data.id, latitude, longitude);
        }
      } catch {
        // Best-effort — see function doc.
      }
    })
  );
}

/** Same idea as fanOutCheckinToOtherGroups, for the checkout half — only ever attaches to a checkin THIS fan-out created (auto_created), never a manual one, and never overwrites an already-completed checkout. */
async function fanOutCheckoutToOtherGroups(params: FanOutParams) {
  const { otherGroups, userId, flattenedUri, capturedAtDate, capturedAtIso, latitude, longitude, accuracyMeters, locationMocked } =
    params;
  await Promise.all(
    otherGroups.map(async (m) => {
      try {
        const otherDate = toZonedDateString(capturedAtDate, m.group.timezone);
        const { data: existing } = await supabase
          .from('checkins')
          .select('id, auto_created, checkout_captured_at')
          .eq('group_id', m.group_id)
          .eq('user_id', userId)
          .eq('checkin_date', otherDate)
          .maybeSingle();
        if (!existing || !existing.auto_created || existing.checkout_captured_at) return;

        const path = checkoutPhotoPath(m.group_id, userId, otherDate);
        await uploadImage('checkins', path, flattenedUri);
        const { data } = await supabase.rpc('submit_workout_checkout', {
          p_checkin_id: existing.id,
          p_captured_at: capturedAtIso,
          p_latitude: latitude,
          p_longitude: longitude,
          p_location_accuracy_m: accuracyMeters,
          p_photo_path: path,
          p_location_mocked: locationMocked,
          p_auto_created: true,
        });
        if (data) {
          await cancelCheckoutReminders(existing.id);
        }
      } catch {
        // Best-effort — see fanOutCheckinToOtherGroups's doc.
      }
    })
  );
}

export default function CheckinPreviewScreen() {
  const { session, profile } = useAuth();
  const { group } = useActiveGroup();
  const { memberships } = useMyMemberships();
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
  const overlayText = formatZonedDateTime12h(capturedAtDate, group.timezone);
  const coordsText = `${draft.latitude.toFixed(5)}, ${draft.longitude.toFixed(5)}`;
  const otherActiveGroups = memberships.filter((m) => m.group_id !== group.id);

  const handleRetake = () => {
    setDraft(null);
    router.back();
  };

  const handleConfirm = async () => {
    if (!viewShotRef.current) return;
    setIsSubmitting(true);
    try {
      const flattenedUri = await captureRef(viewShotRef, { format: 'jpg', quality: 0.85 });
      const checkinDate = toZonedDateString(capturedAtDate, group.timezone);

      if (draft.mode === 'checkout') {
        if (!draft.existingCheckinId) throw new Error('No se encontró el check-in de hoy');
        const path = checkoutPhotoPath(group.id, session.user.id, checkinDate);
        await uploadImage('checkins', path, flattenedUri);

        const { data, error } = await supabase.rpc('submit_workout_checkout', {
          p_checkin_id: draft.existingCheckinId,
          p_captured_at: draft.capturedAt,
          p_latitude: draft.latitude,
          p_longitude: draft.longitude,
          p_location_accuracy_m: draft.accuracyMeters,
          p_photo_path: path,
          p_location_mocked: draft.locationMocked,
        });
        if (error || !data) throw new Error(error?.message ?? 'No se pudo registrar la foto final');

        await cancelCheckoutReminders(draft.existingCheckinId);

        // Fire-and-forget — never awaited before navigating away. Also
        // retried on every future app foreground (useAppleHealthForegroundSync)
        // in case Health hasn't synced from a wearable yet at this exact moment.
        if (profile?.apple_health_enabled && data.checkout_captured_at) {
          getActiveEnergyBurnedKcal(new Date(data.captured_at), new Date(data.checkout_captured_at))
            .then((kcal) => {
              if (kcal !== null) {
                return supabase.rpc('set_checkin_active_energy', {
                  p_checkin_id: data.id,
                  p_active_energy_kcal: kcal,
                });
              }
            })
            .catch(() => {});
        }

        // Fire-and-forget, same reasoning as the Apple Health sync above —
        // must never block navigation or fail the checkout that already
        // succeeded in this group.
        if (profile?.auto_checkin_other_groups && otherActiveGroups.length > 0) {
          fanOutCheckoutToOtherGroups({
            otherGroups: otherActiveGroups,
            userId: session.user.id,
            flattenedUri,
            capturedAtDate,
            capturedAtIso: draft.capturedAt,
            latitude: draft.latitude,
            longitude: draft.longitude,
            accuracyMeters: draft.accuracyMeters,
            locationMocked: draft.locationMocked,
          }).catch(() => {});
        }

        setDraft(null);
        const minutes = data.workout_minutes ?? 0;
        const isShort = group.require_checkout_photo && minutes < group.min_workout_minutes;
        Alert.alert(
          'Foto final registrada 🏁',
          `Entrenaste ${minutes} minuto(s).${isShort ? ` No alcanzaste el mínimo de ${group.min_workout_minutes} minutos.` : ''}`
        );
        router.replace('/home');
        return;
      }

      const path = checkinPhotoPath(group.id, session.user.id, checkinDate);
      await uploadImage('checkins', path, flattenedUri);

      // submit_checkin upserts on (group_id, user_id, checkin_date) server-side
      // (SECURITY DEFINER, bypassing the client role's column grants): a plain
      // client-side upsert doesn't work here because PostgREST's generated
      // ON CONFLICT DO UPDATE sets every payload column, including group_id/
      // user_id, which aren't grant-covered and raise "permission denied for
      // table checkins" — the same reason submit_workout_checkout above is
      // an RPC rather than a raw client update.
      const { data: checkinRow, error } = await supabase.rpc('submit_checkin', {
        p_group_id: group.id,
        p_captured_at: draft.capturedAt,
        p_latitude: draft.latitude,
        p_longitude: draft.longitude,
        p_location_accuracy_m: draft.accuracyMeters,
        p_photo_path: path,
        p_location_mocked: draft.locationMocked,
      });
      if (error || !checkinRow) throw new Error(error?.message ?? 'No se pudo registrar el check-in');

      // Fire-and-forget — see fanOutCheckoutToOtherGroups's call site below
      // for why this never blocks navigation or fails the primary check-in.
      if (profile?.auto_checkin_other_groups && otherActiveGroups.length > 0) {
        fanOutCheckinToOtherGroups({
          otherGroups: otherActiveGroups,
          userId: session.user.id,
          flattenedUri,
          capturedAtDate,
          capturedAtIso: draft.capturedAt,
          latitude: draft.latitude,
          longitude: draft.longitude,
          accuracyMeters: draft.accuracyMeters,
          locationMocked: draft.locationMocked,
        }).catch(() => {});
      }

      if (group.require_checkout_photo) {
        await scheduleCheckoutReminders(checkinRow.id, draft.latitude, draft.longitude);
      }
      setDraft(null);
      Alert.alert(
        draft.existingCheckinId ? 'Foto actualizada 💪' : '¡Check-in registrado! 💪',
        group.require_checkout_photo
          ? 'Tu día de hoy ya cuenta. Cuando termines de entrenar, vuelve a esta app y registra tu foto final.'
          : 'Tu día de hoy ya cuenta.'
      );
      router.replace('/home');
    } catch (err) {
      Alert.alert(
        draft.mode === 'checkout' ? 'No se pudo registrar la foto final' : 'No se pudo registrar el check-in',
        err instanceof Error ? err.message : 'Intenta de nuevo'
      );
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
        <Button
          label={draft.mode === 'checkout' ? 'Confirmar foto final' : 'Confirmar foto inicial'}
          onPress={handleConfirm}
          loading={isSubmitting}
        />
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
