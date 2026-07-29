/**
 * TS port of `mira-relay/ingest_contract.py::normalize_tag_path` — the fail-closed match key the
 * relay uses to gate ingest against `approved_tags.normalized_tag_path` (mig 035). This MUST
 * reproduce the Python function's output exactly for every input the two sides share, or a tag
 * approved in the Hub (T5 bridge, see `suggestion-accept.ts::createTagEntity`) will never match
 * what the relay computes at ingest time and will be silently dropped.
 *
 * Algorithm (mirrors the Python docstring): lowercase, runs of non-alphanumerics collapse to a
 * single '_', then trim leading/trailing '_'. An empty/falsy input normalizes to ''.
 *
 * Parity is enforced by `normalize-tag-path.test.ts`, which reads the Python source at test time
 * and fails loudly if the two sides drift (mirrors the `safety-phrases.test.ts` T3 pattern).
 */

const NON_ALNUM = /[^a-z0-9]+/g;

export function normalizeTagPath(raw: string): string {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(NON_ALNUM, "_").replace(/^_+|_+$/g, "");
}
