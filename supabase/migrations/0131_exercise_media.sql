-- ============================================================================
-- Exercise detail media (Resumen tab) — adds a demo image and secondary
-- muscles to the exercise catalog, and a public bucket to hold the images.
--
-- Source: WorkoutX API (api.workoutxapp.com) GIFs are re-hosted here rather
-- than hotlinked, for two reasons — their /gifs endpoint requires an API key
-- on every request (not a public CDN), and our free-tier key has a *lifetime*
-- (not monthly) 500-request cap, so each exercise's GIF is fetched from
-- WorkoutX at most once, ever, via the exercise-gif-sync Edge Function, and
-- served from here after that. The app never talks to WorkoutX directly and
-- never sees its API key.
--
-- exercise-media is this project's first PUBLIC bucket: unlike every other
-- bucket so far (checkins, receipts, excuse-proofs, koth-videos — all
-- private, per-group/per-user content read via RLS or signed URL), this
-- holds the same shared, non-sensitive reference images for every user,
-- same visibility as the exercises table itself. Only the service role
-- (exercise-gif-sync) ever writes to it — no end-user upload path exists.
-- ============================================================================

alter table exercises add column gif_url text;
alter table exercises add column secondary_muscles text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-media', 'exercise-media', true, 5242880, array['image/gif', 'image/webp', 'image/png'])
on conflict (id) do nothing;

-- No select policy needed — the bucket is public, so storage.objects rows in
-- it are readable via the public URL regardless of RLS. Insert/update/delete
-- deliberately have no policy at all: only the service role (which bypasses
-- RLS entirely) can write, i.e. only exercise-gif-sync.
