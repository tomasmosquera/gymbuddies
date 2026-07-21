-- ============================================================================
-- admin_delete_checkin: also clean up the checkout photo from storage if
-- one exists — previously only the check-in photo was removed, leaving the
-- checkout photo (if the member had already completed that step) orphaned
-- in the bucket.
-- ============================================================================
create or replace function admin_delete_checkin(p_checkin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
begin
  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_admin(v_checkin.group_id) then
    raise exception 'only the group admin can delete check-ins';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.photo_path;
  if v_checkin.checkout_photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_photo_path;
  end if;
  delete from checkins where id = p_checkin_id;
end;
$$;
