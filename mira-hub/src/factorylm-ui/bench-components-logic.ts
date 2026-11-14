/**
 * Bench components on the tablet — the pure half (BenchComponents.tsx is the view).
 *
 * The technician picks which component a conversation is about, confirms what
 * its label says, and answers MIRA's Return / Switch / Stay / Confirm offers.
 * Every one of those is a call to the components routes that changes validated
 * server state. None of them writes words into the next question: the chat body
 * only says which component the header showed and the selection version it read
 * (`componentSelection`), and the server checks both.
 */
import type { BenchState } from "@/capabilities/bench-components/http";
import type { ComponentAction, ComponentTurnFrame } from "@/capabilities/bench-components/chat-turn";
import type { ComponentRevision } from "@/capabilities/bench-components/selection";
import type { ComponentView } from "@/capabilities/bench-components/view";
import type { HubSelection } from "./hub-host-logic";

export type { BenchState, ComponentTurnFrame, ComponentAction, ComponentView };

export const WHOLE_MACHINE = "Whole machine — no component selected";

/** The component this conversation is asking about, or null for the whole machine. */
export function selectedComponent(state: BenchState | null): ComponentView | null {
  if (!state?.selection) return null;
  return state.components.find((c) => c.id === state.selection!.componentId) ?? null;
}

/** "Asking about VFD1 · AutomationDirect GS11N-20P2", always shown. */
export function askingAbout(state: BenchState | null): string {
  const c = selectedComponent(state);
  return c ? `Asking about ${c.label}` : WHOLE_MACHINE;
}

/**
 * When the newest answer in this conversation was asked about something other than
 * what the header now says (the picker moved, here or on another screen), say which
 * component that answer was about, so it is never read as guidance for the new one.
 * Null when they agree or nothing was asked yet.
 */
export function lastAnswerNotice(state: BenchState | null): string | null {
  const last = state?.lastTurn;
  if (!state || !last) return null;
  const sel = state.selection;
  if (sel ? last.componentId === sel.componentId && last.revision === sel.revision : last.componentId === null) return null;
  const about = last.componentId ? state.components.find((c) => c.id === last.componentId)?.label ?? "another component" : "the whole machine";
  const sameComponent = sel && last.componentId === sel.componentId;
  return sameComponent
    ? `The last answer above was for ${about} before its identity was corrected.`
    : `The last answer above was about ${about}, not ${sel ? selectedComponent(state)?.label ?? "this component" : "the whole machine"}.`;
}

/** What one chat turn carries: the component the header showed and the version read with it. */
export type ComponentRider = { notebookId: string; threadId: string; componentId: string; selectionVersion: number };

export function riderFor(state: BenchState | null, sel: HubSelection | null): ComponentRider | null {
  if (!sel || !state?.selection) return null;
  return { notebookId: sel.notebookId, threadId: sel.threadId, componentId: state.selection.componentId, selectionVersion: state.selection.version };
}

/**
 * The chat body with the rider applied — only for the conversation it was read
 * for. A component scopes the turn to its documents, so the turn is never sent
 * in general mode (the route refuses that pair).
 */
export function withComponentRider<B extends { mode?: "general" }>(
  body: B,
  sel: HubSelection,
  rider: ComponentRider | null,
): B | (Omit<B, "mode"> & { componentSelection: { componentId: string; selectionVersion: number } }) {
  if (!rider || rider.notebookId !== sel.notebookId || rider.threadId !== sel.threadId) return body;
  const { mode: _mode, ...rest } = body;
  return { ...rest, componentSelection: { componentId: rider.componentId, selectionVersion: rider.selectionVersion } };
}

/** The words on one action button. */
export function actionLabel(a: ComponentAction): string {
  switch (a.action) {
    case "return":
      return `Return to ${a.label}`;
    case "switch":
      return `Ask about ${a.label} instead`;
    case "stay":
      return `Stay on ${a.label}`;
    case "confirm":
      return `Confirm ${a.label}`;
  }
}

/** The selection change an action makes; `confirm` opens the card instead. */
export function selectionChangeFor(a: ComponentAction): { componentId: string; via: "return" | "clarify" } | null {
  if (a.action === "return") return { componentId: a.componentId, via: "return" };
  if (a.action === "switch" || a.action === "stay") return { componentId: a.componentId, via: "clarify" };
  return null;
}

