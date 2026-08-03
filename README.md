# Gym Buddies

Gym Buddies is a React Native (Expo) + Supabase app for groups of friends who hold each other financially accountable for going to the gym. Every member deposits real money (COP) into a group — the transfer itself happens **outside the app** (Nequi, Bancolombia, cash, etc.); the app only records the receipt and lets the group's admin confirm it. Each week, a Postgres cron job tallies who met the group's minimum attendance and deducts a penalty from anyone who didn't, straight out of their tracked balance. Attendance is proven with a photo taken **from the in-app camera only** (never the photo library), stamped with GPS coordinates and a timestamp. Everything about how the group works — attendance requirement, penalty amount, whether the pooled money behaves as a shared fund or a competitive prize pool, and more — is configurable and changeable only by majority vote (or, in some cases, a direct admin edit).

This document is intentionally exhaustive: it is meant to let another AI (or a new engineer) understand the entire system — schema, business rules, screens, and code layout — without having to read all 65 SQL migrations and ~150 source files first. Where a rule is precise (an enum value, a formula, a column name), it's stated exactly rather than paraphrased.

## Stack

- **App**: Expo (React Native) + TypeScript + `expo-router` (file-based routing) + Zustand (small global state) + Zod (form validation)
- **Backend**: [Supabase](https://supabase.com) — Postgres + Auth + Storage + Row Level Security + `pg_cron` + one Deno Edge Function
- **No payment gateway**: money transfers happen entirely outside the app; the app is a ledger and an attendance-verification tool, never a payment processor
- **Notable native modules**: `expo-camera` (check-in photos + invite QR scanning), `expo-location` (GPS lock + background geofencing), `expo-notifications` (push), `@react-native-community/datetimepicker`, `@kingstinct/react-native-healthkit` (iOS-only, optional), `react-native-qrcode-svg`, `react-native-view-shot` (photo watermarking), `react-native-svg` (charts)

## Project structure

```
app/                          Screens (expo-router, file-based routing)
  index.tsx                     Redirect hub: routes to sign-in / group-select / home
  group-select.tsx              Pick which group is "active" (for multi-group users)
  (auth)/                       sign-in, sign-up
  (onboarding)/                 create-group, join-group, deposit
  (app)/                        Tab navigator: home, checkin, dashboard, rules, profile
    home/                         Landing screen: today's status, week strip, leaderboard
    checkin/                      Camera capture + preview/confirm (initial + checkout photos)
    dashboard/                    Group-wide attendance viewer (by day / by member / calendar)
    rules/                        Current rules, voting, excuses, photo challenges, League cycle
    profile/                      Hub + ~15 sub-screens (wallet, admin tools, stats, badges, etc.)
src/
  lib/domain/                   Pure business logic, zero RN/Supabase deps — unit tested 1:1
  lib/supabase/                 Supabase client, hand-maintained generated types, Storage helpers
  lib/validation/               Zod schemas for every form
  lib/notifications/             Checkout reminders, geofencing, push token registration, tap routing
  lib/health/                   Apple HealthKit reader (iOS only)
  hooks/                        ~30 data hooks (one per screen/feature area)
  state/                        3 Zustand stores (auth, active group, in-progress check-in draft)
  components/ui/                Reusable visual primitives (Button, Card, TextField, MoneyField, ...)
  components/checkin/           Photo column/modal viewers used across dashboard/rules/admin screens
  components/home/              LeaderboardCard
  components/stats/             LineChart, Heatmap, BarList
  constants/                    theme, payoutModes (per-payout-mode field relevance), ruleFieldHelp
supabase/
  migrations/                   Full SQL schema, RLS, triggers, RPCs, pg_cron jobs — 0001 through 0065
  functions/notify-achievements/  The one Edge Function (badge/level-up push notifications)
tests/domain/                   Unit tests for src/lib/domain/*, one file per module
tests/notifications/            Unit test for the notification tap-routing logic
```

## Data model & business rules

This is the core of the app. Read it top-to-bottom; later sections build on earlier ones.

### 1. Groups

`groups` — one row per accountability circle:

| Column | Meaning |
|---|---|
| `name`, `invite_code` (unique, 8-char), `admin_id`, `currency` (default `'COP'`), `timezone` (default `'America/Bogota'`) | Identity |
| `initial_deposit_amount` (> 0) | Required deposit to become `active` |
| `min_days_per_week` (0–7), `penalty_amount` (≥0), `weekly_penalty_cap` (≥0) | The core attendance rule and its money |
| `require_checkout_photo` (bool), `min_workout_minutes` (≥0, informational only) | Whether a second "checkout" photo is required, and a soft minimum-duration label ("Corto") — never blocks credit or triggers a penalty |
| `exit_fee_amount` (≥0), `exit_notice_days` (≥0) | Cost and notice period for leaving |
| `admin_payment_info` | Free text shown to members (bank account, Nequi number, etc.) — money never touches the app |
| `payout_mode` (`'cooperative'` \| `'league'` \| `'mixed'`, default `'cooperative'`) | How pooled money ultimately gets distributed — see §7 |
| `league_duration_months` (1–24, default 3), `league_prize_splits` (jsonb array of percents summing ≤100, default `[60,30,10]`), `mixed_league_share_percent` (0–100, default 50) | League/Mixed configuration |
| `game_starts_at` (nullable timestamptz) | Optional floor for every member's `activated_at` — lets a group be created ahead of its real start date |

`vacation_days_per_month` existed in the original schema and was **dropped** — fully replaced by the excuse system (§5).

### 2. Membership lifecycle

`group_members` — one row per (group, user):

- **`status`**: `pending_deposit` → `active` → (`needs_recharge` ⇄ `active`) → `left` | `removed`.
  - `pending_deposit`: joined, deposit not yet confirmed. Since migration 0039, these members **fully participate already** — they can check in, vote, propose rules, and are evaluated/penalized every week. The only thing "pending" is money.
  - `active`: confirmed positive-ish balance, in good standing.
  - `needs_recharge`: balance dropped to ≤0 after a penalty; still fully evaluated, just flagged for a UI recharge prompt.
  - `left`: self-service departure completed (can rejoin with the same invite code — a new join re-activates the same row).
  - `removed`: kicked by the admin (cannot rejoin with the same code).
- **`balance`**: the *only* place this is mutated is a trigger on `wallet_transactions` (`apply_wallet_transaction_effect`) — always `balance = balance + confirmed_transaction.amount`. Can go negative (no floor constraint).
- **`activated_at`**: the instant this member's days start counting for *everything* — ranking, consistency %, badges, the weekly required-days math, and voting/proposing eligibility. Auto-set on the member's first confirmed deposit to `greatest(now(), group.game_starts_at)`. Admin-correctable via `admin_set_member_activation_date(p_member_id, p_date)`.
- **`penalty_start_date`**: a separate, independently-settable, *usually-later* gate — lets an admin count someone for everything (ranking, badges, required days) starting at `activated_at`, but shield them from actual **money** penalties until a later agreed date (a "grace period"). Every read falls back `penalty_start_date → activated_at → joined_at`, so leaving it null behaves exactly like using `activated_at`. Set via `admin_set_member_penalty_start_date(p_member_id, p_date)`.
- **`leave_requested_at` / `leave_effective_at`**: set by a notice-based `leave_group` call; the member is graded completely normally for the whole notice period (no special status value for "serving notice"). An hourly cron job finalizes the departure once the effective date arrives.
- **`notification_preferences`** (jsonb): see §10 — per-**group**, not global.

**Joining**: `join_group(p_invite_code)` — case-insensitive lookup; a `removed` member is blocked from rejoining with the same code; a `left` member rejoining re-activates their existing row (`status='pending_deposit', joined_at=now()`) instead of creating a new one, preserving history. The admin gets a push notification about every new member.

**Creating a group**: `create_group(...)` (15 parameters covering every `groups` column above) inserts the group and a `group_members` row for the caller as `role='admin', status='pending_deposit'` — the admin is a player too and must also deposit. In the client (`(onboarding)/create-group.tsx`), the app immediately auto-confirms the creator's own deposit via `admin_confirm_deposit_without_receipt` (no receipt needed — there's no one else for the creator to "prove" a transfer to) and skips straight to `/home`, falling back to the normal `/deposit` screen only if that call fails.

