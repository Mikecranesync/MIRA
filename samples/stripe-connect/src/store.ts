// =============================================================================
// src/store.ts — dead-simple in-memory storage for this DEMO ONLY.
// =============================================================================
// In a real app you would persist connected accounts (and their relationship
// to your own users/tenants) in a database. Here we keep a Map in process
// memory: it resets every time the server restarts. That is fine for a sample
// whose job is to show the Stripe API flow, not data durability.
//
// IMPORTANT for production:
//   - The Stripe account object is ALWAYS the source of truth for account
//     status / capabilities / requirements. We never cache those — every
//     status check re-fetches from the Stripe API (see routes/accounts.ts).
//   - What you DO want to store locally is the *mapping* between YOUR user and
//     the Stripe connected account id (acct_...), plus any display metadata.
// =============================================================================

/** A connected account as we track it locally (just enough to render the UI). */
export interface ConnectedAccount {
  /** Stripe connected account id, e.g. "acct_123". This is the source of truth key. */
  id: string;
  /** Display name we sent to Stripe at creation. */
  displayName: string;
  /** Contact email we sent to Stripe at creation. */
  contactEmail: string;
  /** When we created it (for sorting in the dashboard). */
  createdAt: number;
}

// TODO(db): replace this Map with a real table, e.g.
//   CREATE TABLE connected_accounts (
//     id            TEXT PRIMARY KEY,   -- acct_...
//     user_id       TEXT NOT NULL,      -- YOUR user/tenant id
//     display_name  TEXT,
//     contact_email TEXT,
//     created_at    TIMESTAMPTZ DEFAULT now()
//   );
const accounts = new Map<string, ConnectedAccount>();

export const store = {
  /** Remember a newly created connected account. */
  saveAccount(account: ConnectedAccount): void {
    accounts.set(account.id, account);
  },

  /** Look one up by its acct_... id. */
  getAccount(id: string): ConnectedAccount | undefined {
    return accounts.get(id);
  },

  /** List all known connected accounts, newest first. */
  listAccounts(): ConnectedAccount[] {
    return [...accounts.values()].sort((a, b) => b.createdAt - a.createdAt);
  },
};
