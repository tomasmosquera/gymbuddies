-- Revert: 0118 bumped ios latest_version to '1.0.6' as prep for the App
-- Store release, but it got applied by accident (bundled into an unrelated
-- `supabase db push`) BEFORE 1.0.6 actually cleared Apple review — meaning
-- every real user still on the live public version started seeing "please
-- update" pointed at a build they can't even download yet. Reverting to
-- 1.0.5 (the actual last public release) until the user confirms 1.0.6 is
-- live, at which point this gets bumped again deliberately.
update app_version_info set latest_version = '1.0.5', updated_at = now() where platform = 'ios';
