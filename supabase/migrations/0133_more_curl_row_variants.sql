-- ============================================================================
-- 17 more curl/row variants requested by the user (browsing WorkoutX's own
-- catalog directly), cross-checked against the 108 existing entries to skip
-- true duplicates (e.g. "Barbell Curl" is already barbell_curl).
-- ============================================================================
insert into exercises (slug, name, muscle_group, equipment) values
  ('dumbbell_alternate_curl', 'Alternating Bicep Curl (Dumbbell)', 'biceps', 'dumbbell'),
  ('dumbbell_incline_inner_curl', 'Incline Inner Bicep Curl (Dumbbell)', 'biceps', 'dumbbell'),
  ('barbell_prone_incline_curl', 'Prone Incline Curl (Barbell)', 'biceps', 'barbell'),
  ('barbell_reverse_curl', 'Reverse Curl (Barbell)', 'biceps', 'barbell'),
  ('barbell_reverse_preacher_curl', 'Reverse Preacher Curl (Barbell)', 'biceps', 'barbell'),
  ('dumbbell_alternate_preacher_curl', 'Alternating Preacher Curl (Dumbbell)', 'biceps', 'dumbbell'),
  ('dumbbell_reverse_curl', 'Reverse Curl (Dumbbell)', 'biceps', 'dumbbell'),
  ('dumbbell_cross_body_hammer_curl', 'Cross-Body Hammer Curl (Dumbbell)', 'biceps', 'dumbbell'),
  ('machine_seated_row', 'Seated Row (Machine)', 'back', 'machine'),
  ('machine_reverse_grip_vertical_row', 'Reverse Grip Vertical Row (Machine)', 'back', 'machine'),
  ('machine_one_arm_high_row', 'One Arm High Row (Machine)', 'back', 'machine'),
  ('machine_narrow_grip_seated_row', 'Narrow Grip Seated Row (Machine)', 'back', 'machine'),
  ('machine_bent_over_row_vbar', 'Bent Over Row, V-Bar (Machine)', 'back', 'machine'),
  ('machine_high_row', 'High Row (Machine)', 'back', 'machine'),
  ('cable_seated_high_row_vbar', 'Seated High Row, V-Bar (Cable)', 'back', 'cable'),
  ('cable_rope_elevated_seated_row', 'Elevated Seated Row, Rope (Cable)', 'back', 'cable'),
  ('cable_low_seated_row', 'Low Seated Row (Cable)', 'back', 'cable');
