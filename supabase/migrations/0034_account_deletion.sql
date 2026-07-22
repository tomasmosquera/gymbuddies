-- ============================================================================
-- Prerequisite for letting a user delete their own account: most
-- `references profiles (id)` foreign keys added across earlier migrations
-- default to ON DELETE NO ACTION, which would make `delete from auth.users`
-- fail with a constraint violation for almost any user who has ever voted,
-- confirmed a transaction, or moderated a photo. Split into two groups:
--   - the user's own vote rows: gone with them (CASCADE) — meaningless
--     without a voter, and for an already-resolved proposal/challenge the
--     outcome is already stamped independent of live vote counts.
--   - someone else's financial/moderation record where this user was just
--     the admin who acted on it: keep the row, null out who did it
--     (SET NULL) — deleting wallet_transactions or attendance_overrides
--     because the *admin* left would corrupt another member's own history.
-- groups.admin_id and photo_challenges.target_user_id are deliberately left
-- untouched — see delete_own_account()'s comments below for why.
-- ============================================================================

alter table rule_proposals alter column proposed_by drop not null;
alter table rule_proposals drop constraint rule_proposals_proposed_by_fkey;
alter table rule_proposals add constraint rule_proposals_proposed_by_fkey
  foreign key (proposed_by) references profiles (id) on delete set null;

alter table rule_votes drop constraint rule_votes_user_id_fkey;
alter table rule_votes add constraint rule_votes_user_id_fkey
  foreign key (user_id) references profiles (id) on delete cascade;

alter table wallet_transactions drop constraint wallet_transactions_confirmed_by_fkey;
alter table wallet_transactions add constraint wallet_transactions_confirmed_by_fkey
  foreign key (confirmed_by) references profiles (id) on delete set null;

alter table excuse_requests drop constraint excuse_requests_decided_by_fkey;
alter table excuse_requests add constraint excuse_requests_decided_by_fkey
  foreign key (decided_by) references profiles (id) on delete set null;

alter table excuse_votes drop constraint excuse_votes_user_id_fkey;
alter table excuse_votes add constraint excuse_votes_user_id_fkey
  foreign key (user_id) references profiles (id) on delete cascade;

alter table attendance_overrides alter column set_by drop not null;
alter table attendance_overrides drop constraint attendance_overrides_set_by_fkey;
alter table attendance_overrides add constraint attendance_overrides_set_by_fkey
  foreign key (set_by) references profiles (id) on delete set null;

alter table photo_challenges alter column challenged_by drop not null;
alter table photo_challenges drop constraint photo_challenges_challenged_by_fkey;
alter table photo_challenges add constraint photo_challenges_challenged_by_fkey
  foreign key (challenged_by) references profiles (id) on delete set null;

alter table photo_challenges drop constraint photo_challenges_decided_by_fkey;
alter table photo_challenges add constraint photo_challenges_decided_by_fkey
  foreign key (decided_by) references profiles (id) on delete set null;

alter table photo_challenge_votes drop constraint photo_challenge_votes_user_id_fkey;
alter table photo_challenge_votes add constraint photo_challenge_votes_user_id_fkey
  foreign key (user_id) references profiles (id) on delete cascade;

-- ============================================================================
-- delete_own_account: self-service, permanent. Blocks only when the caller
-- is the admin of a group that still has other active/needs_recharge/
-- pending_deposit members (groups.admin_id has no cascade/set-null — that FK
-- would reject the delete anyway, but this gives a readable error instead of
-- a raw constraint violation). photo_challenges.target_user_id is left
-- unresolved by design: it's always equal to the challenged check-in's own
-- user_id, and checkins.user_id already cascades from profiles, so by the
-- time this row's own FK would be checked, it's already gone via the
-- checkin_id -> checkins -> profiles cascade path.
--
-- Storage cleanup runs first (same set_config('storage.allow_delete_query')
-- escape hatch as cleanup_old_checkin_photos()/admin_delete_checkin, 0021/
-- 0026 — protect_delete() blocks direct deletes otherwise) since the actual
-- auth.users delete cascades away the rows holding these paths.
-- ============================================================================
create or replace function delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if exists (
    select 1 from groups g
      join group_members gm on gm.group_id = g.id
      where g.admin_id = v_user_id
        and gm.user_id <> v_user_id
        and gm.status in ('active', 'needs_recharge', 'pending_deposit')
  ) then
    raise exception 'eres admin de un grupo con otros miembros — transfiere la administración o remuévelos primero';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name in (
    select photo_path from checkins where user_id = v_user_id
    union
    select checkout_photo_path from checkins where user_id = v_user_id and checkout_photo_path is not null
  );
  delete from storage.objects where bucket_id = 'receipts' and name in (
    select receipt_path from wallet_transactions where user_id = v_user_id and receipt_path is not null
  );
  delete from storage.objects where bucket_id = 'excuse-proofs' and name in (
    select proof_path from excuse_requests where user_id = v_user_id and proof_path is not null
  );

  delete from auth.users where id = v_user_id;
end;
$$;
