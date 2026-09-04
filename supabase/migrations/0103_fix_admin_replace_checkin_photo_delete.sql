-- ============================================================================
-- Fixes 0101: admin_replace_checkin_photo's delete from storage.objects hit
-- storage.protect_delete() ("Direct deletion from storage tables is not
-- allowed") — every other function in this codebase that deletes a storage
-- object first does `perform set_config('storage.allow_delete_query', 'true', true)`
-- (see 0021, 0026, 0033, etc.); 0101 was written without it. Reproduces the
-- rest of 0101's body unchanged.
-- ============================================================================
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
    perform set_config('storage.allow_delete_query', 'true', true);
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