**Leaving**: `leave_group(p_group_id, p_immediate)`.
- `p_immediate = true`: charges the exit fee (if any) as a negative `'adjustment'` transaction, then immediately settles the member's cooperative-fund payout (§7), then flips `status='left'`.
- `p_immediate = false` (default): sets `leave_requested_at`/`leave_effective_at = now() + exit_notice_days`; the member keeps training/being graded normally. `process_scheduled_leaves()` (hourly cron) finalizes anyone whose notice period has elapsed, processing members within a group strictly in sequence so a payout pool computed for one departure already reflects an earlier one in the same batch.
- `cancel_leave_request(p_group_id)`: self-service, clears the pending notice.

**Admin removal**: `admin_remove_member(p_member_id, p_pay_out default true)` — can't remove the group's own admin. By default settles a cooperative/mixed payout first (same mechanic as leaving); pass `p_pay_out=false` to remove someone "for cause" (fraud, abuse) and skip the payout, leaving their balance untouched for manual reconciliation.

### 3. Check-ins — the proof of attendance

`checkins` — one row per (group, user, date), unique on that triple:

| Column | Meaning |
|---|---|
| `checkin_date` | **Server-derived**, never trusted from the client — always `(captured_at at time zone 'America/Bogota')::date` |
| `captured_at`, `latitude`, `longitude`, `location_accuracy_m`, `photo_path` | The initial check-in photo's metadata |
| `checkout_captured_at`, `checkout_latitude/longitude/accuracy`, `checkout_photo_path`, `workout_minutes` | Populated only if the group requires a second "checkout" photo |
| `active_energy_kcal` | Optional, from Apple Health (§9) — display only |

