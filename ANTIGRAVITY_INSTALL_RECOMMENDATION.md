# ANTIGRAVITY 2.0 — Install Recommendation for MIRA / FactoryLM

> Generated: 2026-05-31 | Machine inspected: BRAVO (FactoryLM-Bravo)
> Research sources: Google I/O 2026, TechCrunch, official antigravity.google, DataCamp, Agentpedia, Augment Code

---

## 1. Bottom-Line Recommendation

**HOLD on BRAVO. Try CLI only. Do not install the desktop app yet.**

- **Best first machine: Alpha** (orchestrator node — not inspected here; infer it has more disk)
- **BRAVO blocker:** Disk is **92% full** — only 37 GB free on a 460 GB drive. A new IDE with caches and Gemini model context can consume 5–15 GB or more. Do not install a desktop app until ≥80 GB is free.
- **BRAVO path:** If you clear disk, install the **CLI only** (`agy` — Go binary, lightweight) alongside Claude Code, not replacing it. Run both in parallel for 2 weeks on a single workflow to compare.

---

## 2. Official Download Path

**Official URL:** https://antigravity.google

CLI repo (GitHub): https://github.com/google-antigravity/antigravity-cli

**Lookalike domain warning:** Several third-party sites (e.g. `antigravity-download.com`, `googleantigravity.io`) are circulating. The **only** legitimate origin is `antigravity.google`. Do not download from any other domain. Verify the binary checksum against the release page at `antigravity.google/releases`.

---

## 3. Pricing and Limits

| Plan | Price | Limits |
|---|---|---|
| **Free / AI Pro** | Included with Google AI Pro subscription | Baseline |
| **AI Ultra** | $100 / month | 5× Pro limits |
| **Ultra Premium** | $200 / month | 20× Pro limits |

**Notes:**
- A free tier exists for personal use (rate-limited; details thin in official docs — verify at antigravity.google before assuming free is enough for agentic runs).
- If you already have Google AI Pro, the base plan is included at no extra cost.
- Rate limits matter for agentic pipelines. MIRA's eval harness and nightly audit runs will hit limits faster than interactive use. Size up to Ultra if you intend to run scheduled agents.
- Migration notice: Google is pushing all users to migrate **to** Antigravity CLI by **June 18, 2026** (end-of-life for an earlier surface, details at releases page).

---

## 4. Feature Fit for MIRA / FactoryLM

### Strong use cases
| Use case | Fit | Notes |
|---|---|---|
| Web app coding (mira-web, mira-cmms) | ✅ Good | Desktop app has integrated browser testing; 1M context handles full module scans |
| Repo-wide refactoring | ✅ Strong | 1M context window (vs 200K for Claude Code) is a real advantage for cross-module work |
| Python automation | ✅ Good | Standard support; comparable to Claude Code |
| Node/TS pipelines | ✅ Good | Same |
| Subagent / parallel workflows | ✅ Strong | Native first-class subagent orchestration with scheduling; matches MIRA's eval harness needs |
| Scheduled background tasks | ✅ Strong | Built into the desktop app; CLI supports `--schedule` |
| Firebase / Android integration | ✅ Native | Useful if mira-web ever targets mobile PWA |

### Weak use cases
| Use case | Fit | Notes |
|---|---|---|
| Modbus/MQTT/UNS tooling | ⚠️ Neutral | No industrial protocol awareness; Claude Code's custom skill system (`.claude/skills/`) is better-suited for domain-specific behavior |
| PLC code generation | ⚠️ Neutral | Neither tool understands Structured Text natively; MIRA's existing PLC skills give Claude Code a context edge |
| Ignition Perspective mockups | ⚠️ Unclear | No documented Ignition integration; Antigravity's browser automation could work but is untested here |
| Tailscale / multi-node remote workflows | ⚠️ Unclear | No multi-machine orchestration documented yet; Claude Code's peer-to-peer mesh (claude-peers) is already wired |
| Complex code quality / SWE-Bench tasks | ⚠️ Inferior | Claude Code scores **64.3%** on SWE-Bench Pro vs Antigravity's **55.1%** — meaningful gap for hard bugs |

### Where Claude Code is still better
- **Custom skills and hooks** — MIRA has ~30 domain-specific skills, a full hook system, and eval rigs that are tightly coupled to Claude Code's `.claude/` convention. Porting these to Antigravity is non-trivial.
- **Code quality on hard problems** — SWE-Bench gap is real (64.3 vs 55.1).
- **Existing MIRA memory and session context** — `MEMORY.md`, project memory, and the peer mesh work out of the box.
- **No forced UI opinion** — Claude Code runs cleanly in tmux/terminal alongside Docker logs; Antigravity's desktop app would compete for screen space.

---

## 5. Local Machine Readiness (BRAVO — inspected)

