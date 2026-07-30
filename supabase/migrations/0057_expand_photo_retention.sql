-- ============================================================================
-- Expands the daily photo-retention sweep beyond just the initial check-in
-- photo — the checkout photo, payment-receipt photos, and excuse-proof
-- photos now clear on the same cutoff (a photo taken on a weekday clears
-- the following Monday; a weekend photo clears through the following
-- Wednesday), matching the ~1-2 week window the privacy policy already
-- promises for check-in photos. Closes a real gap: the code previously only
-- ever auto-deleted checkins.photo_path, leaving checkout_photo_path,
-- wallet_transactions.receipt_path, and excuse_requests.proof_path stored
-- indefinitely with no matching disclosure.
--
-- Attendance/wallet/excuse RECORDS themselves are never touched — only the
-- storage object is removed, same as the original check-in photo cleanup.
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
        select proof_path from excuse_requests
          where proof_path is not null
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
