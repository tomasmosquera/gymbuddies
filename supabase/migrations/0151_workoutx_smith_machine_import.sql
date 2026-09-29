-- ============================================================================
-- Imports 23 exercises from WorkoutX's 'smith machine' equipment type (49
-- total: 25 already existed under different names, 1 internal WorkoutX
-- duplicate dropped, these 23 are new). WorkoutX's bare 'Smith X' name
-- prefix normalized to 'Smith Machine X' to match our equipment label.
-- Base rows only — gif_url/instructions/secondary_muscles filled right
-- after via exercise-gif-sync, one call per row.
-- ============================================================================

insert into exercises (slug, name, muscle_group, equipment) values
  ('smith_machine_back_shrug', 'Smith Machine Back Shrug', 'back', 'smith_machine'),
  ('smith_machine_hip_raise', 'Smith Machine Hip Raise', 'core', 'smith_machine'),
  ('smith_machine_incline_shoulder_raises', 'Smith Machine Incline Shoulder Raises', 'chest', 'smith_machine'),
  ('smith_machine_reverse_calf_raises', 'Smith Machine Reverse Calf Raises', 'calves', 'smith_machine'),
  ('smith_machine_one_leg_floor_calf_raise', 'Smith Machine One Leg Floor Calf Raise', 'calves', 'smith_machine'),
  ('smith_machine_toe_raise', 'Smith Machine Toe Raise', 'calves', 'smith_machine'),
  ('smith_machine_seated_wrist_curl', 'Smith Machine Seated Wrist Curl', 'forearms', 'smith_machine'),
  ('smith_machine_incline_tricep_extension', 'Smith Machine Incline Tricep Extension', 'triceps', 'smith_machine'),
  ('inverted_row_v2', 'Inverted Row V2', 'back', 'smith_machine'),
  ('smith_machine_behind_neck_press', 'Smith Machine Behind Neck Press', 'shoulders', 'smith_machine'),
  ('smith_machine_bent_knee_good_morning', 'Smith Machine Bent Knee Good Morning', 'glutes', 'smith_machine'),
  ('smith_machine_chair_squat', 'Smith Machine Chair Squat', 'quads', 'smith_machine'),
  ('smith_machine_decline_reverse_grip_press', 'Smith Machine Decline Reverse-grip Press', 'chest', 'smith_machine'),
  ('smith_machine_narrow_row', 'Smith Machine Narrow Row', 'back', 'smith_machine'),
  ('smith_machine_sprint_lunge', 'Smith Machine Sprint Lunge', 'glutes', 'smith_machine'),
  ('smith_machine_standing_behind_head_military_press', 'Smith Machine Standing Behind Head Military Press', 'shoulders', 'smith_machine'),
  ('smith_machine_standing_military_press', 'Smith Machine Standing Military Press', 'shoulders', 'smith_machine'),
  ('smith_machine_wide_grip_bench_press', 'Smith Machine Wide Grip Bench Press', 'chest', 'smith_machine'),
  ('smith_machine_wide_grip_decline_bench_press', 'Smith Machine Wide Grip Decline Bench Press', 'chest', 'smith_machine'),
  ('smith_machine_one_arm_row', 'Smith Machine One Arm Row', 'back', 'smith_machine'),
  ('smith_machine_decline_close_grip_bench_press', 'Smith Machine Decline Close Grip Bench Press', 'triceps', 'smith_machine'),
  ('smith_machine_reverse_decline_close_grip_bench_press', 'Smith Machine Reverse Decline Close Grip Bench Press', 'chest', 'smith_machine'),
  ('smith_machine_sumo_squat', 'Smith Machine Sumo Squat', 'glutes', 'smith_machine');
