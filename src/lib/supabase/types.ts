/**
 * Hand-written to match supabase/migrations/*.sql. Once you have a live
 * Supabase project linked, regenerate this from the real schema with:
 *   npx supabase gen types typescript --linked > src/lib/supabase/types.ts
 * and it will still satisfy every call site in this app (same shapes).
 *
 * NOTE: every row shape below is a `type`, never an `interface`. Interfaces
 * don't get TypeScript's implicit index signature, so they fail the
 * `extends Record<string, unknown>` structural check @supabase/supabase-js
 * uses internally to type `.from()`/`.rpc()` — that mismatch silently
 * degrades every query's inferred types to `never`.
 */

export type GroupMemberRole = 'admin' | 'member';
export type GroupMemberStatus = 'pending_deposit' | 'active' | 'needs_recharge' | 'left' | 'removed' | 'admin_only';
export type WalletTransactionType = 'initial_deposit' | 'penalty' | 'recharge' | 'adjustment' | 'payout';
export type WalletTransactionStatus = 'pending' | 'confirmed' | 'rejected';
export type RuleProposalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'applied';
export type VoteChoice = 'yes' | 'no';
export type WeeklyEvaluationStatus = 'active' | 'needs_recharge';
export type ExcuseType = 'travel' | 'medical' | 'other';
export type ExcuseRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type AttendanceOverrideStatus = 'valid' | 'failed';
export type PayoutMode = 'cooperative' | 'league' | 'mixed';
export type LeagueCycleStatus = 'running' | 'completed' | 'cancelled';

export type NotificationCategory = 'group_activity' | 'money' | 'votes' | 'reminders' | 'admin_actions' | 'achievements';

export type NotificationPreferences = Record<NotificationCategory, boolean>;

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  last_notifications_seen_at: string | null;
  /** App-level opt-in for reading Apple Health data — see set_apple_health_enabled. Never reflects the actual OS-level grant, only whether the app should try. */
  apple_health_enabled: boolean;
  /** Set the first time the user sees the one-time "connect Apple Health?" nudge (accepted or dismissed) — null means it hasn't been shown yet. */
  apple_health_prompted_at: string | null;
  /** When true (default), a check-in/checkout in one group also gets created in every other group the user actively belongs to — see set_auto_checkin_other_groups. */
  auto_checkin_other_groups: boolean;
  /** Minutes after check-in before the "no olvides tu foto de salida" reminder fires — see set_checkout_reminder_minutes. Global per user, unlike the reminders on/off toggle which is per group. */
  checkout_reminder_minutes: number;
  /** Geofence radius (meters) the member has to drift past their check-in spot before the checkout reminder fires — see set_checkout_geofence_radius_meters. Global per user, 20-500, default 100. */
  checkout_geofence_radius_meters: number;
  /** Grants the ability to create/mark groups public — set once via a one-off migration, not client-settable. See list_public_groups/create_group/admin_set_group_public. */
  is_platform_admin: boolean;
  /** Consumed by create_group (1 per group), free to start (default 1, including a one-time backfill for every pre-existing profile). The platform admin never spends this. See admin_grant_group_creation_credits for the platform admin's manual top-up tool — in-app purchase isn't built yet. */
  group_creation_credits: number;
  /** How this member types/reads weights in the routines/workout-log feature — see set_weight_unit. Storage is always canonical kg (weight_kg / target_weight_kg columns); a group comparison always shows kg regardless of the viewer's own preference, same idea as koth_claims' submitted_unit but as a standing preference rather than a per-claim choice. */
  weight_unit: 'kg' | 'lbs';
  /** Global, off by default — see set_progressive_overload_enabled. When on, start_workout_session adds a fixed increment (2.5 kg / 5 lbs, by weight_unit above) on top of the carried-forward weight for any routine exercise whose most recent session hit the top of its rep range on every set at one shared weight (workout_session_exercises.progressive_overload_hit). */
  progressive_overload_enabled: boolean;
  created_at: string;
};

export type AppNotification = {
  id: string;
  user_id: string;
  group_id: string;
  title: string;
  body: string;
  category: NotificationCategory | null;
  data: Record<string, unknown>;
  created_at: string;
};

