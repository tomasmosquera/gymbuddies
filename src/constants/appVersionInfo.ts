/**
 * Shown at the very bottom of Perfil as "Versión {app.json version}.{build}.{date}"
 * — e.g. "Versión 1.0.5.21.020926" (built 02/09/26). The semver piece comes
 * from Constants.expoConfig?.version at render time (always current, it's
 * read straight from app.json); the two pieces below do NOT update
 * themselves and must be hand-edited on every deploy:
 *
 * - APP_BUILD_NUMBER: the native build number EAS tracks remotely (this
 *   project's eas.json has `appVersionSource: "remote"`, so it's not in
 *   app.json) — check the current value with `eas build:version:get -p ios`
 *   before bumping. Only changes after a real `eas build`, never after an
 *   `eas update` (OTA updates don't touch the native binary or its build
 *   number at all).
 * - APP_LAST_UPDATED_DDMMYY: the date of whichever deploy happened most
 *   recently — a build OR an `eas update`. Update this on every single
 *   deploy of either kind, not just builds.
 */
export const APP_BUILD_NUMBER = 21;
export const APP_LAST_UPDATED_DDMMYY = '030926'; // no native build change today — OTA updates only
