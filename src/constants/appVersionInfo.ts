/**
 * Shown at the very bottom of Perfil as "Versión {app.json version}.{build}.{date}"
 * — e.g. "Versión 1.0.5.21.020926" (built 02/09/26). The semver piece comes
 * from Constants.expoConfig?.version at render time (always current, it's
 * read straight from app.json); the date piece comes from expo-updates'
 * `Updates.createdAt` (the actual publish time of whichever update — build
 * or OTA — is currently running, no hand-editing needed — see
 * formatDeployDateDDMMYY in version.ts). Only the build number below still
 * needs hand-editing:
 *
 * - APP_BUILD_NUMBER: the native build number EAS tracks remotely (this
 *   project's eas.json has `appVersionSource: "remote"`, so it's not in
 *   app.json) — check the current value with `eas build:version:get -p ios`
 *   before bumping. Only changes after a real `eas build`, never after an
 *   `eas update` (OTA updates don't touch the native binary or its build
 *   number at all).
 */
export const APP_BUILD_NUMBER = 22;