/** Status chip colour: green confirmed, amber needs the technician, grey nothing yet / removed. */
export function statusTone(status: ComponentView["status"]): "ok" | "warn" | "muted" {
  if (status === "confirmed") return "ok";
  if (status === "not_confirmed" || status === "confirmed_no_model") return "warn";
  return "muted";
}

// --- the confirmation card ---

export const CARD_FIELDS = [
  ["manufacturer", "Manufacturer"],
  ["family", "Family / series"],
  ["catalogNumber", "Full catalog number"],
  ["serialNumber", "Serial number"],
  ["hardwareRevision", "Revision"],
  ["localTag", "Local tag"],
] as const;
export type CardField = (typeof CARD_FIELDS)[number][0];

export type Card = {
  componentId: string;
  /** The revision the card was opened on (0 = none). A save against an older one is refused. */
  expectedRevision: number;
  rawLabel: string;
  values: Record<CardField, string>;
  notSure: Record<CardField, boolean>;
};

export function cardFor(c: Pick<ComponentView, "id" | "current">): Card {
  const r: ComponentRevision | null = c.current;
  const values = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, (r?.[f] as string | null) ?? ""])) as Record<CardField, string>;
  const notSure = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, Boolean(r?.unresolved.includes(f))])) as Record<CardField, boolean>;
  return { componentId: c.id, expectedRevision: r?.revision ?? 0, rawLabel: r?.rawLabel ?? "", values, notSure };
}

/** "Retake": back to what the label says, nothing filled in from memory. */
export function retakeCard(card: Card): Card {
  const values = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, ""])) as Record<CardField, string>;
  const notSure = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, false])) as Record<CardField, boolean>;
  return { ...card, rawLabel: "", values, notSure };
}

/** The revisions route body for this card. "Not sure" fields are sent empty and listed. */
export function revisionBodyFor(card: Card, confirm: boolean, threadId: string, clientRequestId: string): Record<string, unknown> {
  const fields = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, card.notSure[f] ? null : card.values[f].trim() || null]));
  return {
    clientRequestId,
    expectedRevision: card.expectedRevision,
    confirm,
    // Sent exactly as typed (the server keeps it verbatim); only an all-blank label is none.
    rawLabel: card.rawLabel.trim() ? card.rawLabel : null,
    inputKind: "typed",
    ...fields,
    unresolved: CARD_FIELDS.map(([f]) => f).filter((f) => card.notSure[f]),
    threadId,
  };
}

/**
 * The request id an Add sends. While the draft is unchanged a second tap sends the
 * same id, so a retry after a lost reply finds the component the first one made
 * instead of adding another; a changed draft gets a new id.
 */
export type AddRequest = { draft: string; id: string };
export function addRequestFor(prev: AddRequest | null, draft: string, newId: () => string): AddRequest {
  return prev && prev.draft === draft ? prev : { draft, id: newId() };
}

/** A save that never reached the server (no reply at all). */
export const CONNECTION_MESSAGE = "That didn't reach the server. Check the connection, then try again.";

/** True when nothing on the card says what the component is. */
export const cardIsEmpty = (card: Card) =>
  !card.rawLabel.trim() && CARD_FIELDS.every(([f]) => !card.values[f].trim());

// --- the chat stream's component frame ---

function isComponentFrame(v: unknown): v is ComponentTurnFrame {
  const f = v as Partial<ComponentTurnFrame> | null;
  return Boolean(f && f.kind === "component" && typeof f.componentId === "string" && Array.isArray(f.actions) && Number.isInteger(f.selectionVersion));
}

/** Read the `component` frames out of a tee'd chat stream. Advisory: never throws. */
export async function parseComponentFrames(stream: ReadableStream<Uint8Array>, onFrame: (frame: ComponentTurnFrame) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (raw: string) => {
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const json = t.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const v: unknown = JSON.parse(json);
        if (isComponentFrame(v)) onFrame(v);
      } catch {
        /* not JSON — not ours */
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        handle(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
  } catch {
    /* advisory */
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** The plain words for the components routes' refusals. */
export function componentErrorMessage(code: string): string {
  switch (code) {
    case "selection_changed":
      return "The component for this chat was changed on another screen. Check the header and try again.";
    case "component_changed":
      return "This component was changed on another screen. Here is what it says now — check it and save again.";
    case "component_retired":
      return "That component was removed from the checklist.";
    case "component_not_found":
      return "That component is no longer on this project.";
    case "confirmation_required":
      return "Tap Confirm to confirm what the label says.";
    default:
      return "That couldn't be saved just now. Try again.";
  }
}
