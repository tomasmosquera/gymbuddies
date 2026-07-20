-- ============================================================================
-- Photo retention (replaces the flat 7-day cutoff from 0012): weekday
-- check-ins (Mon-Fri) are cleared the following Monday morning; weekend
-- check-ins (Sat-Sun) are kept a bit longer, through the following
-- Wednesday, since the group is more likely to still be looking back at
-- the weekend's photos mid-week. The checkins row itself (date/location/
-- attendance record) is never touched — only the storage object is
-- removed once retention lapses. Same cron schedule as before (0012),
-- just a new cutoff rule inside the function body.
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
