-- Bumping to 1.0.6 (iOS build 22) — see 0072_app_version_info.sql's own
-- comment: "bump these by hand after every future native build." Android
-- untouched (still not published, per 0072/0089's own notes).
update app_version_info set latest_version = '1.0.6', updated_at = now() where platform = 'ios';
