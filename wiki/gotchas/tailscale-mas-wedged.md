---
title: Tailscale (Mac App Store build) wedges in "Connecting", CLI can't drive it
type: gotcha
updated: 2026-06-04
tags: [tailscale, alphanode, macos, ssh, cluster, networking]
---

# Tailscale (MAS build) wedges in "Connecting" — fix without the CLI

## Symptom
- No `inet 100.x` address on any `utun` interface; cluster nodes unreachable.
- `scutil --nc status "Tailscale"` shows `Connecting` with a flapping
  `ConnectCount`/`DisconnectedCount` (e.g. 28 connects / 27 disconnects).
- The bundled CLI fails: `/Applications/Tailscale.app/Contents/MacOS/Tailscale status`
  → `The Tailscale CLI failed to start: ... (Tailscale.CLIError error 1.)`.
  This is the **Mac App Store / sandboxed build** — its CLI can't reach the
  daemon socket. There is no `tailscale` in PATH on alphanode.

## Root cause
The GUI daemon (`io.tailscale.ipn.macos` network-extension) gets stuck in a
connect/disconnect loop. Internet + control plane are fine
(`login.tailscale.com → 302`), so it's a wedged daemon, not a network problem.

## Fix (drive the VPN profile via `scutil`, restart the app)
```bash
scutil --nc stop  "Tailscale"
osascript -e 'quit app "Tailscale"'
pkill -f "Tailscale.app/Contents/MacOS/Tailscale"
open -a Tailscale
scutil --nc start "Tailscale"
ifconfig | grep -E "inet 100\."   # poll until a 100.x appears
```
On 2026-06-03 this took alphanode flapping → `Connected 100.107.140.12` in ~5 s.

## Diagnosing the tailnet when the local CLI is dead
SSH to a **Linux** node (it has a real CLI) and run `tailscale status` there:
```bash
ssh ultron 'tailscale status'   # factorylm-prod, working CLI
```
ICMP is unreliable on this tailnet (macOS peers drop ping) — **use SSH as the
reachability test, not ping.** SSH to bravo/charlie/ultron succeeded while every
ping "failed".

## accept-routes / "all routes" on the MAS build
`--accept-routes` CANNOT be set from a code session (CLI broken). On the MAS
build it's the menu-bar toggle **"Use Tailscale subnet routes."** As of
2026-06-04 the only advertised subnet route is `192.168.1.0/24` from
**pi-factory, offline 90d** — so accepting routes buys nothing until a subnet
router (pi-factory, or the PLC laptop `laptop-0ka3c70h`) comes online and
advertises. Factory LAN (192.168.1.x, PLC `192.168.1.100`) is otherwise only
reachable *from* the PLC laptop. See [[ssh-keychain]] for the docker/doppler-
over-SSH caveat on bravo/charlie.
