# MIRA Ignition Deployment Script - Windows PLC Laptop
# Run in PowerShell as Administrator from the MIRA repo root:
#   cd C:\Users\hharp\Documents\GitHub\MIRA
#   git pull origin main
#   PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1

param(
    [string]$GatewayUser = "admin",
    [string]$GatewayPass = "password",
    [string]$GatewayUrl  = "http://localhost:8088",
    [string]$ProjectName = "ConveyorMIRA",
    # Overwriting a live project directory in place is how
    # ConvSimpleLive._broken_20260531 came to exist. Refuse by default; -Force
    # takes a timestamped backup first, then overwrites.
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_ROOT  = Split-Path -Parent $SCRIPT_DIR

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  MIRA - Ignition Deployment" -ForegroundColor Cyan
Write-Host "  ConveyorMIRA + Mira HMI Co-Pilot" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------------
# STEP 1: Verify gateway is reachable
# ------------------------------------------------------------------
Write-Host "[1/7] Checking Ignition gateway at $GatewayUrl ..." -ForegroundColor Green
try {
    $ping = Invoke-RestMethod -Uri "$GatewayUrl/StatusPing" -TimeoutSec 5
    Write-Host "      OK - Edition: $($ping.edition)  State: $($ping.licenseState)" -ForegroundColor Green
} catch {
    Write-Host "      FAIL - Gateway not responding at $GatewayUrl" -ForegroundColor Red
    Write-Host "      Make sure Ignition is running (tray icon visible)" -ForegroundColor Yellow
    exit 1
}

# ------------------------------------------------------------------
# STEP 2: Locate Ignition data/projects directory
# ------------------------------------------------------------------
Write-Host "[2/7] Locating Ignition projects directory ..." -ForegroundColor Green

$CandidatePaths = @(
    "C:\Program Files\Inductive Automation\Ignition\data\projects",
    "C:\ProgramData\Ignition\data\projects",
    "$env:LOCALAPPDATA\Inductive Automation\Ignition\data\projects"
)

$IgnitionProjects = $null
foreach ($p in $CandidatePaths) {
    if (Test-Path $p) {
        $IgnitionProjects = $p
        Write-Host "      Found: $p" -ForegroundColor Green
        break
    }
}

if (-not $IgnitionProjects) {
    # Try searching Program Files
    $found = Get-ChildItem "C:\Program Files" -Recurse -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -eq "projects" -and $_.FullName -like "*Ignition*" } |
             Select-Object -First 1
    if ($found) {
        $IgnitionProjects = $found.FullName
        Write-Host "      Found (search): $IgnitionProjects" -ForegroundColor Green
    }
}

if (-not $IgnitionProjects) {
    Write-Host "      FAIL - Could not locate Ignition projects directory." -ForegroundColor Red
    Write-Host "      Manually set the path and re-run, or copy manually:" -ForegroundColor Yellow
    Write-Host "      xcopy /E /Y /I ignition\project <IgnitionDataDir>\projects\$ProjectName" -ForegroundColor Yellow
    exit 1
}

# The Ignition DATA dir is the parent of projects/. The allowlist lives there,
# project-independently - see STEP 3c.
$IgnitionData = Split-Path -Parent $IgnitionProjects
Write-Host "      Data dir: $IgnitionData" -ForegroundColor Green

# ------------------------------------------------------------------
# STEP 3: Copy project files (Perspective views + Web Dev scripts)
# ------------------------------------------------------------------
Write-Host "[3/7] Deploying ConveyorMIRA project files ..." -ForegroundColor Green

$ProjectSrc = Join-Path $REPO_ROOT "ignition\project"
$ProjectDst = Join-Path $IgnitionProjects $ProjectName

if (-not (Test-Path $ProjectSrc)) {
    Write-Host "      FAIL - Source not found: $ProjectSrc" -ForegroundColor Red
    Write-Host "      Make sure you ran: git pull origin main" -ForegroundColor Yellow
    exit 1
}

