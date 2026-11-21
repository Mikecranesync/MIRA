# Dependabot batch triage: Mikecranesync/MIRA #4805–#4819 (2026-10-26, read-only)

How this was checked: I listed the PRs and read their check runs on each head SHA through the cursor-github MCP. Usage greps ran against the local tree `/workspace/ir-4380-ae315271/tree`, a recent snapshot of main that is not the exact current tip. Nothing was written to GitHub: no comments, labels, approvals, merges, closes or builds. I did not fetch upstream changelogs one by one, so the breaking-change notes come from repo usage plus each package's known major-version API changes. Treat them as leads to verify before you act on them.

| PR | Package | From → To | Bump | Service / path | CI (head) | Call |
|---|---|---|---|---|---|---|
| #4805 | fastmcp | ==3.3.* → ==4.1.* | **major** | mira-mcp | ❌ CI Gate, Unit Tests, Eval Offline (40 ok) | **hold** |
| #4806 | android-actions/setup-android | 3.2.2 → 4.0.4 | **major** | .github/workflows/mobile-release-distribute.yml | ❌ Legacy UI Lifecycle Guard only (42 ok) | needs code check |
| #4807 | langfuse | >=2.50,<3 → >=5.0.4,<6 | **major (×3)** | mira-bots/telegram (and mira-bots/shared) | ✅ 44/44 | **hold** |
| #4808 | yt-dlp | >=2026.8.19 → >=2026.10.21 | calver (minor-equivalent) | mira-crawler | ✅ 43/43 | safe to merge |
| #4809 | openviking | 0.3.20 → 0.5.1.1 | **major-equivalent (0.x minor)** | mira-mcp | ❌ CI Gate, Docker Build, Unit Tests, License Check (+E2E smoke cancelled) | **hold** |
| #4810 | sqlalchemy | >=2.0.50,<2.1 → >=2.1.6,<2.2 | minor | mira-crawler | ✅ 43/43 | needs code check |
| #4811 | starlette | 1.3.1 → 1.9.0 | minor | mira-mcp | ❌ CI Gate, Unit Tests (41 ok) | needs code check |
| #4812 | sqlalchemy | >=2.0.50,<2.1 → >=2.1.6,<2.2 | minor | mira-bots/telegram | ❌ CI Gate, Unit Tests (42 ok) | needs code check |
| #4813 | fastapi | ==0.136.* → ==0.161.* | **minor, but 0.x and 25 releases** | mira-core/mira-ingest | ✅ 43/43 | needs code check |
| #4814 | sqlalchemy | >=2.0.50,<2.1 → >=2.1.6,<2.2 | minor | mira-core/mira-ingest | ✅ 43/43 | needs code check |
| #4815 | openai | >=1.66.0 → >=3.37.0 | **major (×2)** | mira-bots/telegram | ✅ 43 ok; E2E smoke cancelled | **hold** |
| #4816 | pillow-heif | >=1.4.0 → >=1.8.1 | minor | mira-core/mira-ingest | ✅ 43/43 | safe to merge |
| #4817 | anthropic | >=0.116.0 → >=2.2.0 | **major (×2)** | mira-bots/telegram | ❌ CI Gate, Unit Tests (42 ok) | **hold** |
| #4818 | actions/setup-node | v4 → v7 | **major** | .github/workflows (most already on v6) | ❌ Legacy UI Guard + 2 stranger-notebook E2E | needs code check |
| #4819 | actions/download-artifact | 4.3.0 → 8.0.2 | **major** | ota-release.yml, mobile-release-distribute.yml | ❌ Legacy UI Lifecycle Guard only (42 ok) | **hold** |

