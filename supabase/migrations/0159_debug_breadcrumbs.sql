-- Temporary diagnostic table for the checkin/checkout "stuck on Confirmar" hang: four targeted
-- fixes (alert/navigation timing, Live Activity sync timing) have each failed to resolve it, with
-- no crash log ever produced, so the next step is recording exactly how far handleConfirm actually
-- gets in a real occurrence instead of guessing again. Meant to be dropped once this is resolved.
create table debug_breadcrumbs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  step text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table debug_breadcrumbs enable row level security;

create policy "insert own breadcrumbs" on debug_breadcrumbs
  for insert to authenticated
  with check (user_id = auth.uid());
