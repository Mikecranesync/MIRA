$p = 'C:\Program Files\Inductive Automation\Ignition\data\config\resources\core\com.inductiveautomation.opcua\device\_write_test.tmp'
try {
    Set-Content -Path $p -Value 'test' -ErrorAction Stop
    Remove-Item $p
    Write-Host 'WRITABLE'
} catch {
    Write-Host "NOT WRITABLE: $($_.Exception.Message)"
}
