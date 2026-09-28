// One-off/admin utility — NOT called by the app. Given an exercise slug and
// its WorkoutX numeric id, downloads that exercise's GIF from WorkoutX's API
// (server-side only: WORKOUTX_API_KEY never reaches the client) and re-hosts
// it in the public exercise-media bucket, then stamps exercises.gif_url with
// the resulting public URL. See migration 0131 for why re-hosting instead of
// hotlinking: WorkoutX's /gifs endpoint needs the API key on every request
// (it's not a public CDN), and the free-tier key has a *lifetime* (not
// monthly) 500-request cap — so each exercise's GIF is fetched from WorkoutX
// at most once, ever, right here.
//
// Invoke per exercise (or call repeatedly, one per body):
//   supabase functions invoke exercise-gif-sync --body '{"slug":"bench_press","workoutxId":"0025"}'
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/lib/supabase/types.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  let slug: string | undefined;
  let workoutxId: string | undefined;
  try {
    const body = await req.json();
    slug = body?.slug;
    workoutxId = body?.workoutxId;
  } catch {
    return json({ ok: false, error: 'Expected JSON body: { slug, workoutxId }' }, 400);
  }
  if (!slug || !workoutxId) {
    return json({ ok: false, error: 'Both slug and workoutxId are required' }, 400);
  }

  const apiKey = Deno.env.get('WORKOUTX_API_KEY');
  if (!apiKey) return json({ ok: false, error: 'WORKOUTX_API_KEY is not configured' }, 500);

  const gifResponse = await fetch(
    `https://api.workoutxapp.com/v1/gifs/${encodeURIComponent(workoutxId)}.gif?api-key=${apiKey}`
  );
  if (!gifResponse.ok) {
    return json({ ok: false, error: `WorkoutX returned ${gifResponse.status} for id ${workoutxId}` }, 502);
  }
  const gifBytes = new Uint8Array(await gifResponse.arrayBuffer());

  const supabase = createClient<Database>(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const path = `${slug}.gif`;
  const { error: uploadError } = await supabase.storage
    .from('exercise-media')
    .upload(path, gifBytes, { contentType: 'image/gif', upsert: true });
  if (uploadError) return json({ ok: false, error: `Storage upload failed: ${uploadError.message}` }, 500);

  // Cache-busted with a version query param: upsert overwrites the same
  // path every time (so the bare public URL never changes), and mobile
  // image loaders (expo-image included) key their cache on the exact URL
  // string, not on the server's Last-Modified/ETag — without this, a
  // re-sync (e.g. swapping in an unwatermarked GIF after upgrading the
  // WorkoutX plan) would silently keep serving the stale cached image to
  // anyone who'd already viewed it.
  const { data: publicUrlData } = supabase.storage.from('exercise-media').getPublicUrl(path);
  const gifUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;
  const { error: updateError } = await supabase.from('exercises').update({ gif_url: gifUrl }).eq('slug', slug);
  if (updateError) return json({ ok: false, error: `exercises update failed: ${updateError.message}` }, 500);

  return json({ ok: true, slug, gifUrl }, 200);
});