- **Clock-drift guard**: `captured_at` must be within **4 hours** of the server's `now()` at the moment it's inserted/changed (`set_checkin_date()` trigger) — this check only re-fires when `captured_at` itself changes, so a later update to an unrelated column (checkout fields, HealthKit sync) doesn't re-validate against a now-stale timestamp. A check-in can never be moved to a different calendar day via update — only same-day re-takes or a delete-and-redo.
- **No geofence validation** — GPS lat/lon/accuracy are stored as audit/proof data and shown to the group; nothing server-side rejects a check-in based on distance from a known gym location.
- Writes only through `submit_checkin(p_group_id, p_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_photo_path)` (self-service upsert, requires `is_voting_member`) — direct client table access is revoked.
- Checkout: `submit_workout_checkout(...)` — same-day only, `captured_at` must be after the initial check-in's, its own independent 10-minute drift guard, computes `workout_minutes` server-side. **A missing or short checkout never blocks attendance credit or triggers a penalty** — informational only (drives the "Corto" label and duration-based badges/tiebreaks, nothing else).
- Deletion: `delete_own_checkin` (self, today only) or `admin_delete_checkin` (admin, any day) — both remove the storage objects; the admin version also deletes any `attendance_overrides` row for that date, so the day cleanly reverts to "no record" even if a manual override existed.

### 4. Weekly evaluation — the penalty engine

`run_weekly_evaluation()` runs every **Monday at 00:00 America/Bogota** via `pg_cron`, grading the just-finished Monday–Sunday week for every group. It's idempotent per (group, week) — a unique constraint on `weekly_evaluation_runs(group_id, week_start_date)` makes a re-run a no-op.

Per member, per week:

1. **Two independent "present since" dates**: `activated_date` (drives what's *shown* — required/completed/failed days, ranking, badges) and `penalty_start_date` (drives only what's *charged*).
2. **`completed_days`**: distinct dates in the week with either a real check-in ≥ `activated_date`, or a `'valid'` attendance override — **excluding** any date that also has a `'failed'` override (a failed override always wins, even over a real photo).
3. **`excused_days_used`**: count of approved `excuse_dates` in the week.
4. **`days_present`** = `least(7, greatest(0, (week_end − greatest(week_start, activated_date)) + 1))` — clamps a mid-week joiner's requirement down instead of grading them against a full week they weren't part of.
5. **`required_days`** = `least(min_days_per_week, days_present)`; **`effective_required_days`** = `greatest(required_days − excused_days_used, 0)`; **`failed_days`** = `greatest(effective_required_days − completed_days, 0)` — this is what's stored, ranked, and fed to badges. Never affected by `penalty_start_date`.
6. The exact same 4 formulas are computed a **second time** using `penalty_start_date` instead of `activated_date`, producing a (possibly smaller) `failed_days_for_penalty`.
7. **`penalty_protected`** = `penalty_start_date > week_start` (frozen onto the result row, so the UI can tell "genuinely clean week" apart from "week still under grace-period protection").
8. **`penalty_charged`** = `0` if `payout_mode = 'league'` (pure League suppresses money penalties entirely — only ranking matters), else `least(failed_days_for_penalty * penalty_amount, weekly_penalty_cap)`.
9. Inserts one `weekly_evaluation_results` row (`required_days, completed_days, excused_days_used, failed_days, penalty_charged, penalty_protected, balance_before, balance_after, status_after`), sends a result push notification (worded differently for: league mode / met quota / protected-by-grace-period / actual charge), and — if `penalty_charged > 0` — inserts a `'penalty'` `wallet_transactions` row (the balance mutation itself happens via the standard trigger, not inline here).
10. After grading every member: settles any due League cycle for the group (§7), then applies at most one pending rule-change proposal whose `effective_at` has arrived (§6) — **after** grading, so the week is always graded under the rules that were actually in force during it.

`src/lib/domain/weeklyEvaluation.ts` is a pure TypeScript mirror used for unit tests and UI previews, explicitly documented as "the SQL is authoritative." **Known gap**: it still only implements the pre-`penalty_start_date`/pre-League-mode algorithm (a single "present since" date, no penalty-quota split, no League suppression) — a UI preview for a member with a `penalty_start_date` grace period, or for a `league`-mode group, will show a wrong number until this file is updated to match steps 6–8 above.