**Counts:** safe to merge 2 (#4808, #4816) · needs code check 7 (#4806, #4810, #4811, #4812, #4813, #4814, #4818) · hold 6 (#4805, #4807, #4809, #4815, #4817, #4819).

## Notes on the risky ones

- **#4805 fastmcp 4.1 (hold).** `mira-mcp/server.py` uses `from fastmcp import FastMCP`, the constructor `FastMCP("mira-mcp")`, about 20 bare `@mcp.tool` decorators, and a Starlette app mount (around line 906). There's a code comment that says "FastMCP v3: constructor takes only the server name", so the last major already broke this file. Unit Tests and Eval Offline fail on the PR. This needs a dedicated migration PR, not a Dependabot merge. Do it together with #4811 (starlette), because fastmcp pins the starlette/mcp versions it accepts.
- **#4807 langfuse 5.x (hold, even though CI is green).** `mira-bots/shared/langfuse_setup.py` (lines 150–305) and `shared/telemetry.py:92` call the **v2 API**: `lf.trace(...)` and `trace.span(...)`. Langfuse v3 and later are built on OTel and removed `Langfuse.trace()` in favour of `start_as_current_span`/`start_span`. CI is green because tests run without Langfuse keys and the code is lazy-imported or falls back to a no-op, so a merge would most likely break production tracing silently. It needs a deliberate rewrite of the telemetry layer.
- **#4815 openai >=3.37 and #4817 anthropic >=2.2 (hold).** These are two-major jumps on unpinned floors (`>=`). The telegram requirements say both SDKs are lazy-imported by PrintSynth. OpenAI is the default print-vision provider, and Anthropic sits behind `PRINT_VISION_PROVIDER`. `mira-bots/shared/{engine,inference/router,print_recall,…}.py` reference both. #4817 fails Unit Tests. #4815 is green, but that doesn't prove compatibility, because the vision paths are mocked in unit tests. Each needs a code check of the call sites (client construction, `messages.create` and `chat.completions` shapes, response access), plus a staging print-vision smoke run. A safer alternative is to cap them (`<2`/`<4`) instead of accepting the floor raise.
- **#4809 openviking 0.5 (hold).** It breaks Docker Build and License Check, so a new transitive dependency fails the license allowlist or doesn't resolve. `requirements.txt` already records that an earlier openviking bump (#1184) conflicted with fastmcp 3.x through the litellm → python-dotenv pin. It's only used in `mira-mcp/context/viking_store.py`, through `openviking.open(...)`/`.search`, and that file has a sqlite fallback. Low value and high friction, so it can be closed or ignored until the fastmcp migration is done (closing is Mike's call).
- **#4810 / #4812 / #4814 sqlalchemy 2.1 (×3, needs code check).** Usage is light: Core `create_engine`, `text`, `NullPool` and `IntegrityError` in bot.py, admin_commands.py, mira-ingest main/neon/scripts, and crawler tasks, with no ORM. 2.1 mostly removes long-deprecated 1.x APIs and raises the minimum Python version, so the real risk is low. Crawler and ingest are green. The telegram PR (#4812) fails Unit Tests, so check whether that's the known #4711 race flake or caused by this change before merging. Merge all three together so the services don't drift apart.
- **#4813 fastapi 0.161 (needs code check).** It's green, but it jumps 25 minor releases on a 0.x line, and the pinned starlette and pydantic floors move with it. Check the mira-ingest Docker build and one staging ingest upload before merging.
- **#4811 starlette 1.9 (needs code check).** The current pin exists for CVE fixes (1.3.1). The bump fails Unit Tests, which is likely a fastmcp/mcp version cap or a TestClient/httpx change (requirements.txt notes that the 1.x TestClient needs httpx2). Look at the failing log. If it's a resolver conflict with fastmcp 3.3, park it with #4805.
- **#4819 download-artifact 8 (hold).** It's used in release-critical workflows (ota-release.yml has 5 uses; mobile-release-distribute.yml has 3), and they're still paired with **upload-artifact v4**. Major artifact versions after v4 changed defaults such as digest checks and extraction behaviour, and their compatibility with v4 uploads should be checked. CI never runs these release workflows, so green CI proves nothing here. Bump upload and download together in one PR and test with a manual dry run of the OTA/mobile pipeline.
- **#4806 setup-android 4 (needs code check).** It's used only in mobile-release-distribute.yml (2 uses, SHA-pinned v3.2.2), so the same "CI doesn't exercise it" caveat applies. The Legacy UI Lifecycle Guard failure is the usual label-only gate, not a code problem.
- **#4818 setup-node 7 (needs code check).** The repo is mixed: most workflows are on `@v6`, ci.yml is SHA-pinned v6, and qa-rbac-inspect is still on v4. Both stranger-notebook E2E checks fail on this PR. They may be staging flakiness, but they need to be compared against main before merging. Also check that node-version and caching defaults are still set explicitly.
- **#4808 yt-dlp and #4816 pillow-heif (safe to merge).** These are floor raises within the same major, they're green across the board, and the services aren't on the sellable path.

## Suggested merge order and grouping (all merges are Mike's call)
1. **Now, low risk:** #4808 and #4816.
2. **SQLAlchemy 2.1 group:** #4814 and #4810 (green), then #4812 once its Unit Tests failure is shown to be the #4711 flake or fixed. Keep these three together.
3. **mira-ingest web:** #4813 fastapi, after an ingest Docker build and staging smoke run.
4. **CI actions:** #4806 and #4818 after the code check. #4819 only in a combined upload+download-artifact v4→v8 PR with a release dry run.
5. **mira-mcp migration lane (one PR, not Dependabot):** fastmcp 4.1 (#4805) + starlette 1.9 (#4811) + openviking 0.5 (#4809), or keep openviking pinned.
6. **LLM SDK lane (telegram/shared):** openai 3.x (#4815) and anthropic 2.x (#4817) as a deliberate upgrade with a print-vision staging test. **Langfuse 5 (#4807) is a separate telemetry rewrite.**
7. Consider Dependabot `ignore` rules for major versions of fastmcp, langfuse, openai, anthropic and openviking so the queue stops refilling (that's a config change, so Mike's call).
