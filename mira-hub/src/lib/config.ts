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
// Default 50 clears real OEM manuals (31.5 MB GS10, 33 MB Rockwell ref) with
// headroom, under nginx's 100M `client_max_body_size` transport ceiling. The
// PRIMARY PDF path is now in-Hub ingest-v2 (node-knowledge-ingest: unpdf
// extraction + per-page batched inserts, serialized by NODE_INGEST_CONCURRENCY)
// — far lighter than the legacy OW->docling path. But it still buffers the whole
// file AND eagerly extracts all page text into memory before chunking, so 50 MB
// is a deliberate POLICY bound, NOT an architectural one: do not read "ingest-v2"
// as "memory-safe at any size" and raise this. True any-size needs per-page
// streaming extraction (ingest-v2 Slice 2 — see node-knowledge-ingest.ts header).
// The legacy OW fallback (mira-ingest -> docling) is bounded by its container
// mem_limit (the documented 8 GB-VPS OOM path, ADR-0019).
//
// MUST stay in sync with mira-ingest's MIRA_MAX_UPLOAD_MB — the ingest service
// has its own cap, and a Hub cap above it would accept a file the Hub then
// fails downstream. The old 20/10 MB caps were a Telegram-era artifact.
export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "50");
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