### 5. Attendance overrides & excuses

**`attendance_overrides`** (admin-only writes via `set_attendance_override`/`clear_attendance_override`): a manual `'valid'` or `'failed'` marker for a specific (member, date), unique per triple. A `'failed'` override always beats a real check-in in the evaluation math above.

**Excuses** (`excuse_requests` → `excuse_dates` → `excuse_votes`): `excuse_type` is `'travel'`, `'medical'`, or `'other'` — travel and medical **require a proof photo**, other does not. Every request starts `pending` in the admin's queue; the admin then either:
1. **`approve_excuse_request(p_request_id, p_excused_dates)`** — picks exactly which dates in the requested range to excuse (partial credit allowed), or
2. **`reject_excuse_request(...)`**, or
3. **`send_excuse_request_to_vote(p_request_id)`** — escalates to a group majority vote (same 72h/majority shape as rule proposals); on approval this excuses the *entire* requested range, all-or-nothing.

Only `excuse_dates` rows feed into weekly evaluation's excused-day count — nothing else about the excuse system does.

### 6. Rule changes — voting & direct edits

Any field on `groups` (attendance rule, penalty amounts, exit terms, checkout-photo requirement, and the whole payout-mode/League configuration) can be changed two ways:

- **`propose_rule_change(p_group_id, p_changes jsonb, p_apply_immediately)`** — any `is_active_participant` member (voting-eligible *and* their own `activated_at` has arrived) can propose. Requires simple majority (`floor(members/2)+1`) of `active`/`needs_recharge` members, 72-hour window, one open proposal per group at a time. A member who joined *after* the vote opened cannot vote on it. Resolves early the instant a majority is mathematically forced either way (`resolve_rule_proposal` trigger); an hourly cron force-closes anything that merely times out (defaulting to **rejected**, unlike photo challenges which default to valid). Approved changes take effect either immediately or — the default — at the next Monday 00:00, applied as the final step of that Monday's `run_weekly_evaluation()` run (so the week just graded always used the *old* rules).
- **`apply_rule_change_direct(p_group_id, p_changes)`** — admin-only bypass, no vote, applies instantly.

Both funnel through the same `apply_rule_proposal`/`apply_rule_change_direct` field list (a plain coalesce-over-current-value update on `groups`). Switching a group **from** `league`/`mixed` **to** `cooperative` this way auto-cancels any running League cycle with no payout — the pool just continues under cooperative rules untouched.

### 7. Wallet, payouts & payout modes

`wallet_transactions.type` ∈ `'initial_deposit' | 'recharge' | 'penalty' | 'adjustment' | 'payout'`. The *only* place `group_members.balance` changes is a trigger that fires whenever a row's `status` is/becomes `'confirmed'`: `balance += amount`. `initial_deposit`/`recharge` are self-inserted `pending` with a photo receipt and confirmed/rejected by the admin (or, for a first deposit, confirmable without a receipt via `admin_confirm_deposit_without_receipt`); `penalty`/`adjustment`/`payout` rows are always inserted already-confirmed by server-side logic.

**`payout_mode`** governs what ultimately happens to the pooled money:

- **`cooperative`** (default): every active member's share of the pool is proportional to their `group_members.cooperative_weight` (numeric, default `1` — plain equal split for everyone until an admin changes it). Whenever a member departs — `leave_group`, the scheduled-notice sweep, or `admin_remove_member` with payout enabled — `pay_out_departing_member()` computes their weight-proportional share, pays it to them via a `'payout'` transaction, and spreads the difference across everyone remaining in proportion to *their* weights (cent-exact, remainder distributed one cent at a time) — a strict money-conservation invariant.
- **`league`**: no per-member payout on departure (early leavers forfeit); weekly money penalties are suppressed entirely (§4 step 8); instead the admin starts a **League cycle** (`start_league_cycle`, `league_cycles` table, `status: running|completed|cancelled`, one running cycle per group max) that snapshots the current prize splits/duration. At the end of the cycle, `evaluate_due_league_cycle()` ranks still-active members by `sum(completed_days) − sum(failed_days)` (workout-duration tiebreak only if checkout photos are required), pays the podium places their `league_prize_splits` percentage of the pool, and — since everyone funds the prize equally — charges every currently-active member an equal share of the payout (winners collect a net gain, everyone else a net cost).
- **`mixed`**: `mixed_league_share_percent`% of the pool follows the League mechanic (paid at cycle end); the rest follows the cooperative mechanic (paid on departure, weight-proportional as above). Weekly penalties are **not** suppressed in `mixed` (only pure `league` suppresses them).

`src/lib/domain/leaguePayouts.ts` mirrors both the League placement/tie-merging math and the cooperative-share math client-side, purely for "you'd get about $X" UI previews — the real payout is always computed server-side.

