-- ============================================================================
-- Lets a group admin replace a check-in's initial or final photo from
-- "Moderar Fotos", picking a new one from the camera roll — for a bad/wrong
-- photo that doesn't warrant deleting the whole check-in (which would also
-- wipe the day's credit). The client always uploads the replacement to a
-- FRESH, unique storage path (never reusing the original filename) rather
-- than overwriting the same key in place — this sidesteps two problems at
-- once: the checkins bucket's insert policy only lets a member upload into
-- their own user_id folder (added below, admin-scoped), and CheckinPhotoColumn
-- caches the displayed image on disk keyed by photo_path, so an in-place
-- overwrite at the same path would keep showing the stale cached photo.
-- Reusing the same path was considered and rejected for exactly that reason.
-- ============================================================================
create policy checkins_bucket_admin_insert on storage.objects
  for insert
  with check (
    bucket_id = 'checkins'
    and is_group_admin((storage.foldername(name))[1]::uuid)
  );

create or replace function admin_replace_checkin_photo(p_checkin_id uuid, p_which text, p_photo_path text)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_old_path text;
  v_label text;
begin
  if p_which not in ('initial', 'final') then
    raise exception 'invalid photo selector';
  end if;

  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_admin(v_checkin.group_id) then
    raise exception 'only the group admin can replace a check-in photo';
  end if;
  if p_which = 'final' and v_checkin.checkout_photo_path is null then
    raise exception 'this check-in has no final photo yet';
  end if;

  if p_which = 'initial' then
    v_old_path := v_checkin.photo_path;
    update checkins set photo_path = p_photo_path where id = p_checkin_id returning * into v_checkin;
  else
    v_old_path := v_checkin.checkout_photo_path;
    update checkins set checkout_photo_path = p_photo_path where id = p_checkin_id returning * into v_checkin;
  end if;

  if v_old_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_old_path;
  end if;

  v_label := case p_which when 'initial' then 'inicial' else 'final' end;
  perform send_push_notification(
    array[v_checkin.user_id], 'Gym Buddies',
    format('El administrador reemplazó tu foto %s del %s.', v_label, to_char(v_checkin.checkin_date, 'DD/MM/YYYY')),
    p_group_id => v_checkin.group_id, p_category => 'admin_actions'
  );

  return v_checkin;
end;
$$;
