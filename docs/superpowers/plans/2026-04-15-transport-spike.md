# Transport Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a hello-world HTTPS endpoint on Bravo behind Tailscale Funnel, run 5 pass/fail gates over a 24h window, and write an ADR that decides (a) Tailscale Funnel vs. Cloudflare Tunnel as the public transport for issue #294, and (b) Stripe webhook placement.

**Architecture:** Single-process Python `http.server` on Bravo Mac Mini bound to a Tailscale-issued cert for `spike.factorylm.com`. Tailscale Funnel exposes port 443. UptimeRobot pings every minute for 24h. `hey` runs webhook-shaped POST load tests at staggered intervals. If any Funnel gate fails, repeat against Cloudflare Tunnel. Output: ADR `docs/adr/0011-transport-choice.md`.

**Tech Stack:** Tailscale (cert + funnel), Python 3 stdlib (`http.server`, `ssl`), `hey` load generator, UptimeRobot (free tier), Bash/zsh on macOS, optional Cloudflare Tunnel (`cloudflared`) as fallback.

**Spec:** `docs/superpowers/specs/2026-04-15-transport-spike-design.md`

**Issue:** [#294](https://github.com/Mikecranesync/MIRA/issues/294)

---

## File Structure

| Path | Purpose | Created in task |
|---|---|---|
| `tools/spike/hello_server.py` | ~50-line Python HTTPS server with `/`, `/hook`, `/health` | Task 2 |
| `tools/spike/test_hello_server.py` | Pytest unit tests for the three handlers | Task 2 |
| `tools/spike/hey_body.json` | JSON body used by `hey` for Gate 4 POST load test | Task 6 |
| `tools/spike/uptime_report.md` | Manual capture of measurements (plan tier, sleep settings, Gate 3 %, Gate 4 p95, screenshots paths) | Task 1, appended through Task 7 |
| `docs/adr/0011-transport-choice.md` | Final ADR — transport decision + Stripe placement | Task 9 |

No production runtime files modified. No changes to `docker-compose.saas.yml`, Doppler, or any service in `mira-*/`.

**DNS:** One throwaway record at the registrar — `spike.factorylm.com` CNAME. Removed in Task 10. **Apex untouched.**

---

## Task 1: Pre-flight checks on Bravo

**Files:**
- Create: `tools/spike/uptime_report.md`

- [ ] **Step 1: Open Bravo session.** Use a local Terminal on Bravo (not SSH from Windows) to avoid the macOS keychain prompt issue documented in `~/.claude/projects/.../memory/feedback_docker_ssh.md`.

Verify you're on Bravo:
```bash
hostname
# Expected: bravo (or bravo.local)
```

- [ ] **Step 2: Verify Tailscale + Funnel availability.**

```bash
tailscale version
tailscale status | head -3
tailscale funnel status 2>&1 || echo "funnel not yet enabled — that is OK"
```

Expected: Tailscale running, Bravo node visible, `funnel` subcommand recognized (it ships with all current Tailscale versions on macOS).

- [ ] **Step 3: Capture Tailscale plan tier (Gate 2 input).** Open https://login.tailscale.com/admin/settings/general in a browser on Bravo. Note plan name (Free / Personal Pro / Starter / Premium / Enterprise).

- [ ] **Step 4: Check Bravo sleep settings (risk mitigation for Gate 3).**

```bash
pmset -g | egrep 'sleep|disksleep|displaysleep|womp|tcpkeepalive'
```

Expected output should include `sleep 0` (system sleep disabled). If any of `sleep`, `disksleep`, or `tcpkeepalive` look wrong, fix before proceeding:
```bash
sudo pmset -a sleep 0 disksleep 0 womp 1 tcpkeepalive 1
```

- [ ] **Step 5: Create the report file with captured values.**

Create `tools/spike/uptime_report.md` with this exact content (substitute your actual values for `<PLAN_TIER>` and the `pmset` line):

```markdown
# Transport Spike — Measurements Report

Spike start: <YYYY-MM-DD HH:MM TZ>

## Pre-flight (Task 1)
- Tailscale plan tier: <PLAN_TIER>
- `pmset -g` (sleep-relevant lines):
  ```
  <paste the egrep output here>
  ```

## Gate 1 — Custom domain binds
TBD-Task-4

## Gate 2 — Bandwidth headroom
TBD-Task-1 (recorded above) — must be ≥ 5 GB/mo cap; Free tier confirms via Tailscale docs.

## Gate 3 — 24h reachability
TBD-Task-7

## Gate 4 — Webhook-shaped POST p95
TBD-Task-6 (run 1) / Task-7 (final)

## Gate 5 — TLS sanity
TBD-Task-4

## Cloudflare run (only if any Funnel gate failed)
TBD-Task-8
```

The `TBD-Task-N` placeholders are intentional pointers — each later task fills in its row.

- [ ] **Step 6: Commit.**

```bash
cd <path-to-MIRA-repo-on-Bravo>  # e.g. /Users/bravonode/MIRA — confirm with `git remote -v` first
git remote -v  # MUST show github.com/Mikecranesync/MIRA — not a different fork
git add tools/spike/uptime_report.md
git commit -m "chore(spike): pre-flight measurements for transport spike (issue #294)"
```

---

## Task 2: Write hello_server.py with tests

**Files:**
- Create: `tools/spike/hello_server.py`
- Create: `tools/spike/test_hello_server.py`

- [ ] **Step 1: Write the failing tests first.**

Create `tools/spike/test_hello_server.py`:

```python
"""Tests for the spike hello server. Run BEFORE writing the server."""
from __future__ import annotations

import json
import threading
from http.client import HTTPConnection

import pytest

from hello_server import build_server


@pytest.fixture
def server():
    httpd = build_server(("127.0.0.1", 0))  # ephemeral port
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield port
    httpd.shutdown()


def _get(port: int, path: str) -> tuple[int, bytes]:
    conn = HTTPConnection("127.0.0.1", port, timeout=2)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return resp.status, body


def _post(port: int, path: str, payload: dict) -> tuple[int, bytes]:
    conn = HTTPConnection("127.0.0.1", port, timeout=2)
    body = json.dumps(payload).encode()
    conn.request("POST", path, body=body, headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    out = resp.read()
    conn.close()
    return resp.status, out


def test_root_returns_hello(server: int):
    status, body = _get(server, "/")
    assert status == 200
    assert body == b"hello"


def test_health_returns_200(server: int):
    status, body = _get(server, "/health")
    assert status == 200
    assert body == b"ok"


def test_hook_echoes_post_body(server: int):
    payload = {"event": "test", "n": 42}
    status, body = _post(server, "/hook", payload)
    assert status == 200
    assert json.loads(body) == payload


def test_unknown_path_returns_404(server: int):
    status, _ = _get(server, "/nope")
    assert status == 404
```

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd tools/spike && python -m pytest test_hello_server.py -v
```

Expected: `ModuleNotFoundError: No module named 'hello_server'` (or all 4 tests fail with import error).

- [ ] **Step 3: Write the minimal server.**

Create `tools/spike/hello_server.py`:

```python
"""Hello-world HTTPS server for the transport spike.

Three endpoints:
  GET /        -> 200 "hello"
  GET /health  -> 200 "ok"
  POST /hook   -> 200 echo of the JSON body

For Tailscale Funnel: pass the cert/key paths emitted by `tailscale cert`.
For local pytest: use build_server() to skip TLS.
"""
from __future__ import annotations

import json
import ssl
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class SpikeHandler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, ctype: str = "text/plain") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Strict-Transport-Security", "max-age=31536000")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/":
            self._send(200, b"hello")
        elif self.path == "/health":
            self._send(200, b"ok")
        else:
            self._send(404, b"not found")

    def do_POST(self) -> None:
        if self.path != "/hook":
            self._send(404, b"not found")
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._send(400, b"invalid json")
            return
        self._send(200, json.dumps(payload).encode(), ctype="application/json")

    def log_message(self, format: str, *args) -> None:  # quieter test output
        return


