param(
  [double]$StartLat = 51.5007,
  [double]$StartLon = -0.1246,
  [double]$SpeedMps = 1.4,
  [int]$EastSeconds = 300,
  [int]$NorthSeconds = 300
)
# Feeds a running Android emulator a simple route (east, then north) with one GPS fix per
# second through `adb emu geo fix`, for smoke-testing recording, pause/resume and recovery.
# Usage: powershell -File scripts/emulator-walk.ps1 -SpeedMps 3.0
# Emulator fixes are noise-free: this checks the plumbing, not real-world accuracy.
$culture = [Globalization.CultureInfo]::InvariantCulture
$metersPerDegLat = 111320.0
$metersPerDegLon = 111320.0 * [Math]::Cos($StartLat * [Math]::PI / 180.0)
$knots = ($SpeedMps * 1.943844).ToString('F2', $culture)
$lat = $StartLat
$lon = $StartLon
for ($i = 0; $i -lt ($EastSeconds + $NorthSeconds); $i++) {
  $tick = Get-Date
  if ($i -lt $EastSeconds) { $lon += $SpeedMps / $metersPerDegLon } else { $lat += $SpeedMps / $metersPerDegLat }
  adb emu geo fix $lon.ToString('F7', $culture) $lat.ToString('F7', $culture) 20 10 $knots | Out-Null
  Write-Host "$i  $($lat.ToString('F6', $culture)), $($lon.ToString('F6', $culture))  walked $([Math]::Round(($i + 1) * $SpeedMps)) m"
  $elapsed = ((Get-Date) - $tick).TotalMilliseconds
  if ($elapsed -lt 1000) { Start-Sleep -Milliseconds (1000 - $elapsed) }
}
