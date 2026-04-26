/**
 * Magic-link sign-in tokens — #SO-070.
 *
 * Token lifecycle:
 *   POST /api/magic-link → createMagicLink → emails raw token
 *   GET  /api/magic/login → validateAndConsumeToken → 24h session
 *
 * Storage is dependency-injected so unit tests can run without NeonDB.
 * Production uses the neon-backed storage; tests use in-memory.
 *
 * Tokens: 32 random bytes (64-char hex) shown to the user; SHA-256 hash
 * is what we persist. 10-minute TTL. Single-use (consumed_at).
 */

import { neon } from "@neondatabase/serverless";
import { randomBytes, createHash } from "node:crypto";

export const MAGIC_LINK_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAGIC_LINK_RATE_LIMIT_MS = 60 * 1000; // 60s per email

export interface MagicLinkRecord {
  tokenHash: string;
  tenantId: string;
  email: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface MagicLinkStorage {
  insert(record: MagicLinkRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<MagicLinkRecord | null>;
  markConsumed(tokenHash: string, at: Date): Promise<void>;
}

export type ValidationResult =
  | { ok: true; tenantId: string; email: string }
  | { ok: false; reason: "not_found" | "expired" | "already_consumed" };

export interface CreateTokenOpts {
  tenantId: string;
  email: string;
  now?: Date;
}

export interface CreatedToken {
  token: string; // raw — sent in email only
  tokenHash: string; // stored
  expiresAt: Date;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildMagicLinkUrl(
  publicUrl: string,
  token: string,
  email: string
): string {
  const base = publicUrl.replace(/\/$/, "");
  const params = new URLSearchParams({ token, email });
  return `${base}/api/magic/login?${params.toString()}`;
}

// ─── Storage-using functions ─────────────────────────────────────────────────

export async function createMagicLink(
  storage: MagicLinkStorage,
  opts: CreateTokenOpts
): Promise<CreatedToken> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);
  const token = generateToken();
  const tokenHash = hashToken(token);
  await storage.insert({
    tokenHash,
    tenantId: opts.tenantId,
    email: opts.email,
    expiresAt,
    consumedAt: null,
  });
  return { token, tokenHash, expiresAt };
}

export async function validateAndConsumeToken(
  storage: MagicLinkStorage,
  token: string,
  now: Date = new Date()
): Promise<ValidationResult> {
  const tokenHash = hashToken(token);
  const record = await storage.findByHash(tokenHash);
  if (!record) return { ok: false, reason: "not_found" };
  if (record.consumedAt) return { ok: false, reason: "already_consumed" };
  if (record.expiresAt.getTime() < now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  await storage.markConsumed(tokenHash, now);
  return { ok: true, tenantId: record.tenantId, email: record.email };
}

// ─── Rate-limit (in-memory; fine for single Bun instance) ───────────────────

const recentRequests = new Map<string, number>();

export function checkMagicLinkRateLimit(
  email: string,
  now: number = Date.now()
): boolean {
  const key = email.toLowerCase();
  const last = recentRequests.get(key);
  if (last && now - last < MAGIC_LINK_RATE_LIMIT_MS) return false;
  recentRequests.set(key, now);
  if (recentRequests.size > 1000) {
    for (const [k, v] of recentRequests) {
      if (now - v > MAGIC_LINK_RATE_LIMIT_MS * 2) recentRequests.delete(k);
    }
  }
  return true;
}

export function _resetRateLimitForTest(): void {
  recentRequests.clear();
}

// ─── Storage adapters ────────────────────────────────────────────────────────

export function inMemoryStorage(): MagicLinkStorage {
  const records = new Map<string, MagicLinkRecord>();
  return {
    async insert(record) {
      records.set(record.tokenHash, { ...record });
    },
    async findByHash(tokenHash) {
      const r = records.get(tokenHash);
      return r ? { ...r } : null;
    },
    async markConsumed(tokenHash, at) {
      const r = records.get(tokenHash);
      if (r) records.set(tokenHash, { ...r, consumedAt: at });
    },
  };
}

interface NeonRow {
  token_hash: string;
  tenant_id: string;
  email: string;
  expires_at: string;
  consumed_at: string | null;
}

export function neonMagicLinkStorage(): MagicLinkStorage {
  const sql = () => {
    const url = process.env.NEON_DATABASE_URL;
    if (!url) throw new Error("NEON_DATABASE_URL not set");
    return neon(url);
  };
  return {
    async insert(record) {
      const db = sql();
      await db`
        INSERT INTO plg_magic_link_tokens
          (token_hash, tenant_id, email, expires_at)
        VALUES
          (${record.tokenHash}, ${record.tenantId}, ${record.email},
           ${record.expiresAt.toISOString()})`;
    },
    async findByHash(tokenHash) {
      const db = sql();
      const rows = (await db`
        SELECT token_hash, tenant_id, email, expires_at, consumed_at
          FROM plg_magic_link_tokens
         WHERE token_hash = ${tokenHash}
         LIMIT 1`) as NeonRow[];
      const row = rows[0];
      if (!row) return null;
      return {
        tokenHash: row.token_hash,
        tenantId: row.tenant_id,
        email: row.email,
        expiresAt: new Date(row.expires_at),
        consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
      };
    },
    async markConsumed(tokenHash, at) {
      const db = sql();
      await db`
        UPDATE plg_magic_link_tokens
           SET consumed_at = ${at.toISOString()}
         WHERE token_hash = ${tokenHash}
           AND consumed_at IS NULL`;
    },
  };
}

// ─── Audit logging ──────────────────────────────────────────────────────────

export interface AuditEntry {
  email: string;
  action:
    | "magic_link.requested"
    | "magic_link.sent"
    | "magic_link.rate_limited"
    | "magic_link.consumed"
    | "magic_link.invalid";
  tenantId?: string;
  ip?: string;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

export async function auditMagicLink(entry: AuditEntry): Promise<void> {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) return;
  try {
    const db = neon(url);
    await db`
      INSERT INTO plg_audit_log (email, tenant_id, action, ip, user_agent, meta_json)
      VALUES (${entry.email}, ${entry.tenantId ?? null}, ${entry.action},
              ${entry.ip ?? null}, ${entry.userAgent ?? null},
              ${entry.meta ? JSON.stringify(entry.meta) : null})`;
  } catch (err) {
    console.error("[magic-link][audit] insert failed:", err);
  }
}