def build_server(addr: tuple[str, int]) -> HTTPServer:
    return HTTPServer(addr, SpikeHandler)


def serve_tls(host: str, port: int, certfile: str, keyfile: str) -> None:
    httpd = build_server((host, port))
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(certfile=certfile, keyfile=keyfile)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"https://{host}:{port}/  (cert={certfile})", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.stderr.write("usage: hello_server.py <bind-host> <cert.crt> <cert.key>\n")
        sys.exit(2)
    serve_tls(sys.argv[1], 443, sys.argv[2], sys.argv[3])
```

- [ ] **Step 4: Run the tests and confirm they pass.**

```bash
cd tools/spike && python -m pytest test_hello_server.py -v
```

Expected: `4 passed`.

- [ ] **Step 5: Commit.**

```bash
git add tools/spike/hello_server.py tools/spike/test_hello_server.py
git commit -m "chore(spike): hello-world TLS server for transport spike (issue #294)"
```

---

## Task 3: Add throwaway DNS record

**Files:**
- None in repo.
- External: registrar DNS record for `spike.factorylm.com`.

- [ ] **Step 1: Get Bravo's tailnet hostname.**

```bash
tailscale status --json | python -c "import sys,json; d=json.load(sys.stdin); print(d['Self']['DNSName'].rstrip('.'))"
```

Expected: something like `bravo.tail1234.ts.net`. Save this exact string for the next step.

- [ ] **Step 2: Add the CNAME at the registrar.** Log in to the DNS provider for `factorylm.com`. Add ONE record:

| Type | Host | Value | TTL |
|---|---|---|---|
| CNAME | `spike` | `<bravo-tailnet-hostname-from-step-1>.` (note the trailing dot) | 300 |

**Stop and verify before saving:** the Host field should read exactly `spike` (or `spike.factorylm.com.` if your registrar requires FQDN). It must NOT be `@`, blank, `*`, `app`, or `www`. Re-read the row before clicking save. An accidental apex CNAME breaks production immediately.

- [ ] **Step 3: Verify DNS resolution.**

```bash
dig +short spike.factorylm.com
# Expected: <bravo-tailnet-hostname>
# Then a follow-up A record from Tailscale's DNS, e.g. 100.86.236.11 (Tailscale IP)
```

If `dig` returns nothing, wait 60s for TTL; if still nothing, the registrar didn't save the record.

- [ ] **Step 4: Append confirmation to uptime_report.md.**

Append to `tools/spike/uptime_report.md`:

```markdown

