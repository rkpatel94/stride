# Stride — personal walking & running tracker (Android)

Stride records outdoor walks and runs with GPS, measures distance from the recorded fixes, shows
the route on a free OpenStreetMap-based map, and keeps history, statistics, daily, weekly and
monthly goals and achievements — all stored on the phone. A workout can switch between walking
and running, pause itself while you stand still, and guide run/walk intervals with voice and
vibration cues; a map shows all your routes and a home-screen widget shows today's distance. No
account, server, cloud database, analytics, subscription or API key.

- **Platform:** Android (minSdk 24, targetSdk 36), React Native 0.88 / Expo SDK 58, TypeScript.
- **Recording:** a Kotlin foreground service (type `location`) using the Fused Location Provider
  (raw GNSS fallback without Google Play services). Recording keeps going with the screen locked.
- **Storage:** Android's built-in SQLite (through the app's own small native module) with
  versioned migrations, plus a small native journal so
  no fix is lost while the JS runtime is not running.
- **Maps:** [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/) (shipped inside the app) in a
  WebView, with free [OpenFreeMap](https://openfreemap.org) vector tiles — no API key, account or
  billing.

## Contents

1. [Verification status](#verification-status)
2. [Quick start](#quick-start)
3. [Maps](#maps)
4. [Workout features](#workout-features)
5. [Run on a phone](#run-on-a-physical-phone)
6. [Release build](#release-build-signed-apk--aab)
7. [Architecture](#architecture)
8. [GPS processing and distance](#gps-processing-and-distance)
9. [Data model](#data-model)
10. [Statistics, goals and achievements](#statistics-goals-and-achievements)
11. [Privacy and data](#privacy-and-data)
12. [Testing](#testing)
13. [Troubleshooting](#troubleshooting)
14. [Project structure](#project-structure)
15. [Known limitations](#known-limitations)

## Verification status

What has been verified, and how — nothing below is claimed beyond what was actually run.

| Area | Evidence |
|------|----------|
| GPS filter, distance, gaps, jumps, drift, pause/resume, duplicates, out-of-order | Unit tests on deterministic synthetic traces (`tests/unit/gpsFilter.test.ts`) |
| Statistics, calendar grouping (incl. midnight), streaks, pace, goals, achievements | Unit tests |
| Start/pause/resume/finish, journal→SQLite exactly-once, JS restart, killed process, crash between commit and ack, orphaned sessions, discard | Integration tests: real SQLite (Node's built-in engine) + a fake native module with the service's semantics (`tests/integration`) |
| Migrations, constraints, cascade delete, achievement idempotency, backup round-trip | Integration tests |
| Native module compiles; debug APK builds | `./gradlew assembleDebug` on Windows (JDK 17, AGP 9.2, Gradle 9.4) |
| Release (R8-minified) APK | `./gradlew assembleRelease` → **11.3 MB** (11,339,961 bytes), arm64-v8a only (79.4 MB before the size work: arm64-v8a + x86_64, MapLibre Native) — see [App size](#app-size). The same code built for x86_64 (11.6 MB) ran on the Android 17 emulator — see [workout features on the emulator](#workout-features-on-the-emulator). The arm64 build itself has not been installed on a phone. Earlier release builds (MapLibre Native) were checked on the emulator: installed over the debug build with data preserved, a walk recorded and finished with the live map, detail-screen map and replay, and one walk with **airplane mode on** |
| End-to-end on Android 17 (API 37) **emulator** | Permission flow, first-fix acquisition, foreground service (`type=location`), live notification, recording with the display off, pause/resume and finish — see [emulator results](#emulator-smoke-test-results) |
| Maps on the **emulator** — with MapLibre Native, before the WebView map | OpenFreeMap tiles load in the Liberty (light) and Dark styles; live route line, start/finish and position markers, accuracy circle; following, panning stops following, recenter, show whole route; detail screen fits the route; replay trail and marker. With no DNS in the emulator the style failed to load and the offline route sketch was shown instead |
| WebView map (MapLibre GL JS) | Unit tests of the page builder and its message protocol (`tests/unit/mapPage.test.ts`). On the Android 17 emulator (x86_64 release build): tiles, the live map following a simulated walk, walk/run colours, the detail map and the all-routes map with tap-to-select. Once, opening the all-routes map while two other maps were open crashed the app inside the WebView itself (`libwebviewchromium.so`, its network thread); maps that show a whole route now open already fitted instead of zooming in from the world view, and 6 further attempts with three maps open did not crash |
| Walk/run parts, auto-pause, intervals, goals, routes map, widget | Unit and integration tests (above), and on the emulator — see [workout features on the emulator](#workout-features-on-the-emulator). Voice cues: the text-to-speech engine bound and no errors were logged; the emulator has no audio check here, so hearing them is **not verified** |
| **Not yet verified** | The WebView map and the SVG bar chart on a phone; spoken interval cues being audible; the widget on launchers other than the emulator's Pixel launcher; the built-in SQLite module on a device (including opening a database written by an earlier expo-sqlite build); the app without Fresco's JPEG transcoder and filter libraries; a physical phone; distance accuracy outdoors; long screen-locked sessions on real hardware; OEM battery killers; map tile caching while offline after a first online view; a signed release build installed on a device; the minSdk 24 device. Use [`docs/FIELD_TESTING.md`](docs/FIELD_TESTING.md). |

### Emulator smoke test results

Debug build on the `Google APIs` x86_64 image (Android 17 / API 37), walking simulated with
`adb emu geo fix` at 1.4 m/s (reported accuracy 5 m, noise-free):

- Start workflow: precise-location prompt → notification prompt → "GPS good ±5 m" → *Recording*.
- `dumpsys`: `TrackingService` `isForeground=true`, `types=0x8` (location), ongoing notification
  "Walking · 22 m · GPS ±5 m" with Pause/Finish actions, updated while the display was off.
- Display off for ~2 minutes: all 178 fixes reached SQLite (journal backlog 0); stored distance
  257.4 m vs 257.4 m between the first and last recorded fix on the straight simulated path, and
  equal to the sum of accepted segments.
- Pause ~45 s while the simulated walker kept moving: active 4:23 vs elapsed 5:08; the first fix
  after resuming starts segment 1 with `starts_new_line=1` and 0 m (the 69 m moved while paused
  is not counted, nothing is drawn across it).
- JS reloaded mid-walk: the engine re-attached to the running native session ("Walk in progress · 642 m").
- Finish: service stopped and notification removed; activity saved with 688.0 m (= sum of
  accepted segments), "First steps" achievement, detail screen and replay from stored points.
- `am crash` during a run: Android restarted the sticky service, which (no background-location
  permission, Android 17) marked the session interrupted and posted "Recording stopped"; reopening
  showed *Recovering* → **Resume** restarted the service with a new segment; downtime excluded from
  active time (0:37 active vs 1:45 elapsed).
- `am force-stop` during the same run: on relaunch the interruption was detected → **Save**
  completed the run (140.8 m, durations frozen at the last heartbeat).
- History list, weekly statistics chart and dashboard reflected the saved activities.

These runs exercise the plumbing only. Emulator fixes have no noise, so they say nothing about
real-world distance accuracy.

### Workout features on the emulator

x86_64 release build on the same Android 17 emulator (fresh install), positions fed with
`adb emu geo fix` once a second:

- Goals screen: weekly goal turned on ("counts for this whole week, from Nov 9"), set to 0.5 km;
  monthly goal on at 100 km. Dashboard then showed the weekly and monthly bars.
- Track screen: auto-pause and a 0:15 run / 0:15 walk × 2 interval plan; "Start intervals"
  started with a run. The interval card counted down ("RUN · ROUND 1 OF 2 … then walk"), the
  service switched the part to walking at 15 s (switch, notification "Walking · round 1 of 2"),
  and "INTERVALS DONE" after 60 s of active time. The text-to-speech engine bound
  (`Sucessfully bound to com.google.android.tts`) and no cue errors were logged.
- The map drew running parts orange and walking parts blue; the panel showed "Walked … · Ran …"
  with each part's active time.
- Standing still (speed 0) for 25 s: "AUTO-PAUSED" pill and banner, notification
  "Running · auto-paused · 2:46 active"; moving again ended it by itself. Active time stayed
  behind elapsed time by the standing time.
- Switching to *Running* by hand during the walk part: notification "Running", new fixes orange.
- Widget added from the launcher's widget list: during the workout "Running · 0.57 km" with
  *Open workout* (which opened the tracker); after saving "0.57 km · 11% of 5.00 km daily goal"
  with *Walk* / *Run*.
- Finished through the notification's deep link (`stride://track?confirmFinish=1`): saved as
  "Walk + run", completion card "Weekly goal reached — nice work!" with the *Weekly goal reached*
  achievement, the *Walking and running* card (0.17 km walked, 0.40 km run), the History/Home card
  labelled "Walk + run", and the route in two colours.
- All routes (from the Home lifetime tile): the route, the type and time filters, and tapping
  the route highlighted it and showed its workout.
- Caveat: when the simulated walk stopped, the emulator kept repeating its last fix with the
  old speed, so auto-pause could not trigger and that idle time counted as running. A phone at
  rest reports a speed near 0.

## Quick start

Prerequisites:

- Node.js 22 LTS and npm.
- JDK 17 (Android Studio's bundled JBR works; set `JAVA_HOME` to it).
- Android SDK with Platform 36/37, Build-Tools 36+, NDK and CMake (Android Studio → SDK Manager;
  missing packages are downloaded by Gradle when licences are accepted).
- Nothing else: maps need no API key.

```bash
npm install
```

```bash
npm test
```

```bash
npx expo run:android
```

`expo run:android` generates the native `android/` project from `app.json` and the config
plugins (Continuous Native Generation), builds the debug variant, installs it on the connected
device/emulator and starts Metro. **Expo Go cannot run this app**: it contains its own native
module (the tracking service).

Other scripts: `npm run typecheck`, `npm run lint`, `npm run prebuild`, `npm start` (Metro only).

## Maps

Maps are drawn by [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/) inside a WebView, from
free vector tiles served by [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data): no API
key, registration or usage limits. Light mode uses the *Liberty* style, dark mode *Dark* — see
`src/constants/map.ts`, where any other MapLibre style URL (another provider or a self-hosted tile
server) can be swapped in.

- The map page (`src/components/map/mapPage.ts`) and MapLibre GL JS itself ship with the app; the
  page loads nothing from a CDN, only the style, tiles, fonts and icons of the map from the tile
  server. The library is copied from the pinned `maplibre-gl` devDependency (5.x: the last version
  with a single-file build) into `src/components/map/vendor/` by `npm run vendor:maplibre`.
- A WebView map replaced MapLibre Native to keep the APK small: the native renderer alone was
  about 4 MB of the compressed APK, the JavaScript library is about 0.3 MB.
- Attribution ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap") is behind the map's ⓘ button;
  keep it — it is required by the tile and data licences. Its links open in the browser.
- Tiles need an internet connection the first time an area is viewed; the WebView's HTTP cache
  keeps what it has shown. If the map style cannot load, the app shows an offline sketch of the
  route instead. Recording never depends on the map.
- The route, gaps (dashed), start/finish, current position with its accuracy circle and the replay
  marker are drawn as map layers from the recorded fixes; nothing is snapped to roads. A workout
  with walking and running parts is drawn in two colours (walk blue, run orange).

## Workout features

- **Walking and running in one workout.** While recording, the *Walking / Running* switch on the
  Track screen starts a new part. Every fix stores the part it was recorded in
  (`route_points.activity_type`); distance counts for the part of the fix that completed it, and
  active time for the part that was current. A saved workout keeps both parts
  (`walk_distance_meters`, `run_distance_meters`, `walk_active_seconds`, `run_active_seconds`)
  and its main type is the part with the larger distance; it is shown as "Walk + run" once both
  parts are at least 50 m. Statistics, goals and the walk/run split count each part's distance
  separately. *Change type* on a saved workout merges the parts into one type.
- **Auto-pause** (Settings, or the Track screen before and during a workout). The service stops
  the active clock after 8 s below 0.35 m/s (dated from when the phone stopped) and restarts it
  after two fixes at 0.7 m/s or more (dated from the first). Location keeps recording, so the
  route and distance continue; only active time, pace and intervals wait. Needs the provider's
  speed (GPS); without it nothing is paused.
- **Run/walk intervals** (Track screen): run for a set time, walk for a set time, a number of
  rounds (15 s to 30 min per phase, 1–30 rounds; default 1:00 run, 2:00 walk, 8 rounds). The
  workout starts with a run; the service switches the walking/running part at each phase,
  speaks the next phase with Android's text-to-speech (other audio is lowered meanwhile) and
  vibrates (two buzzes for run, one long for walk, three short when done). Phases are timed on
  the active clock, so pauses and auto-pause hold them. Switching by hand overrides the current
  phase until the next one. Home's and the widget's start buttons start a plain walk or run;
  intervals start from the Track screen.
- **All your routes** (Statistics → *Map of all your routes*, or the Home lifetime tile): every
  saved route on one map from the compact previews stored with each workout, coloured by main
  type, filterable by type and time range; tap a route to see its workout.
- **Home-screen widget** (4×2, resizable): today's distance with the daily-goal bar, *Walk* and
  *Run* buttons that open the tracker and start, and the workout in progress (distance, paused or
  auto-paused). The app refreshes it after every change; during a workout the service refreshes
  it at most every 15 s.
- **Weekly and monthly goals** next to the daily goal (Goals & achievements): see
  [Statistics, goals and achievements](#statistics-goals-and-achievements).

## Run on a physical phone

1. Enable *Developer options → USB debugging*, connect the phone, accept the prompt.
2. `adb devices` should list it.
3. `npx expo run:android --device` and pick the phone. Metro is reached through `adb reverse`;
   on Android 17 the debug build may show a "nearby devices / local network" permission prompt —
   that permission is **debug-only** (React Native's dev-server connection) and is not in release
   builds.
4. For outdoor tests use a release build (no Metro dependency): see below.

## Release build (signed APK / AAB)

1. Create an upload keystore once (keep it and its passwords safe, outside the repo):

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore C:/keys/stride-upload.jks -alias stride -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Add to your **user-level** `~/.gradle/gradle.properties` (not the project):

   ```
   STRIDE_UPLOAD_STORE_FILE=C:/keys/stride-upload.jks
   STRIDE_UPLOAD_STORE_PASSWORD=...
   STRIDE_UPLOAD_KEY_ALIAS=stride
   STRIDE_UPLOAD_KEY_PASSWORD=...
   ```

   `plugins/withReleaseSigning.js` wires these into the generated `android/app/build.gradle`.
   Without them the release build is signed with the debug key and Gradle prints a warning.
3. Bump `version` / `android.versionCode` in `app.json` for every release.
4. Build:

   ```bash
   npx expo prebuild --platform android
   ```

   ```bash
   cd android && ./gradlew assembleRelease
   ```

   (On Windows: `cd android` then `gradlew.bat assembleRelease`.)
   APK: `android/app/build/outputs/apk/release/app-release.apk`.
   For Google Play use `./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`.
5. Install for testing: `adb install -r android/app/build/outputs/apk/release/app-release.apk`.

`eas.json` contains equivalent `development` / `preview` / `production` profiles if you prefer
EAS Build (note that EAS uploads the project to Expo's build servers).

### App size

A release APK is **11.3 MB** (79.4 MB before the changes below; walk/run parts, auto-pause,
intervals, weekly/monthly goals, the routes map and the widget added about 40 KB). Most of what remains is React
Native, Hermes and Expo modules (6 MB of compressed native code), 2.5 MB of Java/Kotlin code and
1.4 MB of JavaScript (including the map library); fonts are 0.24 MB.

- **Phones only:** `buildArchs: ["arm64-v8a"]` in the `expo-build-properties` plugin (`app.json`).
  Every current phone is arm64; 32-bit-only phones and x86_64 emulators can't install the release
  APK. For an emulator, build with `./gradlew assembleRelease -PreactNativeArchitectures=x86_64`.
  Debug builds from `npx expo run:android` are compiled for the connected device automatically.
- **Compressed native code and JavaScript** (`useLegacyPackaging`, `enableBundleCompression`):
  Android stores both uncompressed by default, which roughly doubles the APK. The JS bundle is
  unpacked when the app starts, which costs a little start-up time.
- **Shrinking:** R8 (`enableMinifyInReleaseBuilds`), unused resources removed
  (`enableShrinkResourcesInReleaseBuilds`), no GIF/WebP decoders (`gifEnabled`, `webpEnabled`; the
  app has neither), English-only resources (`plugins/withEnglishOnlyResources.js`), and Fresco's
  JPEG transcoder and filter libraries left out (`packagingOptions.exclude`): the app never shows
  images through React Native's `<Image>`. Remove that exclusion before using `<Image>` with JPEGs
  or `blurRadius`.
- **In the app:** the map is MapLibre GL JS in a WebView (MapLibre Native was ~4 MB), icons are
  SVG paths (`src/components/iconPaths.ts`) instead of a 1.3 MB icon font, fonts are Latin subsets
  (`npm run fonts:subset`; Android draws other characters with the system font) and body text uses
  two Inter weights, the database uses Android's built-in SQLite instead of expo-sqlite's bundled
  copy (~1 MB), the bar chart is drawn with `react-native-svg` instead of a chart library, and
  `metro.config.js` keeps expo-router's unused optional modules (Expo UI, expo-symbols and the
  1 MB Material Symbols font they need) out of the bundle.

For Google Play, upload the AAB (`./gradlew bundleRelease`) instead: Play delivers only the phone's
architecture and compresses downloads itself, so `useLegacyPackaging` can be turned off there for
faster installs.

### Windows notes

- Deep project folders exceed the 260-character path limit in React Native's C++ builds. The
  project handles this: `plugins/withShortCmakeObjectPaths.js` lets CMake hash long object paths
  and `react-native.config.js` excludes native libraries the app does not use. If you still see
  "Filename longer than 260 characters", move the project to a shorter path (e.g. `C:\dev\stride`)
  or enable Windows long paths.
- Use JDK 17 or newer for Gradle (`JAVA_HOME`); Android Studio's bundled JBR (JDK 25) works.
- `metro.config.js` stops Metro from crawling Gradle/CMake outputs inside `node_modules/*/android`
  (tens of thousands of binaries), which otherwise makes the first Metro start after a native build
  very slow.

## Architecture

```
┌─────────────── Android process ────────────────────────────────────────────────┐
│ TrackingService (Kotlin, foreground, type=location)                            │
│   FusedLocationProvider ──fix──▶ TrackingJournal.append()  (own SQLite file)   │
│        │                         TrackingController (session state machine,   │
│        │                         SharedPreferences, monotonic durations)       │
│        └─ notification (chronometer, distance, Pause/Resume/Finish)            │
│                    │ events (when JS is alive)                                 │
│ AndroidLocationModule (Expo module) ── start/pause/resume/finish, journal read │
├──────────────────────────────── JS (React Native) ─────────────────────────────┤
│ TrackingEngine: read journal → GPS filter → one transaction:                   │
│   route_points + activity totals + tracking_state(filter state, cursor)        │
│   → then acknowledge (delete) journal rows                                     │
│ Repositories (built-in SQLite, synchronous=FULL) ◀── screens via               │
│ useDatabaseQuery (re-query on data change)                                     │
└────────────────────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **Recording does not depend on JS.** The service writes every fix to a native journal before
  anything else. JS processes it when it can (immediately while the app is alive, including in
  the background; otherwise on next launch). The journal is a separate database file, written by
  the service on its own thread without waiting for the app database.
- **Built-in SQLite.** The app database goes through `modules/app-database` (one connection, one
  thread, `synchronous=FULL`) instead of expo-sqlite, whose bundled SQLite added ~1 MB. Android 7
  ships SQLite 3.9, so the SQL avoids newer syntax such as UPSERT;
  `tests/unit/sqlCompatibility.test.ts` checks for it.
- **Exactly-once processing.** Route points, totals, the filter state and the journal cursor are
  committed in one transaction; journal rows are deleted only after that commit. A crash between
  the two re-reads rows that are then skipped by the cursor/sequence checks.
- **Monotonic time.** Active and elapsed durations use `SystemClock.elapsedRealtime()` in the
  service, so clock changes do not affect them; wall-clock time is used only for calendar placement.
- **No background-location permission.** The service is started from a user action while the
  app is visible, which keeps "while in use" access with the screen locked. `ACCESS_BACKGROUND_LOCATION`
  is explicitly removed from the manifest.
- **Recovery.** If the process is killed while recording, the session is marked *interrupted* at
  the last heartbeat (time after it is not counted as active). On Android 11+ the system cannot
  restart a location service from the background without "Allow all the time", so the app posts a
  "Recording stopped" notification and offers **Resume** (new route segment, nothing drawn across
  the gap) or **Save**. A session finished natively but not yet saved is completed on next launch.
- **Duplicate prevention.** One native session at a time, engine actions are serialized, and
  start is refused while an unfinished activity exists.

## GPS processing and distance

Implemented in `src/features/tracking/gpsFilter.ts` (pure, unit-tested); thresholds in
`src/features/tracking/trackingConfig.ts`.

For each fix, in order:

1. Ignore journal replays (sequence ≤ last processed).
2. Reject invalid coordinates.
3. A new recording segment (after pause/resume or recovery) starts a new line; nothing is joined.
4. Reject duplicates (same timestamp) and out-of-order fixes within a segment, using monotonic
   timestamps (that clock restarts when the phone reboots, so it is not compared across segments).
5. Reject fixes with reported accuracy worse than **30 m** (or unknown).
6. A much more precise first fix replaces a coarse segment start instead of adding a phantom jump.
7. **Gaps** (no usable fix for > 15 s): ≤ 120 s and plausible speed → the straight-line distance
   between the two fixes is counted (a lower bound) and drawn dashed; longer → no distance, the line breaks.
8. **Jumps:** implied speed > 7 m/s is rejected; three mutually consistent far fixes re-anchor
   the route without adding distance.
9. **Movement vs noise:** while the provider reports moving speed (≥ 0.5 m/s), displacement from
   the last accepted point must exceed max(2.5 m, 0.5 × accuracy). When stationary or speed is
   unknown, it must exceed 1.5 × combined accuracy **and** persist for 2 more fixes.
10. Accepted: add the Haversine distance from the last accepted point.

Distance is measured from the last *accepted* point, so slow walking accumulates instead of
being discarded. Distance (m) = sum of accepted segment distances; km = m / 1000. Every fix —
accepted or not, with its rejection reason — is stored for later analysis.

After each activity a GPS quality summary is saved (share of fixes ≤ 10 m, gaps, bridged distance,
rejections, notes). The live screen shows accuracy, signal state (good/fair/poor/lost/off) and
warnings. These values are starting points; tune them with `docs/FIELD_TESTING.md`.

## Data model

SQLite file `files/SQLite/stride.db` (the path expo-sqlite used, so data from earlier builds is
kept), schema version in `PRAGMA user_version`, migrations in
`src/database/migrations.ts`.

| Table | Purpose |
|-------|---------|
| `activities` | One row per workout: main type, status (`recording`/`paused`/`recovering`/`completed`), start/end, elapsed/active seconds, distance (m) and its walking/running parts, active seconds per part, average pace/speed, GPS quality JSON, route preview |
| `route_points` | Every fix: position, timestamps (wall + monotonic), accuracy, altitude, speed, bearing, segment distance, accepted flag, rejection reason, line breaks, gap length, walk/run part (NULL before schema 2). FK → activities (cascade), unique (activity_id, sequence_number) |
| `goals` | Versioned goals (`period_type` daily/weekly/monthly, target, `start_date`, enabled) |
| `achievements` | Unlocked milestones, `achievement_type` UNIQUE |
| `tracking_state` | Live-session state: journal cursor, filter state, distance per part, durations (incl. running time), recovery info |
| `preferences` | Key/value user settings |

Native files: `stride_tracking_journal.db` (raw fix journal) and the `stride_tracking_session`
SharedPreferences (session state machine, including auto-pause and the interval plan), and the
`stride_widget` SharedPreferences (what the widget shows). Schema 2 added the walk/run columns;
migrating fills them from each workout's type.

## Statistics, goals and achievements

- Only **completed** activities count. An activity belongs to the local day/week/month in which it
  **started** (device time zone). Weeks start on Monday (configurable in Settings).
- Totals include every completed activity. Streaks, records and average pace use **eligible**
  activities (≥ 100 m and ≥ 60 s active). Fastest pace requires ≥ 1 km.
- Average pace over several activities = total eligible active time ÷ total eligible distance
  (never an average of paces). Division by zero yields "--".
- Streak: consecutive local days with an eligible activity; today's streak survives until the day ends.
- Goals: daily, weekly and monthly, each on/off with its own target. Changing one writes a row
  from today; a day, week or month is judged by the row in effect on its **last day**, so a
  weekly goal set on Wednesday counts for that whole week, while past periods keep their goal.
- A finished workout reports which goals it reached (it took the period's total across the
  target); Home shows the daily ring and weekly/monthly bars.
- Achievements are re-derived from saved activities (first activity, 1K, 5K, 10K, 25 km week,
  100 km month, daily, weekly and monthly goal reached, 7-day streak, personal best distance).
  Deleting an activity recalculates statistics, goal completion and achievements.

## Privacy and data

- All data stays on the phone. Stride never transmits tracks; there is no backend, account or
  analytics. Android Auto Backup is disabled (`allowBackup=false`).
- Map tiles come from OpenFreeMap's public servers, which see the requested map area and the
  phone's IP address (no account, key or cookies). The map's rendering library ships inside the
  app, so no other server is contacted. Recording, history and statistics work offline.
- Uninstalling the app or clearing its storage deletes everything. **Settings → Export backup**
  writes a JSON file and opens the share sheet so you choose where it goes; **Import backup**
  merges a file back (duplicates are skipped).
- Permissions: precise location (while in use), notifications, foreground service (location),
  vibration (interval cues), internet (map tiles) and any normal permissions the libraries need.
  Voice cues use the phone's own text-to-speech engine, which works offline. Unused permissions pulled in
  by libraries (background location, boot, overlay, storage, audio) are removed in `app.json`.

## Testing

```bash
npm test
```

- `tests/unit`: geodesy, GPS filter on synthetic traces (stationary noise, straight walk, slow
  walk, running loop with turns, zig-zags, duplicates, out-of-order, jump, relocation, short and
  long gaps, low accuracy, pause/resume, recovery after a reboot, state persistence),
  pace/format, statistics (incl. midnight crossing), daily/weekly/monthly goals, achievements,
  run/walk interval timing, route geometry (incl. walk/run parts) and replay, the WebView map
  page, and one-shot route requests (Home's start buttons, the notification's Finish).
- `tests/integration`: the tracking engine and repositories against real SQLite (Node's
  `node:sqlite`) with `tests/support/fakeNative.ts` mirroring the service: lifecycle, duplicate
  prevention, exactly-once journal processing, JS restart, process kill/recovery, finish after
  crash, orphaned sessions, walk/run switching (incl. after a JS restart), auto-pause, intervals,
  goals reached on finish, the widget's numbers, replay from stored points, deletion side effects,
  backups.
- Real-device procedure and results log: [`docs/FIELD_TESTING.md`](docs/FIELD_TESTING.md).
- Emulator smoke test: start an emulator with a *Google APIs* image, install the debug build and
  run `powershell -File scripts/emulator-walk.ps1` (simulated walk via `adb emu geo fix`).

## Troubleshooting

| Problem | What to do |
|---------|------------|
| "Tracking module not available" | You are in Expo Go or an old build. Build with `npx expo run:android`. |
| "Precise location is off" | App info → Permissions → Location → enable *Use precise location*. |
| No notification while recording | Android 13+: allow notifications for Stride. Recording works without it. |
| Recording stops after a while with the screen off | Settings → Battery optimisation → *Unrestricted*; disable battery saver; some brands need extra steps (see dontkillmyapp.com). |
| Map is blank or shows the route sketch | No internet the first time an area is viewed (tiles are cached afterwards). The route is still recorded. |
| Emulator map never loads ("Map needs an internet connection…") | The emulator cannot resolve DNS: it forwards to the host's first DNS server, which may be an inactive adapter's or an internal resolver that does not answer. Start it with `emulator -avd <name> -dns-server 8.8.8.8,1.1.1.1`; `adb shell ping -c 1 tiles.openfreemap.org` should then print an address (the ping itself goes unanswered — the emulator does not forward ICMP). |
| No voice at interval changes (vibration works) | Install or enable a text-to-speech engine and its English voice (Settings → System → Languages → Text-to-speech). |
| Widget says "Open Stride to see today's distance" | Open the app once after installing; it fills the widget. |
| GPS stays "Searching" | Go outdoors, enable location (high accuracy), wait 30–60 s; "Start anyway" appears after 45 s. |
| Debug app shows the splash forever | Metro not reachable: run `npx expo start`, `adb reverse tcp:8081 tcp:8081`; on Android 17 allow the debug-only local-network permission. |
| `Filename longer than 260 characters` (Windows) | See [Windows notes](#windows-notes). |
| Gradle: unsupported Java | Use JDK 17 or newer (`JAVA_HOME`). |
| Gradle: `could not open ...\jbr\lib\jvm.cfg` | `JAVA_HOME` points at an incomplete JDK (e.g. a leftover Android Studio folder). Point it at a complete one, such as the `jbr` folder of the Android Studio you use. |

## Project structure

```
src/app/                 Expo Router screens: (tabs)/index, track, history, statistics, settings;
                         activity/[id], goals, routes (all routes), diagnostics
src/components/          Reusable UI (metrics, buttons, map, route sketch, charts, banners, floating
                         tab bar, goal ring, holographic stickers, SVG icons…)
src/components/map/      WebView map page; vendor/ holds MapLibre GL JS (npm run vendor:maplibre)
src/constants/           Design tokens ("Afterglow": colours, type, radii) and the font set
src/features/tracking/   GPS filter, quality, config, engine, run/walk intervals, permissions
src/features/widget/     Keeps the home-screen widget's numbers up to date
src/features/activities/ Route geometry, replay, activity services
src/features/statistics/ Statistics rules, dashboard data
src/features/goals/      Goals rules and service
src/features/achievements/
src/features/backup/     Export/import
src/database/            SQLite connection, migrations, repositories, write queue
src/hooks/, src/utils/   Hooks; geodesy, pace, dates, formatting
modules/android-location Kotlin foreground service, journal, session state (parts, auto-pause,
                         intervals), voice/vibration cues, home-screen widget, Expo module
modules/app-database     The app database on Android's built-in SQLite (Expo module)
assets/fonts/            Latin subsets of the app's fonts with their licences (npm run fonts:subset)
plugins/                 Config plugins (Windows CMake paths, release signing, English-only resources)
metro/                   Stand-in for expo-router's unused optional modules (see metro.config.js)
scripts/vendor-maplibre.js Copies MapLibre GL JS into src/components/map/vendor/
tests/                   Unit and integration tests, synthetic traces, fakes
docs/FIELD_TESTING.md    Real-device test procedure
docs/ui-redesign/        Design system (DESIGN.md) and Google Stitch prompts for each screen
scripts/generate-icons.js App icon generator
scripts/subset-fonts.js  Regenerates assets/fonts (needs Python 3 with fontTools)
```

## Known limitations

- Not yet validated on physical hardware (see Verification status). Threshold values are
  starting points.
- Android cannot restart location recording from the background after the process is killed
  (Android 11+) without background-location permission, which Stride deliberately does not ask
  for; the user must reopen the app to resume. A force-stop, reboot or revoked permission ends
  recording until the app is opened again.
- An activity crossing midnight counts entirely for the day it started.
- Map tiles need internet the first time an area is viewed; there is no explicit offline-region download.
- Auto-pause and intervals follow the active clock in the service; with no GPS speed (e.g. a
  phone without GNSS) auto-pause never triggers. Voice cues need a text-to-speech engine.
- The widget's "today" total is written by the app whenever it saves, deletes or imports
  workouts or changes a goal; after midnight the widget drops it by itself (within its 30-minute
  refresh) until the app runs again.
- Release APKs contain arm64-v8a code only and English resources only (see [App size](#app-size)).
