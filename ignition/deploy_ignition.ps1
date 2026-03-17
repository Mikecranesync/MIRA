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
Write-Host "  ConveyorMIRA Perspective Dashboard" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------------
# STEP 1: Verify gateway is reachable
# ------------------------------------------------------------------
Write-Host "[1/5] Checking Ignition gateway at $GatewayUrl ..." -ForegroundColor Green
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
Write-Host "[2/5] Locating Ignition projects directory ..." -ForegroundColor Green

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
# STEP 3: Copy project files
# ------------------------------------------------------------------
Write-Host "[3/5] Deploying ConveyorMIRA project files ..." -ForegroundColor Green

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

# List what was deployed
$files = Get-ChildItem $ProjectDst -Recurse -File
Write-Host "      Files deployed: $($files.Count)" -ForegroundColor Green
$files | ForEach-Object { Write-Host "        $($_.FullName.Replace($ProjectDst,''))" }

# ------------------------------------------------------------------
# STEP 4: Trigger project rescan + import tags via gateway REST
# ------------------------------------------------------------------
Write-Host "[4/5] Triggering gateway project rescan ..." -ForegroundColor Green

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

# Import tags
Write-Host "      Importing tags ..." -ForegroundColor Green
$TagsFile = Join-Path $REPO_ROOT "ignition\tags\tags.json"
if (Test-Path $TagsFile) {
    try {
        $tagBody = Get-Content $TagsFile -Raw
        Invoke-RestMethod -Method POST `
            -Uri "$GatewayUrl/data/tag-store/system/tags/import" `
            -Headers $Headers `
            -Body $tagBody `
            -ContentType "application/json" `
            -TimeoutSec 15 | Out-Null
        Write-Host "      Tags imported via REST" -ForegroundColor Green
    } catch {
        Write-Host "      REST tag import failed — do it manually:" -ForegroundColor Yellow
        Write-Host "      Designer -> Tags -> Import Tags -> $TagsFile" -ForegroundColor Yellow
    }
} else {
    Write-Host "      Tags file not found: $TagsFile" -ForegroundColor Red
}

# ------------------------------------------------------------------
# STEP 5: Verify and print access URL
# ------------------------------------------------------------------
Write-Host "[5/5] Verifying gateway after deployment ..." -ForegroundColor Green
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
