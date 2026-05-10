---
name: OpenCode + Ollama Local Inference Setup
description: OpenCode 1.3.17 installed via Homebrew, wired to gemma4:e4b on Ollama
type: project
---

Completed 2026-04-07. OpenCode 1.3.17 installed via `brew install anomalyco/tap/opencode`.
Config at `~/.config/opencode/opencode.json` (uses `opencode.json`, NOT `config.json`).

Ollama 0.20.2 running on localhost:11434. Model: `gemma4:e4b` (8B Q4_K_M, 9.6 GB).
Smoke test passed: `opencode run "Say hello"` → response from gemma4:e4b, $0.00 cost.

Config schema uses `provider.ollama.npm = "@ai-sdk/openai-compatible"` and
`options.baseURL = "http://localhost:11434/v1"` with model key `"gemma4:e4b"`.

**Why:** Paperclip agent orchestration uses local inference. All agents on CHARLIE
run ollama/gemma4:e4b (verified: CEO agent run 303066bd, 90s, $0.00).
