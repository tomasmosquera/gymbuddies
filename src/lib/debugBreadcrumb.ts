import { supabase } from '@/lib/supabase/client';

/**
 * Temporary diagnostic aid for the checkin/checkout "stuck on Confirmar" hang — four targeted
 * fixes (alert/navigation timing, Live Activity sync timing) have each failed to resolve it, with
 * no crash log ever produced, so this records exactly how far handleConfirm gets in a real
 * occurrence instead of guessing again. Fire-and-forget and swallows every error: a logging call
 * must never itself become a new way for this exact flow to hang or fail. Delete this file, its
 * call sites, and the debug_breadcrumbs table (migration 0159) once this is resolved.
 */
export function logBreadcrumb(userId: string, step: string, meta?: Record<string, unknown>): void {
  void (async () => {
    try {
      await supabase.from('debug_breadcrumbs').insert({ user_id: userId, step, meta: meta ?? null });
    } catch {
      // Logging must never itself be a new way for this flow to fail — see doc comment above.
    }
  })();
}
