/**
 * #4508 / #5065 Codex r4 F1 — read a PDF's /PageLabels tree under a hard resource bound.
 *
 * pdfjs `getPageLabels()` builds the complete label array before returning, and a
 * lettered style (/S /A or /a) with a huge /St repeats a letter millions of times per
 * page: a 19 KB, 200-page PDF made it build 77 million characters. A size check on the
 * returned array runs too late. So the call runs in a disposable worker thread with a
 * small V8 heap and a timeout; if it exceeds either, the worker dies and the document
 * gets no labels. The worker also refuses oversized labels before posting them back, so
 * the main thread never receives (or clones) an oversized array. Callers keep their own
 * per-label and aggregate checks (printedPageLabels) as defense in depth.
 *
 * Returns the raw label array, or null — never throws.
 */
import { Worker } from "node:worker_threads";

export const LABEL_WORKER_HEAP_MB = 128;
export const LABEL_WORKER_TIMEOUT_MS = 10_000;

/** Characters, not bytes: a cheap pre-check in the worker; exact UTF-8 limits run in the caller. */
const WORKER_MAX_LABEL_CHARS = 256;
const WORKER_MAX_TOTAL_CHARS = 1024 * 1024;

// CommonJS eval worker: `import("unpdf")` resolves from the process working directory,
// where unpdf is installed (it is a Next serverExternalPackage, so standalone ships it).
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(workerData.bytes);
    const raw = await pdf.getPageLabels();
    if (!Array.isArray(raw)) return parentPort.postMessage({ labels: null });
    let total = 0;
    for (const l of raw) {
      if (typeof l !== "string") continue;
      total += l.length;
      if (l.length > workerData.maxLabel || total > workerData.maxTotal) {
        return parentPort.postMessage({ labels: null, oversized: true });
      }
    }
    parentPort.postMessage({ labels: raw });
  } catch (err) {
    parentPort.postMessage({ labels: null, error: String((err && err.message) || err) });
  }
})();
`;

export async function readPageLabelsBounded(
  bytes: Buffer | Uint8Array,
  filename: string,
  limits: { heapMb?: number; timeoutMs?: number } = {},
): Promise<unknown[] | null> {
  // Bun accepts resourceLimits but does not enforce them (measured: 2.4 GB peak on the
  // r4 attack PDF), so the bound would be fiction. Fail closed: no labels under Bun.
  if (process.versions.bun) {
    console.warn(`[node-ingest] page labels not stored for ${filename}: worker heap limits are not enforced under Bun`);
    return null;
  }
  const copy = new Uint8Array(bytes); // the worker owns a transferred copy; the caller's buffer is untouched
  return new Promise((resolve) => {
    let settled = false;
    const done = (labels: unknown[] | null, why?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (why) console.warn(`[node-ingest] page labels not stored for ${filename}: ${why}`);
      void worker.terminate();
      resolve(labels);
    };
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { bytes: copy, maxLabel: WORKER_MAX_LABEL_CHARS, maxTotal: WORKER_MAX_TOTAL_CHARS },
        transferList: [copy.buffer],
        resourceLimits: { maxOldGenerationSizeMb: limits.heapMb ?? LABEL_WORKER_HEAP_MB, maxYoungGenerationSizeMb: 16 },
      });
    } catch (err) {
      console.warn(`[node-ingest] page label worker failed to start for ${filename}:`, err);
      resolve(null);
      return;
    }
    const timer = setTimeout(() => done(null, "label worker timed out"), limits.timeoutMs ?? LABEL_WORKER_TIMEOUT_MS);
    worker.once("message", (m: { labels: unknown[] | null; oversized?: boolean; error?: string }) =>
      done(Array.isArray(m.labels) ? m.labels : null, m.oversized ? "labels over the size limit" : m.error),
    );
    worker.once("error", (err) => done(null, `label worker failed: ${err.message}`));
    worker.once("exit", (code) => done(null, `label worker exited (${code})`));
  });
}
