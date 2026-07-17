import { create } from 'zustand';

export interface CheckinDraft {
  photoUri: string;
  capturedAt: string; // ISO instant, set the moment the shutter fired
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  address: string | null; // best-effort reverse geocode, may be null
}

interface CheckinDraftState {
  draft: CheckinDraft | null;
  setDraft: (draft: CheckinDraft | null) => void;
}

/**
 * Hands the just-captured photo + GPS/timestamp off from the camera screen
 * to the preview screen. Not persisted on purpose — a half-finished
 * check-in should not survive an app restart, since captured_at must stay
 * close to server time (see set_checkin_date()'s clock-drift guard).
 */
export const useCheckinDraftStore = create<CheckinDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
}));
