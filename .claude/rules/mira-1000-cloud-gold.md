# MIRA-1000 — Cloud Gold / On-Prem parity rule

For any substantial work touching MIRA inference, orchestration, chat behavior, retrieval, evidence, tools, memory, client adapters, model routing, OpenAI, local inference, or cloud/on-prem parity:

1. Follow the global multi-session/session-discipline rules first.
2. Before editing, read:
   - `docs/architecture/mira-1000/README.md`
   - `docs/architecture/mira-1000/CURRENT.md`
   - the active prompt referenced by `CURRENT.md`
   - `docs/architecture/mira-1000/TRACKER.yaml`
3. Treat **MIRA-1000** as the architecture ID regardless of GitHub PR number.
4. This is a convergence program, not permission to create a parallel MIRA stack.
5. The split is at the **inference/provider boundary**:
   - Cloud Gold: OpenAI Responses API
   - On-Prem: local inference
   - both reuse the same FactoryLM truth/context/tool/policy/evidence contracts wherever deployment constraints allow.
6. Never create a second retrieval, evidence, identity, tool, approval, or client-brain architecture merely because the inference provider differs.
7. Prompt files under `docs/architecture/mira-1000/prompts/` are immutable once issued. Supersede them with a new prompt ID.
8. Every MIRA-1000 child PR must update `TRACKER.yaml` and append a concise entry to `HISTORY.md`.
9. Do not claim a capability is done merely because code exists. Record real-path connection, enablement state, eval evidence, rollback, and remaining gaps.