# Never silently overwrite a live project. ConvSimpleLive._broken_20260531 is
# what that looks like after the fact.
if ((Test-Path $ProjectDst) -and -not $Force) {
    Write-Host "      REFUSING - project already exists: $ProjectDst" -ForegroundColor Red
    Write-Host "      This script would overwrite it in place. Re-run with -Force" -ForegroundColor Yellow
    Write-Host "      to take a timestamped backup first, or deploy to a new" -ForegroundColor Yellow
    Write-Host "      project with -ProjectName <name>." -ForegroundColor Yellow
    exit 1
}
if ((Test-Path $ProjectDst) -and $Force) {
    $Backup = "$ProjectDst.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -Path $ProjectDst -Destination $Backup -Recurse -Force
    Write-Host "      Backed up existing project to: $Backup" -ForegroundColor Yellow
    # Copy-Item dir -> EXISTING dir does NOT replace it: it nests the source as
    # a child ($ProjectDst\project) and leaves every stale file in place
    # (reproduced 2026-08-01). The destination must be gone before the copy.
    # Safe to remove here and only here: the backup above just succeeded.
    Write-Host "      Removing existing project dir (backed up above): $ProjectDst" -ForegroundColor Yellow
    Remove-Item -LiteralPath $ProjectDst -Recurse -Force
}

Copy-Item -Path $ProjectSrc -Destination $ProjectDst -Recurse -Force
Write-Host "      Copied: $ProjectSrc" -ForegroundColor Green
Write-Host "          To: $ProjectDst" -ForegroundColor Green

# ------------------------------------------------------------------
# STEP 3b: CONVERT the WebDev sources into 8.3 project resources
# ------------------------------------------------------------------
# This is a conversion, not a copy, and all three reasons were confirmed on a
# live 8.3.4 gateway:
#
#   * A WebDev endpoint is a THREE-file resource - resource.json (whose `files`
#     array IS the data-key list), config.json (resource-type + kebab-case
#     per-method config) and a def-first <method>.py. A directory holding only
#     doGet.py returns HTTP 500 "No data found for resource".
#   * The repo's handlers are comment-first Python modules. Shipped raw they do
#     NOT error - they return HTTP 200 with an EMPTY body and log nothing.
#   * Helper modules are not importable from beside a handler; they must be
#     project script-library modules, which the converter also emits.
#
# The logic lives in Python so it is unit-testable offline -
# tests/regime7_ignition/test_webdev_deploy_contract.py covers every endpoint.
Write-Host "[3b/8] Converting Web Dev sources to Ignition 8.3 resources ..." -ForegroundColor Green

$WebDevSrc = Join-Path $REPO_ROOT "ignition\webdev"
$Builder   = Join-Path $REPO_ROOT "ignition\tools\webdev_build.py"

