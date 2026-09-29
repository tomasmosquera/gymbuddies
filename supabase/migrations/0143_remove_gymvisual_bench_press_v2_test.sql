-- ============================================================================
-- Removes the two Gym visual-licensed comparison exercises added in
-- migration 0142 (bench_press_v2 / dumbbell_bench_press_v2). The app owner
-- reviewed both GIFs side-by-side with the WorkoutX originals in the app and
-- decided not to use them. The originals (bench_press, dumbbell_bench_press)
-- are untouched.
-- ============================================================================

delete from exercises where slug in ('bench_press_v2', 'dumbbell_bench_press_v2');
