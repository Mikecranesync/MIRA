/**
 * The asset context card's state — pure, so the tones can be tested without a
 * DOM and so no component invents a fourth one.
 *
 * PORT NOTICE (Sensor v0 S3 — the ONE permitted copy): this is
 * `mira-hub/src/lib/notebook-asset-card.ts` ported verbatim in logic and copy.
 * The Hub module imports Hub-only types (`@/lib/equipment-notebooks`) and the
 * mobile bundle cannot import from mira-hub (ADR-0034: static Vite bundle),
 * so the 40-line pure function is duplicated here with its input types
 * flattened. If the Hub copy's copy or tones change, change this file the
 * same way — the two must not drift.
 *
 * SELECTED IS NOT CONFIRMED. A QR scan proves which sticker was scanned, not
 * which machine wears it. A scanned binding renders amber until a human
 * confirms it.
 *
 * No colour literals here. Tone names map to `--fl-*` tokens at the component
 * boundary (`.claude/rules/ui-style.md`): green = confirmed/ok, amber =
 * unconfirmed/degraded, gray = unknown/absent, red = fault.
 */
import type { AssetSelectionMethod, NotebookAssetBinding } from "../api/resources";

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

/** Hub `ResolvedAsset`, flattened to what the phone can know from the
 *  notebook payload (the Hub resolves `name`/`unsPath` server-side; the phone
 *  uses the notebook's display name — an asset-bound notebook is named after
 *  its machine by `openAssetNotebook`). */
export type ResolvedAsset =
  | { state: "unbound" }
  | {
      state: "resolved";
      entityId: string;
      name: string;
      selectedVia: AssetSelectionMethod | null;
      confirmedAt: string | null;
    }
  | { state: "unresolvable"; entityId: string };

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

/** The phone's view of a notebook → the card's input. `unresolvable` needs a
 *  server-side lookup the notebook payload does not carry, so the phone never
 *  claims it (it would be a guess). */
export function resolvedAssetFromNotebook(nb: {
  displayName: string;
  asset: NotebookAssetBinding | null;
}): ResolvedAsset {
  if (!nb.asset) return { state: "unbound" };
  return {
    state: "resolved",
    entityId: nb.asset.entityId,
    name: nb.displayName,
    selectedVia: nb.asset.selectedVia,
    confirmedAt: nb.asset.confirmedAt,
  };
}
