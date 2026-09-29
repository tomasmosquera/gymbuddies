-- ============================================================================
-- Closes out the 'leverage machine' equipment type from WorkoutX: the final
-- 10 exercises not covered by our existing catalog or migration 0147 (86
-- total in WorkoutX for this equipment: 26 already existed under different
-- names, 50 imported in 0147, these 10 finish it). Same 'Lever' -> 'Machine'
-- name convention as 0147. Base rows only — gif_url/instructions/
-- secondary_muscles filled right after via exercise-gif-sync.
-- ============================================================================

insert into exercises (slug, name, muscle_group, equipment) values
  ('machine_shoulder_press_v3', 'Machine Shoulder Press V3', 'shoulders', 'machine'),
  ('cycle_cross_trainer', 'Cycle Cross Trainer', 'cardio', 'machine'),
  ('assisted_wide_grip_chest_dip_kneeling', 'Assisted Wide-grip Chest Dip (kneeling)', 'chest', 'machine'),
  ('machine_horizontal_one_leg_press', 'Machine Horizontal One Leg Press', 'glutes', 'machine'),
  ('machine_reverse_grip_lateral_pulldown', 'Machine Reverse Grip Lateral Pulldown', 'back', 'machine'),
  ('captains_chair_straight_leg_raise', 'Captains Chair Straight Leg Raise', 'core', 'machine'),
  ('glute_ham_raise', 'Glute-ham Raise', 'hamstrings', 'machine'),
  ('machine_lying_two_one_leg_curl', 'Machine Lying Two-one Leg Curl', 'hamstrings', 'machine'),
  ('walking_on_incline_treadmill', 'Walking on Incline Treadmill', 'cardio', 'machine'),
  ('machine_standing_chest_press', 'Machine Standing Chest Press', 'chest', 'machine');
