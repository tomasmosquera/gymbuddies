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
export type WalletTransactionType = 'initial_deposit' | 'penalty' | 'recharge' | 'adjustment';
export type WalletTransactionStatus = 'pending' | 'confirmed' | 'rejected';
export type RuleProposalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'applied';
export type VoteChoice = 'yes' | 'no';
export type WeeklyEvaluationStatus = 'active' | 'needs_recharge';
export type ExcuseType = 'travel' | 'medical' | 'other';
export type ExcuseRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type AttendanceOverrideStatus = 'valid' | 'failed';

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  expo_push_token: string | null;
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
  created_at: string;
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
  leave_requested_at: string | null;
  leave_effective_at: string | null;
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
        Update: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url' | 'expo_push_token'>>;
      } & NoRelationships;
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
      checkins: {
        Row: Checkin;
        Insert: Pick<Checkin, 'group_id' | 'user_id' | 'captured_at' | 'latitude' | 'longitude' | 'location_accuracy_m' | 'photo_path'>;
        // Only a same-day self re-capture is allowed (checkins_update_self_today, 0012).
        Update: Partial<Pick<Checkin, 'captured_at' | 'latitude' | 'longitude' | 'location_accuracy_m' | 'photo_path'>>;
      } & NoRelationships;
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
      cast_excuse_vote: { Args: { p_request_id: string; p_vote: VoteChoice }; Returns: ExcuseVote };
      close_expired_excuse_votes: { Args: Record<string, never>; Returns: void };
      process_scheduled_leaves: { Args: Record<string, never>; Returns: void };
      run_weekly_evaluation: { Args: Record<string, never>; Returns: WeeklyEvaluationRun[] };
      close_expired_proposals: { Args: Record<string, never>; Returns: void };
      admin_remove_member: { Args: { p_member_id: string }; Returns: GroupMember };
      admin_delete_checkin: { Args: { p_checkin_id: string }; Returns: void };
      admin_delete_wallet_transaction: { Args: { p_transaction_id: string }; Returns: void };
      set_attendance_override: {
        Args: { p_group_id: string; p_user_id: string; p_date: string; p_status: AttendanceOverrideStatus; p_note?: string | null };
        Returns: AttendanceOverride;
      };
      clear_attendance_override: { Args: { p_group_id: string; p_user_id: string; p_date: string }; Returns: void };
      submit_workout_checkout: {
        Args: {
          p_checkin_id: string;
          p_captured_at: string;
          p_latitude: number;
          p_longitude: number;
          p_location_accuracy_m: number | null;
          p_photo_path: string;
        };
        Returns: Checkin;
      };
    };
  };
};
