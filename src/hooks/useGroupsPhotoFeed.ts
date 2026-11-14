import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getSignedThumbnailUrl } from '@/lib/supabase/storage';

export interface PhotoFeedItem {
  checkinId: string;
  userId: string;
  fullName: string;
  groupId: string;
  groupName: string;
  groupTimezone: string;
  capturedAt: string;
  isVideo: boolean;
  thumbnailUrl: string;
  photoPath: string | null;
  videoPath: string | null;
  latitude: number | null;
  longitude: number | null;
  checkoutCapturedAt: string | null;
  checkoutPhotoPath: string | null;
  checkoutVideoPath: string | null;
  checkoutLatitude: number | null;
  checkoutLongitude: number | null;
}

interface CheckinRow {
  id: string;
  user_id: string;
  group_id: string;
  captured_at: string;
  photo_path: string | null;
  video_path: string | null;
  video_thumbnail_path: string | null;
  latitude: number | null;
  longitude: number | null;
  checkout_captured_at: string | null;
  checkout_photo_path: string | null;
  checkout_video_path: string | null;
  checkout_latitude: number | null;
  checkout_longitude: number | null;
  profile: { full_name: string } | null;
  group: { name: string; timezone: string } | null;
}

// A tile in a 58-60px circle never needs the original ~1280px check-in
// photo — 2x this (for retina) is still far lighter to download than the
// full-size original. getSignedThumbnailUrl falls back to the full-size
// signed URL on its own if Storage can't honor the resize, so this is
// always the smaller option when it's available at all.
const THUMBNAIL_SIZE = 160;

/** First-wins "same person, same exact instant" key — a member whose
 * check-in auto-fans-out to every other group they're in (profile setting,
 * see checkin/preview.tsx's fanOutCheckinToOtherGroups) reuses the exact
 * same captured_at across all of them, even though each group got its own
 * uploaded copy of the photo at its own storage path. Deduping on this
 * before resolving any signed URLs also means never paying for the
 * redundant ones. */
function dedupeKey(r: Pick<CheckinRow, 'user_id' | 'captured_at'>): string {
  return `${r.user_id}|${r.captured_at}`;
}

/**
 * Every OTHER member's check-in capture, across every group the caller
 * belongs to, newest first — the Home feed strip's data. Never the caller's
 * own check-ins (this is "what my buddies have been up to", not a mirror of
 * my own Dashboard history). The checkin side (photo_path/video_path) is
 * what the strip's bubble itself shows; the checkout side is carried along
 * only so the viewer can swipe to it (see FeedMediaModal) — it never affects
 * which items appear or how they're deduped.
 *
 * A check-in with neither a real photo nor a pre-generated video thumbnail
 * (an older video from before 0166, or one whose thumbnail capture failed)
 * is dropped outright rather than shown with a generic placeholder — same
 * reasoning as the expired-media drop below, just a different cause.
 *
 * Storage auto-deletes check-in media ~7-9 days after capture
 * (cleanup_old_checkin_photos) while the checkins row itself lives on, so a
 * signed URL can resolve successfully for a path whose object is already
 * gone — the failure only surfaces once something actually tries to read
 * it. Each candidate's signed URL is resolved up front and any that reject
 * are dropped silently (never shown as "expired", just not shown) —
 * fetching more candidates than `limit` leaves enough survivors after that
 * drop.
 */
export function useGroupsPhotoFeed(userId: string | null, limit: number) {
  const [items, setItems] = useState<PhotoFeedItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    const { data: memberships } = await supabase.from('group_members').select('group_id').eq('user_id', userId);
    const groupIds = (memberships ?? []).map((m) => m.group_id as string);
    if (groupIds.length === 0) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    const candidatePoolSize = Math.min(limit * 3, 120);
    const { data } = await supabase
      .from('checkins')
      .select(
        'id, user_id, group_id, captured_at, photo_path, video_path, video_thumbnail_path, latitude, longitude, checkout_captured_at, checkout_photo_path, checkout_video_path, checkout_latitude, checkout_longitude, profile:profiles(full_name), group:groups(name, timezone)'
      )
      .in('group_id', groupIds)
      .neq('user_id', userId)
      .or('photo_path.not.is.null,video_thumbnail_path.not.is.null')
      .order('captured_at', { ascending: false })
      .limit(candidatePoolSize);

    const rows = (data as unknown as CheckinRow[]) ?? [];
    const seenKeys = new Set<string>();
    const deduped = rows.filter((r) => {
      const key = dedupeKey(r);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    const resolved = await Promise.all(
      deduped.map(async (r): Promise<PhotoFeedItem | null> => {
        const mediaPath = r.photo_path ?? r.video_thumbnail_path;
        if (!mediaPath || !r.profile || !r.group) return null;
        try {
          const thumbnailUrl = await getSignedThumbnailUrl('checkins', mediaPath, THUMBNAIL_SIZE);
          return {
            checkinId: r.id,
            userId: r.user_id,
            fullName: r.profile.full_name,
            groupId: r.group_id,
            groupName: r.group.name,
            groupTimezone: r.group.timezone,
            capturedAt: r.captured_at,
            isVideo: !r.photo_path && !!r.video_path,
            thumbnailUrl,
            photoPath: r.photo_path,
            videoPath: r.video_path,
            latitude: r.latitude,
            longitude: r.longitude,
            checkoutCapturedAt: r.checkout_captured_at,
            checkoutPhotoPath: r.checkout_photo_path,
            checkoutVideoPath: r.checkout_video_path,
            checkoutLatitude: r.checkout_latitude,
            checkoutLongitude: r.checkout_longitude,
          };
        } catch {
          return null;
        }
      })
    );

    setItems(resolved.filter((r): r is PhotoFeedItem => r !== null).slice(0, limit));
    setIsLoading(false);
  }, [userId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, isLoading, refresh };
}
