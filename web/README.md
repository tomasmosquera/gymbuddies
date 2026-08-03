# Gym Buddies — invite web fallback

Static site (no build step, no framework) that makes group-invite links (`https://<domain>/join/<code>`) work as real Universal Links (iOS) / App Links (Android):

- If the app is installed, the OS opens it directly — this site is never seen.
- If not installed, `/join/:code` (rewritten to `join.html` by `vercel.json`) shows a themed fallback page, copies the invite code to the clipboard, and links to the right app store.
- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` are what let iOS/Android verify this domain is allowed to open the app directly.

## Deploy

1. Vercel → New Project → import this repo.
2. **Root Directory: `web`**. Framework preset: **Other** (no build command, no output directory needed — it's already static).
3. Deploy. Note the resulting domain (`*.vercel.app` is fine to start).

## Placeholders to replace before this actually works

- `.well-known/apple-app-site-association` → `appID`: replace `TEAMID_PLACEHOLDER` with your real Apple Developer Team ID (found on developer.apple.com under Membership, or via `eas credentials`). Keep `.com.gymbuddiestm.app` unless the iOS bundle identifier changes.
- `.well-known/assetlinks.json` → `sha256_cert_fingerprints`: replace `SHA256_FINGERPRINT_PLACEHOLDER` with your release keystore's SHA-256 fingerprint (`eas credentials` → Android → your build profile → Keystore, or `keytool -list -v -keystore your.keystore`).
- `join.html` → `IOS_STORE_URL`/`ANDROID_STORE_URL`: fill in once the app has real store listing URLs.

Once the domain is live, it also needs to be filled into: `app.json` (`ios.associatedDomains`, `android.intentFilters`) and the app's `EXPO_PUBLIC_INVITE_LINK_DOMAIN` env var — both are placeholder-tagged the same way.
