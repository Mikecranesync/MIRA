// Uses ?? so NEXT_PUBLIC_API_BASE='' (empty string) works for root-path in Phase 2.
// Never use || here: '' || '/hub' = '/hub', breaking the Phase 2 empty-string case.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/hub";

// Server-side runtime var (not NEXT_PUBLIC_ — NOT baked at build time).
// Controls the path prefix in OAuth redirect_uri sent to external providers.
// Set OAUTH_BASE_PATH=/hub until all provider consoles are updated to root path.
// The existing nginx /hub/ → / rewrite handles delivery of the callback back to hub.
export const OAUTH_BASE = process.env.OAUTH_BASE_PATH ?? "";
