# Ignition integration — architecture map, branches & migration plan

**Purpose:** one place that says how the Ignition pieces fit together and how they
promote dev → staging → prod, so the in-flight branches don't drift into confusion.
**Authority:** subordinate to [ADR-0021](adr/0021-ignition-module-first-edge.md) (the
edge-architecture decision). This doc is the *map + state*, not a new decision.
**Created:** 2026-06-01.

---

## 1. The two planes

```
 EDGE (the plant / our garage)                 CLOUD (VPS — app.factorylm.com)
 ─────────────────────────────                 ──────────────────────────────────
 Ignition Gateway                              MIRA Hub
   • MIRA Module: Perspective project          • Command Center (UNS tree + live HMI)
     (ConvSimpleLive), WebDev endpoints,        • /audit, /api/v1/audit
     tag allowlist, HMAC client                 • engine (UNS gate, RAG, KG, cascade)
   • polls the PLC LOCALLY (Modbus TCP          • mira-pipeline (chat completions)
     192.168.1.100:502 — never from cloud)      • NeonDB (display_endpoints, audit log)
 Host: PLC laptop today → CHARLIE next
        (see docs/plans/ignition-edge-host-charlie-swap.md)
```

**The contract (ADR-0021):** edge → cloud is **outbound HTTPS only**, HMAC-signed,
allowlist-read-only, audit-logged. **No cloud→plant reach** — no inbound ports, no
reverse tunnel, no VPN/Tailscale *into* the plant. The cloud reasons; the gateway
carries.

## 2. The Command Center display path — and its boundary

The Command Center frames the **live Ignition HMI** so a manager sees the real plant
screen. Mechanically (our garage): browser → Hub display route → **origin-root proxy
on CHARLIE** (`mira-proxy/gateway-origin/`, strips `X-Frame-Options`, forwards the
Perspective WebSocket) → the gateway. See `docs/command-center-ignition-display.md`.

> **Boundary worth stating plainly:** "frame the customer's live HMI from the cloud"
> **does not generalize under ADR-0021** — it requires reaching *into* the plant,
> which the contract forbids. So:
> - **Own plant / garage demo:** the proxy path is fine (we control both ends).
> - **Customer:** live context arrives via the Module's **outbound** tag push +
>   cloud-rendered views, not by framing their gateway. The Command Center live-frame
>   is a **demo / own-infrastructure** capability, not a shipped customer feature.
>   (If a customer "watch my HMI in the Hub" feature is ever wanted, it's a separate
>   design that respects outbound-only — e.g. an Edge-pushed snapshot view.)

## 3. Migrations (ownership + the 031 resolution)

| # | File | Owner / stream | Notes |
|---|------|----------------|-------|
| 030 | `display_endpoints_registry.sql` | Command Center P1 | the display registry table |
| 031 | `ignition_audit_log.sql` | Ignition Module (ADR-0021) | audit log + `/api/v1/audit` |
| 032 | `display_endpoints_grant_delete.sql` | Command Center P2 | **renumbered from 031** to resolve the collision below |

**The collision:** `feat/hub-command-center` defined `031_ignition_audit_log`;
`feat/hub-command-center-phase2` independently defined `031_display_endpoints_grant_delete`.
Two different files, same number → `apply-migrations` mis-tracks one. **Resolution:**
the audit-log keeps **031**; the Phase-2 grant-delete becomes **032**. (Grant-delete is
an idempotent `GRANT`, safe to renumber even though a "031" grant was applied to prod
during the earlier gated deploy — re-applying as 032 is a no-op.)

> Going forward: **one migration number = one file, repo-wide.** Before adding a
> migration, `ls mira-hub/db/migrations/` on `origin/main` *and* every open feature
> branch.

## 4. Branch & PR map (the Ignition epic)

`feat/hub-command-center` has become the **Ignition-integration umbrella branch** —
Command Center *and* the Ignition-Module secure-edge work live on it. The stack:

```
main
 ├─ #1615  /ask HMI endpoint .......................... MERGED
 ├─ #1632  /ask kiosk timeout ......................... MERGED
 ├─ #1620  ignition chat → mira-pipeline cutover ...... open → main
 ├─ #1631  edge-host swap runbook (laptop→CHARLIE) .... open → main  (docs)
 ├─ #1592  folder-brain (separate feature) ............ open → main
 └─ #1593  feat/hub-command-center .................... open → main
       │     = Command Center (tree + green dots + repoint to Ignition ConvSimpleLive)
       │     + Ignition Module: HMAC, tag allowlist, audit log, e2e (ADR-0021, audit D1–D10)
       └─ #1603  feat/hub-command-center-phase2 ........ open → #1593
             │     = cloud-reach (per-id proxy) + display registry CRUD
             └─ #1619  feat/cc-ignition-qa ............. open → #1603
                       = origin-root proxy + QA-A (proxy test) + QA-B (live frame)
```

**Decision to confirm (Mike):** keep `#1593` as the combined umbrella (Command Center +
Module ship together), **or** split the Ignition-Module commits onto their own PR so
Command Center promotes independently. Either is workable; the umbrella is simpler if
they ship together. *(Not auto-resolved here — splitting rewrites an actively-developed
branch; that's a human/peer call, not a unilateral rebase.)*

## 5. Promotion state & order

**Now:** dev is fully correct (Command Center frames live ConvSimpleLive via the proxy;
QA-A/B green). Staging's display row is **stale** (still Node-RED). Nothing Command-
Center is on `main` yet. `/ask` (#1615/#1632) is the only Ignition piece in prod.

**Order to prod (each step gated, dev→staging→prod per `docs/environments.md`):**
1. Land the **032 renumber** (collision fix) on `#1603`/`#1619`.
2. **Reconcile the stack** — confirm §4's umbrella-vs-split decision; bring `#1603`
   current with `#1593`.
3. **Repoint the staging** display row → Ignition; boot a staging Hub; run **QA-B**.
4. Build the **origin-root proxy exposure** (dedicated `cc-gw.*` subdomain + TLS) +
   **watch-only** Ignition session (so the framed HMI can't drive the PLC).
5. Merge the stack → `main`; `apply-migrations` (030/031/032) dev→staging→prod; seed the
   prod display row; nginx leg; **off-LAN smoke** (values render).

## 6. Cross-references

- [ADR-0021](adr/0021-ignition-module-first-edge.md) — edge-architecture decision (the why).
- `docs/mira-ignition-secure-architecture.md` — long-form secure architecture.
- `docs/command-center-ignition-display.md` — Command Center → Ignition feature + QA-B.
- `mira-proxy/gateway-origin/README.md` — origin-root proxy + QA-A.
- `docs/plans/ignition-edge-host-charlie-swap.md` — deferred laptop→CHARLIE host swap.
- Memory: `project_command_center`, `project_ignition_edge_host_swap`.
