# Copies the Step 1 IOCheck Perspective view into the active Ignition project.
# Run in an ELEVATED PowerShell (Start → type "powershell" → right-click → Run as administrator).
# After it finishes, press Ctrl+Shift+U in the Designer (or File → Update Project) to reload.

param(
    [string] $ProjectName = "MIRA_Tags"   # change if you named your new project differently
)

$src = "C:\Users\hharp\Documents\CCW\MIRA_PLC\ignition\step1_io_check\views\IOCheck"
$dst = "C:\Program Files\Inductive Automation\Ignition\data\projects\$ProjectName\com.inductiveautomation.perspective\views\IOCheck"

if (-not (Test-Path "C:\Program Files\Inductive Automation\Ignition\data\projects\$ProjectName")) {
    Write-Host "ERROR: project '$ProjectName' doesn't exist. Create it in Designer first, or pass -ProjectName <name>." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
Write-Host "Copied IOCheck view into project '$ProjectName'." -ForegroundColor Green
Write-Host "Now in Designer: File -> Update Project (Ctrl+Shift+U) and open Views/IOCheck." -ForegroundColor Cyan
