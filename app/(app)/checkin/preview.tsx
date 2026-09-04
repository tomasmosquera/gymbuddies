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
import { setLastCheckinDateCache } from '@/lib/notifications/checkinArrivalCache';
import { todayLocalDateString } from '@/lib/domain/checkinReminders';
import { getActiveEnergyBurnedKcal } from '@/lib/health/appleHealth';
import { findBuddyPartner } from '@/lib/domain/geo';
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
  /** Only meaningful for the check-in side (fanOutCheckoutToOtherGroups never reads it) — omitted falls back to scheduleCheckoutReminders' own default. */
  reminderMinutes?: number;
}

/**
 * Auto check-in fan-out (profile.auto_checkin_other_groups): the same
 * photo/location that just satisfied one group also gets submitted to
 * every other group the user actively belongs to — but only once the member
 * has said yes to confirmReplicateToOtherGroups below, called at every
 * confirm-photo tap this is reachable from. It used to run silently off the
 * toggle alone; that once overwrote an already-decided, unrelated check-in
 * in another group with a retake meant to fix only the current one — so the
 * toggle now just controls whether the question gets asked, not whether it
 * fans out. Each group gets its own uploaded copy of the photo — the
 * 'checkins' storage bucket's read policy scopes access by the group_id
 * folder segment of the path, so reusing one path across groups would
 * silently break photo viewing for the other groups' members. Best-effort
 * per group (own try/catch) — a failure or a skip in one other group must
 * never affect the primary check-in, which has already succeeded by the
 * time this runs.
 */
async function fanOutCheckinToOtherGroups(params: FanOutParams) {
  const {
    otherGroups,
    userId,
    flattenedUri,
    capturedAtDate,
    capturedAtIso,
    latitude,
    longitude,
    accuracyMeters,
    locationMocked,
    reminderMinutes,
  } = params;
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
          await scheduleCheckoutReminders(data.id, latitude, longitude, reminderMinutes);
        }
      } catch {
        // Best-effort — see function doc.
      }
    })
  );
}

/**
 * Same idea as fanOutCheckinToOtherGroups, for the checkout half — attaches
 * to whatever checkin already exists for that (group, user, date), manual
 * or auto_created alike, as long as it doesn't already have its own
 * checkout. Deliberately NOT gated on auto_created (unlike the check-in
 * fan-out, which must not overwrite an independent manual checkin's own
 * photo/location): a checkin's auto_created flag only records which group's
 * screen happened to originate the day's check-in, not which group the
 * person will happen to finish their workout from — the same real session
 * can easily start in one group and finish from another (observed: check-in
 * from Group A fans out fine, but finishing from Group B later left Group
 * A's own manual checkin without a checkout, since it was never the one
 * that "created" the fan-out). The one guard that still matters is not
 * clobbering a checkout the person already completed there themselves.
 */