#### Cooperative weight & whole-group liquidation (migration `0065`)

- **`group_members.cooperative_weight`** (numeric, default `1`, must be `> 0`): a relative weight, not a raw percent — a member's share is always `weight_i / sum(all active weights)`, so a brand-new member joining at the default weight of `1` simply dilutes everyone else proportionally, exactly like "one more equal player joined," with no manual rebalancing needed. **`admin_set_cooperative_share_percent(p_member_id, p_target_percent)`** lets the admin instead express the edit as "this member should sit at X% of the pool" (0–100 exclusive) — the function solves for the weight that produces that percentage against everyone else's *current* weights and stores the weight, not the percent. No vote required, same direct-admin-tool precedent as `admin_set_member_activation_date`/`admin_set_member_penalty_start_date`.
- **`liquidate_group_now(p_group_id, p_dry_run)`**: settles the *entire* group's pool today, in one shot — every active member's balance goes to `$0` and each one gets a `'payout'` transaction recording what they're actually owed (real money the admin still has to hand back outside the app, exactly like every other transaction in this system — the app never custodies funds). One function serves two purposes with the identical calculation, so a preview can never drift from reality:
  - `p_dry_run = true` — read-only, callable by **any** group member. This is the live "Reparto de hoy" figure everyone sees.
  - `p_dry_run = false` — actually executes the payout. **Admin only.**
  - In `cooperative`/`mixed`, the non-League slice of the pool splits by `cooperative_weight` exactly like a departure payout. In `league`/`mixed`, the League slice is paid to the podium ranked by **today's** standing (not the cycle's original end date) using the same tie-merging logic as a normal cycle settlement, and any unclaimed prize percentage (splits under 100%, or fewer participants than prize slots) rolls into the cooperative slice instead of being stranded. If the mode needs a running League cycle and there isn't one, it raises a clear error instead of silently returning zero for everyone. The group itself is **not** deactivated or archived by a liquidation — it stays fully active with every member simply back at `$0`, free to keep depositing and playing.

Client-side: `app/(app)/profile/wallet.tsx` renders a **"Reparto de hoy"** card (via `useLiquidationPreview`, which just wraps the two `liquidate_group_now` calls) visible to every member, ranking rows by amount with a 🏆 next to podium places. When the mode isn't pure League, the admin additionally sees an inline **"Editar %"** control per row (calls `admin_set_cooperative_share_percent`, refreshes the preview immediately so the effect of the edit is visible right away) and a **"Liquidar ahora"** button that confirms with the exact per-member amounts before calling the real (non-dry-run) RPC.

## Gamification

### Badges & XP

There is no `badges` table — everything is computed **live** from existing data, so a badge you already qualify for just shows as earned instantly, with no backfill step. `src/lib/domain/badges.ts` defines 47 lifetime badges across 6 categories (`racha`/streaks, `consistencia`, `fechas especiales`, `checkins`, `financiero`, `social`) — from `primer-paso` (first ever check-in) through `leyenda` (365-day streak), duration-based badges (`entreno-de-hierro`, `maratonista`), social badges (`motivador`, `alma-del-grupo`, `reformista` for getting a rule proposal approved), and one deliberately-**revocable** badge (`ahorrador-involuntario`, worth 0 XP on purpose so a level can never go down — every other badge is permanent once earned).

**Leveling** (`src/lib/domain/xp.ts`): `xpRequiredForLevel(level) = 100 + 50 * (level - 1)` (level 1 costs 100 XP, +50 per level after); a member's total XP is their earned lifetime-badge XP plus their monthly-challenge XP (below), and their level/progress-to-next-level is derived from that total.

### Monthly challenges

`src/lib/domain/monthlyChallenges.ts` defines 23 challenges that reset every calendar month (`empezamos-bien`, `top-del-grupo`, `mvp-al-menos-una-vez`, `mes-de-hierro`, etc.) — most are simple counters credited instantly within the still-open current month; rank-based ones (top-of-group, podium, "comeback vs last month") only evaluate against already-closed months. Each tracks `timesAchieved` (lifetime occurrence count) separately from `currentMonthEarned`.

### Leaderboard

`useLeaderboard.ts` ranks members by **consistency % only** (never balance/money) — week / month / all-time periods, standard competition ranking (ties share a rank), workout-duration tiebreak only when the group requires checkout photos. Each row also shows a purely informational `chargedAmount`: the frozen historical penalty sum for closed periods, or for the still-open current week, a **live "guaranteed-misses-only" projection** — a day only counts as a guaranteed miss once there literally aren't enough days left in the week to still hit quota, correctly clamped by `penalty_start_date` so a member in their grace period never shows a scary live number.

