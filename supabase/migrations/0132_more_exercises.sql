-- ============================================================================
-- 14 new catalog entries requested by the user, cross-checked against the
-- existing 94 (see migration 0128's renamed list) to avoid near-duplicates —
-- e.g. "Seated Shoulder Press (Dumbbell)" is added separately from the
-- existing standing "Shoulder Press (Dumbbell)" because it's a genuinely
-- different exercise, not a rename of it.
-- ============================================================================
insert into exercises (slug, name, muscle_group, equipment) values
  ('seated_dumbbell_shoulder_press', 'Seated Shoulder Press (Dumbbell)', 'shoulders', 'dumbbell'),
  ('cable_overhead_triceps_extension', 'Overhead Triceps Extension (Cable)', 'triceps', 'cable'),
  ('toes_to_bar', 'Toes to Bar', 'core', 'bodyweight'),
  ('weighted_russian_twist', 'Russian Twist (Weighted)', 'core', 'other'),
  ('weighted_sit_ups', 'Sit Up (Weighted)', 'core', 'other'),
  ('chest_supported_incline_row', 'Incline Chest Supported Row (Dumbbell)', 'back', 'dumbbell'),
  ('single_arm_lat_pulldown', 'Lat Pulldown (Cable, Single Arm)', 'back', 'cable'),
  ('close_grip_lat_pulldown', 'Lat Pulldown (Cable, Close Grip)', 'back', 'cable'),
  ('seated_cable_row_wide_grip', 'Seated Cable Row (Wide Grip)', 'back', 'cable'),
  ('seated_cable_row_v_grip', 'Seated Cable Row (V-Grip)', 'back', 'cable'),
  ('seated_incline_curl', 'Seated Incline Curl (Dumbbell)', 'biceps', 'dumbbell'),
  ('behind_the_back_cable_curl', 'Behind The Back Curl (Cable)', 'biceps', 'cable'),
  ('dumbbell_lunge', 'Lunge (Dumbbell)', 'quads', 'dumbbell'),
  ('hip_adduction_machine', 'Hip Adduction (Machine)', 'glutes', 'machine');
