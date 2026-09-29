-- ============================================================================
-- Fourth batch: 50 exercises from WorkoutX's 'leverage machine' equipment
-- type (a new category, first time importing machine exercises via this
-- process — see 0144/0145/0146 for barbell/dumbbell/cable). WorkoutX's own
-- name prefix 'Lever' renamed to 'Machine' to match our existing naming
-- convention (e.g. 'Chest Press (Machine)'); entries that didn't already
-- start with 'Lever' (Assisted/Hyperextension/etc.) kept as-is. Base rows
-- only — gif_url/instructions/secondary_muscles filled right after via
-- exercise-gif-sync, one call per row.
-- ============================================================================

insert into exercises (slug, name, muscle_group, equipment) values
  ('machine_gripless_shrug', 'Machine Gripless Shrug', 'back', 'machine'),
  ('machine_kneeling_leg_curl', 'Machine Kneeling Leg Curl', 'hamstrings', 'machine'),
  ('machine_kneeling_twist', 'Machine Kneeling Twist', 'core', 'machine'),
  ('machine_reverse_hyperextension', 'Machine Reverse Hyperextension', 'glutes', 'machine'),
  ('machine_seated_fly', 'Machine Seated Fly', 'chest', 'machine'),
  ('machine_seated_leg_raise_crunch', 'Machine Seated Leg Raise Crunch', 'core', 'machine'),
  ('machine_seated_reverse_fly_parallel_grip', 'Machine Seated Reverse Fly (parallel Grip)', 'shoulders', 'machine'),
  ('machine_seated_reverse_fly', 'Machine Seated Reverse Fly', 'shoulders', 'machine'),
  ('machine_donkey_calf_raise', 'Machine Donkey Calf Raise', 'calves', 'machine'),
  ('machine_gripless_shrug_v2', 'Machine Gripless Shrug V2', 'back', 'machine'),
  ('machine_preacher_curl_v2', 'Machine Preacher Curl V2', 'biceps', 'machine'),
  ('machine_hammer_grip_preacher_curl', 'Machine Hammer Grip Preacher Curl', 'biceps', 'machine'),
  ('machine_reverse_grip_preacher_curl', 'Machine Reverse Grip Preacher Curl', 'biceps', 'machine'),
  ('machine_hip_extension_v2', 'Machine Hip Extension V2', 'glutes', 'machine'),
  ('machine_gripper_hands', 'Machine Gripper Hands', 'forearms', 'machine'),
  ('machine_rotary_calf', 'Machine Rotary Calf', 'calves', 'machine'),
  ('machine_seated_calf_press', 'Machine Seated Calf Press', 'calves', 'machine'),
  ('machine_seated_crunch_v2', 'Machine Seated Crunch V2', 'core', 'machine'),
  ('assisted_chest_dip_kneeling', 'Assisted Chest Dip (kneeling)', 'chest', 'machine'),
  ('assisted_parallel_close_grip_pull_up', 'Assisted Parallel Close Grip Pull-up', 'back', 'machine'),
  ('assisted_pull_up', 'Assisted Pull-up', 'back', 'machine'),
  ('assisted_triceps_dip_kneeling', 'Assisted Triceps Dip (kneeling)', 'triceps', 'machine'),
  ('hyperextension_on_bench', 'Hyperextension (on Bench)', 'back', 'machine'),
  ('hyperextension', 'Hyperextension', 'back', 'machine'),
  ('machine_alternating_narrow_grip_seated_row', 'Machine Alternating Narrow Grip Seated Row', 'back', 'machine'),
  ('machine_assisted_chin_up', 'Machine Assisted Chin-up', 'back', 'machine'),
  ('machine_chest_press_v2', 'Machine Chest Press V2', 'chest', 'machine'),
  ('machine_front_pulldown', 'Machine Front Pulldown', 'back', 'machine'),
  ('machine_military_press', 'Machine Military Press', 'shoulders', 'machine'),
  ('machine_overhand_triceps_dip', 'Machine Overhand Triceps Dip', 'triceps', 'machine'),
  ('machine_seated_hip_abduction', 'Machine Seated Hip Abduction', 'glutes', 'machine'),
  ('machine_seated_hip_adduction', 'Machine Seated Hip Adduction', 'glutes', 'machine'),
  ('reverse_grip_machine_lat_pulldown', 'Reverse Grip Machine Lat Pulldown', 'back', 'machine'),
  ('stationary_bike_walk', 'Stationary Bike Walk', 'cardio', 'machine'),
  ('machine_shoulder_press_v2', 'Machine Shoulder Press V2', 'shoulders', 'machine'),
  ('machine_incline_chest_press', 'Machine Incline Chest Press', 'chest', 'machine'),
  ('machine_decline_chest_press', 'Machine Decline Chest Press', 'chest', 'machine'),
  ('machine_inner_chest_press', 'Machine Inner Chest Press', 'chest', 'machine'),
  ('machine_unilateral_row', 'Machine Unilateral Row', 'back', 'machine'),
  ('machine_one_arm_lateral_wide_pulldown', 'Machine One Arm Lateral Wide Pulldown', 'back', 'machine'),
  ('machine_reverse_t_bar_row', 'Machine Reverse T-bar Row', 'back', 'machine'),
  ('machine_t_bar_reverse_grip_row', 'Machine T-bar Reverse Grip Row', 'back', 'machine'),
  ('machine_one_arm_lateral_high_row', 'Machine One Arm Lateral High Row', 'back', 'machine'),
  ('machine_seated_squat_calf_raise_on_leg_press_machine', 'Machine Seated Squat Calf Raise on Leg Press Machine', 'calves', 'machine'),
  ('assisted_standing_chin_up', 'Assisted Standing Chin-up', 'back', 'machine'),
  ('assisted_standing_pull_up', 'Assisted Standing Pull-up', 'back', 'machine'),
  ('machine_seated_dip', 'Machine Seated Dip', 'triceps', 'machine'),
  ('machine_incline_chest_press_v2', 'Machine Incline Chest Press V2', 'chest', 'machine'),
  ('self_assisted_inverse_leg_curl', 'Self Assisted Inverse Leg Curl', 'hamstrings', 'machine'),
  ('machine_alternate_leg_press', 'Machine Alternate Leg Press', 'quads', 'machine');
