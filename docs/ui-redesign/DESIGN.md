# Stride — "Afterglow" design system

Paste this into the Stitch project's design system (DESIGN.md) before generating screens. Stitch sends it
with every prompt, so every screen inherits the same rules.

## Product

Stride is a private, offline-first walking and running tracker for Android phones. There is no account,
no cloud, no social feed and no ads: GPS routes, statistics, goals and achievements live only on the
phone. Audience: Gen Z and young millennials who walk or run most days and care about privacy.
Units are metric: km, pace in min/km ("11:55 /km"), speed in km/h.

## Concept: Afterglow

Every walk leaves a trail of light. Routes are drawn like long-exposure light painting: a glowing line
on a dark, quiet map. The UI is dark-first, editorial and bold: oversized numbers, a bento grid, pill
and circle shapes, frosted glass over maps, and holographic stickers for achievements. Energetic, but
calm while you move; honest about GPS; privacy is presented as a feature.

## Colors

Dark theme (default):

- background `#0A0B0F` (ink)
- surface `#14161C`, surface-raised `#1C1F27`, outline `#2A2E38` (1 dp hairlines)
- text-primary `#F5F6FA`, text-secondary `#A4A9B8`, text-muted `#7D8295`
- volt `#C6FF3D`: brand colour, primary action and progress on a screen, success; text on volt is ink `#0A0B0F`
- ion `#46C8FF`: walking (always)
- ember `#FF6B3D`: running (always)
- amber `#FFC94D`: warnings
- signal-red `#FF4D6A`: errors and destructive actions
- holo gradient `#FFB8F2 → #A5F3FF → #FFF3A6` (45°): unlocked achievements only
- glow: the element's colour at 40 % opacity, 24 dp blur, used only on live or active elements

Light theme ("Daylight"):

- background `#F5F4EF`, surface `#FFFFFF`, surface-raised `#ECEAE3`, outline `#DCD9CF`
- text-primary `#0A0B0F`, text-secondary `#4E5263`, text-muted `#646878`
- volt stays `#C6FF3D` as a fill with ink text; volt used as text or icons is `#4A6B00`
- ion `#0A72C2`, ember `#C2410C`, amber `#9A5B00`, signal-red `#C8243F`

Rules: walk is always ion and run is always ember, never swapped. Volt marks the one most important
action or progress element per screen. Never put volt text on white. Body text contrast is at least
4.5:1, and colour is never the only signal (pair it with an icon or label).

## Typography

- Display (screen titles, section heroes): **Unbounded** 600–700, letter-spacing −2 %.
  Title 32/36, section 20/24.
- Numbers (every metric, timer and distance): **Space Grotesk** 700 with tabular figures.
  Hero 88/88 (live distance), large 48/52, medium 28/32, small 18/22. Units in Inter 500 at about
  40 % of the number size, text-secondary, baseline-aligned ("2.37 km").
- Body and UI: **Inter** 400/500/600. Body 16/24, caption 13/18, label 12/16 uppercase, +6 % tracking.
- Diagnostics only: **JetBrains Mono** for values.

## Shape and spacing

- 4 dp grid. Screen side padding 20 dp, gaps 12 dp, card padding 20 dp.
- Radius: cards 28 dp, tiles 24 dp, map frames 32 dp, bottom sheets 32 dp (top corners), inputs 16 dp,
  buttons and chips fully rounded (pill).
- No drop shadows on dark: separate layers with surface colours and hairline outlines. Soft coloured
  glow only for live or active elements.
- 3 % film grain on gradient surfaces.
- Touch targets at least 48 dp; workout controls 64 dp.

## Components

- **Floating nav bar**: a glass pill (surface at 72 % + 24 dp blur) floating 12 dp above the gesture
  bar. Order: Home, History, Track (centre), Stats, Settings. Track is a raised 64 dp volt circle; while
  a workout is running it shows a pulsing ring and the elapsed time. Hidden on live workout screens.
- **Start orb**: 136 dp circle filled with the activity colour (ion for walk, ember for run), ink icon
  and label ("Start walk"), 40 % glow.
- **Buttons**: pill, 56 dp (64 dp on workout screens). Primary = volt fill + ink text; secondary =
  surface-raised fill; ghost = text only; destructive = signal-red text or outline.
- **Metric tile**: uppercase label, big number, unit, optional delta chip (`▲ 23 %` in volt,
  `▼ 8 %` in text-secondary).
- **Bento grid**: 2 columns; tiles span 1×1, 2×1 or 1×2; mixed sizes; at most 6 tiles per screen.
- **Activity card**: 72 dp square "light-painting" thumbnail (the route glowing on ink), activity chip
  (ion Walk / ember Run), relative date and time, big distance, duration · pace.
- **Nudge card** (banner): compact; icon + title + one line + text action; tones info (ion), warning
  (amber), error (signal-red). Show one at a time; collapse the rest into "+2 more".
- **Chips and segmented toggles**: pill; selected = volt fill + ink text.
- **Achievement sticker**: die-cut badge with a 3 dp white outline. Unlocked = holo gradient foil,
  slight tilt, unlock date. Locked = dark silhouette, dashed outline, small lock, requirement text.
- **Charts**: rounded bars (6 dp radius), walk (ion) stacked under run (ember), today or the current
  period highlighted with glow, no gridlines, baseline only, small labels.
- **Map**: monochrome street map (dark in dark theme). Routes are glowing 6 dp lines in the activity
  colour with a faint wide halo; start = small ring, finish = checkered pin, live position = pulsing dot
  with a translucent accuracy circle; GPS gaps = dotted grey line. Round glass map buttons (recenter,
  show whole route) at the top right; attribution "ⓘ" bottom left.
- **Bottom sheet**: surface-raised, 32 dp top corners, grab handle, used for confirmations.
- **Icons**: Material Symbols Rounded, weight 500, filled when active.

## Voice

Short, warm, confident, a little playful; sentence case. No exclamation marks except celebrations;
emoji only in celebration moments. Always honest about GPS ("GPS good ±5 m", "GPS signal lost").
Privacy is a feature: "On this phone only", "No account. No cloud."

## Never include

Login or sign-up, profile photos or avatars, followers, feeds, leaderboards, ads, cloud sync, calories,
heart rate, steps, elevation, weather, music controls, or any metric not listed in the prompts.
