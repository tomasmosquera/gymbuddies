-- ============================================================================
-- Cleanup: reverts migration 0151 entirely. All 23 rows failed
-- exercise-gif-sync with a permanent 403 on the gif fetch (0/23, not a
-- partial failure like 0149's 88/193) — strong signal that WorkoutX's
-- entire 'smith machine' equipment category sits outside this account's
-- current plan tier, not just a handful of specific assets. Leaving this
-- equipment type unimported until/unless the plan changes.
-- ============================================================================

delete from exercises where slug in (
  'smith_machine_back_shrug',
  'smith_machine_hip_raise',
  'smith_machine_incline_shoulder_raises',
  'smith_machine_reverse_calf_raises',
  'smith_machine_one_leg_floor_calf_raise',
  'smith_machine_toe_raise',
  'smith_machine_seated_wrist_curl',
  'smith_machine_incline_tricep_extension',
  'inverted_row_v2',
  'smith_machine_behind_neck_press',
  'smith_machine_bent_knee_good_morning',
  'smith_machine_chair_squat',
  'smith_machine_decline_reverse_grip_press',
  'smith_machine_narrow_row',
  'smith_machine_sprint_lunge',
  'smith_machine_standing_behind_head_military_press',
  'smith_machine_standing_military_press',
  'smith_machine_wide_grip_bench_press',
  'smith_machine_wide_grip_decline_bench_press',
  'smith_machine_one_arm_row',
  'smith_machine_decline_close_grip_bench_press',
  'smith_machine_reverse_decline_close_grip_bench_press',
  'smith_machine_sumo_squat'
);
