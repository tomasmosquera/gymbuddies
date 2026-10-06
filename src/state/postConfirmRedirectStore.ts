import { create } from 'zustand';
import type { Href } from 'expo-router';

interface PostConfirmRedirectState {
  /** Set by preview.tsx right before closing the checkin fullScreenModal, read and cleared by
   * checkin/index.tsx's own focus effect once it's back on screen — see that call site's comment
   * for why the modal-close and the tab switch are two separate steps instead of one compound
   * router.dismissTo() call. */
  pendingHref: Href | null;
  setPendingHref: (href: Href | null) => void;
}

export const usePostConfirmRedirectStore = create<PostConfirmRedirectState>((set) => ({
  pendingHref: null,
  setPendingHref: (href) => set({ pendingHref: href }),
}));