### Reactions

Members can react to each other's check-in photos with exactly one of 3 fixed emoji (`💪🏼`, `🔥`, `🫃`) — one reaction per person per check-in (switching emoji replaces, doesn't stack), can't react to your own check-in, only the *first* reaction from someone notifies the photo's owner.

## Notifications

Every push goes through one Postgres function, `send_push_notification(p_user_ids, p_title, p_body, p_group_id, p_data, p_category)`, which filters recipients against their **per-group** `notification_preferences` (`group_activity | money | votes | reminders | admin_actions | achievements` — a member can mute one group while keeping another fully on), always writes an in-app `notifications` inbox row regardless of push-token presence, and sends the actual Expo push with `category`/`group_id` folded into the payload's `data` so a cold-start tap can route without a database round trip.

It's called from ~30 places covering essentially every state change in the app: new member joined, deposit/recharge confirmed or rejected, weekly evaluation result, balance adjusted, payout settled, League cycle started/settled, rule proposal opened/resolved, direct rule change applied, excuse request submitted/decided/voted, photo challenge opened/resolved, someone reacted to your photo, admin corrected your activation or penalty-start date, admin deleted your check-in, you were removed from a group, and the nightly "you haven't checked in today" reminder. A separate reactive pipeline (a Deno Edge Function, `notify-achievements`, triggered every 15 minutes but skipping any group with no relevant changes since its last check via a `dirty_at`/`last_checked_at` tracking table) evaluates every badge/monthly-challenge/level-up and pushes exactly once per newly-earned achievement, to both the achiever and the rest of the group.

Beyond ordinary pushes, a confirmed check-in also schedules **local** reminders when the group requires a checkout photo: a 20-minute delayed notification, a foreground GPS-distance watch (fires if the member drifts >100m from the check-in spot while the app is open), and — if background location permission is granted — a one-shot native geofence that fires the same reminder even with the app fully closed.

## Apple Health integration (iOS only, fully optional)

`src/lib/health/appleHealth.ts` lazily loads `@kingstinct/react-native-healthkit` (must not be imported statically — it's a native/Nitro module that crashes in Expo Go) and reads exactly one thing: active calories burned, taking the max of two independent estimates (workout-object totals vs. summed loose quantity samples) to avoid undercounting. Gated entirely behind an opt-in `profiles.apple_health_enabled` flag (a one-time prompt on first iOS sign-in, togglable later in Profile → Permissions). Synced three ways: a fire-and-forget attempt right at checkout confirmation, a foreground-resync pass on every app-foreground event (re-checks the last 72 hours of checkouts, since a paired Watch can lag), and a server guard (`set_checkin_active_energy`) that never lets a synced value *decrease*. Stored as `checkins.active_energy_kcal`, shown as a display-only 🔥 figure in Dashboard and Admin Photos — never used for penalties, ranking, or badges.

## Personal stats

`profile/stats.tsx` — day/week/month trend charts (consistency % and, if checkout photos are required, average workout minutes, both "you" vs. "group") via a custom `LineChart` (fixed non-scrolling Y-axis, horizontally-scrollable plot once there are more points than fit, always defaulted scrolled to the most recent point); current/longest streaks; weekday and check-in-hour pattern bars; a 26-week GitHub-style attendance heatmap; group-comparison tiles; personal records; financial summary; and a social tally (reactions given/received, who you react to most).

## Security model

RLS predicate functions used throughout (all `security definer stable`):
- **`is_group_member`** — any status in `pending_deposit`/`active`/`needs_recharge`. The baseline "can see this group" gate.
- **`is_group_admin`** — the above plus `role='admin'`.
- **`is_voting_member`** — same statuses (widened in migration 0039 to include `pending_deposit`, since that status already fully participates) — gates check-in submission, voting, proposing.
- **`is_active_participant`** — `is_voting_member` **plus** the member's own `activated_at` has actually arrived — gates *proposing/voting* specifically (rule proposals, excuses, photo challenges), deliberately **not** check-in/checkout submission, which must always work regardless of activation date.

General pattern: every table's `SELECT` policy is simply "any member of this group can read it" — including other members' balances and penalty history, deliberately, since the leaderboard, group money summary, and admin tooling all depend on it. Writes are far more locked down: Supabase's default blanket grants are revoked, and only specific columns are re-granted directly (e.g. a group's own `name`/`admin_payment_info`); every money-moving, penalty-charging, or authority-changing mutation can only happen through a `SECURITY DEFINER` function that re-checks the relevant `is_*` predicate itself. Tables like `checkins`, `weekly_evaluation_results`, and `rule_votes` are fully immutable/undeletable by clients — an audit trail — with admin/self deletion instead routed through dedicated functions that re-verify authorization.

