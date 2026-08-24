import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { kothVideoPath, uploadVideo } from '@/lib/supabase/storage';
import type { KothClaim } from '@/lib/supabase/types';

interface SubmitKothClaimParams {
  groupId: string;
  userId: string;
  exerciseId: string;
  exerciseSlug: string;
  value: number;
  unit: 'kg' | 'lbs' | null;
  videoUri: string;
  videoMimeType?: string | null;
}

/** Imperative — not a persistent list. Uploads the video, then submits the claim. */
export function useSubmitKothClaim() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 0..1 while the video is uploading, null before/after (the RPC call that
  // follows is near-instant, so there's nothing meaningful to show progress
  // for beyond the upload itself).
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const submit = useCallback(async (params: SubmitKothClaimParams): Promise<KothClaim> => {
    setIsSubmitting(true);
    setUploadProgress(0);
    try {
      const path = kothVideoPath(params.groupId, params.userId, params.exerciseSlug);
      await uploadVideo('koth-videos', path, params.videoUri, params.videoMimeType ?? 'video/mp4', setUploadProgress);

      const { data, error } = await supabase.rpc('submit_koth_claim', {
        p_group_id: params.groupId,
        p_exercise_id: params.exerciseId,
        p_value: params.value,
        p_video_path: path,
        p_unit: params.unit,
      });
      if (error) throw new Error(error.message);
      return data;
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  }, []);

  return { submit, isSubmitting, uploadProgress };
}
