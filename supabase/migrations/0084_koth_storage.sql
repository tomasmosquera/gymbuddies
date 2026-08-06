-- ============================================================================
-- koth-videos: private bucket for King of the Hill claim videos. First
-- bucket in this project to set file_size_limit/allowed_mime_types
-- explicitly — a video is far larger than any photo this app has stored so
-- far, so an unbounded upload is a real cost/abuse risk none of the
-- existing photo buckets had to worry about. 150MB paired with a
-- client-side recording-duration cap (~30s) keeps a single-lift clip
-- comfortably inside the limit without needing server-side transcoding.
-- Same path convention and RLS shape as every other bucket:
-- "{group_id}/{user_id}/{file}", private, read only via signed URL.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('koth-videos', 'koth-videos', false, 157286400, array['video/mp4', 'video/quicktime'])
on conflict (id) do nothing;

create policy koth_videos_bucket_select on storage.objects
  for select
  using (
    bucket_id = 'koth-videos'
    and is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy koth_videos_bucket_insert on storage.objects
  for insert
  with check (
    bucket_id = 'koth-videos'
    and auth.uid()::text = (storage.foldername(name))[2]
    and is_active_participant((storage.foldername(name))[1]::uuid, auth.uid())
  );
