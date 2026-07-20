-- ============================================================================
-- excuse-proofs: a new private bucket for excuse evidence (flight tickets,
-- toll receipts, medical notes). Kept separate from `receipts` for clarity
-- (excuse documentation vs. payment receipts), but with the SAME open
-- select policy as checkins/receipts — any group member can view it (no
-- special privacy restriction for medical proof, confirmed with the user).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('excuse-proofs', 'excuse-proofs', false)
on conflict (id) do nothing;

create policy excuse_proofs_bucket_select on storage.objects
  for select
  using (
    bucket_id = 'excuse-proofs'
    and is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy excuse_proofs_bucket_insert on storage.objects
  for insert
  with check (
    bucket_id = 'excuse-proofs'
    and auth.uid()::text = (storage.foldername(name))[2]
    and is_voting_member((storage.foldername(name))[1]::uuid, auth.uid())
  );
