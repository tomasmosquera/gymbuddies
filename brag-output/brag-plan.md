# Brag Plan: Gym Buddies

## What is this app?
A React Native + Supabase app where a group of friends puts real money (COP) into a shared pool, proves every gym visit with an in-app camera photo (GPS + timestamp, never the photo library), and every Monday at 00:00 the app charges whoever missed their weekly quota.

## The angle
"Your friends charge you for skipping the gym." The joke is that the app is a bank statement for your laziness: every miss has a price, and the money doesn't vanish, it goes to the friends who showed up. The whole video speaks in the app's own deadpan-banking voice (a push notification, a weekly tally, a payout card), never in hype language. It is Spanish, in the app's own Colombian register, because that is the app's real copy.

## Hook (first 2-3 seconds)
A push notification drops onto the dark screen: **Gym Buddies · "No olvides tu check-in"** (the real 18:00 reminder copy). Then the two-line hook slams in and holds: **"Faltas al gym."** → **"Tus amigos cobran."** The notification is the visual hook: everyone recognizes the dread of a reminder that costs money.

## Key moments (the middle)
- **The proof:** the check-in screen. "📍 Ubicación lista" pill turns on, a shutter tap, then the step pills flip to "1. Foto Inicial ✓" and the resolve line "Ya hiciste check-in hoy ✓". Caption: "Foto desde la cámara. Nada de galería."
- **Friends react:** the check-in photo gets the app's three fixed reactions (💪🏼 🔥 🫃). Caption: "Tus amigos ven tu foto. Y reaccionan."
- **Rules by vote:** "Votación de reglas en curso" → "Cambio de reglas aprobado". Caption: "Las reglas las votan todos."
- **Monday's tally:** three member rows arrive one by one with their week result. Two are on quota, one missed and gets a red charge. Caption: "Cada lunes se hace la cuenta."
- **"Reparto de hoy":** the payout card ranks members with a 🏆 on the podium, and the missed-days money counts up into the winners' amounts. Caption: "Lo que pierde uno, lo reparten los demás."

## Outro / punchline
Logo + name **Gym Buddies** in the app's green on the dark background, a two-line sign-off that reads as one phrase: **"Ve al gym" / "Con tus amigos"**. Last hit lands on the strong beat at 28.92s.

## User flow worth showing
1. **Entry:** the 18:00 reminder push -> open the camera screen.
2. **Key action:** take the check-in photo (location lock -> shutter -> "1. Foto Inicial ✓").
3. **Result:** the week is settled on Monday: a miss costs money, and "Reparto de hoy" shows where that money goes.

## Tone
- Preset: default
- Creative direction: el banco de tus amigos: deadpan, cada falta tiene precio
- Interpretation: playful but understated. Push notifications and payout rows carry the joke; nothing shouts. Comfortable holds, snappy entrances (0.3-0.6s), no hype words, no generic SaaS language.

## Format: vertical — 1080x1920
(The product is a phone app, so vertical gives the largest, most legible phone UI and fits Reels/TikTok/Stories/Play Store previews. Landscape is one flag away with `--format landscape`.)
## Duration: 30 seconds (extended from the original 21s at the user's request; the skill's default is 15-25s)

## Visual identity (from the project)
Source: `src/constants/theme.ts`
- Background: #0B0F14
- Surface / cards: #161C24 (alt #1F2733, border #2A3441)
- Accent: #3DDC97 (primary green; text on green: #04140D)
- Text: #F5F7FA (muted #9AA7B5)
- Penalty / danger: #FF6B6B (warning #FFB454)
- Display font: system UI sans (no custom fonts in the app). Use Inter or an equivalent clean sans, bold 700 for headings.
- Body font: same family, regular 400
- Strongest visual element: the dark UI with the mint-green accent: the check-in step pills, the leaderboard/"Reparto de hoy" rows with the 🏆, and the reaction emoji 💪🏼 🔥 🫃. App icon: `assets/icon.png` (notification) and `assets/icon-header.png` (outro logo).

