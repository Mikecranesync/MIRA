# Fix #1 — #574 LLM keys: KEK rotation + hex validation

**Branch:** `agent/issue-574-byo-llm-asset-chat-0331`
**Severity:** 🔴 Security blocker
**Effort:** ~1.5 hours
**Why now:** Once a real customer key is stored under the current schema, rotating `LLM_KEK` becomes a customer-impacting outage. Fix before any real key is stored.

## What's broken

1. `mira-hub/db/migrations/2026-04-24-001-byo-llm-asset-chat.sql:21-32` — `llm_keys` table has no `key_id` (KEK version) column. If `LLM_KEK` env var ever rotates, every encrypted key becomes unreadable.
2. `mira-hub/src/lib/llm-keys.ts:60-71` — `Buffer.from(hex, "hex")` silently truncates on non-hex characters. A typo'd KEK is accepted.

## The fix

### Patch 1.1 — Migration: add `kek_version` column + audit table

Add to the existing migration (or as a follow-up migration before #574 ships to a real env):

```sql
-- mira-hub/db/migrations/2026-04-24-001b-llm-keys-rotation.sql
-- Issue: #574 — KEK rotation support
-- Run AFTER 2026-04-24-001-byo-llm-asset-chat.sql

BEGIN;

-- 1. Track which KEK version encrypted each key. Default 1 = current LLM_KEK.
ALTER TABLE llm_keys
    ADD COLUMN IF NOT EXISTS kek_version SMALLINT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS llm_keys_kek_version_idx
    ON llm_keys (kek_version)
    WHERE deactivated_at IS NULL;

-- 2. Optional: a registry of KEK versions. Lets us mark old KEKs as
--    "decrypt-only" or "retired" once all keys have been re-encrypted
--    onto a newer version.
CREATE TABLE IF NOT EXISTS llm_kek_versions (
    version          SMALLINT PRIMARY KEY,
    -- env_var_name records WHICH env var held this KEK at the time.
    -- Lets you point LLM_KEK_v2 -> Doppler's LLM_KEK_2026_05.
    env_var_name     TEXT NOT NULL,
    activated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at       TIMESTAMPTZ
);

INSERT INTO llm_kek_versions (version, env_var_name)
VALUES (1, 'LLM_KEK')
ON CONFLICT (version) DO NOTHING;

COMMIT;
```

### Patch 1.2 — Lib: support multiple KEK versions

Replace the relevant section in `mira-hub/src/lib/llm-keys.ts`:

```ts
// ---------- crypto ----------
let sodiumReady: Promise<unknown> | null = null;

async function getSodium(): Promise<unknown | null> {
  // ... unchanged ...
}

// 64 hex chars = 32 bytes.
const HEX_64_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Read a KEK from the env. Validates that the hex string is exactly
 * 32 bytes of valid hex; throws otherwise (no silent truncation).
 *
 * @param version KEK version. Defaults to the current writer version.
 *                For decrypt of older records, pass the version stored
 *                on the row (`llm_keys.kek_version`).
 */
function getKEK(version = CURRENT_KEK_VERSION): Buffer {
  const reg = KEK_REGISTRY[version];
  if (!reg) {
    throw new Error(`unknown KEK version ${version}`);
  }
  const hex = process.env[reg.envVarName] ?? "";
  if (!HEX_64_REGEX.test(hex)) {
    throw new Error(
      `KEK env var ${reg.envVarName} is missing or not 32 bytes of hex (got ${hex.length} chars). ` +
        "Generate with `openssl rand -hex 32` and set in Doppler factorylm/prd.",
    );
  }
  return Buffer.from(hex, "hex");
}

// Currently we only ship one KEK. To rotate:
//   1. Add a new entry { version: 2, envVarName: "LLM_KEK_2" } below.
//   2. INSERT into llm_kek_versions (version, env_var_name) VALUES (2, 'LLM_KEK_2');
//   3. Bump CURRENT_KEK_VERSION to 2 and ship.
//   4. Run a one-time re-encrypt job over llm_keys (see scripts/rotate-llm-kek.mjs).
//   5. Once all rows have kek_version = 2, mark v1 retired.
const KEK_REGISTRY: Record<number, { envVarName: string }> = {
  1: { envVarName: "LLM_KEK" },
};
const CURRENT_KEK_VERSION = 1;

export async function encryptKey(plaintext: string): Promise<{
  ciphertext: Buffer;
  kekVersion: number;
}> {
  const sodium = (await getSodium()) as
    | {
        randombytes_buf: (n: number) => Uint8Array;
        crypto_secretbox_easy: (msg: Uint8Array, nonce: Uint8Array, key: Uint8Array) => Uint8Array;
        crypto_secretbox_NONCEBYTES: number;
      }
    | null;

  if (!sodium) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("libsodium-wrappers not installed; cannot encrypt in production");
    }
    return {
      ciphertext: Buffer.concat([Buffer.from("STUB:"), Buffer.from(plaintext, "utf8")]),
      kekVersion: CURRENT_KEK_VERSION,
    };
  }

  const kek = getKEK(CURRENT_KEK_VERSION);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(
    Buffer.from(plaintext, "utf8"),
    nonce,
    new Uint8Array(kek),
  );
  return {
    ciphertext: Buffer.concat([Buffer.from(nonce), Buffer.from(cipher)]),
    kekVersion: CURRENT_KEK_VERSION,
  };
}

export async function decryptKey(
  ciphertext: Buffer,
  kekVersion: number,
): Promise<string> {
  const sodium = (await getSodium()) as
    | {
        crypto_secretbox_open_easy: (cipher: Uint8Array, nonce: Uint8Array, key: Uint8Array) => Uint8Array;
        crypto_secretbox_NONCEBYTES: number;
      }
    | null;

  if (!sodium) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("libsodium-wrappers not installed; cannot decrypt in production");
    }
    const s = ciphertext.toString("utf8");
    if (s.startsWith("STUB:")) return s.slice(5);
    throw new Error("Stub crypto: unrecognised ciphertext");
  }

  const kek = getKEK(kekVersion);  // <-- the rotation-friendly part
  const NB = sodium.crypto_secretbox_NONCEBYTES;
  const nonce = ciphertext.subarray(0, NB);
  const cipher = ciphertext.subarray(NB);
  const plain = sodium.crypto_secretbox_open_easy(
    new Uint8Array(cipher),
    new Uint8Array(nonce),
    new Uint8Array(kek),
  );
  return Buffer.from(plain).toString("utf8");
}
```

### Patch 1.3 — DAL: pass `kek_version` through

Update `insertLLMKey` and `getActiveKeyWithSecret` (in the same file):

```ts
export async function insertLLMKey(args: {
  tenantId: string;
  provider: LLMProvider;
  label: string | null;
  createdBy: string | null;
  plaintextKey: string;
}): Promise<LLMKey> {
  const { ciphertext, kekVersion } = await encryptKey(args.plaintextKey);
  const { rows } = await pool.query(
    `INSERT INTO llm_keys (tenant_id, provider, encrypted_key, kek_version, label, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, provider, label, created_by, created_at, last_used_at`,
    [args.tenantId, args.provider, ciphertext, kekVersion, args.label, args.createdBy],
  );
  return rowToKey(rows[0]);
}

export async function getActiveKeyWithSecret(
  tenantId: string,
  provider: LLMProvider,
): Promise<LLMKeyWithSecret | null> {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, provider, encrypted_key, kek_version,
            label, created_by, created_at, last_used_at
       FROM llm_keys
      WHERE tenant_id = $1 AND provider = $2 AND deactivated_at IS NULL
      LIMIT 1`,
    [tenantId, provider],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const plaintext = await decryptKey(row.encrypted_key as Buffer, row.kek_version as number);
  return { ...rowToKey(row), plaintext };
}
```

### Patch 1.4 — Rotation script

```js
// mira-hub/scripts/rotate-llm-kek.mjs
//
// One-time job to re-encrypt llm_keys from KEK v_old onto KEK v_new.
// Run with both KEK env vars present.
//
//   LLM_KEK=<old hex> LLM_KEK_2=<new hex> \
//     node mira-hub/scripts/rotate-llm-kek.mjs --to 2

import process from "node:process";
import pool from "../src/lib/db.js";
import { decryptKey, encryptKey } from "../src/lib/llm-keys.js";

const args = process.argv.slice(2);
const toIdx = args.indexOf("--to");
if (toIdx === -1) {
  console.error("usage: --to <new-kek-version>");
  process.exit(2);
}
const targetVersion = Number(args[toIdx + 1]);

const { rows } = await pool.query(
  `SELECT id, tenant_id, encrypted_key, kek_version FROM llm_keys
    WHERE deactivated_at IS NULL AND kek_version != $1`,
  [targetVersion],
);
console.log(`re-encrypting ${rows.length} keys from kek_version != ${targetVersion} → ${targetVersion}`);

let ok = 0, fail = 0;
for (const row of rows) {
  try {
    const plaintext = await decryptKey(row.encrypted_key, row.kek_version);
    const { ciphertext } = await encryptKey(plaintext);
    await pool.query(
      `UPDATE llm_keys SET encrypted_key = $1, kek_version = $2 WHERE id = $3`,
      [ciphertext, targetVersion, row.id],
    );
    ok += 1;
  } catch (err) {
    console.error(`  FAILED tenant=${row.tenant_id} key=${row.id}:`, err.message);
    fail += 1;
  }
}
console.log(`done. ok=${ok} fail=${fail}`);
await pool.end();
process.exit(fail === 0 ? 0 : 1);
```

## Test

`mira-hub/src/lib/__tests__/llm-keys.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const VALID_KEK = "0".repeat(64);
const VALID_KEK_2 = "f".repeat(64);

beforeEach(() => {
  vi.resetModules();
  process.env.NODE_ENV = "development"; // exercise the libsodium-stub path
  process.env.LLM_KEK = VALID_KEK;
});

describe("getKEK validation", () => {
  it("rejects missing KEK", async () => {
    delete process.env.LLM_KEK;
    const { encryptKey } = await import("../llm-keys");
    await expect(encryptKey("x")).rejects.toThrow(/missing or not 32 bytes/);
  });

  it("rejects KEK with non-hex chars (the silent-truncation bug)", async () => {
    process.env.LLM_KEK = "g".repeat(64); // 'g' is not hex
    const { encryptKey } = await import("../llm-keys");
    await expect(encryptKey("x")).rejects.toThrow(/not 32 bytes of hex/);
  });

  it("rejects KEK with wrong length", async () => {
    process.env.LLM_KEK = "0".repeat(60);
    const { encryptKey } = await import("../llm-keys");
    await expect(encryptKey("x")).rejects.toThrow(/not 32 bytes of hex/);
  });
});

describe("encryption round-trip", () => {
  it("encrypts then decrypts to the same plaintext", async () => {
    const { encryptKey, decryptKey } = await import("../llm-keys");
    const { ciphertext, kekVersion } = await encryptKey("sk-secret-123");
    expect(kekVersion).toBe(1);
    const out = await decryptKey(ciphertext, kekVersion);
    expect(out).toBe("sk-secret-123");
  });

  it("returns kekVersion so callers can persist it", async () => {
    const { encryptKey } = await import("../llm-keys");
    const { kekVersion } = await encryptKey("x");
    expect(kekVersion).toBe(1);
  });
});

describe("rotation", () => {
  it("decryption uses the row's kekVersion, not the current one", async () => {
    // Simulate v1 → v2 rotation by registering v2 then asking for decrypt of v1.
    process.env.LLM_KEK = VALID_KEK;
    process.env.LLM_KEK_2 = VALID_KEK_2;

    // Encrypt with v1 (the only version registered by default).
    const { encryptKey, decryptKey } = await import("../llm-keys");
    const { ciphertext, kekVersion } = await encryptKey("v1-data");
    expect(kekVersion).toBe(1);

    // Decrypt with v1 again (positive control).
    const plain = await decryptKey(ciphertext, 1);
    expect(plain).toBe("v1-data");

    // Asking for v2 fails (we haven't pushed the v2 registry update).
    await expect(decryptKey(ciphertext, 2)).rejects.toThrow(/unknown KEK version 2/);
  });
});
```

## Verification

```bash
cd mira-hub
npx tsc --noEmit -p .
npx vitest run src/lib/__tests__/llm-keys.test.ts
```

After all 8 tests pass, the KEK rotation gap is closed. Real customer keys can now be stored without painting yourself into a corner.

## Why this design

- `kek_version` is `SMALLINT NOT NULL DEFAULT 1`. Every existing row gets v1 on migration, so backfill is implicit.
- `KEK_REGISTRY` is in code, not the DB, because the env var name maps to a Doppler secret name. DB doesn't know that.
- Rotation is **opt-in**: you keep using v1 until you want to rotate. To rotate, add a v2 entry, deploy, run the script, deploy again with `CURRENT_KEK_VERSION = 2`.
- During rotation the script reads each row's `kek_version` and encrypts with the new one. The OLD env var must remain set in Doppler until the script finishes — otherwise old rows can't decrypt.
- Retire the old KEK by setting `llm_kek_versions.retired_at` and removing the env var. Code refuses to use a retired version.
