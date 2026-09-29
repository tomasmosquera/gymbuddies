-- ============================================================================
-- TEST/COMPARISON exercises — Gym visual-licensed GIFs, side-by-side with the
-- existing WorkoutX-sourced originals. Purchased by the app owner directly
-- from Gym visual (gymvisual.com) under their N-CRFL license; these two rows
-- exist purely to visually compare the two media sources in the running app
-- before deciding whether to replace the WorkoutX GIFs project-wide. Text
-- (name/instructions/muscles/equipment) is copied as-is from the existing
-- bench_press / dumbbell_bench_press rows — only gif_url differs.
--
-- Safe to delete later with:
--   delete from exercises where slug in ('bench_press_v2', 'dumbbell_bench_press_v2');
-- (and the two objects at exercise-media/bench_press_v2.gif /
-- dumbbell_bench_press_v2.gif in Storage, removed separately)
-- ============================================================================

insert into exercises (slug, name, muscle_group, equipment, gif_url, secondary_muscles, instructions)
values (
  'bench_press_v2',
  'Bench Press (Barbell) V2',
  'chest',
  'barbell',
  (select replace(gif_url, 'bench_press.gif', 'bench_press_v2.gif') from exercises where slug = 'bench_press'),
  (select secondary_muscles from exercises where slug = 'bench_press'),
  (select instructions from exercises where slug = 'bench_press')
);

insert into exercises (slug, name, muscle_group, equipment, gif_url, secondary_muscles, instructions)
values (
  'dumbbell_bench_press_v2',
  'Bench Press (Dumbbell) V2',
  'chest',
  'dumbbell',
  (select replace(gif_url, 'dumbbell_bench_press.gif', 'dumbbell_bench_press_v2.gif') from exercises where slug = 'dumbbell_bench_press'),
  (select secondary_muscles from exercises where slug = 'dumbbell_bench_press'),
  (select instructions from exercises where slug = 'dumbbell_bench_press')
);
