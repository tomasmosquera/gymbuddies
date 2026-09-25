# Hyperframes Composition Brief: Gym Buddies

## Objective
Create a short launch-style brag video for Gym Buddies.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: vertical — 1080x1920
- Duration: 30 seconds (extended at the user's request; the skill default is 15-25s)

## Source Material
- Project root: `Gym Buddies/` (Expo / React Native + Supabase mobile app, no marketing site)
- Primary files read: `README.md`, `package.json`, `src/constants/theme.ts`, `web/index.html`, `app/(app)/home/index.tsx`, `app/(app)/checkin/index.tsx`, `app/(app)/profile/wallet.tsx`, `app/(auth)/sign-in.tsx`, `assets/icon-header.png`, `assets/Foto.jpeg` (user-provided real gym photo, cropped; used as the check-in photo in Scenes 2 and 3)
- Product name: Gym Buddies
- Tagline / strongest claim: friends charge each other for skipping the gym; the money goes to whoever showed up
- Key UI or visual moment to recreate: the check-in screen (location pill, shutter, "1. Foto Inicial ✓"), Monday's member tally, and the "Reparto de hoy" payout card with 🏆 on the podium
- Copy that must appear verbatim (Spanish, from the app):
  - No olvides tu check-in
  - 📍 Ubicación lista
  - 1. Foto Inicial ✓ / 2. Foto Final
  - Ya hiciste check-in hoy ✓
  - Reparto de hoy
  - Tu saldo
  - Gym Buddies
- Video-only copy (written for this video, Spanish):
  - Faltas al gym. / Tus amigos cobran.
  - Foto desde la cámara. Nada de galería.
  - Cada lunes se hace la cuenta.
  - Lo que pierde uno, lo reparten los demás.
  - Ve al gym / Con tus amigos
- Member names and amounts in the tally and payout are illustrative placeholders (e.g. penalty $20.000 COP per missed day); they must read as example data, not real users.

## Creative Direction
- Tone preset: default
- Creative direction: el banco de tus amigos: deadpan, cada falta tiene precio
- Interpretation: playful but understated. Push notifications and payout rows carry the joke; nothing shouts. Comfortable holds, snappy 0.3-0.6s entrances, no hype words.
- Angle: "Your friends charge you for skipping the gym." The app is a bank statement for laziness: every miss has a price and the money doesn't vanish, it goes to the friends who showed up. The whole video speaks in the app's own deadpan-banking voice, in Spanish.
- Hook: a push notification "No olvides tu check-in" drops in, then "Faltas al gym." / "Tus amigos cobran."
- Outro / punchline: logo + "Gym Buddies" + "Ve al gym / Con tus amigos"
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign (stay inside the app's dark UI and mint accent)
  - Cash-register clichés in the sound design

## Visual Identity
- Background: #0B0F14
- Text: #F5F7FA (muted #9AA7B5)
- Accent: #3DDC97 (text on accent: #04140D)
- Surfaces: #161C24, alt #1F2733, border #2A3441
- Danger / penalty: #FF6B6B (warning #FFB454)
- Display font: Inter 700/800 (bundled locally as the closest web match to the app's system UI font)
- Body font: Inter 400/600
- Visual references from the project: the dark UI with mint-green accent; step pills; leaderboard / "Reparto de hoy" rows with 🏆; reaction emoji 💪🏼 🔥 🫃; the GB barbell logo (`assets/icon-header.png`, copied to `composition/assets/`)

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 4.38s — push notification "No olvides tu check-in", then "Faltas al gym." / "Tus amigos cobran."
2. La prueba — 4.36s — check-in screen: "📍 Ubicación lista", shutter tap, "1. Foto Inicial ✓", caption "Foto desde la cámara. Nada de galería.", "Ya hiciste check-in hoy ✓"
3. Reacciones — 4.37s — "Tus amigos ven tu foto. / Y reaccionan.", a check-in photo card with the reactions 💪🏼 2, 🔥 3, 🫃 1
4. Votación de reglas — 4.36s — "Las reglas las votan todos.", "Votación de reglas en curso" → "Cambio de reglas aprobado ✓" for "Días mínimos por semana" 3 → 4, then "Se aplica el próximo lunes."
5. La cuenta del lunes — 4.9s — "Cada lunes se hace la cuenta." then three member rows one by one, one with a red charge
6. Reparto de hoy — 4.37s — payout card with 🏆 podium and counting-up amounts, caption "Lo que pierde uno, lo reparten los demás."
7. Outro — 3.26s — GB logo + "Gym Buddies" + "Ve al gym / Con tus amigos"

## Audio
- Audio role: warm business-beat bed with sparse, motion-matched accents
- Audio arc: bed enters immediately, notification and shutter accents early, card sounds for the tally, a small payoff accent for the payout, one bell on the logo slam, fade out
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (chosen by the user instead of vol-10)
- Music treatment: start at 0s, bed volume about 0.30-0.35, fade out over the last ~1.4s
- Music cue guidance: bundled preset `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (~110 BPM). Strong cues locked (vol-12): 8.74 (Scene 3 in), 9.29 ("Y reaccionan."), 10.93 (first reaction chip), 13.11 / 13.64 (Scene 4 in / rule card), 15.84 (rules vote approved), 17.47 (Scene 5 in), 18.56 / 19.66 (member rows a and b), 22.37 / 22.93 (Scene 6 in / payout card), 24.56 (Reparto de hoy amounts land), 26.74 (logo slam), 27.30 (brand name). This track has no strong cues before 8.74, so the hook and check-in scenes lock to the plain beat grid: notification 0.56, line 1 1.10, line 2 2.19, slam 2.73, shutter tap 6.01, captions 6.56 / 7.10 / 7.65. Beat grid also drives: reaction chips 10.93 / 11.46 / 12.02, member rows 18.56 / 19.66 / 20.75, closing line 28.92. Optional hints only; readability comes first.
- Audio-reactive treatment: subtle; bass and overall energy make the logo glow and the payout winner glow breathe. No waveform/equalizer visuals.
- Audio-coupled moments:
  - Scene 1 notification drop — soft accent; line 2 lands on the 2.46s beat
  - Scene 2 shutter tap — simulated interaction click; "Foto Inicial ✓" tick
  - Scene 3 reaction chips — a soft click per chip
  - Scene 4 votes — a click per vote, a bell accent on approval at 15.84s
  - Scene 5 member rows — card/slide accent per row, heavier accent on the red row
  - Scene 6 counter — sparse ticks, payoff accent at 24.56s
  - Scene 7 logo slam — bell at 26.74s
- SFX selection guidance: prefer low high-frequency-risk files for repeated moments; medium only for isolated reveals; volumes 0.55-0.8
- SFX analysis guidance: `assets/sfx/sfx-analysis.md` in the skill
- Exact SFX choice: Hyperframes chose files after the visual animation was built (see the composition's `<audio>` elements)
- Audio files: chosen music and SFX copied into `brag-output/composition/assets/`

## Hyperframes Instructions
Loaded the composition-building Hyperframes domain skills — `hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`, `hyperframes-keyframes`, `hyperframes-cli`. /brag is its own workflow: no `hyperframes` entry-point intent interview and no generic promo / launch-video workflow.

Requirements:
- Show real UI, copy, and visual elements from the source project.
- Keep all text readable in the final render.
- Keep the video within 15-25 seconds.
- Include the planned music/SFX layer.
- Run `hyperframes check` before render, and pause for approval before rendering.
