import { inflateRawSync } from "node:zlib";

// A13 (orchestrator): decompression-bomb guards for the stranger-reachable
// /api/contextualization/import .zip path. A Factory Context Bundle is small
// structured JSON; these caps fail a crafted bundle loudly instead of letting
// inflate OOM the shared hub. (The sibling /sources route already caps via
// MAX_UPLOAD_BYTES; the bundle path did not.)
const MAX_ENTRY_BYTES = 64 * 1024 * 1024; // inflated, per entry
const MAX_TOTAL_BYTES = 256 * 1024 * 1024; // inflated, whole bundle
const MAX_ENTRIES = 10_000;

/**
 * Minimal, dependency-free ZIP reader for Factory Context Bundles.
 *
 * Bundles are produced by Python's `zipfile.ZipFile(...).writestr(...)` on a seekable buffer, so each
 * local file header carries the real compressed/uncompressed sizes (no streaming data descriptors).
 * We scan local file headers (sig 0x04034b50), reading stored (method 0) or deflated (method 8)
 * entries; deflate is inflated with Node's zlib. We do NOT need the central directory.
 *
 * Throws on anything unexpected (encrypted, data-descriptor sizes, unknown method) so a malformed or
 * non-bundle upload fails loudly rather than importing garbage.
 */
export function readZipEntries(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let off = 0;
  let total = 0;
  let count = 0;
  while (off + 4 <= buf.length) {
    const sig = buf.readUInt32LE(off);
    if (sig !== 0x04034b50) break; // 0x02014b50 = central directory → done with local entries
    const flags = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    if (flags & 0x08) throw new Error("zip uses streaming data descriptors (unsupported)");
    if (flags & 0x01) throw new Error("encrypted zip entry (unsupported)");
    const nameStart = off + 30;
    const name = buf.toString("utf-8", nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    let entry: Buffer;
    if (method === 0) {
      if (data.length > MAX_ENTRY_BYTES) throw new Error(`zip entry ${name} exceeds per-entry cap`);
      entry = Buffer.from(data);
    } else if (method === 8) {
      // maxOutputLength → zlib throws ERR_BUFFER_TOO_LARGE instead of inflating
      // an unbounded (zip-bomb) payload into memory.
      entry = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    } else {
      throw new Error(`unsupported zip compression method ${method} for ${name}`);
    }
    total += entry.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("zip bundle exceeds total inflated size cap");
    if (++count > MAX_ENTRIES) throw new Error("zip bundle exceeds entry count cap");
    out[name] = entry;
    off = dataStart + compSize;
  }
  return out;
}
