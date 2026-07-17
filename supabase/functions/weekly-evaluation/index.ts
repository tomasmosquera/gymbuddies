// Optional companion to the `weekly-evaluation` pg_cron job (see
// supabase/migrations/0011_pg_cron.sql), which already runs the actual
// evaluation directly in Postgres. This function only sends Expo push
// notifications to members who just flipped to 'needs_recharge'.
//
// It is NOT wired into pg_cron by default (that would require pg_net plus
// storing this project's URL/service-role key as Postgres config, which
// varies per deployment). To enable it:
//   1. supabase functions deploy weekly-evaluation
//   2. supabase secrets set EXPO_ACCESS_TOKEN=... (if you use Expo's push
//      security feature; optional)
//   3. Schedule it a few minutes after the SQL job, e.g. via pg_net:
//      select cron.schedule('weekly-evaluation-notify', '10 5 * * 1', $$
//        select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/weekly-evaluation',
//          headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
//        );
//      $$);
// See the README's "Notificaciones push (opcional)" section.

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface WeeklyEvaluationResult {
  user_id: string;
  status_after: 'active' | 'needs_recharge';
  group_id: string;
}

interface ProfileWithPushToken {
  id: string;
  expo_push_token: string | null;
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: results, error } = await supabase
    .from('weekly_evaluation_results')
    .select('user_id, status_after, group_id')
    .eq('status_after', 'needs_recharge')
    .gte('created_at', oneHourAgo)
    .returns<WeeklyEvaluationResult[]>();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!results || results.length === 0) {
    return new Response(JSON.stringify({ notified: 0 }), { status: 200 });
  }

  const userIds = [...new Set(results.map((r) => r.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, expo_push_token')
    .in('id', userIds)
    .returns<ProfileWithPushToken[]>();

  const messages = (profiles ?? [])
    .filter((p) => p.expo_push_token)
    .map((p) => ({
      to: p.expo_push_token,
      sound: 'default',
      title: 'Gym Buddies',
      body: 'Tu saldo llegó a cero. Recarga para seguir participando en el grupo.',
    }));

  if (messages.length > 0) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(messages),
    });
  }

  return new Response(JSON.stringify({ notified: messages.length }), { status: 200 });
});
