/**
 * Work Packet (#4982) — which manufacturer's documents this tool can draft from. Pure, no I/O;
 * shared by the draft builder and the GET availability check so both refuse the same way.
 */

// The parsers read CAT Pumps documents only; another maker's pump can share a model number with a
// CAT manual attached by mistake, so the confirmed manufacturer must be CAT Pumps (Codex #5062 F14).
// "Cat Pumps", "CAT PUMPS", "Cat Pumps Inc." pass; "Caterpillar" or a bare "Cat" do not.
export function isSupportedManufacturer(manufacturer: string | null): boolean {
  return (manufacturer ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").startsWith("catpumps");
}

export function manufacturerRefusalMessage(manufacturer: string | null): string {
  return manufacturer && manufacturer.trim()
    ? `This tool drafts job packets from CAT Pumps documents only, and this machine is confirmed as made by "${manufacturer.trim()}". Use that manufacturer's own documents, or correct the confirmed identity.`
    : "This machine's confirmed identity has no manufacturer. Confirm the manufacturer (this tool supports CAT Pumps) before drafting a job packet.";
}