export type Group = {
  id: string;
  name: string;
  invite_code: string;
  admin_id: string;
  currency: string;
  initial_deposit_amount: number;
  min_days_per_week: number;
  penalty_amount: number;
  weekly_penalty_cap: number;
  exit_fee_amount: number;
  exit_notice_days: number;
  require_checkout_photo: boolean;
  min_workout_minutes: number;
  admin_payment_info: string | null;
  timezone: string;
  /** How the group's pooled balance gets distributed — see league_cycles for 'league'/'mixed' cycle state. */
  payout_mode: PayoutMode;
  /** How many whole Monday-Sunday weeks each Liga/Mixto cycle lasts (a cycle is graded on closed weeks). Applies to cycles started from now on — a running cycle keeps its own duration_weeks. */
  league_duration_weeks: number;
  /** Liga/Mixto: when a cycle is settled, start the next one right away (that same Monday) instead of waiting for the admin to start it. Off by default. */
  league_auto_renew: boolean;
  /** Percent of the league-share pool each place gets, in order (1st, 2nd, ...). Sum ≤ 100 — a sum below 100 leaves the remainder unpaid. */
  league_prize_splits: number[];
  /** Only meaningful when payout_mode = 'mixed': % of the pool that follows the league mechanic (the rest follows cooperative). */
  mixed_league_share_percent: number;
  /** Group-wide floor under every member's activated_at, set at creation — "we're creating the group today but really start playing on Aug 15". Null means no delay (existing behavior). */
  game_starts_at: string | null;
  /** Discoverable via list_public_groups and joinable without an invite code (join_public_group) — only a platform admin can set this, at creation or later via admin_set_group_public. */
  is_public: boolean;
  /** League mode only. Number of last-place members penalized at cycle close (0 = descenso disabled). See evaluate_due_league_cycle. */
  descenso_rank_count: number;
  /** Fixed amount charged to each relegated member — can be 0 (marks the zone without charging). Added to that same cycle's prize pool. */
  descenso_penalty_amount: number;
  /** Charged to every new member on top of initial_deposit_amount when they join — goes straight to the admin, never pooled into group_members.balance. See wallet_transactions.enrollment_fee_amount for how a given deposit's split is recorded. */
  enrollment_fee_amount: number;
  created_at: string;
};

/** Curated row shape returned by list_public_groups — a deliberately narrower view of Group (no invite_code/admin_payment_info/admin_id) plus a computed member_count. */
export type PublicGroupListing = {
  id: string;
  name: string;
  currency: string;
  payout_mode: PayoutMode;
  min_days_per_week: number;
  penalty_amount: number;
  initial_deposit_amount: number;
  timezone: string;
  member_count: number;
};

export type LeagueCycle = {
  id: string;
  group_id: string;
  cycle_number: number;
  prize_splits: number[];
  duration_weeks: number;
  league_share_percent: number;
  /** Monday 00:00 (group timezone) of the week the cycle began in — cycles always run on whole Monday-Sunday weeks. */
  started_at: string;
  /** Sunday 23:59:59 (group timezone) of the cycle's last week. */
  ends_at: string;
  /** The day the admin actually started the cycle (YYYY-MM-DD). Days of the first week before it count as excused for everyone. */
  effective_start_date: string;
  /** The admin closed it ahead of schedule: ends_at was moved to that week's Sunday. */
  closed_early: boolean;
  /** The end date before an early close (null unless closed_early) — restored if the close is cancelled. */
  original_ends_at: string | null;
  status: LeagueCycleStatus;
  completed_at: string | null;
  pool_at_payout: number | null;
  created_at: string;
};

/** A member's full final standing in a settled cycle (every eligible member, not just the paid places). Absent for cycles settled before migration 0126 or closed by liquidate_group_now. */
export type LeagueCycleStanding = {
  id: string;
  cycle_id: string;
  user_id: string;
  place: number;
  completed_days: number;
  failed_days: number;
  prize_amount: number;
  relegated: boolean;
  descenso_amount: number;
  created_at: string;
};

/** "This person already got the end-of-cycle results modal for this cycle" — one row per user per cycle, so it never shows twice (also across devices). */
export type LeagueCycleResultsSeen = {
  cycle_id: string;
  user_id: string;
  seen_at: string;
};

export type LeagueCyclePayout = {
  id: string;
  cycle_id: string;
  user_id: string;
  place: number;
  share_percent: number;
  amount: number;
  wallet_transaction_id: string | null;
  created_at: string;
};

/** One row per active member returned by liquidate_group_now — what they'd get (or actually got) settling the group right now. In Liga/Mixto, place is set for every ranked member (ties share a place, standard competition ranking) — only share_percent (and the podium share of amount) is exclusive to league podium winners. Both are null in Cooperativo (no league ranking at all). */
export type LiquidationRow = {
  user_id: string;
  full_name: string;
  amount: number;
  place: number | null;
  share_percent: number | null;
};

/** Public, non-member-safe preview of a group by invite code — see get_group_invite_preview. Deliberately narrow: no balances, no payment info, no member list. */
export type GroupInvitePreviewRow = {
  group_id: string;
  name: string;
  member_count: number;
  min_days_per_week: number;
  penalty_amount: number;
  currency: string;
  payout_mode: PayoutMode;
};

export type GroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  balance: number;
  joined_at: string;
  activated_at: string | null;
  /** When set (and later than activated_at), missed days before this date never generate a monetary penalty — the member is still counted normally everywhere else (ranking, badges, consistency). Null means penalties apply as soon as the member is activated, same as before this field existed. */
  penalty_start_date: string | null;
  leave_requested_at: string | null;
  leave_effective_at: string | null;
  notification_preferences: NotificationPreferences;
  /** Relative weight for Cooperativo/Mixto splits (share_i = pool * weight_i / sum(all active weights)). Default 1 = equal footing. Admin-editable via admin_set_cooperative_share_percent. */
  cooperative_weight: number;
};

