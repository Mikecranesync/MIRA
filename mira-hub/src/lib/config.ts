// Uses ?? so NEXT_PUBLIC_API_BASE='' (empty string) works for root-path in Phase 2.
// Never use || here: '' || '/hub' = '/hub', breaking the Phase 2 empty-string case.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/hub";

// Server-side runtime var (not NEXT_PUBLIC_ — NOT baked at build time).
// Controls the path prefix in OAuth redirect_uri sent to external providers.
// Set OAUTH_BASE_PATH=/hub until all provider consoles are updated to root path.
// The existing nginx /hub/ → / rewrite handles delivery of the callback back to hub.
export const OAUTH_BASE = process.env.OAUTH_BASE_PATH ?? "";

// Maximum upload size, in MB. Single source of truth for every upload route
// (local, folder, cloud-pick, node-file) and the client-side pre-checks/copy.
// NEXT_PUBLIC_ so it inlines for the browser and is also readable server-side.
//
// Default 50 clears real OEM manuals (the 31.5 MB GS10 PDF, the 33 MB Rockwell
// ref manual from ADR-0019) with headroom. It is bounded BELOW nginx's 100M
// transport ceiling on purpose: mira-ingest buffers the whole file in memory
// (`await file.read()`) before docling, the documented 8 GB-VPS OOM path
// (project_vps_oom_docling_incidents / ADR-0019). True any-size needs the
// streaming ingest-v2 rebuild; until then 50 MB is the deliberate ceiling.
//
// MUST stay in sync with mira-ingest's MIRA_MAX_UPLOAD_MB — the ingest service
// has its own cap, and a Hub cap above it would accept a file the Hub then
// fails downstream. The old 20/10 MB caps were a Telegram-era artifact.
export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "50");
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