async function fanOutCheckoutToOtherGroups(params: FanOutParams) {
  const { otherGroups, userId, flattenedUri, capturedAtDate, capturedAtIso, latitude, longitude, accuracyMeters, locationMocked } =
    params;
  await Promise.all(
    otherGroups.map(async (m) => {
      try {
        const otherDate = toZonedDateString(capturedAtDate, m.group.timezone);
        const { data: existing } = await supabase
          .from('checkins')
          .select('id, checkout_captured_at')
          .eq('group_id', m.group_id)
          .eq('user_id', userId)
          .eq('checkin_date', otherDate)
          .maybeSingle();
        if (!existing || existing.checkout_captured_at) return;

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

/**
 * A previous silent auto-fan-out clobbered an independently-decided check-in
 * in another group (observed: a retake meant to fix *this* group's photo
 * also overwrote an already-valid, unrelated check-in elsewhere) — asking
 * every time, on every check-in/checkout, hands that decision back to the
 * member instead of guessing from context.
 */
function confirmReplicateToOtherGroups(otherGroups: MembershipWithGroup[]): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      '¿Replicar en tus otros grupos?',
      `Tienes "Check-in en otros grupos" activado. ¿Quieres registrar esta misma foto también en: ${otherGroups
        .map((m) => m.group.name)
        .join(', ')}?`,
      [
        { text: 'No', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Sí', onPress: () => resolve(true) },
      ]
    );
  });
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

        // Awaited (unlike the Apple Health sync above) — a background upload
        // that's merely fired-and-forgotten right before navigating away is
        // vulnerable to the OS suspending the app the moment the user leaves
        // this screen, silently killing the fan-out mid-flight (observed:
        // some days it completes in time, some days it doesn't, with no
        // error surfaced either way). Waiting here guarantees it actually
        // runs to completion while the screen is still the active one — a
        // failure per other group still never fails this checkout, which
        // already succeeded in the primary group (see the function's own
        // per-group try/catch).
        if (profile?.auto_checkin_other_groups && otherActiveGroups.length > 0 && (await confirmReplicateToOtherGroups(otherActiveGroups))) {
          await fanOutCheckoutToOtherGroups({
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

      // Fast path for the arrival-reminder geofence (checkinArrivalReminders.ts):
      // marks "already checked in today" immediately, without waiting for the
      // member to reopen Home for that to be re-derived there. Deliberately
      // the device's own local date (todayLocalDateString), not the group's
      // timezone-defined day — that's what the geofence task compares it
      // against, see checkinReminders.ts's doc comment.
      setLastCheckinDateCache(todayLocalDateString()).catch(() => {});

      // Awaited — see fanOutCheckoutToOtherGroups's call site above for why
      // fire-and-forget here is unreliable (the app backgrounding right
      // after this screen navigates away can silently kill it mid-flight).
      // A failure per other group still never fails this check-in, which
      // already succeeded in the primary group.
      if (profile?.auto_checkin_other_groups && otherActiveGroups.length > 0 && (await confirmReplicateToOtherGroups(otherActiveGroups))) {
        await fanOutCheckinToOtherGroups({
          otherGroups: otherActiveGroups,
          userId: session.user.id,
          flattenedUri,
          capturedAtDate,
          capturedAtIso: draft.capturedAt,
          reminderMinutes: profile?.checkout_reminder_minutes,
          latitude: draft.latitude,
          longitude: draft.longitude,
          accuracyMeters: draft.accuracyMeters,
          locationMocked: draft.locationMocked,
        }).catch(() => {});
      }

      if (group.require_checkout_photo) {
        await scheduleCheckoutReminders(checkinRow.id, draft.latitude, draft.longitude, profile?.checkout_reminder_minutes);
      }

      // Buddy check-in: best-effort only, same spirit as the fan-out's own
      // per-group try/catch above — a lookup failure must never block a
      // check-in that already succeeded. The actual bonus XP/'dupla' badge
      // is computed independently (useGroupBadges.ts, via
      // findBuddyCheckinKeys) the next time badges load; this is purely the
      // in-the-moment "you weren't training alone" callout.
      let buddyPartnerName: string | null = null;
      try {
        const { data: othersTodayRaw } = await supabase
          .from('checkins')
          .select('user_id, latitude, longitude, captured_at, profile:profiles(full_name)')
          .eq('group_id', group.id)
          .eq('checkin_date', checkinDate)
          .neq('user_id', session.user.id);
        // checkins is declared NoRelationships in types.ts (see its comment),
        // so the embedded profile join can't be inferred — same cast every
        // other checkins+profile query in this codebase already uses (e.g.
        // useGroupWeekCheckins.ts).
        const othersToday = othersTodayRaw as unknown as
          | { user_id: string; latitude: number; longitude: number; captured_at: string; profile: { full_name: string } | null }[]
          | null;
        const partner = findBuddyPartner(
          {
            userId: session.user.id,
            date: checkinDate,
            capturedAtMs: new Date(draft.capturedAt).getTime(),
            latitude: draft.latitude,
            longitude: draft.longitude,
          },
          (othersToday ?? []).map((o) => ({
            userId: o.user_id,
            date: checkinDate,
            capturedAtMs: new Date(o.captured_at).getTime(),
            latitude: o.latitude,
            longitude: o.longitude,
            fullName: o.profile?.full_name ?? null,
          }))
        );
        buddyPartnerName = partner?.fullName ?? null;
      } catch {
        // Best-effort only — see comment above.
      }
      const buddyLine = buddyPartnerName ? `\n\n🫱🏼‍🫲🏻 Entrenaste junto a ${buddyPartnerName} — +3 XP bonus.` : '';

      setDraft(null);
      Alert.alert(
        draft.existingCheckinId ? 'Foto actualizada 💪' : '¡Check-in registrado! 💪',
        (group.require_checkout_photo
          ? 'Tu día de hoy ya cuenta. Cuando termines de entrenar, vuelve a esta app y registra tu foto final.'
          : 'Tu día de hoy ya cuenta.') + buddyLine
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