## Share copy (draft)
Faltas al gym y tus amigos te cobran. Literal. Gym Buddies, la app donde la plata te lleva al gym.

## Audio direction
- Role: warm business-beat bed with sparse, motion-matched accents
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (1:57, ~110 BPM, first beat at 0.56s; chosen by the user instead of vol-10)
- Music treatment: start at 0s, low-to-medium bed under everything, slight duck under the notification hook, fade out over the last ~1.2s after the final hit
- Music cue guidance: preset read from `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.md`. Strong cues locked (vol-12): **8.74** (Scene 3 in), **9.29** ("Y reaccionan."), **10.93** (first reaction chip), **13.11 / 13.64** (Scene 4 in / rule card), **15.84** (rules vote approved), **17.47** (Scene 5 in), **18.56 / 19.66** (member rows a and b), **22.37 / 22.93** (Scene 6 in / payout card), **24.56** (Reparto de hoy amounts land), **26.74** (logo slam), **27.30** (brand name). This track has no strong cues before 8.74, so the hook and check-in scenes lock to the plain beat grid: notification 0.56, line 1 1.10, line 2 2.19, slam 2.73, shutter tap 6.01, captions 6.56 / 7.10 / 7.65. Beat grid also drives: reaction chips 10.93 / 11.46 / 12.02, member rows 18.56 / 19.66 / 20.75, closing line 28.92 (about 1.09s apart, so each row can hold its full read time). Use cues as optional hints only; readability comes first.
- Audio-reactive treatment: subtle; a faint glow behind the logo and the winner amount responds to bass, nothing else
- SFX posture: sparse; motion-matched, professional restraint
- Audio-coupled moments: notification drop, shutter tap, step pills ticking on, member rows arriving one by one, money counter ticks, final logo hit
- Restraint rule: no comedic stingers or cash-register cliches; the humor is in the copy, not the sound

## Storyboard

### Scene 1 — Hook — 4.38s (0.0-4.38)
Dark #0B0F14 screen. A push-notification card slides in from the top: "Gym Buddies · No olvides tu check-in". Then the hook lines slam in and hold: "Faltas al gym." (settled by ~1.4s), then "Tus amigos cobran." (settled by ~2.3s, held to the cut). Total words 6, hold floor respected (about 1.8s reading time for the pair, held about 1.7s after the last entrance plus entrance).
Sequential/interaction: yes: notification first, then line 1, then line 2, one by one (about 0.9s apart).
Audio intent: a soft notification "ding" then a low tonal hit as line 2 lands.
Audio-coupled idea: notification drop; line 2 lands on the beat at 2.46s.
Music: warm upbeat bed enters on 0.27s.
Transition mood: clean → Scene 2 (quick wipe up)

### Scene 2 — La prueba — 4.36s (4.38-8.74)
Vertical phone frame recreating the check-in screen with the app's real UI, using the user's own gym photo (`assets/Foto.jpeg`, cropped) as the camera viewfinder: the "📍 Ubicación lista" pill lights up, a cursor/finger taps the shutter, a photo frame flashes and the step pills read "1. Foto Inicial ✓" and "2. Foto Final". Caption below: "Foto desde la cámara. Nada de galería." (7 words, hold about 2.1s). Resolve micro-line: "Ya hiciste check-in hoy ✓" (0.8s settled).
Sequential/interaction: yes: simulated tap on the shutter, then the pills tick on one by one.
Audio intent: tactile and satisfying; the moment feels "verified."
Audio-coupled idea: shutter click on the tap; a small tick as "Foto Inicial ✓" appears.
Music: bed continues, mild lift.
Transition mood: clean → Scene 3 (slide)

