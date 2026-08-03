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
export type GroupMemberStatus = 'pending_deposit' | 'active' | 'needs_recharge' | 'left' | 'removed';
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
  league_duration_months: number;
  /** Percent of the league-share pool each place gets, in order (1st, 2nd, ...). Sum ≤ 100 — a sum below 100 leaves the remainder unpaid. */
  league_prize_splits: number[];
  /** Only meaningful when payout_mode = 'mixed': % of the pool that follows the league mechanic (the rest follows cooperative). */
  mixed_league_share_percent: number;
  /** Group-wide floor under every member's activated_at, set at creation — "we're creating the group today but really start playing on Aug 15". Null means no delay (existing behavior). */
  game_starts_at: string | null;
  created_at: string;
};

export type LeagueCycle = {
  id: string;
  group_id: string;
  cycle_number: number;
  prize_splits: number[];
  duration_months: number;
  league_share_percent: number;
  started_at: string;
  ends_at: string;
  status: LeagueCycleStatus;
  completed_at: string | null;
  pool_at_payout: number | null;
  created_at: string;
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

/** One row per active member returned by liquidate_group_now — what they'd get (or actually got) settling the group right now. place/share_percent are only set for league podium winners. */
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
  league_duration_months?: number;
  league_prize_splits?: number[];
  mixed_league_share_percent?: number;
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
  proof_path: string | null;
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

export type CheckinReaction = {
  id: string;
  group_id: string;
  checkin_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
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
        Update: Partial<Pick<Group, 'name' | 'admin_payment_info'>>;
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
        Insert: Pick<WalletTransaction, 'group_id' | 'user_id' | 'type' | 'amount' | 'status' | 'receipt_path'>;
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
      checkin_reactions: { Row: CheckinReaction; Insert: never; Update: never } & NoRelationships;
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
          p_league_duration_months?: number;
          p_league_prize_splits?: number[];
          p_mixed_league_share_percent?: number;
          p_game_starts_at?: string | null;
        };
        Returns: Group;
      };
      join_group: { Args: { p_invite_code: string }; Returns: GroupMember };
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
          p_proof_path?: string | null;
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
      start_league_cycle: { Args: { p_group_id: string }; Returns: LeagueCycle };
      admin_set_cooperative_share_percent: {
        Args: { p_member_id: string; p_target_percent: number };
        Returns: GroupMember;
      };
      liquidate_group_now: {
        Args: { p_group_id: string; p_dry_run?: boolean };
        Returns: LiquidationRow[];
      };
      get_group_invite_preview: {
        Args: { p_invite_code: string };
        Returns: GroupInvitePreviewRow[];
      };
      admin_set_member_activation_date: { Args: { p_member_id: string; p_date: string }; Returns: GroupMember };
      admin_set_member_penalty_start_date: { Args: { p_member_id: string; p_date: string }; Returns: GroupMember };
      register_push_token: { Args: { p_token: string }; Returns: void };
      unregister_push_token: { Args: { p_token: string }; Returns: void };
      react_to_checkin: { Args: { p_checkin_id: string; p_emoji: string }; Returns: CheckinReaction };
      remove_reaction: { Args: { p_checkin_id: string }; Returns: void };
      admin_delete_checkin: { Args: { p_checkin_id: string }; Returns: void };
      delete_own_checkin: { Args: { p_checkin_id: string }; Returns: void };
      admin_delete_wallet_transaction: { Args: { p_transaction_id: string }; Returns: void };
      set_attendance_override: {
        Args: { p_group_id: string; p_user_id: string; p_date: string; p_status: AttendanceOverrideStatus; p_note?: string | null };
        Returns: AttendanceOverride;
      };
      clear_attendance_override: { Args: { p_group_id: string; p_user_id: string; p_date: string }; Returns: void };
      create_photo_challenge: {
        Args: { p_checkin_id: string; p_reason?: string | null };
        Returns: PhotoChallenge;
      };
      cast_photo_challenge_vote: { Args: { p_challenge_id: string; p_vote: VoteChoice }; Returns: PhotoChallengeVote };
      admin_decide_photo_challenge: { Args: { p_challenge_id: string; p_valid: boolean }; Returns: PhotoChallenge };
      close_expired_photo_challenges: { Args: Record<string, never>; Returns: void };
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
        };
        Returns: Checkin;
      };
      set_apple_health_enabled: { Args: { p_enabled: boolean }; Returns: void };
      dismiss_apple_health_prompt: { Args: Record<string, never>; Returns: void };
      set_checkin_active_energy: { Args: { p_checkin_id: string; p_active_energy_kcal: number }; Returns: void };
      submit_checkin: {
        Args: {
          p_group_id: string;
          p_captured_at: string;
          p_latitude: number;
          p_longitude: number;
          p_location_accuracy_m: number | null;
          p_photo_path: string;
          p_location_mocked?: boolean;
        };
        Returns: Checkin;
      };
    };
  };
};