if (-not (Test-Path $WebDevSrc)) {
    Write-Host "      Web Dev source not found: $WebDevSrc (skipping)" -ForegroundColor Yellow
} else {
    $Python = $null
    foreach ($c in @("py", "python3", "python")) {
        $cmd = Get-Command $c -ErrorAction SilentlyContinue
        # On Windows, `python`/`python3` are often Microsoft Store stubs that
        # print an install message and exit non-zero. Probe before trusting one.
        if ($cmd) { & $c -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { $Python = $c; break } }
    }
    if (-not $Python) {
        Write-Host "      FAIL - no working Python found (tried py/python3/python)." -ForegroundColor Red
        Write-Host "      The Web Dev conversion cannot be skipped: copying the raw" -ForegroundColor Yellow
        Write-Host "      sources produces endpoints that return HTTP 200 with an" -ForegroundColor Yellow
        Write-Host "      empty body and log nothing." -ForegroundColor Yellow
        exit 1
    }

    $Stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    & $Python $Builder --webdev-src $WebDevSrc --script-src $WebDevSrc `
        --project-dir $ProjectDst --timestamp $Stamp
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      FAIL - Web Dev conversion failed; nothing further deployed." -ForegroundColor Red
        exit 1
    }
    Write-Host "      Web Dev resources + script library written under: $ProjectDst" -ForegroundColor Green
}

# ------------------------------------------------------------------
# STEP 3c: Deploy the tag allowlist to THE authoritative runtime location
# ------------------------------------------------------------------
# One location, used by deployment and by the loader. It is keyed off the
# Ignition DATA dir, deliberately not off a project name: this script installs
# "$ProjectName" (default ConveyorMIRA) while allowlist.py used to search
# .../data/projects/factorylm/, a project that exists nowhere. The allowlist
# therefore landed where nothing read it and every tag was dropped - correctly
# fail-closed, but for the wrong reason and invisibly.
# The relative path below is asserted against allowlist.RUNTIME_ALLOWLIST_RELPATH
# by tests/regime7_ignition/test_webdev_deploy_contract.py so the two cannot drift.
Write-Host "[3c/8] Deploying tag allowlist ..." -ForegroundColor Green

$AllowlistSrc = Join-Path $REPO_ROOT "ignition\project\approved_tags.json"
$AllowlistDst = Join-Path $IgnitionData "factorylm/approved_tags.json"

if (Test-Path $AllowlistSrc) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $AllowlistDst) -Force | Out-Null
    Copy-Item -Path $AllowlistSrc -Destination $AllowlistDst -Force
    Write-Host "      Allowlist deployed to: $AllowlistDst" -ForegroundColor Green
} else {
    Write-Host "      WARNING - no approved_tags.json at $AllowlistSrc" -ForegroundColor Yellow
    Write-Host "      Without it every tag is dropped (fail-closed) and chat turns" -ForegroundColor Yellow
    Write-Host "      carry no live evidence. Deploy one before relying on tags." -ForegroundColor Yellow
}

# List what was deployed
$files = Get-ChildItem $ProjectDst -Recurse -File
Write-Host "      Files deployed: $($files.Count)" -ForegroundColor Green
$files | ForEach-Object { Write-Host "        $($_.FullName.Replace($ProjectDst,''))" }

# ------------------------------------------------------------------
# STEP 4: Trigger project rescan + import ALL tag files via REST
# ------------------------------------------------------------------
Write-Host "[4/7] Triggering gateway project rescan + importing tags ..." -ForegroundColor Green

$Headers = @{ "Content-Type" = "application/json" }
$Cred    = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${GatewayUser}:${GatewayPass}"))
$Headers["Authorization"] = "Basic $Cred"

# Rescan projects
try {
    Invoke-RestMethod -Method POST -Uri "$GatewayUrl/data/projects/scan" -Headers $Headers -TimeoutSec 10 | Out-Null
    Write-Host "      Project rescan triggered via REST" -ForegroundColor Green
} catch {
    Write-Host "      REST rescan failed (auth or endpoint) - do it manually:" -ForegroundColor Yellow
    Write-Host "      $GatewayUrl -> Config -> Projects -> Scan File System" -ForegroundColor Yellow
}

# Import all tag files
$TagFiles = @(
    "ignition\tags\tags.json",
    "ignition\tags\mira_monitored_demo.json",
    "ignition\tags\mira_alerts_template.json"
)

foreach ($tf in $TagFiles) {
    $TagsFile = Join-Path $REPO_ROOT $tf
    $TagFileName = Split-Path $tf -Leaf
    if (Test-Path $TagsFile) {
        try {
            $tagBody = Get-Content $TagsFile -Raw
            Invoke-RestMethod -Method POST `
                -Uri "$GatewayUrl/data/tag-store/system/tags/import" `
                -Headers $Headers `
                -Body $tagBody `
                -ContentType "application/json" `
                -TimeoutSec 15 | Out-Null
            Write-Host "      Tags imported: $TagFileName" -ForegroundColor Green
        } catch {
            Write-Host "      REST tag import failed for $TagFileName - do it manually:" -ForegroundColor Yellow
            Write-Host "      Designer -> Tags -> Import Tags -> $TagsFile" -ForegroundColor Yellow
        }
    } else {
        Write-Host "      Tags file not found: $TagsFile" -ForegroundColor Yellow
    }
}

# ------------------------------------------------------------------
# STEP 5: Database schema instructions
# ------------------------------------------------------------------
Write-Host "[5/7] Database schema ..." -ForegroundColor Green

