# Real-device GPS field testing

Automated tests prove the filter, persistence and recovery logic against synthetic traces and a
simulated native service. They cannot prove real-world distance accuracy, background survival on
a particular phone, or battery behaviour. Those need the procedure below on physical hardware.

**Status: not yet run on a physical device.** The tables at the end are empty on purpose — fill
them in with your own measurements; do not quote an accuracy figure until they are.

## Equipment

- At least one physical Android phone with Google Play services (record model and Android
  version). Ideally a second phone on the oldest Android version you want to support (minSdk 24).
- A measured reference route: a 400 m running track (lane 1 = 400 m), or a route measured with a
  surveyor's wheel / official course markers. A route traced on a web map is a weaker reference;
  note which you used.
- A debug or release build installed (see README). For investigation, use **Settings → Export
  backup**: it contains every raw fix with the filter's decision and rejection reason.

## Before each session

1. Settings → Permissions & device: location *Precise*, notifications *Allowed*.
2. Note battery saver state and whether Stride is exempt from battery optimisation.
3. Stand still outdoors until the Track screen shows **GPS good** before starting.

## Test matrix

| # | Scenario | How | Pass criteria |
|---|----------|-----|---------------|
| 1 | Open sky, walking | Walk the reference route 3×, normal pace | Each run within your target error (record it); route follows the path |
| 2 | Open sky, running | Run the reference route 3× | As above; no spikes in current pace |
| 3 | Slow walking | Walk the route at ~0.6–0.8 m/s | Distance not systematically lower than #1 |
| 4 | Stationary | Start, put the phone down outdoors for 10 min, finish | Distance < 15 m; "Stationary drift" rejections in the backup |
| 5 | Built-up street | Walk 1–2 km between tall buildings | Route plausible; GPS quality summary shows fair/poor where expected; no straight-line shortcuts across blocks |
| 6 | Screen locked | Lock the screen for 20–30 min while walking | No gap in the route; notification distance keeps increasing; active time continuous |
| 7 | Temporary GPS loss | Walk through an underpass/tunnel or cover the phone in a metal tin for 30–60 s | "GPS signal lost" warning; dashed gap on the map; quality notes mention the gap |
| 8 | Long GPS loss | As #7 for > 2 min | Route breaks (no line drawn); no distance added across the gap |
| 9 | Pause / resume | Pause, walk 200 m, resume | The 200 m is not counted; no line connects pause and resume points |
| 10 | Battery saver | Enable battery saver, lock screen 10 min | Note any gap; the app shows the battery-saver warning before starting |
| 11 | Offline | Airplane mode with location on (or mobile data off) | Recording, history and statistics work; map tiles may be missing |
| 12 | Process termination | During a walk: `adb shell am kill com.personal.stridetracker` (background kill) or swipe the app away; then reopen | Recording continued (foreground service) or the app offers *Resume / Save*; no data lost before the kill |
| 13 | Force-stop | `adb shell am force-stop com.personal.stridetracker`, reopen | App shows "Recording was interrupted" with Resume/Save; points before the stop are kept |
| 14 | Reboot | Reboot mid-walk, reopen | Interrupted session can be saved; durations frozen at the last heartbeat |
| 15 | Location turned off | Disable location in quick settings for 30 s | "Location is turned off" banner + notification text; recording resumes after re-enabling |

## Measuring distance error

For each run: `error % = (recorded − reference) / reference × 100`. Report the mean and the
spread over repeated runs, per scenario and phone. If you have a consumer reference (watch or
another app) on the same run, record it too, but it is not ground truth.

## Tuning

All thresholds are in `src/features/tracking/trackingConfig.ts` and shown in
*Settings → Diagnostics*. Typical adjustments:

- Distance consistently **high** while walking, with many accepted short segments → raise
  `movementAccuracyFactor` (e.g. 0.5 → 0.75) or `minMovementMeters`.
- Distance **low** on twisty routes → lower `movementAccuracyFactor`.
- Drift while standing → raise `stationaryAccuracyFactor` or `stationaryConfirmations`.
- Real sprint segments rejected as jumps → raise `maxPlausibleSpeedMps` for `run`.

Every recorded fix (accepted or not) is stored, so a backup file from a field test can be re-run
through the filter in a unit test (`runFilter`) to compare settings before changing defaults.

## Results log

| Date | Phone / Android | Scenario # | Reference (m) | Recorded (m) | Error % | GPS quality | Notes |
|------|-----------------|------------|---------------|--------------|---------|-------------|-------|
|      |                 |            |               |              |         |             |       |

## Emulator smoke test (done during development)

The emulator cannot measure real GPS accuracy, but it exercises the full stack. Run on the
`Google APIs` x86_64 image (Android 17 / API 37), debug build, simulated walk at 1.4 m/s fed with
`adb emu geo fix` via `scripts/emulator-walk.ps1`. Results are recorded in the README's
"Verification status" section.
