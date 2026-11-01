/**
 * Codex #5062 F4–F6 — the panel never shows one notebook's packet under another machine, clears a
 * stale revision tick when the manuals change, and the PDF carries the job header and a source
 * line for every cited field. Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-panel-review-fixes
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Field, WorkPacket } from "@/capabilities/work-packet/types";
import { FieldRow, PacketHeader } from "../WorkPacketPanel";
import { documentsSignature, packetForNotebook, packetHeaderRows } from "../work-packet-view";

const NB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const f = (value: string | null): Field => ({ value, label: value ? "verified" : "unknown", source: null, basis: "t" });
const HEAD: Pick<WorkPacket, "workOrder" | "equipment"> = {
  workOrder: { id: "WO-7781", title: "Reseal", description: "Replace low-pressure seals", assetTag: "PUMP-3", site: "Line 2", synthetic: false },
  equipment: { manufacturer: f("CAT Pumps"), model: f("3520"), serial: f(null), identityStatus: "user_confirmed" } as WorkPacket["equipment"],
};

describe("F4 — a packet is only shown under the notebook it was built for", () => {
  const packet = { notebookId: NB_A } as WorkPacket;
  it("drops another notebook's packet", () => expect(packetForNotebook(packet, NB_B)).toBeNull());
  it("control: keeps its own", () => expect(packetForNotebook(packet, NB_A)).toBe(packet));
  it("hub-host remounts the panel on notebook, identity or manual change", () => {
    const src = readFileSync(join(__dirname, "..", "hub-host.tsx"), "utf8");
    const mount = src.slice(src.indexOf("<WorkPacketPanel"), src.indexOf("/>", src.indexOf("<WorkPacketPanel")));
    for (const part of ["key={[", "selection.notebookId", "detail?.notebook.identityStatus", "detail?.notebook.model", "detail?.sources"]) {
      expect(mount).toContain(part);
    }
  });
});

describe("F5 — the revision tick is tied to the exact documents shown", () => {
  const rev = (v: string) => ({ value: v, label: "verified" as const, source: null, basis: "t" });
  it("changes when a manual is attached", () => {
    expect(documentsSignature([{ docId: "d1", revision: rev("J") }])).not.toBe(
      documentsSignature([{ docId: "d1", revision: rev("J") }, { docId: "d2", revision: rev("A") }]),
    );
  });
  it("changes when a revision changes", () => {
    expect(documentsSignature([{ docId: "d1", revision: rev("J") }])).not.toBe(documentsSignature([{ docId: "d1", revision: rev("K") }]));
  });
  it("control: same documents, same signature", () => {
    expect(documentsSignature([{ docId: "d1", revision: rev("J") }])).toBe(documentsSignature([{ docId: "d1", revision: rev("J") }]));
  });
});

describe("F6 — the PDF says which job, which pump, and where each line came from", () => {
  it("header rows carry the work order and equipment", () => {
    const text = packetHeaderRows(HEAD).map((r) => `${r.label}: ${r.value}`).join("\n");
    for (const s of ["Work order: WO-7781", "Title: Reseal", "Job: Replace low-pressure seals", "Asset tag: PUMP-3", "Site: Line 2", "Manufacturer: CAT Pumps", "Model: 3520", "Serial: (unknown)"]) {
      expect(text).toContain(s);
    }
  });

  it("the header renders without a no-print marker", () => {
    const html = renderToStaticMarkup(<PacketHeader packet={HEAD} />);
    expect(html).toContain("WO-7781");
    expect(html).toContain("PUMP-3");
    expect(html).not.toContain("data-no-print");
  });

  it("a cited field prints its file and page; the chip button stays screen-only", () => {
    const field: Field = {
      value: "90 in-lbs", label: "verified", basis: "t",
      source: { docId: "d1", fileId: null, filename: "3520_J.pdf", page: 6, line: "Plunger Retainer 90 in-lbs" },
    };
    const html = renderToStaticMarkup(<FieldRow path="measurements[0].value" field={field} onEdit={() => {}} busy={false} />);
    const printOnly = html.match(/<div class="wp-print-only"[^>]*>(.*?)<\/div>/);
    expect(printOnly?.[1]).toContain("p.6 3520_J.pdf");
  });

  it("control: an uncited field has no source line", () => {
    const html = renderToStaticMarkup(<FieldRow path="unknowns[0]" field={f(null)} onEdit={() => {}} busy={false} />);
    expect(html).not.toContain("wp-print-only");
  });

  it("print CSS reveals .wp-print-only on paper", () => {
    const src = readFileSync(join(__dirname, "..", "WorkPacketPanel.tsx"), "utf8");
    expect(src).toMatch(/@media print[\s\S]*\.wp-print-root \.wp-print-only \{ display: block !important; \}/);
  });
});
