-- Private buckets. Objects are addressed as "{group_id}/{user_id}/{file}",
-- which the policies below parse via storage.foldername() to reuse the same
-- group-membership predicates as every other table. Clients read photos
-- through short-lived signed URLs (createSignedUrl), never public URLs.
insert into storage.buckets (id, name, public)
values ('checkins', 'checkins', false), ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy checkins_bucket_select on storage.objects
  for select
  using (
    bucket_id = 'checkins'
    and is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy checkins_bucket_insert on storage.objects
  for insert
  with check (
    bucket_id = 'checkins'
    and auth.uid()::text = (storage.foldername(name))[2]
    and is_voting_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

create policy receipts_bucket_select on storage.objects
  for select
  using (
    bucket_id = 'receipts'
    and is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy receipts_bucket_insert on storage.objects
  for insert
  with check (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[2]
    and is_group_member((storage.foldername(name))[1]::uuid)
  );