| Item | Value | Assessment |
|---|---|---|
| **OS** | macOS 26.3 (Darwin 25.3.0) | ✅ Supported |
| **CPU** | Apple M4 ARM64 | ✅ Excellent — M4 is tier-1 hardware for Antigravity |
| **RAM** | 16 GB | ⚠️ Adequate for CLI; tight for desktop app with Docker + Ollama running simultaneously |
| **Disk (free)** | **37 GB** out of 460 GB (**92% full**) | ❌ PRIMARY BLOCKER — clear space before installing |
| **Git** | `/opt/homebrew/bin/git` | ✅ |
| **Node 20** | `/opt/homebrew/opt/node@20/bin/node` | ✅ |
| **Python 3** | `/opt/homebrew/bin/python3` | ✅ |
| **Docker** | `/usr/local/bin/docker` | ✅ |
| **VS Code** | `/opt/homebrew/bin/code` | ✅ |
| **Claude** | `/opt/homebrew/bin/claude` | ✅ |

**Repo locations found on BRAVO:**
```
~/Mira                      # primary MIRA mono-repo
~/FactoryLM_v2.0
~/factorylm
~/MiraDrop
~/Mira-worktrees            # git worktrees (space consumer!)
~/mira-merge-600
```

> **Alpha and Charlie were not inspected** (not accessible from this session). Check disk on both before choosing the install target. Alpha (orchestrator) is the preferred first install node if it has ≥80 GB free.

---

## 6. Security Notes

### What Antigravity needs
- A Google Account (required — no offline/no-account mode)
- Repo read/write access (file system access scoped to the project directory)
- Terminal command execution (configurable — see below)
- Browser access for browser-automation features (optional)

### Specific risks for MIRA
| Risk | Detail | Mitigation |
|---|---|---|
| **.env / secrets exposure** | Agents can read `.env` files by default | Set Terminal Command mode to **"Off (Allow List Only)"** at first launch; `.env` files should already be Doppler-managed (not in working tree), but verify |
| **API key exfiltration via curl** | A permissive agent can `curl` data to a remote host | Use the Deny List to block outbound curl/wget to non-internal hosts in agentic mode |
| **Browser automation** | Can access logged-in sessions in your browser | Enable browser automation only in a dedicated test profile; do NOT use your primary Google account browser |
| **Google Account linkage** | Antigravity syncs projects to your Google Account | Use your `harperhousebuyers@gmail.com` or a dedicated dev account — not the `factorylm.com` Google Workspace account (currently suspended per memory records) |
| **`--dangerously-skip-permissions` flag** | Bypasses all permission checks; one reported incident of full drive deletion | Never use this flag; remove it from any cron jobs or automation scripts |
| **Doppler secrets** | MIRA uses Doppler for all production secrets | Confirm Doppler is not leaking values into shell env before running Antigravity in the repo directory; `doppler run` subshells are safe, but `.env` exports are not |

### Safe install practice
1. Install CLI binary only (`agy`) first; do not install the desktop app until disk is cleared.
2. On first run, set permission mode to **Ask** (not Allow-all).
3. Point Antigravity at a non-production project directory for the first 2 weeks.
4. Do not grant browser automation access until you need it.
5. Verify the binary SHA256 against `antigravity.google/releases` before running.

---

## 7. Final Decision

| Machine | Decision | Reason |
|---|---|---|
| **BRAVO** | **Install CLI only after clearing disk** | 37 GB free is below safe threshold for desktop app; M4 + all tools installed makes it the best hardware; CLI is the right surface for MIRA's terminal workflow |
| **Alpha** | **First install target (desktop app)** | Orchestrator node; likely more disk space; desktop app's subagent scheduling fits Alpha's coordination role |
| **Charlie** | **Install later** | KB/Qdrant host; lower priority; Antigravity's browser automation not relevant to KB indexing |

**First test project on BRAVO:**
> Run `agy` CLI (Go binary) against the `mira-web` module for one feature (e.g., a Hub UI ticket). Compare output quality, speed, and context usage against Claude Code on the same task. The 1M context window is Antigravity's strongest differentiator — validate whether it meaningfully reduces context-loss on cross-module edits in the MIRA monorepo.

**Disk cleanup before installing:**
```bash
# Check what's consuming space
du -sh ~/Mira-worktrees ~/mira-merge-600 ~/FactoryLM_v2.0
docker system prune -af  # reclaim Docker layer cache
```
Free up ≥50 GB before installing the desktop app. The CLI binary itself is small; you can install it now if you want to start experimenting.

---

*Sources consulted:*
- [TechCrunch — Google launches Antigravity 2.0 at I/O 2026](https://techcrunch.com/2026/05/19/google-launches-antigravity-2-0-with-an-updated-desktop-app-and-cli-tool-at-io-2026/)
- [Google Blog — I/O 2026 developer highlights](https://blog.google/innovation-and-ai/technology/developers-tools/google-io-2026-developer-highlights/)
- [antigravity.google — official site](https://antigravity.google/)
- [antigravity.google/releases — release notes](https://antigravity.google/releases)
- [DataCamp — Claude Code vs. Antigravity](https://www.datacamp.com/blog/claude-code-vs-antigravity)
- [Augment Code — Antigravity vs Claude Code](https://www.augmentcode.com/tools/google-antigravity-vs-claude-code)
- [Agentpedia — Antigravity Security Guide](https://agentpedia.codes/blog/antigravity-security-guide)
- [Agentpedia — Antigravity vs Claude Code](https://agentpedia.codes/blog/antigravity-vs-claude-code)
- [AIToolTier — Pricing](https://aitooltier.com/pricing/antigravity)