$SchemaFile = Join-Path $REPO_ROOT "ignition\db\schema.sql"
if (Test-Path $SchemaFile) {
    Write-Host "      Schema file found: $SchemaFile" -ForegroundColor Green
    Write-Host "      MANUAL STEP: Execute this SQL in Ignition Designer:" -ForegroundColor Yellow
    Write-Host "      Designer -> Database -> Query Browser -> paste contents of schema.sql" -ForegroundColor Yellow
} else {
    Write-Host "      Schema file not found (skipping)" -ForegroundColor Yellow
}

# ------------------------------------------------------------------
# STEP 6: Check RAG sidecar
# ------------------------------------------------------------------
Write-Host "[6/7] Checking MIRA RAG sidecar at localhost:5000 ..." -ForegroundColor Green

try {
    $sidecarStatus = Invoke-RestMethod -Uri "http://localhost:5000/status" -TimeoutSec 5
    Write-Host "      Sidecar OK - status: $($sidecarStatus.status), docs: $($sidecarStatus.doc_count)" -ForegroundColor Green
} catch {
    Write-Host "      Sidecar not running at localhost:5000" -ForegroundColor Yellow
    Write-Host "      To install: cd mira-sidecar\service && install_service_windows.bat" -ForegroundColor Yellow
    Write-Host "      Or run manually: cd mira-sidecar && uv run uvicorn app:app --host 127.0.0.1 --port 5000" -ForegroundColor Yellow
}

# ------------------------------------------------------------------
# STEP 7: Verify and print access URLs
# ------------------------------------------------------------------
Write-Host "[7/7] Verifying gateway after deployment ..." -ForegroundColor Green
Start-Sleep -Seconds 3

try {
    $ping2 = Invoke-RestMethod -Uri "$GatewayUrl/StatusPing" -TimeoutSec 5
    Write-Host "      Gateway OK - $($ping2.edition) / $($ping2.licenseState)" -ForegroundColor Green
} catch {
    Write-Host "      Gateway did not respond - check tray icon" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  DEPLOYMENT COMPLETE" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Perspective client:" -ForegroundColor White
Write-Host "  $GatewayUrl/data/perspective/client/$ProjectName" -ForegroundColor Yellow
Write-Host ""
# A WebDev URL is /system/webdev/<PROJECT>/<RESOURCE PATH>. These used to print
# /system/webdev/FactoryLM/... which reads `FactoryLM` as the project name - it
# is the resource-path root inside the project, so every printed URL 404'd.
Write-Host "  Mira Chat (standalone):" -ForegroundColor White
Write-Host "  $GatewayUrl/system/webdev/$ProjectName/FactoryLM/mira" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Mira API Health:" -ForegroundColor White
Write-Host "  $GatewayUrl/system/webdev/$ProjectName/FactoryLM/api/status" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Designer:" -ForegroundColor White
Write-Host "  $GatewayUrl  ->  Launch Designer  ->  Open ConveyorMIRA" -ForegroundColor Yellow
Write-Host ""
Write-Host "  If views are missing:" -ForegroundColor White
Write-Host "  Config -> Projects -> Scan File System" -ForegroundColor Yellow
Write-Host ""
Write-Host "  If tags show Bad_NotFound:" -ForegroundColor White
Write-Host "  1. Create device Micro820_Conveyor (Modbus TCP, 192.168.1.100, port 502)" -ForegroundColor Yellow
Write-Host "  2. Designer -> Tags -> Import Tags -> ignition\tags\tags.json" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Gateway scripts (MANUAL - copy from ignition\gateway-scripts\):" -ForegroundColor White
Write-Host "  1. Tag Change Script: tag-change-fsm-monitor.py" -ForegroundColor Yellow
Write-Host "     Watch path: [default]Mira_Monitored/*/State" -ForegroundColor Yellow
Write-Host "  2. Timer Script (10s): timer-stuck-state.py" -ForegroundColor Yellow
Write-Host "  3. Timer Script (1hr): timer-fsm-builder.py" -ForegroundColor Yellow
Write-Host ""
