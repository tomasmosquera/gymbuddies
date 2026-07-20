-- ============================================================================
-- Supabase Storage has a statement-level BEFORE DELETE trigger on
-- storage.objects (storage.protect_delete()) that rejects any direct SQL
-- DELETE unless the session-local GUC `storage.allow_delete_query` is set to
-- 'true' — it exists precisely to let trusted server-side code (migrations,
-- SECURITY DEFINER functions) opt in, as an alternative to the Storage REST
-- API (which plpgsql can't call without pg_net). Every function below that
-- deletes storage objects was failing this check silently (confirmed via
-- cron.job_run_details: cleanup-old-checkin-photos has errored out on every
-- run since it was introduced in 0012). `set_config(..., true)` scopes the
-- flag to the current transaction only, so it never leaks elsewhere.
-- ============================================================================

create or replace function cleanup_old_checkin_photos()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
    where bucket_id = 'checkins'
      and name in (
        select photo_path from checkins
          where (
            extract(isodow from checkin_date) in (6, 7)
            and v_today >= date_trunc('week', checkin_date)::date + 9
          ) or (
            extract(isodow from checkin_date) between 1 and 5
            and v_today >= date_trunc('week', checkin_date)::date + 7
          )
      );
end;
$$;

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
  delete from checkins where id = p_checkin_id;
end;
$$;

create or replace function admin_delete_wallet_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx wallet_transactions%rowtype;
begin
  select * into v_tx from wallet_transactions where id = p_transaction_id;
  if not found then
    raise exception 'transaction not found';
  end if;
  if not is_group_admin(v_tx.group_id) then
    raise exception 'only the group admin can delete transactions';
  end if;
  if v_tx.status <> 'pending' then
    raise exception 'only pending transactions can be deleted';
  end if;

  if v_tx.receipt_path is not null then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where bucket_id = 'receipts' and name = v_tx.receipt_path;
  end if;
  delete from wallet_transactions where id = p_transaction_id;
end;
$$;
