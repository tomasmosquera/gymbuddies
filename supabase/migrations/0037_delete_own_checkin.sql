-- ============================================================================
-- delete_own_checkin: self-service version of admin_delete_checkin (0026) —
-- a member can erase *today's* check-in entirely (not just retake the
-- photo), going back to a blank/pending state instead of an updated one.
-- Scoped to today only, mirroring the same same-day restriction already
-- used for retakes (checkins_update_self_today, 0012) — past days stay
-- immutable proof.
-- ============================================================================
create or replace function delete_own_checkin(p_checkin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;
  if v_checkin.checkin_date <> (now() at time zone 'America/Bogota')::date then
    raise exception 'solo puedes eliminar el check-in de hoy';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.photo_path;
  if v_checkin.checkout_photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_photo_path;
  end if;
  delete from checkins where id = p_checkin_id;
end;
$$;
