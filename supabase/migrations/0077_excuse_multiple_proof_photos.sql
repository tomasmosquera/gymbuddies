-- ============================================================================
-- Multiple proof photos per excuse request (e.g. several boarding-pass
-- photos for a multi-leg trip) — proof_path text -> proof_paths text[].
-- No storage policy change needed: excuse-proofs' RLS (0016_excuse_storage.sql)
-- only constrains the first two path segments (group_id/user_id), the
-- filename itself is free — multiple photos for one request just share
-- that same {group_id}/{user_id}/ prefix with distinct filenames, same as
-- how a check-in and its checkout photo already coexist today.
-- ============================================================================
alter table excuse_requests rename column proof_path to proof_path_old;
alter table excuse_requests add column proof_paths text[] not null default '{}';
update excuse_requests set proof_paths = array[proof_path_old] where proof_path_old is not null;
alter table excuse_requests drop column proof_path_old;

create or replace function create_excuse_request(
  p_group_id uuid, p_excuse_type text, p_start_date date, p_end_date date,
  p_reason text default null, p_proof_paths text[] default '{}'
)
returns excuse_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_admin_id uuid;
begin
  if p_excuse_type not in ('travel', 'medical', 'other') then
    raise exception 'invalid excuse type';
  end if;
  if not is_active_participant(p_group_id, auth.uid()) then
    raise exception 'only active members can request an excuse';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date must be on or after start date';
  end if;
  if p_excuse_type in ('travel', 'medical') and coalesce(array_length(p_proof_paths, 1), 0) = 0 then
    raise exception 'travel and medical excuses require proof';
  end if;
  if coalesce(array_length(p_proof_paths, 1), 0) > 8 then
    raise exception 'a maximum of 8 proof photos is allowed';
  end if;

  insert into excuse_requests (
    group_id, user_id, excuse_type, requested_start_date, requested_end_date, reason, proof_paths
  ) values (
    p_group_id, auth.uid(), p_excuse_type, p_start_date, p_end_date, p_reason, p_proof_paths
  ) returning * into v_request;

  select admin_id into v_admin_id from groups where id = p_group_id;
  if v_admin_id is not null then
    perform send_push_notification(
      array[v_admin_id], 'Nueva solicitud de excusa', 'Hay una solicitud de excusa pendiente por revisar.',
      p_group_id => p_group_id, p_category => 'votes', p_data => jsonb_build_object('route', 'admin_review')
    );
  end if;

  return v_request;
end;
$$;

-- ============================================================================
-- cleanup_old_checkin_photos() / delete_own_account(): both deleted
-- excuse-proofs storage objects by selecting the old single proof_path
-- column — now every path in the array needs deleting. checkins/receipts
-- deletion logic is untouched, reproduced as-is from the current bodies
-- (0057_expand_photo_retention.sql, 0035_fix_delete_own_account.sql).
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
            (extract(isodow from checkin_date) in (6, 7)
              and v_today >= date_trunc('week', checkin_date)::date + 9)
            or
            (extract(isodow from checkin_date) between 1 and 5
              and v_today >= date_trunc('week', checkin_date)::date + 7)
          )
        union all
        select checkout_photo_path from checkins
          where checkout_photo_path is not null
            and (
              (extract(isodow from checkin_date) in (6, 7)
                and v_today >= date_trunc('week', checkin_date)::date + 9)
              or
              (extract(isodow from checkin_date) between 1 and 5
                and v_today >= date_trunc('week', checkin_date)::date + 7)
            )
      );

  delete from storage.objects
    where bucket_id = 'receipts'
      and name in (
        select receipt_path from wallet_transactions
          where receipt_path is not null
            and (
              (extract(isodow from (created_at at time zone 'America/Bogota')::date) in (6, 7)
                and v_today >= date_trunc('week', (created_at at time zone 'America/Bogota')::date)::date + 9)
              or
              (extract(isodow from (created_at at time zone 'America/Bogota')::date) between 1 and 5
                and v_today >= date_trunc('week', (created_at at time zone 'America/Bogota')::date)::date + 7)
            )
      );

  delete from storage.objects
    where bucket_id = 'excuse-proofs'
      and name in (
        select unnest(proof_paths) from excuse_requests
          where array_length(proof_paths, 1) > 0
            and (
              (extract(isodow from (created_at at time zone 'America/Bogota')::date) in (6, 7)
                and v_today >= date_trunc('week', (created_at at time zone 'America/Bogota')::date)::date + 9)
              or
              (extract(isodow from (created_at at time zone 'America/Bogota')::date) between 1 and 5
                and v_today >= date_trunc('week', (created_at at time zone 'America/Bogota')::date)::date + 7)
            )
      );
end;
$$;

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
    select unnest(proof_paths) from excuse_requests where user_id = v_user_id and array_length(proof_paths, 1) > 0
  );

  delete from groups where admin_id = v_user_id;

  delete from auth.users where id = v_user_id;
end;
$$;
