# MIRA Ignition Deployment Script — Windows PLC Laptop
# Run in PowerShell as Administrator from the MIRA repo root:
#   cd C:\Users\hharp\Documents\GitHub\MIRA
#   git pull origin main
#   PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1

param(
    [string]$GatewayUser = "admin",
    [string]$GatewayPass = "password",
    [string]$GatewayUrl  = "http://localhost:8088"
)

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_ROOT  = Split-Path -Parent $SCRIPT_DIR

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  MIRA — Ignition Deployment" -ForegroundColor Cyan
Write-Host "  ConveyorMIRA + Mira HMI Co-Pilot" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------------
# STEP 1: Verify gateway is reachable
# ------------------------------------------------------------------
Write-Host "[1/7] Checking Ignition gateway at $GatewayUrl ..." -ForegroundColor Green
try {
    $ping = Invoke-RestMethod -Uri "$GatewayUrl/StatusPing" -TimeoutSec 5
    Write-Host "      OK — Edition: $($ping.edition)  State: $($ping.licenseState)" -ForegroundColor Green
} catch {
    Write-Host "      FAIL — Gateway not responding at $GatewayUrl" -ForegroundColor Red
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
    Write-Host "      FAIL — Could not locate Ignition projects directory." -ForegroundColor Red
    Write-Host "      Manually set the path and re-run, or copy manually:" -ForegroundColor Yellow
    Write-Host "      xcopy /E /Y /I ignition\project <IgnitionDataDir>\projects\ConveyorMIRA" -ForegroundColor Yellow
    exit 1
}

# ------------------------------------------------------------------
# STEP 3: Copy project files (Perspective views + Web Dev scripts)
# ------------------------------------------------------------------
Write-Host "[3/7] Deploying ConveyorMIRA project files ..." -ForegroundColor Green

$ProjectSrc = Join-Path $REPO_ROOT "ignition\project"
$ProjectDst = Join-Path $IgnitionProjects "ConveyorMIRA"

if (-not (Test-Path $ProjectSrc)) {
    Write-Host "      FAIL — Source not found: $ProjectSrc" -ForegroundColor Red
    Write-Host "      Make sure you ran: git pull origin main" -ForegroundColor Yellow
    exit 1
}

# Copy with overwrite
Copy-Item -Path $ProjectSrc -Destination $ProjectDst -Recurse -Force
Write-Host "      Copied: $ProjectSrc" -ForegroundColor Green
Write-Host "          To: $ProjectDst" -ForegroundColor Green

# Copy Web Dev scripts if they exist
$WebDevSrc = Join-Path $REPO_ROOT "ignition\webdev"
if (Test-Path $WebDevSrc) {
    $WebDevDst = Join-Path $ProjectDst "com.inductiveautomation.webdev\resources"
    New-Item -ItemType Directory -Path $WebDevDst -Force | Out-Null
    Copy-Item -Path "$WebDevSrc\*" -Destination $WebDevDst -Recurse -Force
    Write-Host "      Web Dev scripts deployed to: $WebDevDst" -ForegroundColor Green
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
    Write-Host "      REST rescan failed (auth or endpoint) — do it manually:" -ForegroundColor Yellow
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
            Write-Host "      REST tag import failed for $TagFileName — do it manually:" -ForegroundColor Yellow
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
    Write-Host "      Sidecar OK — status: $($sidecarStatus.status), docs: $($sidecarStatus.doc_count)" -ForegroundColor Green
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
    Write-Host "      Gateway OK — $($ping2.edition) / $($ping2.licenseState)" -ForegroundColor Green
} catch {
    Write-Host "      Gateway did not respond — check tray icon" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  DEPLOYMENT COMPLETE" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Perspective client:" -ForegroundColor White
Write-Host "  $GatewayUrl/data/perspective/client/ConveyorMIRA" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Mira Chat (standalone):" -ForegroundColor White
Write-Host "  $GatewayUrl/system/webdev/FactoryLM/mira" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Mira API Health:" -ForegroundColor White
Write-Host "  $GatewayUrl/system/webdev/FactoryLM/api/status" -ForegroundColor Yellow
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
Write-Host "  Gateway scripts (MANUAL — copy from ignition\gateway-scripts\):" -ForegroundColor White
Write-Host "  1. Tag Change Script: tag-change-fsm-monitor.py" -ForegroundColor Yellow
Write-Host "     Watch path: [default]Mira_Monitored/*/State" -ForegroundColor Yellow
Write-Host "  2. Timer Script (10s): timer-stuck-state.py" -ForegroundColor Yellow
Write-Host "  3. Timer Script (1hr): timer-fsm-builder.py" -ForegroundColor Yellow
Write-Host ""
