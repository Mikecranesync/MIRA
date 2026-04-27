// Hub path prefix — drives all client fetches, OAuth callbacks, and nav redirects.
// Phase 1 (current): NEXT_PUBLIC_API_BASE is unset → defaults to '/hub' → identical to today.
// Phase 2 (switchover): rebuild with NEXT_PUBLIC_API_BASE='' → hub serves from root.
// Uses ?? (not ||) so that an empty-string env var is respected.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/hub";
