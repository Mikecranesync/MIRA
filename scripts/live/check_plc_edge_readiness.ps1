param(
  [string]$PlcHost = "192.168.1.100",
  [int]$PlcPort = 502,
  [string]$IgnitionUrl = "http://127.0.0.1:8088"
)

$ErrorActionPreference = "Stop"

function Test-Port {
  param([string]$HostName, [int]$Port)

  $result = Test-NetConnection $HostName -Port $Port -WarningAction SilentlyContinue
  return [bool]$result.TcpTestSucceeded
}

$checks = [ordered]@{}
$checks["plc_modbus_tcp"] = Test-Port -HostName $PlcHost -Port $PlcPort

try {
  $response = Invoke-WebRequest -Uri $IgnitionUrl -UseBasicParsing -TimeoutSec 5
  $checks["ignition_http"] = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
} catch {
  $checks["ignition_http"] = $false
}

$checks["jarvis_not_required"] = $true

$checks.GetEnumerator() | ForEach-Object {
  $status = if ($_.Value) { "PASS" } else { "FAIL" }
  Write-Output "$status $($_.Key)"
}

if ($checks.Values -contains $false) {
  exit 1
}