export type Checkin = {
  id: string;
  group_id: string;
  user_id: string;
  checkin_date: string;
  captured_at: string;
  latitude: number;
  longitude: number;
  location_accuracy_m: number | null;
  photo_path: string;
  checkout_captured_at: string | null;
  checkout_latitude: number | null;
  checkout_longitude: number | null;
  checkout_location_accuracy_m: number | null;
  checkout_photo_path: string | null;
  workout_minutes: number | null;
  /** Active calories burned during the workout window, sourced from Apple Health — display-only, never used for penalties/ranking/badges. */
  active_energy_kcal: number | null;
  /** True when this row was created by the auto-checkin-other-groups fan-out (see submit_checkin), not a direct submission in this group. Lets the fan-out tell its own rows apart from a genuinely separate manual check-in, which it must never touch. */
  auto_created: boolean;
  created_at: string;
};

export type WalletTransaction = {
  id: string;
  group_id: string;
  user_id: string;
  type: WalletTransactionType;
  amount: number;
  status: WalletTransactionStatus;
  receipt_path: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  weekly_evaluation_result_id: string | null;
  note: string | null;
  /** Only meaningful on type = 'initial_deposit' rows — the portion of `amount`'s companion transfer that was the group's enrollment_fee_amount, kept in its own column specifically so apply_wallet_transaction_effect (which only ever adds `amount`) never pools it. Always 0 on every other transaction type. */
  enrollment_fee_amount: number;
  created_at: string;
};

export type RuleProposalChanges = {
  min_days_per_week?: number;
  penalty_amount?: number;
  weekly_penalty_cap?: number;
  exit_fee_amount?: number;
  exit_notice_days?: number;
  require_checkout_photo?: boolean;
  min_workout_minutes?: number;
  payout_mode?: PayoutMode;
  league_duration_weeks?: number;
  /** Legacy key — proposals created before the months -> weeks change still carry this; the server converts it to weeks when applying. */
  league_duration_months?: number;
  league_prize_splits?: number[];
  mixed_league_share_percent?: number;
  league_cycle_started_at?: string;
  descenso_rank_count?: number;
  descenso_penalty_amount?: number;
  enrollment_fee_amount?: number;
  league_auto_renew?: boolean;
};

export type RuleProposal = {
  id: string;
  group_id: string;
  proposed_by: string;
  proposed_changes: RuleProposalChanges;
  status: RuleProposalStatus;
  apply_immediately: boolean;
  required_votes: number;
  member_count_snapshot: number;
  voting_closes_at: string;
  decided_at: string | null;
  effective_at: string | null;
  applied_at: string | null;
  created_at: string;
};

export type RuleVote = {
  id: string;
  proposal_id: string;
  user_id: string;
  vote: VoteChoice;
  voted_at: string;
};

export type ExcuseRequest = {
  id: string;
  group_id: string;
  user_id: string;
  excuse_type: ExcuseType;
  requested_start_date: string;
  requested_end_date: string;
  reason: string | null;
  proof_paths: string[];
  status: ExcuseRequestStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  required_votes: number | null;
  member_count_snapshot: number | null;
  voting_closes_at: string | null;
  created_at: string;
};

export type ExcuseDate = {
  id: string;
  excuse_request_id: string;
  group_id: string;
  user_id: string;
  excused_date: string;
  created_at: string;
};

export type ExcuseVote = {
  id: string;
  excuse_request_id: string;
  user_id: string;
  vote: VoteChoice;
  voted_at: string;
};

export type PhotoChallengeStatus = 'pending' | 'invalid' | 'valid';

export type PhotoChallenge = {
  id: string;
  group_id: string;
  checkin_id: string;
  target_user_id: string;
  challenged_by: string;
  reason: string | null;
  status: PhotoChallengeStatus;
  required_votes: number;
  member_count_snapshot: number;
  voting_closes_at: string;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
};

export type PhotoChallengeVote = {
  id: string;
  challenge_id: string;
  user_id: string;
  vote: VoteChoice;
  voted_at: string;
};

export type KothMetricType = 'weight_kg' | 'reps';
export type KothClaimStatus = 'pending_vote' | 'valid' | 'invalidated';

export type KothExercise = {
  id: string;
  slug: string;
  name: string;
  metric_type: KothMetricType;
  sort_order: number;
  created_at: string;
};

/** Append-only log of every claim that beat the record at submission time — the source of truth koth_records points into. */
export type KothClaim = {
  id: string;
  group_id: string;
  exercise_id: string;
  user_id: string;
  metric_type: KothMetricType;
  /** Always what gets compared — kg for weight_kg exercises (server-converted), raw rep count for reps exercises. */
  value_canonical: number;
  submitted_unit: 'kg' | 'lbs' | null;
  submitted_value: number;
  video_path: string;
  status: KothClaimStatus;
  /** False for a claim submitted while its owner was still in their protection period (activated_at in the future) — recorded for their own history, but never crowns them, dethrones anyone, or opens a vote. */
  counts_for_record: boolean;
  required_votes: number;
  member_count_snapshot: number;
  voting_closes_at: string;
  decided_at: string | null;
  decided_by: string | null;
  reminder_sent_at: string | null;
  created_at: string;
};

export type KothClaimVote = {
  id: string;
  claim_id: string;
  user_id: string;
  vote: VoteChoice;
  voted_at: string;
};

/** Thin pointer to the current champion's claim per (group, exercise) — never a duplicated value. */
export type KothRecord = {
  id: string;
  group_id: string;
  exercise_id: string;
  current_claim_id: string | null;
  updated_at: string;
};

