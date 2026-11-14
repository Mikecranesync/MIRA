/**
 * Bench components on the tablet (Mike 2026-11-14): "Asking about …" is always
 * shown; the chat turn carries only which component and which selection version
 * (never words for the parser), and only in the conversation it was read for;
 * the card keeps "Not sure" fields empty and the label verbatim; the reply's
 * offers are selection changes, not text. Static render: no jsdom in this repo.
 *
 * Run: npx vitest run src/factorylm-ui/bench-components-logic.test.tsx
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComponentRow, ConfirmationCard } from "./BenchComponents";
import {
  WHOLE_MACHINE,
  actionLabel,
  addRequestFor,
  askingAbout,
  cardFor,
  parseComponentFrames,
  retakeCard,
  revisionBodyFor,
  riderFor,
  selectionChangeFor,
  withComponentRider,
  type BenchState,
  type ComponentTurnFrame,
  type ComponentView,
} from "./bench-components-logic";

const NB = "22222222-2222-4222-8222-222222222222";
const VFD = "44444444-4444-4444-8444-444444444444";
const PS1 = "77777777-7777-4777-8777-777777777777";
const vfdRev = {
  componentId: VFD, revision: 2, rawLabel: "AutomationDirect GS11N-20P2 S/N 1234", inputKind: "typed" as const,
  manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-20P2", serialNumber: "1234",
  hardwareRevision: null, localTag: "VFD1", identityStatus: "user_confirmed" as const, unresolved: [],
  confirmedAt: "2026-11-14T03:00:00.000Z", createdAt: "2026-11-14T03:00:00.000Z",
};
const view = (over: Partial<ComponentView>): ComponentView => ({
  id: VFD, position: 1, kind: "VFD", origin: "device_schedule", status: "confirmed", statusLabel: "confirmed",
  label: "VFD1 · AutomationDirect GS11N-20P2", current: vfdRev, documents: [], hasOwnDocument: false, evidence: "Confirmed by a technician.", ...over,
});
const state = (selection: BenchState["selection"]): BenchState => ({
  components: [view({}), view({ id: PS1, label: "PS1", status: "not_confirmed", statusLabel: "identity not confirmed", current: null })],
  selection, turnComponents: {}, tallies: {}, documentNumbers: [],
});
const SEL = { notebookId: NB, threadId: "legacy" };
const selected = { componentId: VFD, revision: 2, selectedAt: "2026-11-14T04:00:00.000Z", selectedVia: "picker" as const, version: 3, current: true };

describe("Asking about", () => {
  it("names the selected component, and says so plainly when there is none", () => {
    expect(askingAbout(state(selected))).toBe("Asking about VFD1 · AutomationDirect GS11N-20P2");
    expect(askingAbout(state(null))).toBe(WHOLE_MACHINE);
    expect(askingAbout(null)).toBe(WHOLE_MACHINE);
  });
});

describe("the chat rider", () => {
  const body = { message: "what does oC mean", sourceDocIds: [], history: [], clientRequestId: "r", threadId: null, mode: "general" as const };

  it("carries the component and the version the header showed, and never sends a component turn in general mode", () => {
    const out = withComponentRider(body, SEL, riderFor(state(selected), SEL));
    expect(out).toEqual({ message: "what does oC mean", sourceDocIds: [], history: [], clientRequestId: "r", threadId: null, componentSelection: { componentId: VFD, selectionVersion: 3 } });
    // The question itself is never rewritten.
    expect(out.message).toBe(body.message);
  });

  it("control: no selection, or a rider read for another conversation, leaves the body untouched", () => {
    expect(withComponentRider(body, SEL, riderFor(state(null), SEL))).toBe(body);
    const other = riderFor(state(selected), { notebookId: NB, threadId: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(withComponentRider(body, SEL, other)).toBe(body);
  });
});

describe("the reply's offers are selection changes", () => {
  const a = (action: "return" | "switch" | "stay" | "confirm") => ({ action, componentId: VFD, label: "VFD1 · AutomationDirect GS11N-20P2" });
  it("labels and the server call each one makes", () => {
    expect(actionLabel(a("return"))).toBe("Return to VFD1 · AutomationDirect GS11N-20P2");
    expect(selectionChangeFor(a("return"))).toEqual({ componentId: VFD, via: "return" });
    expect(selectionChangeFor(a("switch"))).toEqual({ componentId: VFD, via: "clarify" });
    expect(selectionChangeFor(a("stay"))).toEqual({ componentId: VFD, via: "clarify" });
    // Confirm opens the card; it does not select anything by itself.
    expect(selectionChangeFor(a("confirm"))).toBeNull();
  });
});

describe("the confirmation card", () => {
  it("sends the label verbatim, a Not sure field empty and listed, and the revision it was opened on", () => {
    const card = cardFor(view({}));
    const edited = { ...card, rawLabel: "GS11N-2OP2  S/N 1234", values: { ...card.values, catalogNumber: "GS11N-2OP2" }, notSure: { ...card.notSure, serialNumber: true } };
    const body = revisionBodyFor(edited, true, "legacy", "req-1");
    expect(body).toMatchObject({
      clientRequestId: "req-1", expectedRevision: 2, confirm: true, rawLabel: "GS11N-2OP2  S/N 1234",
      catalogNumber: "GS11N-2OP2", serialNumber: null, unresolved: ["serialNumber"], threadId: "legacy", hardwareRevision: null,
    });
  });

  it("Retake empties every field instead of keeping what was there", () => {
    const r = retakeCard(cardFor(view({})));
    expect(r.rawLabel).toBe("");
    expect(Object.values(r.values).every((v) => v === "")).toBe(true);
    expect(r.expectedRevision).toBe(2);
  });

  it("shows the exact character that differs from a document's number, and does not fill it in", () => {
    const card = { ...cardFor(view({})), values: { ...cardFor(view({})).values, catalogNumber: "GS11N-2OP2" } };
    const html = renderToStaticMarkup(
      <ConfirmationCard card={card} onChange={vi.fn()} known={[{ label: "GS11N-20P2", from: "gs10usermanual.pdf" }]} saving={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(html).toContain('<mark style="background:var(--fl-warn-bg);color:var(--fl-warn)" title="you typed O">0</mark>');
    expect(html).toContain("&quot;0&quot; (zero) where you typed &quot;O&quot; (letter O)");
    expect(html).toContain('value="GS11N-2OP2"');
    expect(html).not.toContain("Written exactly like this");
  });
});

describe("adding a component", () => {
  it("a second tap on the same draft sends the same request id, so a lost reply cannot add a copy", () => {
    const newId = vi.fn(() => "id-1");
    const first = addRequestFor(null, '{"kind":"relay"}', newId);
    const retry = addRequestFor(first, '{"kind":"relay"}', vi.fn(() => "id-2"));
    expect(retry.id).toBe("id-1");
    expect(newId).toHaveBeenCalledTimes(1);
  });

  it("control: a changed draft gets a new request id (the old one would be refused as a different add)", () => {
    const first = addRequestFor(null, '{"kind":"relay"}', () => "id-1");
    expect(addRequestFor(first, '{"kind":"contactor"}', () => "id-2").id).toBe("id-2");
  });
});

describe("the checklist", () => {
  it("an unconfirmed component is never shown as having a manual (unknown is not ready)", () => {
    const html = renderToStaticMarkup(
      <ComponentRow
        c={view({ id: PS1, label: "PS1", status: "not_confirmed", statusLabel: "identity not confirmed", current: null, evidence: "Old device schedule says Mean Well.", documents: [{ docId: "d", filename: "psu.pdf", selected: true, model: "covers", declared: [], ready: true, readyLabel: "searchable" }] })}
        selected={false} tally={{ answered: 0, refused: 1 }} saving={false} onAsk={vi.fn()} onCheck={vi.fn()}
      />,
    );
    expect(html).toContain("identity not confirmed");
    expect(html).toContain("Manuals are not checked until its identity is confirmed.");
    expect(html).not.toContain("psu.pdf");
    expect(html).toContain("answered 0 · refused 1 in this chat");
    // Every row says what it rests on.
    expect(html).toContain("Evidence: Old device schedule says Mean Well.");
  });
});

describe("component frames in the chat stream", () => {
  it("reads only well-formed component frames, across chunk boundaries", async () => {
    const frame: ComponentTurnFrame = { kind: "component", componentId: VFD, revision: 2, selectionVersion: 3, label: "VFD1", actions: [{ action: "return", componentId: VFD, label: "VFD1" }] };
    const text = [
      `data: ${JSON.stringify({ kind: "sources", citations: [] })}\n\n`,
      `data: ${JSON.stringify({ kind: "status", status: "insufficient_evidence" })}\n\n`,
      `data: ${JSON.stringify({ kind: "component", componentId: VFD, actions: [] })}\n\n`, // no selectionVersion: not ours
      `data: ${JSON.stringify(frame)}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    const bytes = new TextEncoder().encode(text);
    const cut = Math.floor(bytes.length / 2) + 3;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    });
    const seen: ComponentTurnFrame[] = [];
    await parseComponentFrames(stream, (f) => seen.push(f));
    expect(seen).toEqual([frame]);
  });
});