## Task 3 — DNS
- Bravo tailnet hostname: <bravo.tail1234.ts.net>
- Spike CNAME: spike.factorylm.com → <bravo.tail1234.ts.net>
- `dig +short spike.factorylm.com` output:
  ```
  <paste output here>
  ```
```

- [ ] **Step 5: Commit.**

```bash
git add tools/spike/uptime_report.md
git commit -m "chore(spike): record DNS CNAME for spike.factorylm.com"
```

---

## Task 4: Tailscale cert + Funnel + verify Gates 1 & 5

**Files:** none modified in repo (uptime_report.md updated in Step 7).

- [ ] **Step 1: Issue the cert.**

```bash
sudo tailscale cert spike.factorylm.com
```

Expected: writes `spike.factorylm.com.crt` and `spike.factorylm.com.key` to the current directory. Move them to a known location:

```bash
mkdir -p ~/spike-certs
mv spike.factorylm.com.* ~/spike-certs/
ls -la ~/spike-certs/
```

If the command fails with `not authorized to issue certs`, enable HTTPS in the Tailscale admin: https://login.tailscale.com/admin/dns → "Enable HTTPS". Then retry.

- [ ] **Step 2: Start the server.**

In a dedicated terminal window (so it stays alive for 24h):

```bash
cd <MIRA-repo-on-Bravo>  # same path used in Task 1 Step 6
sudo python3 tools/spike/hello_server.py 0.0.0.0 \
  ~/spike-certs/spike.factorylm.com.crt \
  ~/spike-certs/spike.factorylm.com.key
```

Expected stdout: `https://0.0.0.0:443/  (cert=...crt)`. Leave this terminal open.

- [ ] **Step 3: Enable Funnel.**

In a NEW terminal:

```bash
sudo tailscale funnel 443 on
tailscale funnel status
```

Expected `funnel status`: shows `https://spike.factorylm.com` (or the tailnet name) → `:443`.

- [ ] **Step 4: Verify Gate 1 from three vantage points.**

From Bravo's local terminal (in-tailnet):
```bash
curl -sv https://spike.factorylm.com/ 2>&1 | tail -20
# Expected: HTTP/1.1 200, body "hello", valid TLS handshake.
```

From Windows laptop (via Tailscale):
```bash
curl -sv https://spike.factorylm.com/
# Expected: same as above.
```

