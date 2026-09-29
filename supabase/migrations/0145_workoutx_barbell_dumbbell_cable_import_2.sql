-- ============================================================================
-- Second batch: 60 more exercises from WorkoutX (20 barbell + 20 dumbbell +
-- 20 cable), continuing from migration 0144. Next-ranked picks from the
-- still-missing set for these 3 equipment types, excluding everything used
-- in 0144 (matched by WorkoutX id, not name, to avoid a cleaned-name vs
-- raw-name mismatch). 'Cable Kickback' (id 0860) renamed to 'Cable Triceps
-- Kickback' — WorkoutX's own generic name collided with our existing
-- 'Glute Kickback (Cable)' (a different, unrelated exercise). Base rows
-- only — gif_url/instructions/secondary_muscles filled right after via
-- exercise-gif-sync, one call per row.
-- ============================================================================

insert into exercises (slug, name, muscle_group, equipment) values
  ('barbell_standing_close_grip_curl', 'Barbell Standing Close Grip Curl', 'biceps', 'barbell'),
  ('barbell_standing_front_raise_over_head', 'Barbell Standing Front Raise Over Head', 'shoulders', 'barbell'),
  ('barbell_standing_leg_calf_raise', 'Barbell Standing Leg Calf Raise', 'calves', 'barbell'),
  ('barbell_standing_overhead_triceps_extension', 'Barbell Standing Overhead Triceps Extension', 'triceps', 'barbell'),
  ('barbell_standing_reverse_grip_curl', 'Barbell Standing Reverse Grip Curl', 'biceps', 'barbell'),
  ('barbell_standing_rocking_leg_calf_raise', 'Barbell Standing Rocking Leg Calf Raise', 'calves', 'barbell'),
  ('barbell_standing_twist', 'Barbell Standing Twist', 'core', 'barbell'),
  ('barbell_standing_wide_grip_curl', 'Barbell Standing Wide-grip Curl', 'biceps', 'barbell'),
  ('barbell_wrist_curl_v2', 'Barbell Wrist Curl V2', 'forearms', 'barbell'),
  ('finger_curls', 'Finger Curls', 'forearms', 'barbell'),
  ('floor_fly_with_barbell', 'Floor Fly (with Barbell)', 'chest', 'barbell'),
  ('landmine_180', 'Landmine 180', 'core', 'barbell'),
  ('power_clean', 'Power Clean', 'hamstrings', 'barbell'),
  ('snatch_pull', 'Snatch Pull', 'quads', 'barbell'),
  ('barbell_decline_pullover', 'Barbell Decline Pullover', 'chest', 'barbell'),
  ('barbell_bent_arm_pullover', 'Barbell Bent Arm Pullover', 'back', 'barbell'),
  ('barbell_floor_calf_raise', 'Barbell Floor Calf Raise', 'calves', 'barbell'),
  ('barbell_palms_down_wrist_curl_over_a_bench', 'Barbell Palms Down Wrist Curl Over a Bench', 'forearms', 'barbell'),
  ('barbell_palms_up_wrist_curl_over_a_bench', 'Barbell Palms Up Wrist Curl Over a Bench', 'forearms', 'barbell'),
  ('barbell_standing_wide_grip_biceps_curl', 'Barbell Standing Wide Grip Biceps Curl', 'biceps', 'barbell'),
  ('dumbbell_decline_shrug_v2', 'Dumbbell Decline Shrug V2', 'back', 'dumbbell'),
  ('dumbbell_decline_shrug', 'Dumbbell Decline Shrug', 'back', 'dumbbell'),
  ('dumbbell_decline_triceps_extension', 'Dumbbell Decline Triceps Extension', 'triceps', 'dumbbell'),
  ('dumbbell_decline_twist_fly', 'Dumbbell Decline Twist Fly', 'chest', 'dumbbell'),
  ('dumbbell_fly', 'Dumbbell Fly', 'chest', 'dumbbell'),
  ('dumbbell_front_raise_v2', 'Dumbbell Front Raise V2', 'shoulders', 'dumbbell'),
  ('dumbbell_full_can_lateral_raise', 'Dumbbell Full Can Lateral Raise', 'shoulders', 'dumbbell'),
  ('dumbbell_hammer_curl_v2', 'Dumbbell Hammer Curl V2', 'biceps', 'dumbbell'),
  ('dumbbell_incline_biceps_curl', 'Dumbbell Incline Biceps Curl', 'biceps', 'dumbbell'),
  ('dumbbell_incline_breeding', 'Dumbbell Incline Breeding', 'chest', 'dumbbell'),
  ('dumbbell_incline_curl_v2', 'Dumbbell Incline Curl V2', 'biceps', 'dumbbell'),
  ('dumbbell_incline_curl', 'Dumbbell Incline Curl', 'biceps', 'dumbbell'),
  ('dumbbell_incline_hammer_curl', 'Dumbbell Incline Hammer Curl', 'biceps', 'dumbbell'),
  ('dumbbell_incline_inner_biceps_curl', 'Dumbbell Incline Inner Biceps Curl', 'biceps', 'dumbbell'),
  ('dumbbell_incline_one_arm_lateral_raise', 'Dumbbell Incline One Arm Lateral Raise', 'shoulders', 'dumbbell'),
  ('dumbbell_incline_palm_in_press', 'Dumbbell Incline Palm-in Press', 'chest', 'dumbbell'),
  ('dumbbell_incline_raise', 'Dumbbell Incline Raise', 'shoulders', 'dumbbell'),
  ('dumbbell_incline_rear_lateral_raise', 'Dumbbell Incline Rear Lateral Raise', 'shoulders', 'dumbbell'),
  ('dumbbell_incline_row', 'Dumbbell Incline Row', 'back', 'dumbbell'),
  ('dumbbell_incline_shrug', 'Dumbbell Incline Shrug', 'back', 'dumbbell'),
  ('cable_seated_rear_lateral_raise', 'Cable Seated Rear Lateral Raise', 'shoulders', 'cable'),
  ('cable_side_bend_crunch_bosu_ball', 'Cable Side Bend Crunch (bosu Ball)', 'core', 'cable'),
  ('cable_side_bend', 'Cable Side Bend', 'core', 'cable'),
  ('cable_side_crunch', 'Cable Side Crunch', 'core', 'cable'),
  ('cable_standing_cross_over_high_reverse_fly', 'Cable Standing Cross-over High Reverse Fly', 'shoulders', 'cable'),
  ('cable_standing_crunch', 'Cable Standing Crunch', 'core', 'cable'),
  ('cable_standing_fly', 'Cable Standing Fly', 'chest', 'cable'),
  ('cable_standing_hip_extension', 'Cable Standing Hip Extension', 'glutes', 'cable'),
  ('cable_standing_inner_curl', 'Cable Standing Inner Curl', 'biceps', 'cable'),
  ('cable_standing_lift', 'Cable Standing Lift', 'core', 'cable'),
  ('cable_standing_one_arm_triceps_extension', 'Cable Standing One Arm Triceps Extension', 'triceps', 'cable'),
  ('cable_standing_pulldown_with_rope', 'Cable Standing Pulldown (with Rope)', 'biceps', 'cable'),
  ('cable_supine_reverse_fly', 'Cable Supine Reverse Fly', 'shoulders', 'cable'),
  ('cable_tuck_reverse_crunch', 'Cable Tuck Reverse Crunch', 'core', 'cable'),
  ('cable_twist', 'Cable Twist', 'core', 'cable'),
  ('cable_triceps_kickback', 'Cable Triceps Kickback', 'triceps', 'cable'),
  ('cable_twist_up_down', 'Cable Twist (up-down)', 'core', 'cable'),
  ('cable_reverse_crunch', 'Cable Reverse Crunch', 'core', 'cable'),
  ('cable_standing_crunch_with_rope_attachment', 'Cable Standing Crunch (with Rope Attachment)', 'core', 'cable'),
  ('cable_one_arm_decline_chest_fly', 'Cable One Arm Decline Chest Fly', 'chest', 'cable');