**Storage** (3 private buckets, objects addressed as `{group_id}/{user_id}/{file}`, always accessed via short-lived signed URLs, never public): `checkins` (both initial and checkout photos), `receipts` (deposit/recharge proof), `excuse-proofs` (travel/medical proof). **Retention**: a daily cron deletes the storage object (never the underlying row) for any of these four photo types — check-in, checkout, receipt, or excuse-proof — once it ages out: Monday–Friday photos are cleared the following Monday; Saturday–Sunday photos get roughly two extra days (cleared the following Wednesday), since the group is more likely to still be reviewing weekend photos mid-week.

## Scheduled jobs (`pg_cron`)

| Job | Schedule | What it does |
|---|---|---|
| `weekly-evaluation` | Mon 00:00 America/Bogota | Grades the just-finished week for every group: penalties, notifications, due rule-change application, League-cycle settlement |
| `checkin-reminder` | 18:00 America/Bogota daily | "No olvides tu check-in" push to anyone active who hasn't checked in or been excused today |
| `cleanup-old-checkin-photos` | 03:00 America/Bogota daily | Deletes expired check-in/checkout/receipt/excuse-proof storage objects per the retention rule above |
| `close-expired-rule-proposals` | hourly | Force-resolves any rule vote that timed out (defaults to rejected) |
| `close-expired-excuse-votes` | hourly | Same, for group-voted excuse requests |
| `close-expired-photo-challenges` | hourly | Same, for photo-validity challenges (defaults to valid) |
| `process-scheduled-leaves` | hourly | Finalizes members whose leave-notice period has elapsed, settling any payout |
| `notify-achievements` (Edge Function) | every 15 min | Pushes newly-earned badges/monthly-challenges/level-ups; cheaply no-ops for groups with nothing new |

## App architecture

### Screens (`app/`)

