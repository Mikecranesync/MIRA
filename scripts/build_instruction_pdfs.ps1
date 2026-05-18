<#
.SYNOPSIS
  Render every docs/instructions/*.html to a sibling .pdf via Chrome headless.

.DESCRIPTION
  Discovers Chrome, walks docs/instructions/*.html (filtered by -Filter if given),
  and emits a sibling .pdf for each. Prints "OK (N bytes)" per file on success.

  Contract is set by ~/.claude/skills/plc-instruction-guide/references/build-pdf.md
  — do not change flag names or output naming without updating that reference.

.PARAMETER Filter
  Glob limiting which HTML files are built (default: all). Example: "Conv_Simple_UDFB_Intro.html"

.PARAMETER OpenAfter
  After a successful build, open the resulting PDF in the default viewer.

.EXAMPLE
  pwsh scripts/build_instruction_pdfs.ps1
  pwsh scripts/build_instruction_pdfs.ps1 -Filter "Conv_Simple_*.html"
  pwsh scripts/build_instruction_pdfs.ps1 -Filter "Stub.html" -OpenAfter
#>
[CmdletBinding()]
param(
  [string]$Filter = "*.html",
  [switch]$OpenAfter
)

$ErrorActionPreference = "Stop"

# Resolve repo root from this script's location: scripts/ -> ..
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$InstructionsDir = Join-Path $RepoRoot "docs/instructions"

if (-not (Test-Path $InstructionsDir)) {
  Write-Error "docs/instructions/ not found at $InstructionsDir"
  exit 2
}

# Find Chrome. Add new paths here if a fresh install lands somewhere unusual.
$ChromeCandidates = @(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "$env:LOCALAPPDATA/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
)
$Chrome = $null
foreach ($candidate in $ChromeCandidates) {
  if (Test-Path $candidate) { $Chrome = $candidate; break }
}
if (-not $Chrome) {
  $onPath = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($onPath) { $Chrome = $onPath.Source }
}
if (-not $Chrome) {
  Write-Error "Chrome not found. Install Google Chrome or add the path to `$ChromeCandidates at the top of this script."
  exit 3
}

$Htmls = Get-ChildItem -Path $InstructionsDir -Filter $Filter -File | Where-Object { $_.Extension -eq ".html" }
if (-not $Htmls -or $Htmls.Count -eq 0) {
  Write-Warning "No HTML files matched filter '$Filter' in $InstructionsDir"
  exit 0
}

$Errors = 0
foreach ($html in $Htmls) {
  $pdfPath = [System.IO.Path]::ChangeExtension($html.FullName, ".pdf")
  $url = "file:///" + ($html.FullName -replace '\\', '/')

  # --headless=new is the modern flag; required since Chrome 109. The legacy
  # --headless (no =new) silently produces blank PDFs on recent Chrome builds.
  & $Chrome `
      --headless=new `
      --disable-gpu `
      --no-pdf-header-footer `
      --print-to-pdf-no-header `
      "--print-to-pdf=$pdfPath" `
      $url 2>$null | Out-Null

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $pdfPath)) {
    Write-Host ("FAIL: {0}" -f $html.Name) -ForegroundColor Red
    $Errors++
    continue
  }
  $size = (Get-Item $pdfPath).Length
  if ($size -lt 1024) {
    Write-Host ("WARN: {0} -> only {1} bytes (likely render failure; check HTML in Chrome)" -f $html.Name, $size) -ForegroundColor Yellow
    $Errors++
    continue
  }
  Write-Host ("OK ({0} bytes): {1}" -f $size, $html.Name) -ForegroundColor Green

  if ($OpenAfter) {
    Start-Process $pdfPath
  }
}

if ($Errors -gt 0) {
  Write-Error "$Errors file(s) failed."
  exit 1
}
exit 0
