-- ============================================================================
-- checkin_reactions: quick emoji reactions on a teammate's check-in — the
-- most self-contained gamification feature (no cron, no effect on weekly
-- evaluation/penalties, just social feedback). Same shape as every other
-- write path added this session: SELECT is open via RLS to group members,
-- but INSERT/UPDATE/DELETE are revoked from `authenticated` entirely and
-- funneled through two SECURITY DEFINER RPCs — mirrors photo_challenges
-- (0030), checkins (0028), push_tokens (0043).
--
-- group_id is denormalized onto the table itself (like photo_challenges,
-- not like photo_challenge_votes) so the SELECT policy is a plain
-- is_group_member(group_id) with no join needed.
--
-- One active reaction per (checkin, user) — react_to_checkin upserts on
-- conflict, replacing whatever emoji was there before, same "replace, don't
-- accumulate" semantics attendance_overrides already uses. No self-reaction
-- (same rule as "you cannot challenge your own photo" in create_photo_
-- challenge). Only the *first* reaction from a given user notifies the
-- check-in's owner — switching your emoji on an already-reacted check-in
-- stays silent, same "don't re-notify on a retake" precedent as
-- submit_checkin's own-photo-upload notification.
-- ============================================================================
create table checkin_reactions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  checkin_id uuid not null references checkins (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  emoji text not null check (emoji in ('💪🏼', '🔥', '🫃')),
  created_at timestamptz not null default now(),
  unique (checkin_id, user_id)
);

create index checkin_reactions_checkin_idx on checkin_reactions (checkin_id);

alter table checkin_reactions enable row level security;

create policy checkin_reactions_select on checkin_reactions
  for select
  using (is_group_member(group_id));

revoke insert, update, delete on checkin_reactions from authenticated;

create or replace function react_to_checkin(p_checkin_id uuid, p_emoji text)
returns checkin_reactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_reaction checkin_reactions%rowtype;
  v_full_name text;
  v_is_first_reaction boolean;
begin
  if p_emoji not in ('💪🏼', '🔥', '🫃') then
    raise exception 'invalid reaction emoji';
  end if;

  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_member(v_checkin.group_id) then
    raise exception 'only group members can react';
  end if;
  if v_checkin.user_id = auth.uid() then
    raise exception 'you cannot react to your own check-in';
  end if;

  select not exists (
    select 1 from checkin_reactions where checkin_id = p_checkin_id and user_id = auth.uid()
  ) into v_is_first_reaction;

  insert into checkin_reactions (group_id, checkin_id, user_id, emoji)
    values (v_checkin.group_id, p_checkin_id, auth.uid(), p_emoji)
    on conflict (checkin_id, user_id) do update set emoji = excluded.emoji, created_at = now()
    returning * into v_reaction;

  if v_is_first_reaction then
    select full_name into v_full_name from profiles where id = auth.uid();
    perform send_push_notification(
      array[v_checkin.user_id], 'Gym Buddies',
      format('%s reaccionó %s a tu entreno.', v_full_name, p_emoji),
      p_category => 'group_activity'
    );
  end if;

  return v_reaction;
end;
$$;

create or replace function remove_reaction(p_checkin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from checkin_reactions where checkin_id = p_checkin_id and user_id = auth.uid();
end;
$$;
