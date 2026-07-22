-- ============================================================================
-- Fix a gap in 0034's delete_own_account(): the admin-with-no-other-members
-- case (e.g. everyone else already left) still hit groups.admin_id's FK
-- (intentionally left with no cascade/set-null) because the group row
-- itself was never removed — the original guard only checked for *other*
-- members, not the group row's own reference back to this user. Now any
-- group this user still admins (which, past the guard above, has no other
-- members left) gets deleted outright before the auth.users delete, cascading
-- away everything scoped to it. Storage cleanup must run BEFORE that group
-- delete, not after — otherwise the checkins/receipts/proof rows it reads
-- paths from would already be gone via the group's own cascade.
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

  delete from groups where admin_id = v_user_id;

  delete from auth.users where id = v_user_id;
end;
$$;
