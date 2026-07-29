/**
 * Drive-pack loader — Hub-side TS twin of `mira-bots/shared/drive_packs/loader.py`.
 *
 * ADR-0025 (§1, three-layer drive intelligence): a drive pack's decode tables
 * (`mira-bots/shared/drive_packs/packs/<pack_id>/pack.json`) are the single
 * source of truth for both the Python engine and this Hub. This module is
 * the minimal TS surface the Hub needs — it does NOT port the Python loader
 * wholesale (no `resolve_pack` text-matching, no `list_packs` discovery, no
 * nameplate/knowledge/provenance typing — nothing consumes those here yet).
 *
 * Build-time import, not a runtime `fs` read: the Hub bundles for the
 * browser/edge, so `resolveJsonModule` (already on in `mira-hub/tsconfig.json`)
 * inlines the JSON as a JS object at build time via the bundler — there is no
 * runtime file dependency to trace.
 *
 * Only `durapulse_gs10` exists today, so this loads that one pack eagerly at
 * import time (mirrors the Python module's "import-time load is deliberate"
 * stance in `mira-bots/shared/live_snapshot.py`) rather than adding
 * multi-pack discovery machinery with no caller.
 *
 * Imports `./gs10-pack.json`, a committed byte-for-byte copy of the canonical
 * `mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json`, NOT that file
 * directly. The Hub's Docker build context is `./mira-hub`
 * (`docker-compose.saas.yml`), so a `../../../mira-bots/...` import resolves
 * in a full-repo checkout (CI) but is unreachable inside the Hub's image
 * build — `next build` fails at deploy time only. The copy keeps the import
 * inside `mira-hub/`; drift between the two files is caught by
 * `mira-bots/tests/test_drive_pack_hub_copy_sync.py` (runs on a full-repo
 * checkout in CI, where both files exist).
 */
import gs10PackJson from "./gs10-pack.json";

export interface RegisterEntry {
  addr: number | null;
  unit: string;
  scaling: number;
  datapoint: string;
}

export interface EnvelopeBand {
  nominal?: number | null;
  min?: number | null;
  max?: number | null;
  rated?: number | null;
  unit?: string | null;
}

export interface LiveDecode {
  status_bits: Record<number, string>;
  cmd_word: Record<number, string>;
  fault_codes: Record<number, string>;
  registers: Record<string, RegisterEntry>;
}

export interface Envelope {
  dc_bus: EnvelopeBand;
  current: EnvelopeBand;
  frequency: EnvelopeBand;
}

export interface DrivePack {
  pack_id: string;
  live_decode: LiveDecode;
  envelope: Envelope;
}

/**
 * JSON object keys are always strings; the wire enum tables (status_bits,
 * cmd_word, fault_codes) are int-keyed. Mirrors Python's `_int_keyed` —
 * throws a pack-id-scoped, actionable error on a non-numeric key rather than
 * silently producing `NaN` keys.
 */
function intKeyed(
  raw: Record<string, string>,
  packId: string,
  fieldName: string,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(key);
    if (!Number.isInteger(n)) {
      throw new Error(
        `pack '${packId}': non-numeric key '${key}' in live_decode.${fieldName} — ` +
          "wire enum tables must be int-keyed",
      );
    }
    out[n] = value;
  }
  return out;
}

function loadPack(raw: typeof gs10PackJson): DrivePack {
  return {
    pack_id: raw.pack_id,
    live_decode: {
      status_bits: intKeyed(raw.live_decode.status_bits, raw.pack_id, "status_bits"),
      cmd_word: intKeyed(raw.live_decode.cmd_word, raw.pack_id, "cmd_word"),
      fault_codes: intKeyed(raw.live_decode.fault_codes, raw.pack_id, "fault_codes"),
      registers: raw.live_decode.registers as Record<string, RegisterEntry>,
    },
    envelope: raw.envelope as Envelope,
  };
}

/** The GS10 drive pack, loaded once at import time. */
export const GS10_PACK: DrivePack = loadPack(gs10PackJson);
