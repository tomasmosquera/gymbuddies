-- ============================================================================
-- Fix: 0089's "revoke execute on function join_group_membership(groups) from
-- authenticated" didn't actually work — Postgres grants EXECUTE to PUBLIC by
-- default on every newly created function, and a per-role revoke never
-- overrides a PUBLIC grant (has_function_privilege('authenticated', ...)
-- still returned true after 0089). Confirmed the same latent gap already
-- exists on pay_out_departing_member (0063), which this repo's comment
-- claimed was locked down the same way — not fixed here since it's out of
-- scope for this feature, but worth a follow-up.
--
-- The actual fix is revoking from PUBLIC, not (only) authenticated —
-- join_group/join_public_group still work since they call this as their
-- own SECURITY DEFINER owner, which is never subject to PUBLIC's grants.
-- ============================================================================
revoke execute on function join_group_membership(groups) from public;
revoke execute on function join_group_membership(groups) from authenticated;