- **`index.tsx`** — redirect hub (sign-in required → group-select if no active membership → home).
- **`group-select.tsx`** — pick/switch active group; entry point for creating or joining.
- **`(auth)/`** — `sign-in.tsx`, `sign-up.tsx`.
- **`(onboarding)/`** — `create-group.tsx` (full rules form incl. payout mode, auto-confirms the creator's own deposit), `join-group.tsx` (code entry or QR scan with deep-link support), `deposit.tsx` (receipt upload + admin/self confirmation).
- **`(app)/`** — 5-tab navigator:
  - **`home/`** — today's status, week strip, balance, leaderboard, pending-votes banner.
  - **`checkin/`** — camera capture (`index.tsx`) → photo preview with GPS/timestamp watermark and confirm (`preview.tsx`).
  - **`dashboard/`** — group-wide attendance browser (by day / by member / calendar view), reactions, photo-challenge button.
  - **`rules/`** — current rules (mode-aware display), League cycle status, open votes (rule changes, excuses, photo challenges), plus `propose.tsx` and `excuse-request.tsx`.
  - **`profile/`** — hub screen plus ~15 sub-screens: `wallet.tsx` (balance, penalty summary, transaction history, and the "Reparto de hoy" live liquidation preview with admin-only weight-editing and "Liquidar ahora")/`wallet-recharge.tsx`, `stats.tsx`, `badges.tsx`, `notifications.tsx`, `permissions.tsx`, `invite.tsx`, `edit-profile.tsx`/`change-password.tsx`/`delete-account.tsx`, and admin-only `admin.tsx`/`admin-members.tsx`/`admin-transactions.tsx`/`admin-photos.tsx`/`admin-edit-group.tsx`/`excuse-admin.tsx`.

### Hooks (`src/hooks/`)

One data hook per feature area — `useActiveGroup`, `useAuth`, `useCheckins`, `useGroupAttendanceRecords` (the shared foundation for badges/challenges/leaderboard/stats), `useGroupBadges`, `useGroupMonthlyChallenges`, `useLeaderboard`, `useGroupDayAttendance`, `useGroupMembers`, `useGroupMoneyOverview`, `useGroupAdminOverview`, `useWallet`, `useLiquidationPreview` (wraps `liquidate_group_now`'s dry-run/real-execution pair), `useRuleProposal`, `useExcuseRequests`/`useExcuseVote`/`useExcusedDays`, `usePhotoChallenges`, `useAttendanceOverrides`, `useLeagueCycle`, `useLocationLock`, `useElapsedSeconds`, `useNotifications`/`useNotificationTapRouting`, `useAppleHealth`, `usePersonalStats`, `useMyMemberships`.

### Domain logic (`src/lib/domain/`) — the tested, pure layer

`attendance.ts`, `badges.ts`, `dateUtils.ts` (fixed UTC-5 America/Bogota, no DST), `geo.ts`, `inviteCode.ts`, `leaguePayouts.ts`, `monthlyChallenges.ts`, `personalStats.ts`, `reactions.ts`, `voting.ts`, `walletState.ts`, `weeklyEvaluation.ts`, `xp.ts`. Each has a matching file in `tests/domain/`. This layer reimplements in TypeScript the same rules that live authoritatively in SQL, specifically so they can be unit-tested and used for instant UI previews without a network round trip — **the SQL is always the source of truth**; if a business rule changes, both sides need updating (see the noted `weeklyEvaluation.ts` gap above).

### Components (`src/components/`)

`ui/` — generic primitives (`Button`, `Card`, `TextField`, `MoneyField` with live thousand-separator formatting, `SegmentedControl`, `Badge`, `ProgressBar`, `AvatarWithLevel`, `PrizeSplitEditor`, `EmptyState`). `checkin/` — `CheckinPhotoColumn`/`CheckinPhotoModal` (signed-URL photo viewers reused across dashboard/rules/admin). `home/LeaderboardCard`. `stats/LineChart`/`Heatmap`/`BarList`.

### State (`src/state/`, Zustand)

`authStore` (session/profile — populated once at app boot, read everywhere), `activeGroupStore` (persisted to AsyncStorage — which group is "active" right now, read by nearly every screen and by notification-tap routing when a push belongs to a different group), `checkinDraftStore` (deliberately **not** persisted — hands an in-progress photo capture from the camera screen to the preview screen; a half-finished check-in must not survive an app restart since its timestamp has to stay close to real time).

## Onboarding & auth flow

Sign-up (email/password + name/phone) → Supabase's standard email-confirmation link → sign-in → `app/index.tsx` redirect logic: no membership → `group-select.tsx` → either `create-group.tsx` (auto-confirmed deposit, straight to `/home`) or `join-group.tsx` (code/QR) → `deposit.tsx` (receipt upload, pending admin confirmation) → once any membership is active, `/home`. `group-select.tsx` is revisited any time there's no active membership, from Profile's "Cambiar de grupo," and automatically whenever a tapped notification belongs to a different group than the one currently active.

## Setting up your own Supabase project (free)

The app ships with the complete schema, but you need your own Supabase project to actually run it.

1. Create a free account and project at [supabase.com](https://supabase.com).
2. **Project Settings → API**: copy the **Project URL** and **anon public key**.
3. Copy `.env.example` to `.env` and fill them in:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and link your project:
   ```
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```
5. Apply all 65 migrations (creates every table, RLS policy, function, and cron job):
   ```
   npx supabase db push
   ```
6. In the Supabase dashboard, enable the `pg_cron` and `pg_net` extensions if not already on (**Database → Extensions**) — required for every scheduled job listed above.
7. Deploy the Edge Function (needed for the achievement-notification pipeline):
   ```
   npx supabase functions deploy notify-achievements
   ```
8. (Optional) Regenerate the TypeScript types from your real schema:
   ```
   npx supabase gen types typescript --linked > src/lib/supabase/types.ts
   ```
   Not required day-to-day — the committed types are hand-maintained to match the migrations.

## Running the app

```
npm install
npm run start
```

Scan the QR code with **Expo Go** on a physical device — camera and GPS need a real device (iOS Simulator has no camera; the Android emulator's camera is fake).

## Verification / tests

Runnable in any environment, no device or live Supabase project needed:

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # jest — the src/lib/domain/* pure business logic
```

### What still needs a real device/project to verify

- Real camera capture + GPS lock, and the checkout geofence/foreground-distance reminders
- The photo watermark (timestamp/address overlay) actually looking right on a real image
- RLS policies end-to-end against a real Supabase project
- `pg_cron` actually firing on schedule and the Edge Function actually deploying/running
- The full happy path: create group → someone joins by code → deposit → admin confirms → check-ins → a missed day gets penalized on Monday → propose and vote on a rule change → (League/Mixed mode) start and settle a cycle → leave the group and get paid out

## Known limitations

- The "camera only, no photo library" rule for check-ins is a product-level deterrent, not a cryptographic guarantee — someone could in theory point the camera at a photo of a photo. Sufficient friction for a friend group.
- `src/lib/domain/weeklyEvaluation.ts` (the pure TS mirror used for tests/UI previews) has not been updated to reflect the `penalty_start_date` grace-period split or League-mode penalty suppression added later in the SQL (migrations 0060/0064) — it still implements the earlier single-quota algorithm. The real SQL function is correct and authoritative; only the preview mirror is stale.
- `src/lib/supabase/types.ts` is hand-maintained to match the migrations rather than generated on every schema change — regenerate via the CLI if it drifts.
- Colombia has no daylight saving time, so all date logic (SQL and `src/lib/domain/dateUtils.ts`) assumes a fixed `America/Bogota` = UTC-5 offset rather than a real timezone database.