From phone on cellular (off-Tailscale, REAL public-internet test): open `https://spike.factorylm.com/` in mobile browser. Expected: page renders "hello", padlock icon present.

If the cellular test fails but Tailscale-side passes, Funnel didn't enable — re-check Step 3.

- [ ] **Step 5: Verify Gate 5 (TLS sanity).**

Use SSL Labs (browser): https://www.ssllabs.com/ssltest/analyze.html?d=spike.factorylm.com&hideResults=on
Expected: grade A or A+ within ~2 minutes.

OR if `testssl.sh` is installed:
```bash
testssl.sh --quiet --color 0 https://spike.factorylm.com 2>&1 | grep -E '(grade|HSTS|chain)'
```
Expected: no `NOT ok` in chain or HSTS lines.

- [ ] **Step 6: Append Gate 1 + 5 results to uptime_report.md.**

```markdown

## Task 4 — Funnel up; Gates 1 & 5
- `tailscale funnel status`:
  ```
  <paste>
  ```
- Gate 1 (Bravo local curl): PASS / FAIL
- Gate 1 (Windows curl): PASS / FAIL
- Gate 1 (cellular browser): PASS / FAIL
- Gate 5 (SSL Labs grade): A / A+ / other
- Gate 5 (HSTS header observed): YES / NO
```

- [ ] **Step 7: Commit.**

```bash
git add tools/spike/uptime_report.md
git commit -m "chore(spike): record Gate 1 + Gate 5 results"
```

---

## Task 5: Register UptimeRobot monitor (Gate 3 starts the clock)

**Files:** `tools/spike/uptime_report.md` updated.

- [ ] **Step 1: Create UptimeRobot account if needed.** https://uptimerobot.com/signUp — free tier covers 50 monitors at 1-min interval (enough for this spike).