### Scene 3 — Reacciones — 4.37s (8.74-13.11)
Title "Tus amigos ven tu foto. / Y reaccionan." Then a dashboard-style card: the viewer's own check-in (header "Tú", "Hoy · 18:02", "Foto Inicial" tag), showing the same real gym photo with the GPS/time watermark, and a reaction bar with the app's three fixed emoji: 💪🏼 2, 🔥 3, 🫃 1 (one reaction per person per check-in, per the README).
Sequential/interaction: yes: the three reaction chips pop in one by one on the beat grid (10.93, 11.46, 12.02); they are non-text accents, so every beat is fine.
Audio intent: light, social, a little cheeky.
Audio-coupled idea: a soft click per chip as it lands.
Music: bed steady.
Transition mood: soft crossfade → Scene 4

### Scene 4 — Votación de reglas — 4.36s (13.11-17.47)
Title "Las reglas las votan todos." A rule-vote card using the app's real copy: "Votación de reglas en curso 🗳️", the field "Días mínimos por semana" changing 3 → 4, and three voters. Santi votes "✓ A favor" (14.73), Vale votes "✓ A favor" (15.29), and the majority (2 of 3) is reached, so the header flips to "Cambio de reglas aprobado ✓" on the strong cue at 15.84s (the app resolves a vote early the moment a majority is forced). Juan stays "Pendiente". Closing line: "Se aplica el próximo lunes." (the default effective date), which sets up Scene 5's "Mínimo 4 días".
Sequential/interaction: yes: votes flip one by one, then the approval lands on the cue.
Audio intent: procedural and satisfying; the approval is the payoff.
Audio-coupled idea: a click per vote, a soft bell accent on approval at 15.84s.
Music: bed steady.
Transition mood: slide → Scene 5

### Scene 5 — La cuenta del lunes — 4.9s (17.47-22.37)
Title line "Cada lunes se hace la cuenta." enters and settles (6 words, about 1.8s hold). Then three member rows arrive one by one in a dark card: two members with a green ✓ and on-quota result, one with the missed days and a red charge (e.g. "−$60.000", an illustrative example of a group's `penalty_amount` × missed days). Member names are illustrative placeholders. Each row holds at least 0.8s settled, and the full set holds on screen through the end of the scene.
Sequential/interaction: yes: three rows appear one by one on the every-other-beat grid (18.56, 19.66, 20.75).
Audio intent: dry, accountant-like; the red row gets a slightly lower, heavier accent.
Audio-coupled idea: card-place sound per row, beat-aligned.
Music: bed steady, slightly ducked under the row accents.
Transition mood: clean → Scene 6 (soft crossfade)

### Scene 6 — Reparto de hoy — 4.37s (22.37-26.74)
The "Reparto de hoy" card from the wallet screen: members ranked by amount with a 🏆 next to the podium places. The penalty money counts up into the winners' amounts, landing on the strong cue at 24.56s. Caption: "Lo que pierde uno, lo reparten los demás." (7 words, hold about 2.1s after it settles).
Sequential/interaction: yes: rows appear top-down, then the amounts count up (a counter simulation).
Audio intent: payoff, bright, a little smug.
Audio-coupled idea: subtle counter ticks, one accent as the winner amount lands at 24.56s.
Music: bed at full presence.
Transition mood: dramatic-lite → Scene 7 (hard cut on the beat at 26.74s)

### Scene 7 — Outro — 3.26s (26.74-30.0)
App icon + "Gym Buddies" in #3DDC97 on #0B0F14. Sign-off lines: "Ve al gym" then "Con tus amigos" (5 words in two lines; the second lands on 28.92s and holds about 1.1s). Final hit at 28.92s, then about 1.1s of calm before the end.
Sequential/interaction: none.
Audio intent: confident, clean landing.
Audio-coupled idea: logo hit on 26.74s, tagline confirm on 28.92s.
Music: final chord then fade out.
Transition mood: end

**Music mood for this video:** upbeat business bed (deadpan-friendly)
**Audio summary:** A warm business-beat bed under sparse, motion-matched accents (notification, shutter, card placements, counter ticks) that builds to a clean logo hit and fades out.
