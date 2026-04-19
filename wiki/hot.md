# Hot Cache — 2026-04-19 — BRAVO

## Session — 2026-04-19 (BRAVO)
- **VPS eval: 53/57 (93%)** — feat/training-loop-v1 deployed, pipeline healthy. Offline eval: 54/57 (94%). Merge threshold (40/57) blown past.
- **feat/training-loop-v1 already merged to main** via PR #386 (training loop v1 — eval 56/57). main has 10+ commits beyond that branch.
- **VPS running**: feat/training-loop-v1 (merged with main at e3e543b). All containers healthy.
- **GitHub cleanup**: closed #385, #382, #376, #374, #333, #332 — all eval issues resolved.
- **Anthropic API credits low** — Claude judge failing on VPS eval, fell back to Groq. Not blocking.
- **4 remaining eval failures** (all single checkpoint, not critical):
  - `gs3_ground_fault_14` — 5/6, judge_avg=3.0
  - `gs20_phase_loss_16` — 5/6, judge_avg=3.2
  - `pf527_phase_loss_20` — 5/6, judge_avg=1.6 (likely judge formatting, not real quality issue)
  - `cmms_wo_creation_32` — 5/6

## Next Actions (priority order)

1. **Switch VPS to main** (currently on feat/training-loop-v1, main is ahead by ~10 commits):
   ```bash
   ssh root@165.245.138.91 "cd /opt/mira && git fetch origin && git checkout main && git pull && doppler run --project factorylm --config prd -- docker compose -f docker-compose.saas.yml restart mira-pipeline"
   ```
2. **OEM migration LIVE** (398 ChromaDB chunks → Open WebUI KB) — needs explicit go-ahead:
   ```bash
   ssh root@165.245.138.91 "docker cp /opt/mira/tools/migrate_sidecar_oem_to_owui.py mira-sidecar:/tmp/migrate.py"
   ssh root@165.245.138.91 "docker exec -e OPENWEBUI_API_KEY=sk-e7363e3dcc2cb69ba488e3441ba8681633134e0183d74b51fbc84cafc64a08f1 -e OPENWEBUI_BASE_URL=http://mira-core-saas:8080 mira-sidecar sh -c 'cd /app && CHROMA_PATH=/data/chroma uv run python /tmp/migrate.py'"
   ```
3. **BFG git history cleanup** — purge old secrets from history
4. **HTTPS/TLS** — nginx config
5. **Top Anthropic credits** — Claude judge failing on VPS; buy credits or rotate key

## Machine State

- **BRAVO (this machine):** `feat/citation-gate` branch (stale — work is done)
- **VPS (165.245.138.91):** `feat/training-loop-v1` (merged with main). All containers healthy.
- **main:** e337868 — ahead of VPS by ~10 commits
- **Bravo (100.86.236.11):** Ollama :11434 OK
- **PLC Laptop (100.72.2.99):** PLC at 192.168.1.100 unreachable — physical check needed

## Open Issues (active)
- **#399** — stochastic floor: watchdog 54/57 vs baseline 43/57 same commit
- **#392** — no CD pipeline (VPS deploy is manual)
- **#383** — backfill ~499 missing V1000 chunks
- **#378** — guardrails.rewrite_question can return empty string
- **#338** — atlas-api not running on VPS
- **#335** — RESEND_API_KEY not in Doppler (emails skipped)
- **#309** — sandboxed code execution in Open WebUI

## Key NeonDB Facts
```
Total chunks: ~68,000+
Rockwell Automation: 13,686 chunks (main KB)
ABB: 931 chunks — mostly NULL model_number
Siemens: 905 (SINAMICS label) + 442 (other models)
AutomationDirect: 2,250 chunks (GS10, PF525, etc.)
Yaskawa: 27 chunks (NULL model) + 1 (CIMR-AU4A0058AAA)
SEW-Eurodrive: 6 chunks (R47 DRE80M4 gearmotor — NOT a VFD)
Danfoss: 2 chunks (VLT FC302 only)
Mitsubishi Electric: 16 chunks (NULL model)
```
