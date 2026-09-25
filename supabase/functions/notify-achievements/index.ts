// Runs every 15 minutes (cron job scheduled in migrations 0049/0052) across every
// group. A group with nothing new since its last check costs almost nothing:
// achievement_check_state.dirty_at is bumped by a trigger on every table that
// feeds badges/monthly challenges, and a group is only evaluated when
// dirty_at > last_checked_at.
//
// All of the actual work lives in src/lib/achievements/notifyAchievements.ts,
// which evaluates achievements with the SAME code the app uses (it takes the
// Supabase client as a parameter) and diffs the result against what was
// already pushed. This file only wires it to Deno: read the request, build a
// service-role client, run, and report.
//
// The import map (deno.json) has to list every module the shared code reaches —
// Deno does no alias or extension resolution of its own. If a shared module
// starts importing a new '@/...' path, regenerate it and re-check with:
//   deno check --config supabase/functions/notify-achievements/deno.json supabase/functions/notify-achievements/index.ts
//
// Request body (optional): { "baseline": true } records everything currently
// earned as already notified WITHOUT sending any push, for every group. Run it
// once after the badge catalog or the computation changes; otherwise existing
// members would be sent a notification for every achievement they already had.
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/lib/supabase/types.ts';
import { runNotifyAchievements } from '../../../src/lib/achievements/notifyAchievements.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  let baselineOnly = false;
  try {
    const body = await req.json();
    baselineOnly = body?.baseline === true;
  } catch {
    // No JSON body (e.g. the cron's empty '{}' or no body at all) — normal run.
  }

  const supabase = createClient<Database>(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const result = await runNotifyAchievements(supabase, { baselineOnly });
    // A non-2xx status makes a failing run visible in the Edge Function
    // metrics and in the cron's HTTP response — the previous version returned
    // 200 with groupsProcessed: 0 for weeks while failing on every group.
    if (!result.ok) console.error('notify-achievements finished with failures:', JSON.stringify(result.errors));
    return json(result, result.ok ? 200 : 500);
  } catch (err) {
    console.error('notify-achievements failed:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
