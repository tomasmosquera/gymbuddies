-- ============================================================================
-- Lets each member set the weight of the barbell they train with (a standard
-- Olympic bar is 20kg, but a short bar, an EZ-curl bar, or a women's bar
-- weigh less) — used client-side only, to work out how many plates go on
-- each side of a barbell-equipment exercise's target weight. Global per user
-- (not per group or per exercise), same reasoning and RPC shape as
-- checkout_reminder_minutes (0097): it's a personal-equipment fact, not a
-- per-group rule. Canonical kg, like every other weight column in this
-- schema — converted to the viewer's own weight_unit for display/input, same
-- as body_weight_kg already is.
-- ============================================================================

alter table profiles add column default_bar_weight_kg numeric(5, 2) not null default 20
  check (default_bar_weight_kg >= 0 and default_bar_weight_kg <= 50);

create or replace function set_default_bar_weight_kg(p_kg numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kg < 0 or p_kg > 50 then
    raise exception 'default_bar_weight_kg must be between 0 and 50';
  end if;
  update profiles set default_bar_weight_kg = p_kg where id = auth.uid();
end;
$$;
