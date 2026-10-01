-- ============================================================================
-- Groups the official routines that are really days of the same program
-- (StrongLifts 5x5's A/B, Push Pull Legs' three days, Upper Lower's two) under
-- one "Programa" card in Explorar rutinas, instead of listing each day as its
-- own unrelated routine. program_name is the group label (null = this routine
-- stands alone, shown as its own card, same as today); day_label is the short
-- name shown for this routine WITHIN its program's day list ("Push", "Día A"),
-- since the program name already gives the context the full routine name
-- would otherwise repeat; program_order controls day order within the
-- program (alphabetical on the routine's own name would put "Legs" before
-- "Pull" before "Push" — wrong training order).
-- ============================================================================

alter table routines add column program_name text;
alter table routines add column day_label text;
alter table routines add column program_order smallint;
create index routines_program_idx on routines (program_name) where program_name is not null;

update routines set program_name = 'StrongLifts 5x5', day_label = 'Día A', program_order = 1
  where is_official and name = 'StrongLifts 5x5 - Dia A';
update routines set program_name = 'StrongLifts 5x5', day_label = 'Día B', program_order = 2
  where is_official and name = 'StrongLifts 5x5 - Dia B';

update routines set program_name = 'Push Pull Legs', day_label = 'Push', program_order = 1
  where is_official and name = 'Push Pull Legs - Push';
update routines set program_name = 'Push Pull Legs', day_label = 'Pull', program_order = 2
  where is_official and name = 'Push Pull Legs - Pull';
update routines set program_name = 'Push Pull Legs', day_label = 'Legs', program_order = 3
  where is_official and name = 'Push Pull Legs - Legs';

update routines set program_name = 'Upper Lower', day_label = 'Tren Superior', program_order = 1
  where is_official and name = 'Upper Lower - Tren Superior';
update routines set program_name = 'Upper Lower', day_label = 'Tren Inferior', program_order = 2
  where is_official and name = 'Upper Lower - Tren Inferior';
