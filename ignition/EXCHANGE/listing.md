# Ignition Exchange Listing — MIRA Maintenance Copilot

Copy/paste-ready content for the [Ignition Exchange submission form](https://inductiveautomation.com/exchange/submit).
Each section maps to a field in the Exchange web form.

> **Note on sibling listing.** A lighter companion listing lives at
> `mira-ignition-exchange/EXCHANGE_LISTING.md` — that one ships only Perspective
> views (ChatDock + ScanWidget) and requires no WebDev module. This listing is the
> full secure module: WebDev endpoints + gateway tag-stream + relay + Perspective
> project. Mike should decide whether to publish one listing or both.

---

## Resource Name

**MIRA Maintenance Copilot**

## Tagline (≤ 100 chars)

AI troubleshooting grounded in your real plant tags — inside Perspective.

## Short Description (≤ 280 chars)

MIRA is an AI maintenance assistant that runs inside your Ignition Gateway. It reads the tags you approve, streams them to the MIRA Cloud reasoning engine, and answers maintenance questions in Perspective — grounded in your actual PLC data, your manuals, and your work-order history.

## Long Description

### The wedge — maintenance copilot grounded in your real plant context

Your technicians already have Ignition open. MIRA lives there too.

MIRA installs as an Ignition project + WebDev endpoints + a gateway tag-stream script. It reads the tags you put on a monitored folder, sends them outbound to MIRA Cloud, and routes maintenance questions to an AI reasoning engine that knows your equipment — because it has your manuals, your fault history, and your tag values at the time of the failure.

The result: a technician opens Perspective, types "why did Conveyor B16 fault?", and gets a grounded answer in under 5 seconds that cites the GS10 fault code from your OEM manual, the tag values at time of fault, and the last work order on that asset. Not a generic LLM response — a maintenance-specific answer grounded in your plant.

### What this bundle installs

| Piece | Purpose |
|---|---|
| **Perspective project (ConveyorMIRA)** | ConveyorStatus view (live VFD metrics + state banner), FaultLog view, NavBar. The HMI the technician has open. |
| **WebDev endpoints** (`/chat`, `/tags`, `/status`, `/alerts`, `/connect`, `/ingest`) | The bridge between Ignition and MIRA Cloud. `/chat` forwards the technician's question + a tag snapshot. `/connect` handles tenant activation. |
| **Gateway timer script** (`tag-stream.py`) | Reads the tags in your monitored folder every 2 s and POSTs outbound to MIRA Cloud. Ignition does I/O; MIRA does reasoning. |
| **FSM monitor + stuck-state detector** | Tag-change script that records state transitions; timer script that fires an alert when an asset freezes in one state beyond its normal dwell time. |
| **`factorylm.properties`** | All configuration in one file — relay URL, tenant ID, stream folder, FSM tuning. Read fresh on each script tick; no Gateway restart to apply changes. |
| **`deploy_ignition.ps1`** | 3-command PowerShell installer. Idempotent — safe to re-run after updates. |

### Security — the one-paragraph version for IT

MIRA installs as an Ignition gateway script and WebDev endpoints. It only reads the tags you place in the MIRA monitored folder, and it only ever makes outbound HTTPS calls to `*.factorylm.com:443`. It never opens a listening port, never talks to your PLC directly, and never writes a tag. You allow one outbound firewall rule and nothing else changes on your network.

Specifically:
- **Outbound HTTPS only.** No inbound ports. No VPN. No reverse tunnel.
- **Read-only.** No `system.tag.writeBlocking` anywhere in this bundle.
- **You control the tag list.** Put only the tags MIRA should see in the monitored folder. Nothing outside that folder is touched.
- **Tenant-scoped auth.** A bearer key unique to your deployment signs every outbound call.
- **Safety guardrails.** Arc-flash, LOTO, and confined-space queries produce a STOP escalation card — never an AI-generated procedure.

Full security model: `docs/mira-ignition-secure-architecture.md`

### What MIRA does NOT do

Being honest about scope is part of the pitch:

- MIRA does not replace Ignition, your historian, or your CMMS. It reads from them and reasons over them.
- MIRA does not write tags. There is no writable-tag mode in this release.
- MIRA does not talk Modbus, EtherNet/IP, or OPC-UA from the cloud. Your PLC traffic stays on your plant LAN where it belongs.
- MIRA does not predict failures or generate AI-optimized setpoints. It diagnoses current and recent faults — grounded in evidence, not speculation.

### Pricing

Free to install. A FactoryLM account is required for tag streaming and AI answers. See [factorylm.com/pricing](https://factorylm.com/pricing).

---

## Category

Primary: **Perspective Resources**
Secondary: **AI / Machine Learning**

## Tags / Keywords

```
perspective, ai, llm, maintenance, troubleshooting, asset-management,
industrial, conveyor, grounded-ai, tag-stream, factorylm, opc-ua
```

## Feature List

- **Grounded AI answers.** Every response cites the tag value, manual section, or work-order entry it reasoned from — no hallucinated procedures.
- **Perspective-native.** ConveyorStatus view + Chat panel run inside the same Ignition session your technician already has open.
- **Live tag context.** The chat endpoint captures a tag snapshot at query time so the AI knows what the plant was doing when the question was asked.
- **Tag folder allowlist.** MIRA reads only the tags you place in `[default]Mira_Monitored`. Zero enumeration of tags outside that folder.
- **Outbound-only HTTPS.** The only network change needed is one outbound 443 rule to `*.factorylm.com`. No inbound ports, no VPN, no exposed Gateway.
- **Read-only, no PLC writes.** Zero `system.tag.writeBlocking` in any MIRA script.
- **PII sanitization.** IP, MAC, and serial numbers are scrubbed before any LLM call.
- **Safety escalation.** Arc-flash, LOTO, confined-space — STOP card, not an auto-generated procedure.
- **FSM anomaly detection.** The included gateway scripts build a state-machine model from your tag history and fire alerts when timing deviates from baseline.
- **3-command install.** `deploy_ignition.ps1` is idempotent and runs in under 5 minutes on a standard gateway.
- **Cascade inference (Groq → Cerebras → Gemini).** No Anthropic, no single-vendor lock-in, no API key to manage.
- **MIT licensed.** Free for commercial use.

## Compatibility

- **Ignition Version:** 8.1.20+
- **Tested on:** 8.1.44
- **Editions:** Standard, Edge Panel (Maker untested but expected to work)
- **Modules Required:** WebDev, Perspective
- **Modules Optional:** None
- **OS:** Windows (PowerShell installer) or Linux (manual copy path documented)

## Author

**FactoryLM** — Industrial AI for plant maintenance.
[factorylm.com](https://factorylm.com) · [support@factorylm.com](mailto:support@factorylm.com) · [GitHub](https://github.com/Mikecranesync/MIRA)

## License

MIT — see `LICENSE` in this directory.

---

## Screenshots

Reference the existing `docs/promo-screenshots/` archive for real Ignition Gateway and Command Center captures. Recommended screenshots for the Exchange submission form (all at 1440×900 desktop unless noted):

| Filename | Subject | Exists in archive? |
|---|---|---|
| `2026-05-31_ignition-gateway-home_desktop.png` | Ignition Gateway home — proves Gateway context | Yes |
| `2026-05-31_ignition-gateway-devices_desktop.png` | Device connections (Modbus TCP connected) | Yes |
| `2026-05-31_ignition-gateway-projects_desktop.png` | Projects list (ConveyorMIRA visible) | Yes |
| `2026-05-31_ignition-gateway-opcua_desktop.png` | OPC-UA server / tag browse | Yes |
| `2026-05-31_ignition-gateway-LIVE_desktop.png` | Gateway live status | Yes |
| `2026-05-31_command-center-DEV-LIVE-tree.png` | Hub Command Center — UNS tree with live data | Yes |
| `2026-05-31_command-center-ConvSimpleLive-LIVE-framed_desktop.png` | Live conveyor data in the hub | Yes |
| `NEEDED: perspective-conveyor-status-desktop.png` | ConveyorStatus view with live VFD tags | **Not yet — capture from PLC laptop** |
| `NEEDED: perspective-chat-grounded-answer.png` | Chat panel showing a grounded fault answer | **Not yet — requires D2/D3** |
| `NEEDED: perspective-fault-log.png` | FaultLog view | **Not yet** |

---

## Submission Checklist

Before submitting to the Exchange:

- [ ] Capture the three missing screenshots above (ConveyorStatus live, grounded chat answer, FaultLog).
- [ ] Complete D1 (allowlist enforcement) and D2/D3 (cloud chat endpoint) so the "grounded answer" claim is demonstrable end-to-end.
- [ ] Bump `version` in `manifest.json` to `1.0.0`.
- [ ] Zip `ignition/project/` + `ignition/webdev/` + `ignition/gateway-scripts/` + `ignition/config/` as `mira-maintenance-copilot-1.0.0.zip` for upload.
- [ ] Confirm `RELAY_URL` default in `factorylm.properties.template` resolves to the production relay.
- [ ] Decide whether to publish this listing alongside `mira-ignition-exchange/` (lightweight widget) or merge them.
- [ ] IA Exchange review: ~1–2 weeks. Request expedited review if submitting for a trade-show deadline.
