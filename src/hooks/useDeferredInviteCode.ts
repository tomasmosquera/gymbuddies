import { useEffect } from 'react';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { usePendingInviteStore } from '@/state/pendingInviteStore';
import { isValidInviteCode, normalizeInviteCode } from '@/lib/domain/inviteCode';

/**
 * Deferred deep linking without Branch.io: when the app is installed via a
 * store link after tapping an invite (web/join.html copies the code to the
 * clipboard before redirecting to the store), the first time the app opens
 * — before the user is even signed in — this checks the clipboard for
 * something that looks like a real invite code and routes straight to it.
 *
 * Deliberately runs at most ONCE ever (tracked in pendingInviteStore, not
 * just per-session): reading the clipboard surfaces a system "Paste from X"
 * banner on iOS every time, so checking it on every cold start would nag an
 * already-onboarded returning user for no reason. Never trusts arbitrary
 * clipboard content — isValidInviteCode enforces the exact generated-code
 * format before anything navigates anywhere.
 */
export function useDeferredInviteCode() {
  const { isSignedIn, isInitializing } = useAuth();
  const hasCheckedClipboard = usePendingInviteStore((s) => s.hasCheckedClipboard);
  const setPendingCode = usePendingInviteStore((s) => s.setPendingCode);
  const markClipboardChecked = usePendingInviteStore((s) => s.markClipboardChecked);

  useEffect(() => {
    if (isInitializing || isSignedIn || hasCheckedClipboard) return;
    let cancelled = false;

    (async () => {
      let code: string | null = null;
      try {
        const clipboardText = await Clipboard.getStringAsync();
        if (clipboardText && isValidInviteCode(clipboardText)) {
          code = normalizeInviteCode(clipboardText);
        }
      } catch {
        // Denied/unavailable clipboard access — treat exactly like "nothing found".
      }
      if (cancelled) return;
      markClipboardChecked();
      if (code) {
        setPendingCode(code);
        router.push({ pathname: '/join/[code]', params: { code } });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isInitializing, isSignedIn, hasCheckedClipboard, markClipboardChecked, setPendingCode]);
}