export type CheckinReaction = {
  id: string;
  group_id: string;
  checkin_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type BuddyNudge = {
  id: string;
  group_id: string;
  sender_id: string;
  recipient_id: string;
  sent_at: string;
  sent_date: string;
};

export type AppVersionInfo = {
  platform: 'ios' | 'android';
  latest_version: string;
  store_url: string | null;
  message: string | null;
  updated_at: string;
};

export type AttendanceOverride = {
  id: string;
  group_id: string;
  user_id: string;
  override_date: string;
  status: AttendanceOverrideStatus;
  set_by: string;
  note: string | null;
  created_at: string;
};

export type WeeklyEvaluationRun = {
  id: string;
  group_id: string;
  week_start_date: string;
  week_end_date: string;
  ran_at: string;
};

export type WeeklyEvaluationResult = {
  id: string;
  run_id: string;
  group_id: string;
  user_id: string;
  required_days: number;
  completed_days: number;
  excused_days_used: number;
  failed_days: number;
  penalty_charged: number;
  /** True if penalty_start_date hadn't arrived yet at any point during this week — the week's real failed_days still reflects performance, but penalty_charged may be reduced/zeroed because of it. */
  penalty_protected: boolean;
  balance_before: number;
  balance_after: number;
  status_after: WeeklyEvaluationStatus;
  created_at: string;
};

/** One row per (member, badge or monthly challenge, period) already pushed — `period` is 'lifetime' for badges, the YYYY-MM month for a monthly challenge. */
export type MemberAchievementNotification = {
  group_id: string;
  user_id: string;
  badge_id: string;
  period: string;
  notified_at: string;
};

/** The last level a member was told about, so a level-up is pushed once. */
export type MemberLevelNotification = {
  group_id: string;
  user_id: string;
  last_notified_level: number;
  updated_at: string;
};

/** A group is only re-evaluated when dirty_at (bumped by triggers on every table that feeds badges) is newer than last_checked_at. */
export type AchievementCheckState = {
  group_id: string;
  dirty_at: string;
  last_checked_at: string | null;
};

// ----------------------------------------------------------------------------
// Workout routines, exercise catalog, and live workout logging (0127).
// Everything weight-related is stored/returned in kg — see Profile.weight_unit
// for how a member's OWN screens convert for display; a group comparison
// always shows kg regardless of who's looking.
// ----------------------------------------------------------------------------
export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'cardio' | 'full_body';
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'smith_machine' | 'bodyweight' | 'kettlebell' | 'band' | 'other';

/** The fixed, global exercise catalog — same for every group, rarely changes. */
export type Exercise = {
  id: string;
  slug: string;
  name: string;
  muscle_group: MuscleGroup;
  equipment: Equipment;
  /** Re-hosted in the public exercise-media bucket — see migration 0131. Null until exercise-gif-sync has run for this exercise. */
  gif_url: string | null;
  secondary_muscles: string[];
  /** Step-by-step, from WorkoutX — the Explicación tab's content. Empty until exercise-gif-sync has run for this exercise. */
  instructions: string[];
  created_at: string;
};

/** exercises has no client-facing write RLS policy — only the service role (exercise-gif-sync) writes these, direct to the table rather than through an RPC. */
export type ExerciseUpdate = Partial<Pick<Exercise, 'gif_url' | 'secondary_muscles' | 'instructions'>>;

/** Personal (group_id null) or shared with exactly one of the owner's groups — never a snapshot itself, see WorkoutSession.routine_name_snapshot. */
export type Routine = {
  id: string;
  owner_user_id: string;
  group_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
};

/** One exercise slot in a routine — rest_seconds is the target rest for THIS exercise (shown "Rest Timer: 2min 0s" style); its planned sets live in RoutineExerciseSet, not here. */
export type RoutineExercise = {
  id: string;
  routine_id: string;
  exercise_id: string;
  sort_order: number;
  rest_seconds: number | null;
  notes: string | null;
};

/** One individually-editable planned set (the SET / weight / REPS / F table) — its own target reps RANGE/weight, and whether it's meant to be taken to failure. Logging a set still records one specific rep count (workout_sets.reps) — the range is only ever the plan, never what gets logged. */
export type RoutineExerciseSet = {
  id: string;
  routine_exercise_id: string;
  set_number: number;
  target_reps_min: number;
  target_reps_max: number;
  target_weight_kg: number | null;
  is_failure_target: boolean;
};

export type WorkoutSessionStatus = 'in_progress' | 'completed';

/** A live/logged workout — routine_id goes null (routine_name_snapshot keeps the label) if the routine is later deleted; a freeform session never had one. */
export type WorkoutSession = {
  id: string;
  user_id: string;
  routine_id: string | null;
  routine_name_snapshot: string | null;
  checkin_id: string | null;
  status: WorkoutSessionStatus;
  started_at: string;
  finished_at: string | null;
  notes: string | null;
  created_at: string;
};

/**
 * One planned set inside WorkoutSessionExercise.target_sets_snapshot —
 * frozen at the moment the session started. target_reps_min/target_reps_max/
 * is_failure_target still come straight from routine_exercise_sets;
 * target_weight_kg is now the SUGGESTED weight — the routine's own static
 * plan only when this same routine has never been logged with a real weight
 * for this exercise before, otherwise the weight actually lifted the last
 * time this exact routine was done (recursing further back if that time's
 * own set at this position, or the whole exercise that day, has no weight
 * — see start_workout_session), plus a fixed Progressive Overload increment
 * on top when that previous session hit the ceiling of its own rep range on
 * every set and the member has that toggle on (is_progressive_overload_suggestion
 * marks exactly when this happened — the UI highlights it). previous_weight_kg/
 * previous_reps are that same lookup's raw answer, always the true
 * historical value (never the routine's plan, never the PO increment) —
 * what the UI's read-only "Anterior" column shows, both null with no such
 * history at all.
 */
export type WorkoutSessionSetTarget = {
  target_reps_min: number;
  target_reps_max: number;
  target_weight_kg: number | null;
  is_failure_target: boolean;
  previous_weight_kg: number | null;
  previous_reps: number | null;
  is_progressive_overload_suggestion: boolean;
};

/** One exercise within a specific session — copied from routine_exercises/routine_exercise_sets at start time (or added freeform, with an empty snapshot), independent of the routine afterwards. */
export type WorkoutSessionExercise = {
  id: string;
  session_id: string;
  exercise_id: string;
  sort_order: number;
  target_sets_snapshot: WorkoutSessionSetTarget[];
  /** Frozen from routine_exercises.rest_seconds at session start — null for a freeform-added exercise. */
  rest_seconds: number | null;
  created_at: string;
};

/** One completed set — a fact ("did 8 reps at 60kg"), editable any time via update_set/delete_set (owner only — see 0137). */
export type WorkoutSet = {
  id: string;
  session_exercise_id: string;
  set_number: number;
  reps: number;
  weight_kg: number | null;
  is_warmup: boolean;
  completed_at: string;
};

/** One planned set inside a RoutineExerciseArg — target_weight is in whichever unit that same create_routine/update_routine call's p_unit declares. */
export type RoutineExerciseSetArg = {
  target_reps_min: number;
  target_reps_max: number;
  target_weight?: number | null;
  is_failure_target?: boolean;
};

/** The shape create_routine/update_routine take for their exercise list. */
export type RoutineExerciseArg = {
  exercise_id: string;
  rest_seconds?: number | null;
  notes?: string | null;
  /** This exercise's own weight unit — different machines in the same gym read in different units, so it's picked per exercise, not once for the whole routine. Defaults to the call's p_unit ('kg') when omitted. */
  unit?: 'kg' | 'lbs';
  sets: RoutineExerciseSetArg[];
};

type NoRelationships = { Relationships: [] };

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: never;
        Update: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url'>>;
      } & NoRelationships;
      // Written only by send_push_notification (service definer) — the app only ever reads its own rows.
      notifications: { Row: AppNotification; Insert: never; Update: never } & NoRelationships;
      groups: {
        Row: Group;
        Insert: never;
        Update: Partial<Pick<Group, 'name' | 'admin_payment_info' | 'timezone'>>;
      } & NoRelationships;
      group_members: {
        Row: GroupMember;
        Insert: never;
        Update: Partial<Pick<GroupMember, 'role' | 'status'>>;
      } & NoRelationships;
      // All writes go through submit_checkin/submit_workout_checkout (0028) —
      // a raw client upsert can't be used here since PostgREST's generated
      // ON CONFLICT DO UPDATE sets every payload column, including group_id/
      // user_id, which aren't (and shouldn't be) column-granted.
      checkins: { Row: Checkin; Insert: never; Update: never } & NoRelationships;
      wallet_transactions: {
        Row: WalletTransaction;
        Insert: Pick<WalletTransaction, 'group_id' | 'user_id' | 'type' | 'amount' | 'status' | 'receipt_path'> &
          Partial<Pick<WalletTransaction, 'enrollment_fee_amount'>>;
        Update: Partial<Pick<WalletTransaction, 'status'>>;
      } & NoRelationships;
      rule_proposals: {
        Row: RuleProposal;
        Insert: never;
        Update: Partial<Pick<RuleProposal, 'status'>>;
      } & NoRelationships;
      rule_votes: { Row: RuleVote; Insert: never; Update: never } & NoRelationships;
      excuse_requests: { Row: ExcuseRequest; Insert: never; Update: never } & NoRelationships;
      excuse_dates: { Row: ExcuseDate; Insert: never; Update: never } & NoRelationships;
      excuse_votes: { Row: ExcuseVote; Insert: never; Update: never } & NoRelationships;
      weekly_evaluation_runs: { Row: WeeklyEvaluationRun; Insert: never; Update: never } & NoRelationships;
      weekly_evaluation_results: { Row: WeeklyEvaluationResult; Insert: never; Update: never } & NoRelationships;
      attendance_overrides: { Row: AttendanceOverride; Insert: never; Update: never } & NoRelationships;
      photo_challenges: { Row: PhotoChallenge; Insert: never; Update: never } & NoRelationships;
      photo_challenge_votes: { Row: PhotoChallengeVote; Insert: never; Update: never } & NoRelationships;
      koth_exercises: { Row: KothExercise; Insert: never; Update: never } & NoRelationships;
      koth_claims: { Row: KothClaim; Insert: never; Update: never } & NoRelationships;
      koth_claim_votes: { Row: KothClaimVote; Insert: never; Update: never } & NoRelationships;
      koth_records: { Row: KothRecord; Insert: never; Update: never } & NoRelationships;
      exercises: { Row: Exercise; Insert: never; Update: ExerciseUpdate } & NoRelationships;
      routines: { Row: Routine; Insert: never; Update: never } & NoRelationships;
      routine_exercises: { Row: RoutineExercise; Insert: never; Update: never } & NoRelationships;
      routine_exercise_sets: { Row: RoutineExerciseSet; Insert: never; Update: never } & NoRelationships;
      workout_sessions: { Row: WorkoutSession; Insert: never; Update: never } & NoRelationships;
      workout_session_exercises: { Row: WorkoutSessionExercise; Insert: never; Update: never } & NoRelationships;
      workout_sets: { Row: WorkoutSet; Insert: never; Update: never } & NoRelationships;
      checkin_reactions: { Row: CheckinReaction; Insert: never; Update: never } & NoRelationships;
      app_version_info: { Row: AppVersionInfo; Insert: never; Update: never } & NoRelationships;
      // Select-only (own sent rows) — every write goes through send_buddy_nudge.
      buddy_nudges: { Row: BuddyNudge; Insert: never; Update: never } & NoRelationships;
      league_cycles: { Row: LeagueCycle; Insert: never; Update: never } & NoRelationships;
      league_cycle_payouts: { Row: LeagueCyclePayout; Insert: never; Update: never } & NoRelationships;
      league_cycle_standings: { Row: LeagueCycleStanding; Insert: never; Update: never } & NoRelationships;
      league_cycle_results_seen: { Row: LeagueCycleResultsSeen; Insert: { cycle_id: string; user_id: string }; Update: never } & NoRelationships;
      // The three below are only ever touched by the notify-achievements Edge Function (service role) — the app never reads or writes them.
      member_achievement_notifications: {
        Row: MemberAchievementNotification;
        Insert: Pick<MemberAchievementNotification, 'group_id' | 'user_id' | 'badge_id' | 'period'>;
        Update: never;
      } & NoRelationships;
      member_level_notifications: {
        Row: MemberLevelNotification;
        Insert: Pick<MemberLevelNotification, 'group_id' | 'user_id' | 'last_notified_level'> &
          Partial<Pick<MemberLevelNotification, 'updated_at'>>;
        Update: never;
      } & NoRelationships;
      achievement_check_state: {
        Row: AchievementCheckState;
        Insert: Pick<AchievementCheckState, 'group_id'> & Partial<Pick<AchievementCheckState, 'dirty_at' | 'last_checked_at'>>;
        Update: never;
      } & NoRelationships;
    };
    Views: Record<string, never>;
    Functions: {
      create_group: {
        Args: {
          p_name: string;
          p_initial_deposit_amount: number;
          p_min_days_per_week: number;
          p_penalty_amount: number;
          p_weekly_penalty_cap: number;
          p_exit_fee_amount: number;
          p_exit_notice_days: number;
          p_require_checkout_photo?: boolean;
          p_min_workout_minutes?: number;
          p_admin_payment_info?: string | null;
          p_payout_mode?: PayoutMode;
          p_league_duration_weeks?: number;
          p_league_prize_splits?: number[];
          p_mixed_league_share_percent?: number;
          p_game_starts_at?: string | null;
          p_timezone?: string;
          p_is_public?: boolean;
          p_descenso_rank_count?: number;
          p_descenso_penalty_amount?: number;
          p_enrollment_fee_amount?: number;
          p_league_auto_renew?: boolean;
        };
        Returns: Group;
      };
      join_group: { Args: { p_invite_code: string }; Returns: GroupMember };
      join_public_group: { Args: { p_group_id: string }; Returns: GroupMember };
      list_public_groups: {
        Args: {
          p_search?: string | null;
          p_payout_mode?: PayoutMode | null;
          p_max_initial_deposit?: number | null;
          p_max_penalty_amount?: number | null;
          p_max_min_days_per_week?: number | null;
          p_timezone?: string | null;
        };
        Returns: PublicGroupListing[];
      };
      admin_set_group_public: { Args: { p_group_id: string; p_is_public: boolean }; Returns: Group };
      leave_group: { Args: { p_group_id: string; p_immediate?: boolean }; Returns: GroupMember };
      cancel_leave_request: { Args: { p_group_id: string }; Returns: GroupMember };
      propose_rule_change: {
        Args: { p_group_id: string; p_changes: RuleProposalChanges; p_apply_immediately?: boolean };
        Returns: RuleProposal;
      };
      apply_rule_change_direct: {
        Args: { p_group_id: string; p_changes: RuleProposalChanges };
        Returns: Group;
      };
      cast_vote: { Args: { p_proposal_id: string; p_vote: VoteChoice }; Returns: RuleVote };
      create_excuse_request: {
        Args: {
          p_group_id: string;
          p_excuse_type: ExcuseType;
          p_start_date: string;
          p_end_date: string;
          p_reason?: string | null;
          p_proof_paths?: string[];
        };
        Returns: ExcuseRequest;
      };
      approve_excuse_request: { Args: { p_request_id: string; p_excused_dates: string[] }; Returns: ExcuseRequest };
      reject_excuse_request: { Args: { p_request_id: string; p_decision_note?: string | null }; Returns: ExcuseRequest };
      send_excuse_request_to_vote: { Args: { p_request_id: string }; Returns: ExcuseRequest };
      cast_excuse_vote: { Args: { p_request_id: string; p_vote: VoteChoice }; Returns: ExcuseVote };
      close_expired_excuse_votes: { Args: Record<string, never>; Returns: void };
      process_scheduled_leaves: { Args: Record<string, never>; Returns: void };
      run_weekly_evaluation: { Args: Record<string, never>; Returns: WeeklyEvaluationRun[] };
      close_expired_proposals: { Args: Record<string, never>; Returns: void };
      admin_remove_member: { Args: { p_member_id: string; p_pay_out?: boolean }; Returns: GroupMember };
      admin_settle_league_departure: { Args: { p_group_id: string; p_user_id: string; p_refund: boolean }; Returns: void };
      start_league_cycle: { Args: { p_group_id: string }; Returns: LeagueCycle };
      admin_set_league_cycle_start: { Args: { p_group_id: string; p_started_at: string }; Returns: LeagueCycle };
      admin_close_league_cycle_early: { Args: { p_group_id: string }; Returns: LeagueCycle };
      admin_cancel_league_cycle_early_close: { Args: { p_group_id: string }; Returns: LeagueCycle };
      admin_set_cooperative_share_percent: {
        Args: { p_member_id: string; p_target_percent: number };
        Returns: GroupMember;
      };
      liquidate_group_now: {
        Args: { p_group_id: string; p_dry_run?: boolean };
        Returns: LiquidationRow[];
      };
      close_group: { Args: { p_group_id: string }; Returns: void };
      get_group_invite_preview: {
        Args: { p_invite_code: string };
        Returns: GroupInvitePreviewRow[];
      };
      admin_set_member_activation_date: { Args: { p_member_id: string; p_date: string }; Returns: GroupMember };
      admin_set_member_penalty_start_date: { Args: { p_member_id: string; p_date: string }; Returns: GroupMember };
      admin_allow_rejoin: { Args: { p_member_id: string }; Returns: GroupMember };
      send_push_notification: {
        Args: {
          p_user_ids: string[];
          p_title: string;
          p_body: string;
          p_group_id: string;
          p_data?: Record<string, unknown>;
          p_category?: string | null;
        };
        Returns: void;
      };
      register_push_token: { Args: { p_token: string }; Returns: void };
      unregister_push_token: { Args: { p_token: string }; Returns: void };
      react_to_checkin: { Args: { p_checkin_id: string; p_emoji: string }; Returns: CheckinReaction };
      remove_reaction: { Args: { p_checkin_id: string }; Returns: void };
      admin_delete_checkin: { Args: { p_checkin_id: string }; Returns: void };
      admin_set_checkin_workout_minutes: { Args: { p_checkin_id: string; p_workout_minutes: number }; Returns: Checkin };
      admin_set_checkin_active_energy: {
        Args: { p_checkin_id: string; p_active_energy_kcal: number | null };
        Returns: Checkin;
      };
      admin_replace_checkin_photo: {
        Args: { p_checkin_id: string; p_which: 'initial' | 'final'; p_photo_path: string };
        Returns: Checkin;
      };
      delete_own_checkin: { Args: { p_checkin_id: string }; Returns: void };
      admin_delete_wallet_transaction: { Args: { p_transaction_id: string }; Returns: void };
      set_attendance_override: {
        Args: { p_group_id: string; p_user_id: string; p_date: string; p_status: AttendanceOverrideStatus; p_note?: string | null };
        Returns: AttendanceOverride;
      };
      clear_attendance_override: { Args: { p_group_id: string; p_user_id: string; p_date: string }; Returns: void };
      admin_create_checkin: {
        Args: {
          p_group_id: string;
          p_user_id: string;
          p_date: string;
          p_photo_path: string;
          p_checkout_photo_path: string;
          p_latitude: number;
          p_longitude: number;
          p_location_accuracy_m?: number | null;
          p_start_time?: string | null;
          p_end_time?: string | null;
          p_active_energy_kcal?: number | null;
        };
        Returns: Checkin;
      };
      admin_set_excused_day: {
        Args: {
          p_group_id: string;
          p_user_id: string;
          p_date: string;
          p_excuse_type: 'travel' | 'medical';
          p_note?: string | null;
        };
        Returns: ExcuseDate;
      };
      create_photo_challenge: {
        Args: { p_checkin_id: string; p_reason?: string | null };
        Returns: PhotoChallenge;
      };
      cast_photo_challenge_vote: { Args: { p_challenge_id: string; p_vote: VoteChoice }; Returns: PhotoChallengeVote };
      admin_decide_photo_challenge: { Args: { p_challenge_id: string; p_valid: boolean }; Returns: PhotoChallenge };
      close_expired_photo_challenges: { Args: Record<string, never>; Returns: void };
      submit_koth_claim: {
        Args: {
          p_group_id: string;
          p_exercise_id: string;
          p_value: number;
          p_video_path: string;
          p_unit?: 'kg' | 'lbs' | null;
        };
        Returns: KothClaim;
      };
      cast_koth_claim_vote: { Args: { p_claim_id: string; p_vote: VoteChoice }; Returns: KothClaimVote };
      admin_decide_koth_claim: { Args: { p_claim_id: string; p_valid: boolean }; Returns: KothClaim };
      set_weight_unit: { Args: { p_unit: 'kg' | 'lbs' }; Returns: void };
      create_routine: {
        Args: { p_name: string; p_exercises: RoutineExerciseArg[]; p_group_id?: string | null; p_unit?: 'kg' | 'lbs' };
        Returns: Routine;
      };
      update_routine: {
        Args: { p_routine_id: string; p_name: string; p_exercises: RoutineExerciseArg[]; p_unit?: 'kg' | 'lbs' };
        Returns: Routine;
      };
      delete_routine: { Args: { p_routine_id: string }; Returns: void };
      start_workout_session: {
        Args: { p_routine_id?: string | null; p_checkin_id?: string | null };
        Returns: WorkoutSession;
      };
      add_session_exercise: { Args: { p_session_id: string; p_exercise_id: string }; Returns: WorkoutSessionExercise };
      log_set: {
        Args: { p_session_exercise_id: string; p_reps: number; p_weight?: number | null; p_unit?: 'kg' | 'lbs'; p_is_warmup?: boolean };
        Returns: WorkoutSet;
      };
      update_set: {
        Args: { p_set_id: string; p_reps: number; p_weight?: number | null; p_unit?: 'kg' | 'lbs'; p_is_warmup?: boolean };
        Returns: WorkoutSet;
      };
      delete_set: { Args: { p_set_id: string }; Returns: void };
      finish_workout_session: { Args: { p_session_id: string; p_notes?: string | null }; Returns: WorkoutSession };
      delete_workout_session: { Args: { p_session_id: string }; Returns: void };
      admin_adjust_balance: {
        Args: { p_group_id: string; p_user_id: string; p_amount: number; p_note?: string | null };
        Returns: WalletTransaction;
      };
      admin_confirm_deposit_without_receipt: {
        Args: { p_group_id: string; p_user_id: string; p_amount?: number | null };
        Returns: WalletTransaction;
      };
      delete_own_account: { Args: Record<string, never>; Returns: void };
      mark_notifications_seen: { Args: Record<string, never>; Returns: void };
      set_group_notification_preferences: {
        Args: { p_group_id: string; p_preferences: NotificationPreferences };
        Returns: GroupMember;
      };
      submit_workout_checkout: {
        Args: {
          p_checkin_id: string;
          p_captured_at: string;
          p_latitude: number;
          p_longitude: number;
          p_location_accuracy_m: number | null;
          p_photo_path: string;
          p_location_mocked?: boolean;
          p_auto_created?: boolean;
        };
        // null when p_auto_created is true and the target checkin turned out
        // to be a genuinely separate manual one — fan-out skips it, on purpose.
        Returns: Checkin | null;
      };
      set_apple_health_enabled: { Args: { p_enabled: boolean }; Returns: void };
      dismiss_apple_health_prompt: { Args: Record<string, never>; Returns: void };
      set_checkin_active_energy: { Args: { p_checkin_id: string; p_active_energy_kcal: number }; Returns: void };
      set_auto_checkin_other_groups: { Args: { p_enabled: boolean }; Returns: void };
      set_progressive_overload_enabled: { Args: { p_enabled: boolean }; Returns: void };
      set_checkout_reminder_minutes: { Args: { p_minutes: number }; Returns: void };
      set_checkout_geofence_radius_meters: { Args: { p_meters: number }; Returns: void };
      admin_find_user_by_email: {
        Args: { p_email: string };
        Returns: { id: string; full_name: string; group_creation_credits: number }[];
      };
      admin_grant_group_creation_credits: { Args: { p_user_id: string; p_amount: number }; Returns: number };
      submit_checkin: {
        Args: {
          p_group_id: string;
          p_captured_at: string;
          p_latitude: number;
          p_longitude: number;
          p_location_accuracy_m: number | null;
          p_photo_path: string;
          p_location_mocked?: boolean;
          p_auto_created?: boolean;
        };
        // null when p_auto_created is true and a genuinely separate manual
        // check-in already existed that day in the target group.
        Returns: Checkin | null;
      };
      send_buddy_nudge: { Args: { p_group_id: string; p_recipient_id: string }; Returns: BuddyNudge };
      platform_admin_overview: {
        Args: Record<string, never>;
        Returns: {
          total_groups: number;
          active_groups: number;
          total_active_members: number;
          total_active_unique_members: number;
          total_balance: number;
          total_penalties_collected: number;
          cooperative_count: number;
          league_count: number;
          mixed_count: number;
        }[];
      };
      platform_admin_groups_list: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          payout_mode: PayoutMode;
          currency: string;
          created_at: string;
          admin_name: string | null;
          active_member_count: number;
          total_balance: number;
          last_checkin_at: string | null;
        }[];
      };
    };
  };
};
