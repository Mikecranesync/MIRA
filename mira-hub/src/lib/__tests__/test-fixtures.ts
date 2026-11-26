/**
 * Shared test fixture factories for ManualChunk tests.
 * Fixes F9: Use valid ManualChunk interface.
 */
import type { ManualChunk } from "../manual-rag";

export function makeChunk(
  content: string,
  page: number,
  url = "test-manual.pdf",
  options: Partial<ManualChunk> = {}
): ManualChunk {
  return {
    content,
    manufacturer: "Test Manufacturer",
    modelNumber: "TEST100",
    title: "Test Manual",
    sourceUrl: url,
    sourcePage: page,
    chunkIndex: null,
    rank: 0.9,
    verified: false,
    ...options,
  };
}
