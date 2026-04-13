# Hot Cache — 2026-04-08T22:00 — Windows Dev

## Just Finished
- Researched Karpathy's LLM Wiki pattern (9-agent deep research)
- Created this wiki (adapted Karpathy pattern for MIRA ops)
- Migrated infrastructure reference docs from ~/.claude/memory/ into wiki/nodes/

## Machine State
- **Bravo (100.86.236.11):** Running eb7da81, containers healthy. Doppler token expired — using SSH env var workaround.
- **Charlie (100.70.49.126):** Doppler keychain locked. Bot running. 4 legacy containers (factorylm-diagnosis, hmi, modbus, plc).
- **VPS (165.245.138.91):** Running eb7da81. mira + factorylm-cmms + infra stacks. Ollama CPU-only.
- **PLC Laptop (100.72.2.99):** PLC at 192.168.1.100 unreachable. CCW v3.1 program ready.

## Uncommitted Work (staging branch)
- `mira-crawler/celery_app.py` — modified
- `mira-crawler/celeryconfig.py` — modified
- `mira-web/src/server.ts` — modified
- `mira-crawler/tasks/blog.py` — new file (untracked)
- `mira-web/src/lib/blog-db.ts` — new file (untracked)
- `wiki/` — new directory (this wiki)

## Blocked
- PLC at 192.168.1.100 — needs physical check (power/switch/cable)
- Charlie Doppler — needs `doppler configure set token-storage file`
- Teams + WhatsApp bots — code-complete, pending Azure/Meta cloud setup
- No CD pipeline — deploys are manual SSH + docker cp

## Next (any machine)
1. Commit blog crawler + wiki changes on staging
2. Test blog endpoints on staging
3. Deploy staging to VPS
4. Fix Charlie Doppler keychain (requires local terminal session)
5. Investigate PLC network (requires PLC laptop on factory LAN)
