# Plug the phone in, run this, the FactoryLM app installs. PowerShell twin of
# install-latest.sh: download latest.json + signed APK from the direct-install
# page, verify sha256, adb install -r, launch. Usage:
#   powershell -ExecutionPolicy Bypass -File tools\android\install-latest.ps1 [-DryRun]
param([switch]$DryRun)
$ErrorActionPreference = "Stop"
$Base = "https://updates.factorylm.com/app"
$Work = Join-Path $env:TEMP "factorylm-install"
New-Item -ItemType Directory -Force -Path $Work | Out-Null

Write-Host "→ fetching $Base/latest.json"
$latest = Invoke-RestMethod -Uri "$Base/latest.json" -TimeoutSec 30
Write-Host ("   latest: {0} vc{1}  file={2}" -f $latest.versionName, $latest.versionCode, $latest.file)
$apk = Join-Path $Work $latest.file
if (-not (Test-Path $apk)) {
  Write-Host "→ downloading $Base/$($latest.file)"
  Invoke-WebRequest -Uri "$Base/$($latest.file)" -OutFile "$apk.part" -TimeoutSec 600
  Move-Item -Force "$apk.part" $apk
}
Write-Host "→ verifying sha256"
$got = (Get-FileHash -Algorithm SHA256 $apk).Hash.ToLower()
if ($got -ne $latest.sha256.ToLower()) { throw "sha256 mismatch: expected $($latest.sha256) got $got — refusing to install." }
Write-Host "   ok $got"
if ($DryRun) { Write-Host "dry run: APK verified at $apk; skipping adb."; exit 0 }

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { throw "adb not found on PATH (install Android platform-tools)." }
$devices = (& adb devices) | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" }
if (-not $devices) { & adb devices; throw "no device in 'device' state. Plug the phone in, unlock it, accept the USB debugging prompt, then re-run." }
Write-Host "→ installing on: $devices"
& adb install -r $apk
Write-Host "→ launching"
& adb shell monkey -p com.factorylm.mira -c android.intent.category.LAUNCHER 1 | Out-Null
Write-Host @"

Installed. Next, on the phone:
  1. Sign in.
  2. More → About & updates → channel: canary → Check now → Update ready → Restart.
  3. More → Chat style → "Try the unified interface (beta)".
  4. Open a notebook. Full test list: docs/release/android/unified-ui-beta.md
"@
