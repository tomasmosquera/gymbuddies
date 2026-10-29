import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView, type VideoThumbnail } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import { useEvent } from 'expo';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useMyMemberships, type MembershipWithGroup } from '@/hooks/useMyMemberships';
import { useCheckinDraftStore, type CheckinDraftMedia } from '@/state/checkinDraftStore';
import { supabase } from '@/lib/supabase/client';
import {
  checkinPhotoPath,
  checkinVideoPath,
  checkinVideoThumbnailPath,
  checkoutPhotoPath,
  checkoutVideoPath,
  checkoutVideoThumbnailPath,
  uploadImage,
  uploadVideo,
} from '@/lib/supabase/storage';
import { formatZonedDateTime12h, toZonedDateString } from '@/lib/domain/dateUtils';
import { cancelCheckoutReminders, scheduleCheckoutReminders } from '@/lib/notifications/checkoutReminders';
import { requestWorkoutActivitySync } from '@/state/workoutActivitySyncStore';
import { usePostConfirmRedirectStore } from '@/state/postConfirmRedirectStore';
import { setLastCheckinDateCache } from '@/lib/notifications/checkinArrivalCache';
import { todayLocalDateString } from '@/lib/domain/checkinReminders';
import { getActiveEnergyBurnedKcal } from '@/lib/health';
import { findBuddyPartner } from '@/lib/domain/geo';
import { logBreadcrumb } from '@/lib/debugBreadcrumb';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface FanOutParams {
  otherGroups: MembershipWithGroup[];
  userId: string;
  media: CheckinDraftMedia;
  /** Local thumbnail JPEG (see VideoThumbnailCapture below) — only meaningful when media.kind === 'video'. Each group needs its own uploaded copy, same reasoning as media.uri itself (see this function's own doc comment). */
  videoThumbnailUri?: string | null;
  capturedAtDate: Date;
  capturedAtIso: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  locationMocked: boolean;
  /** Only meaningful for the check-in side (fanOutCheckoutToOtherGroups never reads it) — omitted falls back to scheduleCheckoutReminders' own default. */
  reminderMinutes?: number;
  /** Same as reminderMinutes above — omitted falls back to scheduleCheckoutReminders' own default. */
  radiusMeters?: number;
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
    media,
    videoThumbnailUri,
    capturedAtDate,
    capturedAtIso,
    latitude,
    longitude,
    accuracyMeters,
    locationMocked,
    reminderMinutes,
    radiusMeters,
  } = params;
  await Promise.all(
    otherGroups.map(async (m) => {
      try {
        const otherDate = toZonedDateString(capturedAtDate, m.group.timezone);
        const isVideo = media.kind === 'video';
        const path = isVideo ? checkinVideoPath(m.group_id, userId, otherDate) : checkinPhotoPath(m.group_id, userId, otherDate);
        if (isVideo) {
          await uploadVideo('checkins', path, media.uri);
        } else {
          await uploadImage('checkins', path, media.uri);
        }
        let thumbnailPath: string | null = null;
        if (isVideo && videoThumbnailUri) {
          thumbnailPath = checkinVideoThumbnailPath(m.group_id, userId, otherDate);
          await uploadImage('checkins', thumbnailPath, videoThumbnailUri).catch(() => {
            thumbnailPath = null;
          });
        }
        const { data } = await supabase.rpc('submit_checkin', {
          p_group_id: m.group_id,
          p_captured_at: capturedAtIso,
          p_latitude: latitude,
          p_longitude: longitude,
          p_location_accuracy_m: accuracyMeters,
          p_photo_path: isVideo ? null : path,
          p_video_path: isVideo ? path : null,
          p_video_thumbnail_path: thumbnailPath,
          p_location_mocked: locationMocked,
          p_auto_created: true,
        });
        // data is null when a genuinely separate manual check-in already
        // existed that day in this group — respected as-is, nothing to do.
        if (data && m.group.require_checkout_photo) {
          await scheduleCheckoutReminders(latitude, longitude, reminderMinutes, radiusMeters);
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
  const {
    otherGroups,
    userId,
    media,
    videoThumbnailUri,
    capturedAtDate,
    capturedAtIso,
    latitude,
    longitude,
    accuracyMeters,
    locationMocked,
  } = params;
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

        const isVideo = media.kind === 'video';
        const path = isVideo ? checkoutVideoPath(m.group_id, userId, otherDate) : checkoutPhotoPath(m.group_id, userId, otherDate);
        if (isVideo) {
          await uploadVideo('checkins', path, media.uri);
        } else {
          await uploadImage('checkins', path, media.uri);
        }
        let thumbnailPath: string | null = null;
        if (isVideo && videoThumbnailUri) {
          thumbnailPath = checkoutVideoThumbnailPath(m.group_id, userId, otherDate);
          await uploadImage('checkins', thumbnailPath, videoThumbnailUri).catch(() => {
            thumbnailPath = null;
          });
        }
        const { data } = await supabase.rpc('submit_workout_checkout', {
          p_checkin_id: existing.id,
          p_captured_at: capturedAtIso,
          p_latitude: latitude,
          p_longitude: longitude,
          p_location_accuracy_m: accuracyMeters,
          p_photo_path: isVideo ? null : path,
          p_video_path: isVideo ? path : null,
          p_video_thumbnail_path: thumbnailPath,
          p_location_mocked: locationMocked,
          p_auto_created: true,
        });
        if (data) {
          await cancelCheckoutReminders();
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

/**
 * A recorded video can't be flattened through ViewShot the way the photo
 * branch above bakes its date/location bar into the actual JPEG — so this
 * renders that same bar as a plain overlay View on top of the player
 * instead. Split into its own component, mounted only while actually
 * showing a video draft, so useVideoPlayer never runs unconditionally —
 * same isolation already used by VideoPreview (the debug screen) and
 * ClaimVideoPreview (King of the Hill) to keep AVPlayer creation scoped to
 * exactly when it's needed.
 */
function VideoPreviewWithOverlay({ uri, overlayText, locationText }: { uri: string; overlayText: string; locationText: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <View style={styles.shotWrapper}>
      <VideoView style={styles.photo} player={player} nativeControls={false} contentFit="cover" />
      <View style={styles.overlay}>
        <Text style={styles.overlayText}>{overlayText}</Text>
        <Text style={styles.overlayText}>{locationText}</Text>
      </View>
    </View>
  );
}

/** Polls a ref until it's set or the timeout elapses — used so handleConfirm can wait a bit for VideoThumbnailCapture's (fast, local-file) result instead of a Promise plumbed across renders. */
async function waitForRef<T>(ref: { current: T | null }, timeoutMs: number, intervalMs = 150): Promise<T | null> {
  const start = Date.now();
  while (ref.current === null && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return ref.current;
}

/**
 * Captures a static JPEG thumbnail of the video's first frame, used so the Dashboard/Moderar
 * fotos tile loads instantly instead of buffering the remote video just to show a preview (see
 * 0166_checkin_video_thumbnail.sql). generateThumbnailsAsync gives back a native image reference
 * (VideoThumbnail, a SharedRef) — not a file — so it's flattened into a real JPEG the same way
 * the photo branch above already does: render it into an <Image>, then captureRef that view.
 * Rendered off-screen, invisible to the user; the visible preview is VideoPreviewWithOverlay.
 * Mounted alongside it, against the SAME local file, as its own isolated player instance — same
 * AVPlayer-scoping idiom as every other video use in this app.
 */
function VideoThumbnailCapture({ uri, onReady }: { uri: string; onReady: (localUri: string) => void }) {
  const player = useVideoPlayer({ uri });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);
  const shotRef = useRef<ComponentRef<typeof ViewShot>>(null);
  const requestedThumbnailRef = useRef(false);
  const capturedRef = useRef(false);

  useEffect(() => {
    if (status !== 'readyToPlay' || requestedThumbnailRef.current) return;
    requestedThumbnailRef.current = true;
    player
      // 1280 matches uploadImage's own MAX_DIMENSION_PX — generating it any smaller would just
      // get upscaled back up by that resize step (no quality gained, wasted bytes either way).
      .generateThumbnailsAsync(0, { maxWidth: 1280 })
      .then(([thumb]) => {
        if (thumb) setThumbnail(thumb);
      })
      .catch(() => {});
  }, [status, player]);

  useEffect(() => {
    if (!thumbnail || capturedRef.current) return;
    capturedRef.current = true;
    // One tick so the <Image> actually paints the native ref before it's snapshotted.
    requestAnimationFrame(() => {
      captureRef(shotRef, { format: 'jpg', quality: 0.85 })
        .then(onReady)
        .catch(() => {});
    });
  }, [thumbnail, onReady]);

  if (!thumbnail) return null;
  return (
    <ViewShot ref={shotRef} style={[styles.hiddenThumbnail, { width: thumbnail.width, height: thumbnail.height }]}>
      <ExpoImage source={thumbnail} style={{ width: thumbnail.width, height: thumbnail.height }} />
    </ViewShot>
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
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  const viewShotRef = useRef<ComponentRef<typeof ViewShot>>(null);
  const videoThumbnailUriRef = useRef<string | null>(null);
  const handleThumbnailReady = useCallback((localUri: string) => {
    videoThumbnailUriRef.current = localUri;
  }, []);
  // Kept around purely so the diagnostic logging below can still attribute a breadcrumb to
  // someone once session itself has already gone null — see the fallback-render effect.
  const lastKnownUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (session) lastKnownUserIdRef.current = session.user.id;
  }, [session]);

  // Mount-only (draft deliberately NOT in the dependency array): this
  // effect's job is "bail out if this screen was somehow entered with no
  // draft at all" — draft is always already set by the time this screen
  // mounts (checkin/index.tsx sets it synchronously before navigating
  // here), so checking it reactively serves no purpose while genuinely
  // mounted... except a harmful one. handleConfirm calls setDraft(null) on
  // its own way OUT, right before navigating to wherever a successful
  // submission actually goes next (routine-choice for a check-in, /home
  // for a checkout) — with draft in the dependency array, that null re-ran
  // this effect and its `router.replace('/checkin')` raced (and won
  // against) that intentional navigation, always landing back on
  // checkin/index instead of the real destination.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Temporary diagnostic for the "stuck on Confirmar" hang — see debugBreadcrumb.ts's doc
  // comment. Confirms (or rules out) whether the user is actually stuck staring at THIS
  // fallback, and which of the three ever goes null to cause it.
  useEffect(() => {
    if (!draft || !group || !session) {
      const userId = lastKnownUserIdRef.current;
      if (userId) {
        logBreadcrumb(userId, 'confirm:render_fallback', { draftNull: !draft, groupNull: !group, sessionNull: !session });
      }
    }
  }, [draft, group, session]);

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
  // admin_only excluded — that status never checks in (see
  // useWorkoutLiveActivity's own comment on this exact distinction), so it
  // has no business appearing as a fan-out destination; pending_deposit
  // stays in, since it fully participates in check-ins same as active.
  const otherActiveGroups = memberships.filter((m) => m.group_id !== group.id && m.status !== 'admin_only');

  const handleRetake = () => {
    setDraft(null);
    router.back();
  };

  const handleConfirm = async () => {
    const isVideo = draft.media.kind === 'video';
    if (!isVideo && !viewShotRef.current) return;
    setIsSubmitting(true);
    logBreadcrumb(session.user.id, 'confirm:start', { mode: draft.mode, mediaKind: draft.media.kind });
    try {
      // A video can't be flattened through ViewShot (that only snapshots a
      // RN View tree) — its date/location watermark is rendered live by
      // whatever plays it back instead (see VideoPreviewWithOverlay below),
      // so the video just uploads as-is, with no capture step.
      const mediaUri = isVideo ? draft.media.uri : await captureRef(viewShotRef, { format: 'jpg', quality: 0.85 });
      logBreadcrumb(session.user.id, 'confirm:captured');
      const checkinDate = toZonedDateString(capturedAtDate, group.timezone);

      if (draft.mode === 'checkout') {
        if (!draft.existingCheckinId) throw new Error('No se encontró el check-in de hoy');
        const path = isVideo
          ? checkoutVideoPath(group.id, session.user.id, checkinDate)
          : checkoutPhotoPath(group.id, session.user.id, checkinDate);
        if (isVideo) {
          await uploadVideo('checkins', path, mediaUri, 'video/mp4', setVideoUploadProgress);
        } else {
          await uploadImage('checkins', path, mediaUri);
        }
        logBreadcrumb(session.user.id, 'confirm:checkout_uploaded');

        const localThumbUri = isVideo ? await waitForRef(videoThumbnailUriRef, 3000) : null;
        let thumbnailPath: string | null = null;
        if (localThumbUri) {
          thumbnailPath = checkoutVideoThumbnailPath(group.id, session.user.id, checkinDate);
          await uploadImage('checkins', thumbnailPath, localThumbUri).catch(() => {
            thumbnailPath = null;
          });
        }

        const { data, error } = await supabase.rpc('submit_workout_checkout', {
          p_checkin_id: draft.existingCheckinId,
          p_captured_at: draft.capturedAt,
          p_latitude: draft.latitude,
          p_longitude: draft.longitude,
          p_location_accuracy_m: draft.accuracyMeters,
          p_photo_path: isVideo ? null : path,
          p_video_path: isVideo ? path : null,
          p_video_thumbnail_path: thumbnailPath,
          p_location_mocked: draft.locationMocked,
        });
        if (error || !data) throw new Error(error?.message ?? 'No se pudo registrar la foto final');
        logBreadcrumb(session.user.id, 'confirm:checkout_rpc_done');

        await cancelCheckoutReminders();
        logBreadcrumb(session.user.id, 'confirm:checkout_reminders_cancelled');

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
            media: isVideo ? { kind: 'video', uri: mediaUri } : { kind: 'photo', uri: mediaUri },
            videoThumbnailUri: localThumbUri,
            capturedAtDate,
            capturedAtIso: draft.capturedAt,
            latitude: draft.latitude,
            longitude: draft.longitude,
            accuracyMeters: draft.accuracyMeters,
            locationMocked: draft.locationMocked,
          }).catch(() => {});
        }
        logBreadcrumb(session.user.id, 'confirm:checkout_fanout_done');

        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        const minutes = data.workout_minutes ?? 0;
        const isShort = group.require_checkout_photo && minutes < group.min_workout_minutes;
        logBreadcrumb(session.user.id, 'confirm:checkout_alert_about_to_show');
        Alert.alert(
          'Foto final registrada 🏁',
          `Entrenaste ${minutes} minuto(s).${isShort ? ` No alcanzaste el mínimo de ${group.min_workout_minutes} minutos.` : ''}`,
          [
            {
              text: 'OK',
              // Breadcrumb data from real repros (debug_breadcrumbs — see debugBreadcrumb.ts)
              // proved router.dismissTo('/home') gets called and returns with no error, yet
              // Home's own focus effect never fires afterward — the exact same breadcrumb fires
              // fine for a plain manual tab tap, so this isn't a JS hang or a React state issue,
              // it's dismissTo itself never completing its navigation. Root cause, confirmed by
              // reading expo-router's own source (SDK 57 dropped @react-navigation/native
              // entirely for a bespoke queue+ref implementation — see
              // node_modules/expo-router/build/global-state/routingQueue.js): imperative calls
              // are queued, then drained in an effect via `ref.current.dispatch(action)` — that
              // file's own TODO literally says "actions are silently dropped" when the ref isn't
              // ready. dismissTo's action (type 'POP_TO', resolved through getNavigateAction's
              // cross-navigator "divergent state" search) is structurally the most complex kind of
              // action this mechanism supports — dismissing a fullScreenModal AND jumping tabs in
              // one dispatch. Splitting it into two simple steps instead: router.dismiss() here
              // (a plain stack POP, no href resolution, no cross-navigator target search — just
              // closes this modal, landing back on checkin/index in the SAME tab), then a pending
              // flag that checkin/index's own focus effect reads to do the tab switch separately,
              // from a context that isn't itself the thing being torn down.
              onPress: () => {
                logBreadcrumb(session.user.id, 'confirm:checkout_ok_pressed');
                setTimeout(() => {
                  logBreadcrumb(session.user.id, 'confirm:checkout_navigating');
                  setDraft(null);
                  usePostConfirmRedirectStore.getState().setPendingHref('/home');
                  router.dismiss();
                  logBreadcrumb(session.user.id, 'confirm:checkout_navigate_called');
                  // requestWorkoutActivitySync() used to fire synchronously right on submit
                  // success, well before this — meaning the Live Activity's native reconcile
                  // (ActivityKit end/update, which re-evaluates WorkoutActivity.tsx's whole
                  // SwiftUI description in a native JSContext) could land its own, separately
                  // heavy native work in the exact same window as this screen's own alert-
                  // dismiss/navigation race. syncWorkoutLiveActivity's queue is a single
                  // module-scope promise chain for the whole app session — if that native call
                  // ever hangs instead of throwing, every future call to it hangs too, forever,
                  // until the app is force-quit (restarting the module). Deferring it well past
                  // the point navigation has already committed means that, even if it does hang,
                  // it can no longer be mistaken for (or contribute to) this screen failing to
                  // leave "Confirmar".
                  setTimeout(() => requestWorkoutActivitySync(), 800);
                }, 350);
              },
            },
          ]
        );
        return;
      }

      const path = isVideo
        ? checkinVideoPath(group.id, session.user.id, checkinDate)
        : checkinPhotoPath(group.id, session.user.id, checkinDate);
      if (isVideo) {
        await uploadVideo('checkins', path, mediaUri, 'video/mp4', setVideoUploadProgress);
      } else {
        await uploadImage('checkins', path, mediaUri);
      }
      logBreadcrumb(session.user.id, 'confirm:checkin_uploaded');

      const localThumbUri = isVideo ? await waitForRef(videoThumbnailUriRef, 3000) : null;
      let thumbnailPath: string | null = null;
      if (localThumbUri) {
        thumbnailPath = checkinVideoThumbnailPath(group.id, session.user.id, checkinDate);
        await uploadImage('checkins', thumbnailPath, localThumbUri).catch(() => {
          thumbnailPath = null;
        });
      }

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
        p_photo_path: isVideo ? null : path,
        p_video_path: isVideo ? path : null,
        p_video_thumbnail_path: thumbnailPath,
        p_location_mocked: draft.locationMocked,
      });
      if (error || !checkinRow) throw new Error(error?.message ?? 'No se pudo registrar el check-in');
      logBreadcrumb(session.user.id, 'confirm:checkin_rpc_done');

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
          media: isVideo ? { kind: 'video', uri: mediaUri } : { kind: 'photo', uri: mediaUri },
          videoThumbnailUri: localThumbUri,
          capturedAtDate,
          capturedAtIso: draft.capturedAt,
          reminderMinutes: profile?.checkout_reminder_minutes,
          radiusMeters: profile?.checkout_geofence_radius_meters,
          latitude: draft.latitude,
          longitude: draft.longitude,
          accuracyMeters: draft.accuracyMeters,
          locationMocked: draft.locationMocked,
        }).catch(() => {});
      }

      if (group.require_checkout_photo) {
        await scheduleCheckoutReminders(
          draft.latitude,
          draft.longitude,
          profile?.checkout_reminder_minutes,
          profile?.checkout_geofence_radius_meters
        );
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
      logBreadcrumb(session.user.id, 'confirm:checkin_alert_about_to_show');

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      Alert.alert(
        draft.existingCheckinId ? 'Foto actualizada 💪' : '¡Check-in registrado! 💪',
        (group.require_checkout_photo
          ? 'Tu día de hoy ya cuenta. Cuando termines de entrenar, vuelve a esta app y registra tu foto final.'
          : 'Tu día de hoy ya cuenta.') + buddyLine,
        [
          {
            text: 'OK',
            // Fase 3: the "¿qué rutina quieres hacer?" step — never for a checkout, only right
            // after a fresh check-in (see routine-choice.tsx's own doc).
            //
            // Same defensive delay as the checkout branch above, and for the same reason: onPress
            // fires while UIAlertController is still mid its own dismiss animation, and asking for
            // another screen transition before that settles can get silently dropped by UIKit.
            // This path doesn't cross tabs like the checkout one does, but it's the same race on
            // the same alert API, so it gets the same guard rather than waiting for its own report.
            onPress: () => {
              logBreadcrumb(session.user.id, 'confirm:checkin_ok_pressed');
              setTimeout(() => {
                logBreadcrumb(session.user.id, 'confirm:checkin_navigating');
                setDraft(null);
                router.replace({ pathname: '/checkin/routine-choice', params: { checkinId: checkinRow.id } });
                logBreadcrumb(session.user.id, 'confirm:checkin_navigate_called');
                // Deferred well past navigation — see the checkout branch's onPress comment
                // above for why requestWorkoutActivitySync() no longer fires right on submit
                // success.
                setTimeout(() => requestWorkoutActivitySync(), 800);
              }, 350);
            },
          },
        ]
      );
    } catch (err) {
      logBreadcrumb(session.user.id, 'confirm:error', { message: err instanceof Error ? err.message : String(err) });
      Alert.alert(
        draft.mode === 'checkout' ? 'No se pudo registrar la foto final' : 'No se pudo registrar el check-in',
        err instanceof Error ? err.message : 'Intenta de nuevo'
      );
    } finally {
      logBreadcrumb(session.user.id, 'confirm:finally');
      setIsSubmitting(false);
      setVideoUploadProgress(null);
    }
  };

  const isVideoDraft = draft.media.kind === 'video';
  const actionLabel = isVideoDraft
    ? draft.mode === 'checkout'
      ? 'Confirmar video final'
      : 'Confirmar video inicial'
    : draft.mode === 'checkout'
      ? 'Confirmar foto final'
      : 'Confirmar foto inicial';

  return (
    <View style={styles.container}>
      {isVideoDraft ? (
        <>
          <VideoPreviewWithOverlay uri={draft.media.uri} overlayText={overlayText} locationText={address ?? coordsText} />
          <VideoThumbnailCapture uri={draft.media.uri} onReady={handleThumbnailReady} />
        </>
      ) : (
        <ViewShot ref={viewShotRef} style={styles.shotWrapper} options={{ format: 'jpg', quality: 0.85 }}>
          <Image source={{ uri: draft.media.uri }} style={styles.photo} />
          <View style={styles.overlay}>
            <Text style={styles.overlayText}>{overlayText}</Text>
            <Text style={styles.overlayText}>{address ?? coordsText}</Text>
          </View>
        </ViewShot>
      )}

      {isSubmitting && isVideoDraft && videoUploadProgress !== null ? (
        <View style={styles.uploadProgress}>
          <ProgressBar progress={videoUploadProgress} />
          <Text style={styles.uploadProgressText}>
            {videoUploadProgress < 1 ? `Subiendo video... ${Math.round(videoUploadProgress * 100)}%` : 'Procesando...'}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button label={isVideoDraft ? 'Repetir video' : 'Repetir foto'} variant="secondary" onPress={handleRetake} disabled={isSubmitting} />
        <Button label={actionLabel} onPress={handleConfirm} loading={isSubmitting} />
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
  hiddenThumbnail: { position: 'absolute', top: -4000, left: 0 },
  actions: { gap: spacing.sm },
  uploadProgress: { gap: spacing.xs },
  uploadProgressText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
