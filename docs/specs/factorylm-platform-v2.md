# FactoryLM Platform v2 Spec

Full spec in project memory and outputs.

**Stack:** Tauri + Next.js 14 + Refine.dev + shadcn/ui

**Philosophy:** Non-destructive overlay on existing MIRA system.
All mira-hub/ endpoints proxy to mira-pipeline (:9099) and mira-mcp (:8001).
No modifications to existing Python services required.
