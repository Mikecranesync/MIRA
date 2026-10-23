/**
 * Photo-reading evidence labels for notebook chat. Host-agnostic; used by the
 * chat route after citation emission so a technician-confirmed Keep is not
 * collapsed into the generic documentation badge.
 */
export function photoReadingEvidenceFrame(
  citations: readonly { readonly docId: string; readonly originFileId?: string | null }[],
  chunks: readonly { readonly docId?: string | null; readonly verified?: boolean }[],
): { readonly basis: "workspace_evidence" | "oem_documentation"; readonly label: string } | null {
  if (citations.length === 0) return null;
  const photoOnly = citations.every((c) => !!c.originFileId);
  if (!photoOnly) return null;
  const allVerified = citations.every((c) => chunks.some((k) => k.docId === c.docId && k.verified === true));
  const noneVerified = citations.every((c) => !chunks.some((k) => k.docId === c.docId && k.verified === true));
  if (noneVerified) {
    return {
      basis: "workspace_evidence",
      label: "Grounded in a photo kept on this machine — an unconfirmed reading.",
    };
  }
  if (allVerified) {
    return {
      basis: "oem_documentation",
      label: "Grounded in a technician-confirmed photo reading on this machine.",
    };
  }
  return null;
}
