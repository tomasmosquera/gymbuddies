import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface PendingInviteState {
  /** An invite code waiting to be consumed by /join/[code] — set either from a clipboard handoff (useDeferredInviteCode) or when an unauthenticated user opens an invite link and gets sent to sign up first. Cleared once joined or dismissed. */
  pendingCode: string | null;
  /** Whether the one-time clipboard check for a deferred invite has already run — deliberately checked only once ever (see useDeferredInviteCode), not persisted per-launch, so this must survive app restarts. */
  hasCheckedClipboard: boolean;
  setPendingCode: (code: string | null) => void;
  markClipboardChecked: () => void;
}

export const usePendingInviteStore = create<PendingInviteState>()(
  persist(
    (set) => ({
      pendingCode: null,
      hasCheckedClipboard: false,
      setPendingCode: (code) => set({ pendingCode: code }),
      markClipboardChecked: () => set({ hasCheckedClipboard: true }),
    }),
    {
      name: 'gymbuddies-pending-invite',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
