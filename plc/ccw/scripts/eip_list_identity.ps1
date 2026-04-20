# EIP List Identity broadcast — discovers Allen-Bradley / EtherNet/IP devices
# regardless of subnet. Sends a 24-byte encapsulation header with command 0x0063
# to UDP/44818 and prints every reply with its source IP and product name.

param(
    [string[]] $BroadcastTargets = @('255.255.255.255','192.168.1.255','169.254.255.255','192.168.4.255'),
    [int]      $ListenSeconds    = 4
)

$client = New-Object System.Net.Sockets.UdpClient
$client.EnableBroadcast = $true
$client.Client.ReceiveTimeout = 500
$client.Client.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0))

# 24-byte EIP encapsulation header: List Identity (command=0x0063), length=0
$pkt = New-Object byte[] 24
$pkt[0] = 0x63; $pkt[1] = 0x00   # command (LE)

foreach ($tgt in $BroadcastTargets) {
    try {
        $ep = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Parse($tgt)), 44818
        [void] $client.Send($pkt, $pkt.Length, $ep)
        Write-Host "Sent List Identity to $tgt:44818"
    } catch {
        Write-Host "Failed send to $tgt : $_"
    }
}

$deadline = (Get-Date).AddSeconds($ListenSeconds)
$seen     = @{}

while ((Get-Date) -lt $deadline) {
    try {
        $remote = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, 0)
        $data   = $client.Receive([ref]$remote)
    } catch { continue }

    $src = $remote.Address.ToString()
    if ($seen.ContainsKey($src)) { continue }
    $seen[$src] = $true

    # Reply layout: 24-byte enc header, then CPF items. Identity item payload
    # starts at offset 30 (6 CPF bytes after header). Product name is a short
    # string at the tail of the identity object.
    $productName = '(unknown)'
    if ($data.Length -gt 64) {
        $nameLen = $data[$data.Length - 2]  # product name is typically second-to-last
        # More reliable: scan for printable ASCII run of length >= 5 near the end
        $ascii = -join ($data | ForEach-Object { if ($_ -ge 32 -and $_ -lt 127) { [char]$_ } else { '.' } })
        if ($ascii -match '([A-Za-z0-9 \-_/]{5,})') { $productName = $Matches[1] }
    }
    Write-Host ("FOUND  {0,-15}  len={1,3}  name={2}" -f $src, $data.Length, $productName)
}

$client.Close()

if ($seen.Count -eq 0) {
    Write-Host 'No EIP devices responded.'
}
