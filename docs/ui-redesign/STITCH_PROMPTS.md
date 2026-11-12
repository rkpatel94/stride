# Stride UI redesign: Google Stitch prompt pack

A screen-by-screen analysis of the current app and a set of prompts for
[Google Stitch](https://stitch.withgoogle.com) that redesign every screen in one new visual language,
"Afterglow". The design system lives in [`DESIGN.md`](DESIGN.md) next to this file.

Contents:

1. [Screen analysis](#1-screen-analysis)
2. [Design direction: Afterglow](#2-design-direction-afterglow)
3. [How to run this in Stitch](#3-how-to-run-this-in-stitch)
4. [Prompts](#4-prompts)
5. [Refinement prompts and prototype flows](#5-refinement-prompts-and-prototype-flows)
6. [Notes for implementing the result](#6-notes-for-implementing-the-result)

## 1. Screen analysis

### Inventory

Everything the redesign has to cover. All of it is in the app today; the prompts only change how it looks.

| # | Screen | Purpose | Content and states to keep |
|---|--------|---------|----------------------------|
| 1 | Launch / data error | Opens the on-device database | "Opening your activity log…"; "Could not open your data" + Try again (activities are not deleted) |
| 2 | Home (tab) | Today at a glance, quick start | Date header; workout-in-progress or "interrupted" banner → Open tracker; Start walking / Start running (disabled during a workout); daily goal progress split walk/run + Edit; walking, running, total today; streak (current, longest, "be active today to keep it going"); this week and this month (km + count); all activities (count, lifetime km, active time); 3 recent activities + See all; records (longest distance, fastest pace ≥ 1 km, longest duration, longest streak); last 4 achievements; empty states |
| 3 | Track: ready | Choose walk/run, check GPS, start | Walk/Run toggle; banners: module missing, permission needed, precise location off, location off, battery saver limits GPS, battery-optimisation tip, location error; GPS badge (Searching, good, fair, weak, lost, off) with ±accuracy; live map of the current position; Start button; "Could not start" error; screen-locked footnote |
| 4 | Track: preparing | Wait for a fix of ±20 m or better | Current accuracy vs needed; "stand still outdoors" tip; longer-than-usual hint after 45 s; Cancel; Start anyway (enabled after 10 s) |
| 5 | Track: live | Record the workout | State (Preparing, Recording, Paused, Recovering, Saving); GPS badge; banners (interrupted + reason, location off + Turn on, GPS signal lost, battery low, error); map following the position with recenter and show-whole-route; distance; active and elapsed time; current and average pace; current and average speed; GPS accuracy and points used/filtered; controls per state (Pause/Finish, Resume/Finish, Resume/Save, Saving…); Discard when paused or recovering; confirmations for finish, very short workout and discard |
| 6 | Activity detail | Review, replay, edit or delete one activity | Completion card (Saved · distance, or Daily goal reached, plus unlocked achievements); still-in-progress banner; map fitted to the route with start/finish, replay trail and marker, offline route sketch when tiles can't load; replay (progress, time · distance, GPS-gap notice, Play/Pause/Resume, Restart, Stop, 1×–60× speed); type + Change type; distance, active/elapsed time, average pace/speed, started/finished; GPS quality (rating, fixes recorded, used, % within 10 m, gaps, notes, filtered counts); Delete |
| 7 | History (tab) | Browse and filter past activities | All / Walks / Runs; All time, This week, This month, Last 30 days, This year; count · total distance; activity cards with route thumbnails; delete with confirmation; empty and no-match states |
| 8 | Statistics (tab) | Trends and records | This week / This month; total with comparison to the previous period; per-day walk/run bars; walking and running (km, count), active time, average pace, activities, previous period; 12-week trend; records (longest activity →, fastest pace →, best week, best month, lifetime distance and active time, current and longest streak); counting-rules note; empty state |
| 9 | Goals & achievements | Daily goal and milestones | Goal on/off; km input + Save + validation error; today's progress; last 28 days; total days reached; 9 achievements (locked, or unlocked with date; tap opens the activity) |
| 10 | Settings (tab) | Preferences, permissions, data | Goals link; keep screen on; week starts Monday/Sunday; status rows with actions (location permission, location services, notification, battery optimisation) and battery-saver note; export / import backup; privacy text; Diagnostics link; version |
| 11 | Diagnostics | Troubleshooting | Database counts + integrity check; tracking-service state; device facts; GPS filter thresholds |
| 12 | Outside the app | (Not designed in Stitch; keep consistent) | Ongoing notification "Walking · paused" / "2.37 km · GPS ±5 m" with Pause/Resume and Finish; "Recording stopped" alert; Android permission prompts |

### What holds the current UI back

- **No identity.** System font, a generic green/blue/orange palette and flat cards; dark mode is an
  inverted light mode. Nothing looks like Stride.
- **Flat hierarchy on Home.** Start buttons, goal, seven same-sized "km" tiles, records and achievements
  form one long stack, with no hero element.
- **Banner pile-up on Track.** Up to five banners can stack above the map and push Start below the fold.
- **Live screen built like a form.** A small 260 dp map, seven metrics at similar weight, always-visible
  debug text ("points used, filtered"), and Pause next to Finish with only a dialog in between.
- **Activity detail order.** Replay comes before the numbers, the technical GPS-quality card is always
  open, and a full-width red Delete closes the screen.
- **History.** Delete hides behind a long-press, there is no grouping, and the route thumbnails are thin
  plain lines.
- **Statistics and Goals.** Repeated tile patterns; records buried in a long list; the comparison is a
  sentence; the goal calendar is numbered squares; achievements are plain rows with no sense of reward.
- **No moments.** No celebration, motion or anything worth screenshotting.

### Keep

Honest GPS states with accuracy, plain-language privacy explanations, large touch targets, consistent
walk/run colours, clear empty and error states, and screen-reader labels.

## 2. Design direction: Afterglow

> Every walk leaves a trail of light.

- **Light-painting routes.** Routes glow like long-exposure photos on a dark, quiet map, so History
  becomes a gallery of your trails.
- **Bento-grid Home** with one hero, a daily-goal ring split into walking and running.
- **Expressive type.** A wide display face (Unbounded) for titles and oversized tabular numbers
  (Space Grotesk) for every metric.
- **Map-first live screen** with a frosted-glass HUD, no tab bar while moving, and hold-to-finish so a
  pocket tap can't end a workout.
- **Floating glass nav pill** whose centre Track orb turns into a live timer during a workout.
- **Holographic die-cut stickers** for achievements and a GitHub-style streak heatmap: reward you can
  see.
- **Privacy as a feature.** An "On this phone only" chip; no avatars, feeds or accounts anywhere.
- **Palette.** Volt lime (brand and progress), ion blue (walking) and ember orange (running) on ink.
  "Daylight" light theme, plus a high-contrast "Sunlight" mode for the live screen.

## 3. How to run this in Stitch

1. Create a new **mobile app** project in Stitch.
2. Open the project's design system and paste [`DESIGN.md`](DESIGN.md). (If your Stitch version has no
   design-system panel, paste the file's contents above Prompt 1.)
3. Run the prompts below **in order, one per generation**. None asks for more than three screens:
   users report weaker or skipped screens when Stitch is asked for more at once.
4. After each generation, fix what's off with short follow-ups, one change per prompt (for example,
   "Make the Finish button's hold ring thicker"), before moving on.
5. Generate the light theme and Sunlight variants with the refinement prompts.
6. Link the screens with Prototypes using the flows in section 5.
7. Export to Figma for handoff. Stitch's code export is web HTML/React, so use it as a visual reference:
   Stride is React Native.

## 4. Prompts

### Prompt 1: concept and Home

This one restates the key style rules, so it also works on its own as a quick first try.

```text
Design the Home screen of "Stride", a private walking & running tracker for Android phones (no account, no cloud, everything stays on the phone). Use the project's DESIGN.md "Afterglow" system: dark-first ink background, volt #C6FF3D for the main action and progress, ion #46C8FF = walking, ember #FF6B3D = running, Unbounded titles, Space Grotesk numbers, Inter body, 28 dp rounded cards, bento grid, glowing light-trail accents. Vibe: energetic Gen-Z sports zine — bold, playful, premium, never cluttered.

Top to bottom:
1. Header: "Today" (Unbounded 32) with "Saturday, 24 October" underneath; small chip at the right: lock icon + "On this phone only".
2. Two big pill buttons side by side: "Start walk" (ion) and "Start run" (ember), each with its icon.
3. Bento grid:
 - Wide hero tile "Daily goal": a ring at 68 % split into an ion arc (walking 3.42 km) and an ember arc (running 0 km); centre "3.42 / 5 km"; caption "1.58 km to go"; small "Edit" text button.
 - "Streak": flame icon, "6 days", caption "Longest 14".
 - "This week": "18.6 km", chip "▲ 23 %", 7-bar mini chart Mon–Sun with Saturday glowing.
 - "This month": "61.3 km", caption "17 activities".
 - Wide "Lifetime" tile: "742.5 km · 128 activities · 98 h active" over a faint collage of glowing route lines.
4. Section "Recent" with "See all": three activity cards with light-painting route thumbnails:
 Walk · Today 7:42 AM · 3.42 km · 41:05 · 12:01 /km
 Run · Yesterday 6:15 PM · 5.08 km · 28:44 · 5:39 /km
 Walk · Thu 12:30 PM · 2.16 km · 26:08 · 12:06 /km
5. Section "Records & stickers" with "View all": a horizontal row of record chips (Longest 12.4 km · Fastest 5:12 /km · Longest 1 h 52 m · Best streak 14 days) and a row of four holographic stickers (First 5K, Seven-day streak, Goal reached, Personal best).

Floating glass nav pill at the bottom: Home (active), History, centre Track orb in volt, Stats, Settings.
No avatars, no social features, no calories, heart rate or steps.
```

### Prompt 2: Track, ready and locking GPS

```text
Using the same design system, create two screens for the Track tab before a workout starts (dark theme).

Screen 1 "Ready":
- A monochrome dark street map fills the top 55 % of the screen (32 dp rounded bottom corners), centred on a pulsing ion position dot with a translucent accuracy circle; round glass "recenter" button at the top right; "ⓘ" map attribution at the bottom left.
- Floating over the map, top left: GPS chip "GPS good ±5 m" with a volt dot.
- Below the map: pill segmented toggle "Walk | Run" (Walk selected, ion).
- One collapsed nudge card (info tone, one line): "Improve background reliability" with a "Battery settings" text action.
- Centred, a huge circular Start orb (136 dp) in ion with a soft glow: walking icon + "Start walk".
- Muted footnote: "Keeps recording with the screen locked. A notification shows while you move."
- Floating nav pill with the centre Track orb active.

Screen 2 "Locking GPS" (after tapping Start):
- Same map, dimmed, with radar rings pulsing out of the position dot.
- Bottom sheet: title "Locking GPS…"; a horizontal accuracy gauge showing "±34 m now" with a target notch at "±20 m"; helper text "Stand still outdoors with a clear view of the sky."; buttons "Cancel" (secondary) and "Start anyway" (disabled, caption "available in 6 s").
```

### Prompt 3: live workout (recording, paused, finish)

```text
Create three live-workout screens. They are used outdoors while moving: huge numbers, one-hand reach, 64 dp controls, and no nav bar (immersive).

Screen 1 "Recording" (walk):
- The map fills the top 45 %: monochrome dark map, the route as a glowing ion line from a small start ring to a pulsing position dot with a faint accuracy halo; round glass buttons "show whole route" and "recenter" at the top right.
- Chips floating on the map: "● REC" (pulsing volt dot) at the top left, "GPS good ±5 m" at the top right.
- Frosted-glass HUD sheet below (32 dp top corners): hero distance "2.37" in Space Grotesk 96 + "km"; 2×2 grid: Active time 28:14 · Elapsed 29:02 · Pace now 11:42 /km · Avg pace 11:55 /km; a slim row "Speed 5.1 km/h · Avg 5.0 km/h"; a collapsed row "GPS details" (1,661 fixes used · 37 filtered).
- Controls at the bottom: "Pause" (secondary pill, 64 dp) and "Finish" (volt pill) with a circular hold-to-finish progress ring and the hint "Hold to finish".

Screen 2 "Paused": same layout, map desaturated, amber "PAUSED" chip instead of REC; active time frozen at 28:30 while elapsed keeps counting; controls "Resume" (volt, 64 dp) and "Finish" (secondary); ghost signal-red "Discard workout" below.

Screen 3 "Finish and save?": bottom sheet over the paused screen with the summary "2.41 km · 28:30 active · 11:50 /km", primary "Save workout" (volt), secondary "Keep going", ghost signal-red "Discard".
```

### Prompt 4: live workout edge states

```text
Create three edge-state variants of the "Recording" screen, keeping its map, HUD, typography and controls:

1. "GPS signal lost": the route ends in a dotted grey segment; GPS chip "GPS lost" with a crossed-out target icon; an amber nudge pinned to the top of the HUD: "GPS signal lost — distance resumes when the signal returns. The route may show a gap here."
2. "Location turned off": signal-red nudge "Location is turned off — distance isn't being recorded until it's back on" with a "Turn on" action; metrics dimmed to 50 %.
3. "Recovering": state chip "RECOVERING" in signal-red; warning card "Recording was interrupted. Android stopped Stride in the background. Resuming starts a new route segment — nothing is drawn across the gap."; the map shows the route recorded so far; controls "Resume" (volt) and "Save" (secondary), ghost "Discard workout".
```

### Prompt 5: activity detail

```text
Design the Activity detail screen as it appears right after finishing a run (scrollable, dark theme). Ember is the accent on this screen because it is a run.

- Top app bar: back arrow, title "Run · Fri 23 Oct", overflow menu (Change to walk, Delete activity).
- Celebration card: subtle confetti, "Daily goal reached 🎉", and a newly unlocked holographic sticker "First 5K — Cover 5 km in a single activity"; dismiss ×.
- Hero map card (300 dp, 32 dp corners): the whole route fitted, a glowing ember line with a pace gradient (slower = deep red, faster = bright orange), small start ring, checkered finish pin. Replay controls in a glass bar over the bottom of the map: play/pause button, scrubber at 22 % with "1:04 · 189 m", speed chips 1× 2× 5× 10× 30× 60× (10× selected), restart icon.
- Stats: hero "5.08 km"; grid Active time 28:44 · Elapsed 30:02 · Avg pace 5:39 /km · Avg speed 10.6 km/h · Started 6:15 PM · Finished 6:45 PM.
- "GPS quality" card, collapsed: "Good signal" with a volt check and a chevron; show the expanded rows faintly: Fixes recorded 1,802 · Used for distance 1,640 · Within 10 m 96 % · GPS gaps None.
- A quiet signal-red text button "Delete activity" at the very bottom.
```

### Prompt 6: History

```text
Design the History tab (dark theme) and its no-results state.

Screen 1:
- Title "History"; pill segmented control "All | Walks | Runs"; a horizontally scrolling chip row "All time · This week · This month · Last 30 days · This year" with "This month" selected (volt).
- Summary line: "17 activities · 61.3 km".
- List grouped by week with sticky week headers showing the weekly total ("This week · 18.6 km", "12–18 Oct · 21.4 km").
- Each item is an activity card: 72 dp square light-painting thumbnail (the route glowing on ink), activity chip (ion Walk / ember Run), "Today · 7:42 AM", large distance "3.42 km", "41:05 · 12:01 /km".
- Show one card mid-swipe revealing a signal-red "Delete" action.
- Floating nav pill with History active.

Screen 2: filters set to "Runs" and "This week", with an empty state: a dotted glowing trail ending in a question mark, title "Nothing matches these filters", text "Try a different type or date range.", secondary button "Clear filters".
```

### Prompt 7: Stats

```text
Design the Stats tab in two states (dark theme).

Screen 1 "This week":
- Title "Stats"; pill toggle "This week | This month".
- Hero card: label "DISTANCE THIS WEEK", "18.6 km" in Space Grotesk 72, chip "▲ 23 % vs last week (15.1 km)", stacked bar chart Mon–Sun (ion walking at the bottom, ember running on top), Saturday glowing.
- Bento tiles: Walking 13.5 km · 4 walks (ion) · Running 5.1 km · 1 run (ember) · Active time 3 h 11 m · Avg pace 10:16 /km · Activities 5 · Last week 15.1 km.
- Card "12-week trend": smooth glowing area chart of weekly totals, labels every third week.
- "Records" as a trophy shelf of compact rows with icons: Longest activity 12.4 km › · Fastest avg pace (≥ 1 km) 5:12 /km › · Best week 31.2 km · 6 Jul · Best month 98.4 km · Aug 2026 · Lifetime 742.5 km · Lifetime active 98 h · Current streak 6 days · Longest streak 14 days.
- Muted footnote: "Weeks start on Monday. Streaks, records and pace include activities of at least 100 m and 1 minute."
- Floating nav pill with Stats active.

Screen 2 "This month": same layout; 31 thin day bars labelled every 5th day; hero "61.3 km" with "▼ 8 % vs September (66.6 km)".
```

### Prompt 8: Goals and achievements

```text
Design "Goals & stickers", a pushed screen with a back arrow (dark theme), plus one bottom sheet.

Screen 1:
- Goal card: switch "Track a daily goal" (on); big editable number "5" + "km" with − / + steppers and a "Save" pill; ring for today "3.42 / 5 km" (ion walking arc, ember running arc); caption "Changes apply from today. Past days keep the goal they had."
- "Last 4 weeks": 4 × 7 heatmap of rounded day cells (Mon–Sun columns), goal-reached days glowing volt, missed days surface-raised, today outlined; caption "Goal reached on 23 days in total."
- "Stickers": 3-column grid of nine achievement stickers — First steps, First kilometer, First 5K, First 10K, 25 km week, 100 km month, Goal reached, Seven-day streak, Personal best. Six unlocked (holographic foil, slight tilt, date such as "12 Oct"), three locked (dark silhouette, dashed outline, lock, and the requirement such as "Cover 10 km in a single activity").

Screen 2: bottom sheet for the "First 5K" sticker: large tilted holographic sticker, "Unlocked 12 Oct 2026 on a 5.08 km run", primary button "View activity".
```

### Prompt 9: Settings and Diagnostics

```text
Design Settings and Diagnostics (dark theme).

Screen 1 "Settings":
- Title "Settings". Hero privacy card: lock icon, "Your data lives on this phone", "No account · no cloud · no analytics".
- Grouped rounded cards with rows:
 - Goals: "Daily goal & stickers" ›
 - Tracking: switch "Keep screen on while tracking" with helper "Not needed — recording continues with the screen locked. Uses more battery."; segmented "Week starts on: Monday | Sunday".
 - Permissions & device: status rows with a coloured status dot and inline pill actions — Location permission "Precise" (volt dot) · Location services "On" · Tracking notification "Allowed" · Battery optimisation "Optimised" (amber dot) with a "Settings" pill; muted note "Stride only uses location while in use — 'Allow all the time' isn't needed."
 - Your data: "Export backup" and "Import backup" pills; note "Uninstalling deletes your data — export a backup to keep a copy."
 - Maps: "Free OpenFreeMap tiles. Only the map area is downloaded; your GPS track never leaves the phone."
 - About: "Diagnostics" ›; footer "Stride 1.0.0".
- Floating nav pill with Settings active.

Screen 2 "Diagnostics" (pushed, back arrow) in a "nerd mode" style: JetBrains Mono values, ink cards, small volt accents. Sections: Database (Schema version 1 · Completed activities 128 · Stored GPS measurements 214,880 · Unfinished sessions 0 · button "Run integrity check" → "ok"), Tracking service (Session none · Service running no · Location source fused · Unprocessed fixes 0), Device (Android API 37 · Google Play services available · GPS on · Network location on · Battery 82 % · Battery saver off · Background location not granted (not needed)), GPS filter thresholds (key–value rows).
```

### Prompt 10: system states

```text
Create three system screens in the same style:

1. Launch: ink background, the word "Stride" in Unbounded with a glowing volt trail looping around it, caption "Opening your activity log…".
2. Can't open data: illustration of a broken glowing trail, title "Couldn't open your data", text "Your activities haven't been deleted. Try again — if this keeps happening, export a backup from Settings once the app opens.", primary "Try again".
3. Home during a workout: the Home screen with both start buttons disabled and a live mini-player bar above the nav pill: pulsing ion dot, "Walk in progress · 1.24 km · 14:08", button "Open". The centre Track orb shows a pulsing ring and "14:08".
```

### Prompt 11: first run

```text
Create two first-run screens in the same style:

1. Home with no activities yet: header "Today", the two start buttons, an onboarding card "Your first trail starts here" with three icon rows (Precise GPS while you move · Keeps recording with the screen locked · Everything stays on this phone), a "Set a daily goal" card with a "Set goal" pill, and an empty "Recent" area: "No activities yet — your routes will glow here."
2. Stats with no data: a faint ghosted chart and "No stats yet — finish your first walk or run to see weekly and monthly trends."
```

## 5. Refinement prompts and prototype flows

Use these after the main screens exist. Each makes one kind of change.

```text
Create the Daylight (light theme) version of the Home screen using the light colours from DESIGN.md: background #F5F4EF, white cards, ink text, a light street map; volt stays a fill with ink text. Keep the layout identical.
```

(Repeat for each screen, swapping "Home screen" for the screen name.)

```text
Create a "Sunlight" variant of the Recording screen for bright outdoor light: no glass or blur, a solid white HUD, black numbers at 112 sp, 2 dp black outlines, volt only on the Finish button, contrast at least 7:1.
```

```text
Make the nav pill, chips, card radius (28 dp), screen padding (20 dp) and number font identical on every screen. Fix any screen that differs.
```

```text
Remove any calories, heart rate, steps, elevation, weather, avatar or social element from every screen. Stride doesn't track or show them.
```

```text
Check every text against its background for at least 4.5:1 contrast, make all tap targets at least 48 dp (64 dp on workout screens), and add a text label next to every colour-only status.
```

Prototype flows to link:

- Home "Start walk" → Locking GPS → Recording → Paused → Finish sheet → Activity detail
- Home "See all" → History → activity card → Activity detail
- Stats "Longest activity" / "Fastest avg pace" → Activity detail
- Home goal tile "Edit", or Settings "Daily goal & stickers" → Goals & stickers → sticker sheet → Activity detail
- Settings "Diagnostics" → Diagnostics

## 6. Notes for implementing the result

- **The data already exists.** Every number in the prompts is something Stride computes today.
  - **UI-only changes:** weekly grouping in History, the Home week chart, the goal ring, the 28-day heatmap, the sticker grid and the in-progress mini-player.
  - **Changes that need new logic:** the pace-coloured route (pace per segment from the stored points), the Lifetime route collage (loads many route previews), hold-to-finish and the sticker sheet.
- **Navigation.** The app uses expo-router `NativeTabs` (Android's native bottom navigation), which can't float or hold a custom centre button. The floating pill with a Track orb needs expo-router's JavaScript `Tabs` with a custom tab bar. The new order (Home, History, Track, Stats, Settings) also renames "Statistics" to "Stats".
- **Glass blur.** Check `expo-blur`'s Android support in the SDK 58 docs before relying on it. Fallback: surface colour at 90 % opacity.
- **Fonts.** Load Unbounded, Space Grotesk, Inter and JetBrains Mono with `expo-font` and the Google Fonts packages.
- **Glowing routes.** In MapLibre, draw a wide, low-opacity halo line under the 6 dp route line. A pace gradient needs `line-gradient` with line metrics on the GeoJSON source. Dotted gap lines already exist. For exact map colours, use a custom monochrome style JSON instead of OpenFreeMap's stock "dark".
- **Swipe to delete in History** needs a gesture library. `react-native-gesture-handler`'s native build is currently excluded (the Windows path-length workaround in `react-native.config.js`). Until that's revisited, keep long-press and show a context menu.
- **Hold-to-finish** replaces the Finish dialog. The notification's Finish action should still open the app on the finish sheet, so a pocket tap can't end a workout.
- **Charts and graphics.** Stacked bars are drawn by the app's own `DistanceBarChart` with `react-native-svg` (no chart library, to keep the APK small). Rings, stickers and the holographic foil can use `react-native-svg` and `expo-linear-gradient` (both installed).
- **Keep:** the GPS honesty, the privacy copy, 48 / 64 dp touch targets and the accessibility labels.

This prompting approach is based on three sources:

- Google's [Stitch Prompt Guide](https://discuss.ai.google.dev/t/stitch-prompt-guide/83844): start broad, then work screen by screen, with one change per follow-up.
- Stitch's design system and DESIGN.md file ([MindStudio](https://www.mindstudio.ai/blog/what-is-google-stitch-design-md-file)).
- Third-party user reports that results get worse when one prompt asks for more than 2–3 screens.