- [ ] **Step 2: Add the monitor.** Dashboard → Add New Monitor:
- Type: HTTP(s)
- Friendly name: `mira-transport-spike`
- URL: `https://spike.factorylm.com/health`
- Monitoring interval: **1 minute** (paid feature on some plans — if locked to 5-min, that's acceptable; record the interval used)
- Alert contacts: your email + (optional) phone push

Click Create Monitor.

- [ ] **Step 3: Note the start timestamp.** UptimeRobot displays "monitor created at \<timestamp\>". Capture it (UTC).

- [ ] **Step 4: Append start info to uptime_report.md.**

```markdown

## Task 5 — Gate 3 monitor started
- UptimeRobot start (UTC): <YYYY-MM-DDTHH:MMZ>
- Interval: 1m / 5m
- Monitor URL in dashboard: <copy from UptimeRobot>
- Planned end (UTC): <start + 24h>
```

- [ ] **Step 5: Commit.**

```bash
git add tools/spike/uptime_report.md
git commit -m "chore(spike): start 24h Gate 3 uptime monitor"
```

---

## Task 6: First Gate 4 run (webhook-shaped POST load)

**Files:**
- Create: `tools/spike/hey_body.json`
- Modify: `tools/spike/uptime_report.md`

- [ ] **Step 1: Install `hey` on the client machine.**

The test should run from a machine that is NOT Bravo (so the measurement traverses the public network, not loopback). Use Windows or Travel laptop.

```bash
# Windows: install Go (https://go.dev/dl/), then:
#   go install github.com/rakyll/hey@latest
#   (binary lands in %USERPROFILE%\go\bin\hey.exe — add to PATH)
# macOS:   brew install hey
# Linux:   apt install hey  (or the Go install above)
hey -h 2>&1 | head -1
```

Expected: usage banner.

- [ ] **Step 2: Create the JSON body.**

`tools/spike/hey_body.json`:
```json
{"event": "spike.test", "id": "tx_0001", "amount": 1234, "metadata": {"source": "transport-spike"}}
```

- [ ] **Step 3: Run 50 sequential POSTs.**

```bash
hey -n 50 -c 5 -m POST -T application/json -D tools/spike/hey_body.json https://spike.factorylm.com/hook
```

Expected output includes a `Status code distribution: [200] 50 responses` line and a `Latency distribution` block with a `95%` row.

- [ ] **Step 4: Capture the result in uptime_report.md.**

```markdown

## Task 6 — Gate 4 run #1
- Timestamp: <YYYY-MM-DDTHH:MMZ>
- Run from: <Windows / Travel laptop / Bravo>
- 200 count: <50 / N>
- p95 latency: <Xms>
- Pass criterion: 50 × 200 AND p95 < 500ms
- Result: PASS / FAIL
```

- [ ] **Step 5: Schedule two more runs.** Set a reminder/timer for ~T+8h and ~T+16h (you want measurements at different times of day). Each repeat = run Step 3, append to the report under `Gate 4 run #2` and `#3`.

- [ ] **Step 6: Commit (the JSON body + report update).**

```bash
git add tools/spike/hey_body.json tools/spike/uptime_report.md
git commit -m "chore(spike): Gate 4 first POST load run"
```

---

## Task 7: T+24h — capture final results, branch on outcome

**Files:**
- Modify: `tools/spike/uptime_report.md`

- [ ] **Step 1: Pull final UptimeRobot uptime %.** Open the monitor in UptimeRobot, set the date range to the spike start → now (~24h). Read the "Uptime" stat (e.g. `99.87%`).

- [ ] **Step 2: Run final Gate 4 batch.** Same command as Task 6 Step 3. Record p95.

- [ ] **Step 3: Append Task 7 results.**

```markdown

## Task 7 — Final results (T+24h)
- Gate 3 (24h uptime %): <value>
- Gate 3 outcome: PASS (≥99%) / FAIL
- Gate 4 final p95: <Xms>, 200 count: <N>/50
- Gate 4 outcome: PASS / FAIL

### Funnel summary
| Gate | Result |
|---|---|
| 1 — Custom domain binds | <PASS/FAIL from Task 4> |
| 2 — Bandwidth ≥ 5 GB/mo | <PASS — Free tier docs / FAIL> |
| 3 — 24h reachability | <PASS/FAIL from this task> |
| 4 — Webhook-shaped POST | <PASS/FAIL from this task> |
| 5 — TLS sanity | <PASS/FAIL from Task 4> |

**All-green?** YES → skip Task 8, go to Task 9.
**Any red?** → run Task 8 (Cloudflare Tunnel re-run).
```

- [ ] **Step 4: Commit.**

```bash
git add tools/spike/uptime_report.md
git commit -m "chore(spike): T+24h Funnel results captured"
```

---

## Task 8: Cloudflare Tunnel re-run (CONDITIONAL — skip if Task 7 all-green)

**Files:**
- Modify: `tools/spike/uptime_report.md`

Skip this entire task if Task 7's Funnel summary is all-green.

- [ ] **Step 1: Tear down Funnel temporarily.**

```bash
sudo tailscale funnel 443 off
# Leave hello_server.py running on :443 — Cloudflare Tunnel will reach it locally.
```

- [ ] **Step 2: Install cloudflared on Bravo.**

```bash
brew install cloudflared
cloudflared --version
```

- [ ] **Step 3: Authenticate cloudflared.**

```bash
cloudflared tunnel login
# Opens browser → log in to Cloudflare account → select factorylm.com zone.
```

If `factorylm.com` isn't in any Cloudflare account, this is a **stop sign** — escalate to Mike. Don't move the registrar; it's out of scope.

- [ ] **Step 4: Create the tunnel.**

```bash
cloudflared tunnel create mira-transport-spike
# Records a tunnel UUID and writes credentials JSON to ~/.cloudflared/<UUID>.json.
cloudflared tunnel route dns mira-transport-spike spike.factorylm.com
```

The route command UPDATES the existing `spike.factorylm.com` DNS record from CNAME-to-tailnet over to a CNAME-to-tunnel. The same throwaway hostname is reused — no apex risk.

- [ ] **Step 5: Run the tunnel.**

```bash
cloudflared tunnel --url https://localhost:443 --no-tls-verify run mira-transport-spike
# --no-tls-verify because hello_server.py uses the Tailscale cert which Cloudflare doesn't validate.
```

Leave running for 24h.

- [ ] **Step 6: Re-run Gates 1, 3, 4, 5.** Same commands as Tasks 4 (Step 4 + 5), 5, 6, 7. Append all results to uptime_report.md under a `## Cloudflare run` section, mirroring the Funnel summary table.

- [ ] **Step 7: Commit each milestone (Gate 1 + 5 capture, Gate 3 monitor start, T+24h capture) — three commits total to mirror Tasks 4/5/7.**

```bash
git add tools/spike/uptime_report.md
git commit -m "chore(spike): Cloudflare Tunnel <milestone> results"
```

---

## Task 9: Write ADR 0011 — transport choice

**Files:**
- Create: `docs/adr/0011-transport-choice.md`

- [ ] **Step 1: Read the template.**

```bash
cat docs/adr/0008-sidecar-deprecation.md
```

Note the structure (Status, Context, Decision, Consequences, etc.). Match it.

- [ ] **Step 2: Apply the decision matrix from the spec.**

From `tools/spike/uptime_report.md`:
- Transport decision:
  - All 5 Funnel gates green → Funnel.
  - Any red → whichever transport (Funnel/Cloudflare) passed more gates. Funnel wins ties.
- Stripe webhook decision (uses **winning transport's** Gate 3 %):
  - ≥ 99.9% → host on Bravo
  - 99.0–99.9% → keep $6/mo droplet forwarder for `/api/stripe/webhook` only
  - < 99% → revisit migration before any cutover

- [ ] **Step 3: Write the ADR.**

Create `docs/adr/0011-transport-choice.md`:

```markdown
# ADR 0011: Transport Choice for VPS→Bravo Migration

**Status:** Accepted
**Date:** <YYYY-MM-DD>
**Issue:** [#294](https://github.com/Mikecranesync/MIRA/issues/294)
**Spec:** [docs/superpowers/specs/2026-04-15-transport-spike-design.md](../superpowers/specs/2026-04-15-transport-spike-design.md)

## Context

Issue #294 plans to retire the DigitalOcean VPS and serve `factorylm.com` + `app.factorylm.com` from Bravo Mac Mini over a public tunnel. Two viable tunnels: Tailscale Funnel (single-vendor, already on the network) and Cloudflare Tunnel (custom-domain-native, edge retry buffer). The transport spike (sub-project 1) measured both against five pass/fail gates over a 24h window using a hello-world server at `spike.factorylm.com`.

## Measured outcomes

### Tailscale Funnel
| Gate | Result | Notes |
|---|---|---|
| 1 — Custom domain binds | <PASS/FAIL> | <one-liner> |
| 2 — Bandwidth ≥ 5 GB/mo | <PASS/FAIL> | Tailscale plan: <tier>, cap: <X GB/mo> |
| 3 — 24h reachability | <X.XX%> | <PASS/FAIL — threshold 99%> |
| 4 — Webhook POST p95 | <X ms>, <N>/50 200s | <PASS/FAIL> |
| 5 — TLS sanity | <grade> | <PASS/FAIL> |

### Cloudflare Tunnel (only if Funnel had any red)
<same table or "N/A — Funnel all-green, Cloudflare not measured">

## Decision

**Transport:** <Tailscale Funnel / Cloudflare Tunnel>.

**Rationale:** <Plain English referencing the gate table. If Funnel won by default rule, say so. If a comparison was needed, cite the gate counts.>

**Stripe webhook placement:** <(a) Bravo / (b) droplet forwarder / (c) revisit>.

**Rationale:** Winning transport's Gate 3 measured at <X.XX%>, which falls in the <≥99.9% / 99.0–99.9% / <99%> band per the spec's decision matrix.

## Consequences

- Sub-project 2 (Bravo stack bring-up) starts using <chosen transport> + Caddy.
- Sub-project 3 (cutover) must include a longer (7-day) reachability window before flipping the apex DNS — this 24h spike is not authoritative for production.
- <If droplet forwarder chosen:> a $6/mo DO droplet is retained as the Stripe webhook endpoint. ADR-0008-style retirement plan for the droplet itself is deferred until uptime improves.
- <If Bravo placement chosen:> Stripe webhook delivery now depends on residential ISP + Bravo uptime. Stripe's 3-day retry window absorbs short outages.
- Bravo `pmset` settings of record: <paste from uptime_report.md>.

## Related

- ADR-0008 (sidecar deprecation) — predecessor migration whose retirement timing depends on this one.
- Issue #294 — parent migration tracking.
- `docs/runbooks/factorylm-vps.md` — current VPS layout to be replaced.
```

Fill in every `<...>` from `tools/spike/uptime_report.md`. Do NOT leave any angle-brackets in the committed ADR.

- [ ] **Step 4: Verify no placeholders remain.**

```bash
grep -nE '<[^>]+>' docs/adr/0011-transport-choice.md
# Expected: no output. Any output is a placeholder you forgot to fill.
```

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0011-transport-choice.md
git commit -m "docs: ADR-0011 transport choice for issue #294 (sub-project 1 outcome)"
```

---

## Task 10: Tear down

**Files:**
- Modify: `tools/spike/uptime_report.md` (final close-out line)

- [ ] **Step 1: Stop the spike server.** In the terminal running `hello_server.py`, press Ctrl-C. Confirm process gone:

```bash
pgrep -fl hello_server.py
# Expected: no output.
```

- [ ] **Step 2: Disable Funnel (if still on).**

```bash
sudo tailscale funnel 443 off
tailscale funnel status
# Expected: "No serve config" or empty.
```

- [ ] **Step 3: Stop cloudflared (if Task 8 ran).** Ctrl-C the `cloudflared tunnel run` process. Then:

```bash
cloudflared tunnel delete mira-transport-spike
```

- [ ] **Step 4: Remove DNS record.** At the registrar, delete the `spike` CNAME. Verify:

```bash
dig +short spike.factorylm.com
# Expected: no output (or NXDOMAIN after TTL).
```

- [ ] **Step 5: Delete UptimeRobot monitor.** Dashboard → `mira-transport-spike` → Delete.

- [ ] **Step 6: Keep the Tailscale cert.** Do NOT delete `~/spike-certs/`. Sub-project 2 will re-use the cert pattern (and possibly the cert itself if `spike.factorylm.com` is reused as a staging vhost).

- [ ] **Step 7: Append close-out line and commit.**

```markdown

## Task 10 — Teardown complete (<YYYY-MM-DDTHH:MMZ>)
- Server stopped, Funnel off, cloudflared deleted (if used), DNS removed, UptimeRobot monitor deleted.
- Cert retained at ~/spike-certs/ for potential reuse in sub-project 2.
```

```bash
git add tools/spike/uptime_report.md
git commit -m "chore(spike): teardown — return Bravo to pre-spike state"
```

- [ ] **Step 8: Move issue #294 to In Progress on the kanban.** The transport decision is recorded; sub-project 2 work is unblocked.

```bash
gh project item-list 4 --owner Mikecranesync --format json --limit 300 | python -c "
import sys, json
items = json.load(sys.stdin)['items']
hit = [i for i in items if i.get('content',{}).get('number')==294]
print(hit[0]['id'] if hit else 'NOT FOUND')
"
# Use the printed item ID:
gh project item-edit --project-id PVT_kwHODSgiRM4BSa9e --id <ITEM_ID> \
  --field-id PVTSSF_lAHODSgiRM4BSa9ezg_9d4k \
  --single-select-option-id 47fc9ee4
```

---

## Self-review notes

- **Spec coverage:** All 5 gates → Tasks 4 (Gates 1, 5), 1 (Gate 2 input), 5+7 (Gate 3), 6+7 (Gate 4). Decision matrix → Task 9. Tear-down → Task 10. ADR template reference → Task 9 Step 1.
- **Type consistency:** `build_server((host, port))` signature consistent between `hello_server.py` and `test_hello_server.py`. JSON echo behavior (`json.loads(payload) == payload`) round-trips identically in test and impl.
- **No placeholders in code:** Every code block is complete and runnable. The ADR template uses `<...>` placeholders intentionally (filled at Task 9 Step 3); Step 4 of that task is an explicit grep that fails the build if any are forgotten.
- **DNS apex safety:** Three explicit guards — Task 3 Step 2 ("STOP and verify"), Task 8 Step 4 (reuses same `spike` host, no apex change), Task 10 Step 4 (removal verified with `dig`).
- **Mac sleep risk:** Task 1 Step 4 catches before the 24h clock starts.

---

## Out of scope (do NOT attempt in this plan)

- Real Stripe events (sub-project 2)
- Caddy multi-vhost config (sub-project 2)
- Porting `docker-compose.saas.yml` (sub-project 2)
- DNS cutover of `factorylm.com` or `app.factorylm.com` (sub-project 3)
- Decommissioning the DO VPS (sub-project 3)
