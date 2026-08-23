/**
 * The asset context card's state — pure, so the three tones can be tested
 * without a DOM and so no component invents a fourth one.
 *
 * The card answers one question at a glance, which the dogfood spec §7 calls
 * the three-second test: *which machine is MIRA using, and how sure is that?*
 *
 * SELECTED IS NOT CONFIRMED. A QR scan proves which sticker was scanned, not
 * which machine wears it. Stickers get swapped during a rebuild and two
 * identical bench conveyors are indistinguishable to a sticker, so a scanned
 * binding renders amber until a human confirms it. Treating a scan as a
 * confirmation is how the wrong machine gets diagnosed confidently.
 *
 * No colour literals here. Tone names map to `--fl-*` tokens at the component
 * boundary (`.claude/rules/ui-style.md`): green = confirmed/ok, amber =
 * unconfirmed/degraded, gray = unknown/absent, red = fault. A hex in this file
 * would be a state colour chosen twice.
 */
import type { NotebookAssetBinding, ResolvedAsset } from "@/lib/equipment-notebooks";

export type AssetCardTone = "confirmed" | "unconfirmed" | "unresolvable" | "unbound";

export type AssetCardState = {
  tone: AssetCardTone;
  /** Primary line — the machine, or the reason there isn't one. */
  headline: string;
  /** One supporting sentence. Never a colour, never a raw identifier. */
  detail: string;
  /** True when MIRA may answer machine-specific questions in this state. */
  canDiagnose: boolean;
};

const VIA_LABEL: Record<string, string> = {
  qr: "QR sticker",
  nfc: "NFC tag",
  asset_picker: "asset list",
  work_order: "work order",
  nameplate: "nameplate photo",
  manual_entry: "typed in",
};

export function assetCardState(asset: ResolvedAsset, binding?: NotebookAssetBinding | null): AssetCardState {
  if (asset.state === "unbound") {
    return {
      tone: "unbound",
      headline: "No machine selected",
      detail: "Pick the equipment this notebook is about so answers can be tied to it.",
      canDiagnose: true, // document-only Q&A is still legitimate; it just isn't machine-specific
    };
  }

  if (asset.state === "unresolvable") {
    return {
      tone: "unresolvable",
      headline: "Machine unavailable",
      detail:
        "This notebook points at equipment that is no longer available in your account. " +
        "Re-select the machine before asking about it.",
      canDiagnose: false,
    };
  }

  const via = asset.selectedVia ? VIA_LABEL[asset.selectedVia] ?? asset.selectedVia : null;
  const confirmedAt = asset.confirmedAt ?? binding?.confirmedAt ?? null;

  if (!confirmedAt) {
    return {
      tone: "unconfirmed",
      headline: asset.name || "Selected machine",
      detail: via
        ? `Selected from the ${via} — not yet confirmed. Check the machine matches before acting on an answer.`
        : "Selected but not yet confirmed. Check the machine matches before acting on an answer.",
      canDiagnose: true,
    };
  }

  return {
    tone: "confirmed",
    headline: asset.name || "Confirmed machine",
    detail: via ? `Confirmed — selected from the ${via}.` : "Confirmed.",
    canDiagnose: true,
  };
}
