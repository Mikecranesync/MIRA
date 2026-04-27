// Uses ?? so NEXT_PUBLIC_API_BASE='' (empty string) works for root-path in Phase 2.
// Never use || here: '' || '/hub' = '/hub', breaking the Phase 2 empty-string case.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/hub";
