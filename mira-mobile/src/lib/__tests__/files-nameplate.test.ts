// Pure-logic regression net for the Files / attachment / nameplate lane.
// Same convention as pure.test.ts: no DOM, no network, screen helpers pulled in
// with a dynamic import inside the it() that needs them.
import { describe, it, expect } from "vitest";

describe("notebook source mapping preserves the new server fields", () => {
  it("keeps fileId, sourceRole, matchState and opaque matchEvidence", async () => {
    const { toNotebookSource } = await import("../../api/resources");
    const evidence = { reason: "model_match", score: 0.82, terms: ["PF525"] };
    const s = toNotebookSource({
      docId: "d1",
      filename: "pf525.pdf",
      status: "indexed",
      enabledByDefault: true,
      matchState: "candidate",
      pages: 220,
      fileId: "f-9",
      sourceRole: "drawing",
      matchEvidence: evidence,
    });
    expect(s.fileId).toBe("f-9");
    expect(s.sourceRole).toBe("drawing");
    expect(s.matchState).toBe("candidate");
    // Opaque evidence is preserved by reference — never re-shaped or dropped.
    expect(s.matchEvidence).toEqual(evidence);
  });

  it("legacy rows (no matchState/fileId) stay usable and don't invent values", async () => {
    const { toNotebookSource } = await import("../../api/resources");
    const s = toNotebookSource({ docId: "d2", filename: "old.pdf" });
    expect(s.matchState).toBe("user_confirmed"); // what it meant pre-match-state
    expect(s.fileId).toBeNull();
    expect(s.sourceRole).toBeNull();
    expect(s.matchEvidence).toBeNull();
    expect(s.enabledByDefault).toBe(true);
  });
});

describe("canBeChatSource — an unconfirmed proposal is not evidence", () => {
  it("candidate and rejected are NEVER chat scope", async () => {
    const { canBeChatSource } = await import("../../api/resources");
    expect(canBeChatSource({ docId: "d", matchState: "candidate" })).toBe(false);
    expect(canBeChatSource({ docId: "d", matchState: "rejected" })).toBe(false);
  });
  it("user_confirmed and verified are, but only when materialized", async () => {
    const { canBeChatSource } = await import("../../api/resources");
    expect(canBeChatSource({ docId: "d", matchState: "user_confirmed" })).toBe(true);
    expect(canBeChatSource({ docId: "d", matchState: "verified" })).toBe(true);
    // No docId ⇒ nothing to retrieve, however trusted the relationship is.
    expect(canBeChatSource({ docId: null, matchState: "verified" })).toBe(false);
    expect(canBeChatSource({ matchState: "user_confirmed" })).toBe(false);
  });
});

describe("fileCapabilityLabel", () => {
  it("maps the three capabilities to the technician sentence", async () => {
    const { fileCapabilityLabel } = await import("../../api/resources");
    expect(fileCapabilityLabel("indexable")).toBe("Searchable source");
    expect(fileCapabilityLabel("viewable")).toBe("Viewable attachment");
    expect(fileCapabilityLabel("stored")).toBe("Stored file—not searchable in chat");
    // Unknown capability must not claim searchability.
    expect(fileCapabilityLabel("something_new")).toBe(
      "Stored file—not searchable in chat",
    );
  });
});

describe("citations carry fileId — saved AND live", () => {
  it("persisted turn evidence keeps fileId (citationsFromEvidence)", async () => {
    const { citationsFromEvidence } = await import("../../screens/NotebookScreen");
    const rows = citationsFromEvidence([
      { citationId: "1", sourceTitle: "m.pdf", page: 44, quote: "q", docId: "d1", fileId: "f1" },
      { citationId: "2", sourceTitle: "n.pdf" },
      "junk",
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].fileId).toBe("f1");
    expect(rows[1].fileId).toBeNull(); // absent, not invented
  });
  it("live SSE sources frames keep fileId (parseChatSse)", async () => {
    const { parseChatSse } = await import("../sse");
    const body =
      'data: {"kind":"sources","citations":[{"citationId":"1","sourceTitle":"m.pdf","page":7,"docId":"d9","fileId":"f9"}]}\n\n' +
      'data: {"kind":"content","content":"x [1]"}\n\ndata: [DONE]';
    const t = parseChatSse(body);
    expect(t.citations[0].fileId).toBe("f9");
    expect(t.citations[0].docId).toBe("d9");
  });
});

describe("source kind labelling (three kinds, never blurred)", () => {
  it("a confirmed materialized source is searchable; a candidate is not", async () => {
    const { sourceKind, sourceKindLabel } = await import("../../screens/NotebookScreen");
    expect(sourceKind({ docId: "d", matchState: "user_confirmed", status: "indexed" })).toBe(
      "searchable",
    );
    expect(sourceKind({ docId: "d", matchState: "candidate", status: "indexed" })).toBe(
      "viewable",
    );
    expect(sourceKind({ docId: "", matchState: "user_confirmed", status: null })).toBe("stored");
    expect(
      sourceKindLabel({ docId: "d", matchState: "candidate", status: "indexed" }),
    ).toMatch(/confirm before using/);
  });
});

describe("attachment picker selection logic", () => {
  it("multi-select accumulates and is order-independent", async () => {
    const { toggleSelection } = await import("../attach-selection");
    let sel: string[] = [];
    sel = toggleSelection(sel, "asset:a1");
    sel = toggleSelection(sel, "notebook:n1");
    expect(sel).toEqual(["asset:a1", "notebook:n1"]);
    // Reverse tap order yields the SAME selection.
    let other: string[] = [];
    other = toggleSelection(other, "notebook:n1");
    other = toggleSelection(other, "asset:a1");
    expect(other).toEqual(sel);
    // Toggling off removes it.
    expect(toggleSelection(sel, "asset:a1")).toEqual(["notebook:n1"]);
  });

  it("existing relationships render checked and are excluded from the request", async () => {
    const { existingKeys, buildAttachRequest, attachCount, attachActionLabel } = await import(
      "../attach-selection"
    );
    const existing = [{ linkId: "l1", targetType: "cmms_asset", targetId: "a1" }];
    expect(existingKeys(existing)).toEqual(["cmms_asset:a1"]);
    const selection = ["cmms_asset:a1", "equipment_notebook:n1"];
    expect(buildAttachRequest(selection, existing)).toEqual([
      { targetType: "equipment_notebook", targetId: "n1" },
    ]);
    expect(attachCount(selection, existing)).toBe(1);
    expect(attachActionLabel(selection, existing)).toBe("Attach to 1 place");
    expect(
      attachActionLabel(
        ["cmms_asset:a1", "equipment_notebook:n1", "namespace_node:x"],
        existing,
      ),
    ).toBe("Attach to 2 places");
  });

  it("building the request twice from one selection is byte-identical (retry-safe)", async () => {
    const { buildAttachRequest } = await import("../attach-selection");
    const existing = [{ linkId: "l1", targetType: "work_order", targetId: "w1" }];
    const a = buildAttachRequest(
      ["equipment_notebook:n2", "cmms_asset:a1", "work_order:w1"],
      existing,
    );
    const b = buildAttachRequest(
      ["cmms_asset:a1", "work_order:w1", "equipment_notebook:n2"],
      existing,
    );
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Sorted + de-duplicated, so a repeat is the same idempotent request.
    expect(a.map((t) => t.targetId)).toEqual(["a1", "n2"]);
    expect(buildAttachRequest(["cmms_asset:a1", "cmms_asset:a1"], [])).toHaveLength(1);
  });

  it("uses the server's own LINK_TARGET_TYPES tokens on the wire", async () => {
    const { buildAttachRequest } = await import("../attach-selection");
    // A UUID target id contains no ':' problem — the key splits on the FIRST
    // colon, so the id survives intact.
    const r = buildAttachRequest(
      ["namespace_node:1a2b3c4d-0000-4000-8000-000000000000"],
      [],
    );
    expect(r).toEqual([
      { targetType: "namespace_node", targetId: "1a2b3c4d-0000-4000-8000-000000000000" },
    ]);
  });

  it("attaches with a role when one is supplied", async () => {
    const { buildAttachRequest } = await import("../attach-selection");
    const r = buildAttachRequest(["equipment_notebook:n1"], [], (t) =>
      t.targetType === "equipment_notebook" ? "manual" : undefined,
    );
    expect(r).toEqual([
      { targetType: "equipment_notebook", targetId: "n1", role: "manual" },
    ]);
  });
});

describe("nameplate flow reducer", () => {
  const ident = {
    manufacturer: "Allen-Bradley",
    model: "100-C09",
    catalogNumber: "",
    serialNumber: "",
    equipmentType: "contactor",
    voltage: "",
    fullLoadAmps: "",
    horsepower: "",
    frequency: "",
    rpm: "",
  };
  /** A manual the server PROVED is citable: indexed doc + trusted match. */
  const citableManual = {
    fileId: "f-man",
    docId: "d1",
    filename: "100-C09.pdf",
    matchState: "verified",
    enabledByDefault: true,
    indexed: true,
    chunkCount: 88,
    discoveryUrl: "https://ab.example/100-C09.pdf",
    finalUrl: "https://ab.example/100-C09.pdf",
  };
  const ok = (extra: Record<string, unknown> = {}) => ({
    status: "complete" as const,
    manual: citableManual,
    candidate: null,
    applicability: null,
    message: null,
    warning: null,
    ...extra,
  });

  async function mod() {
    return import("../nameplate-flow");
  }

  /** Drive the happy path up to the in-flight confirm. */
  async function upToSearching() {
    const { nameplateReducer, INITIAL_NAMEPLATE_STATE } = await mod();
    let s = nameplateReducer(INITIAL_NAMEPLATE_STATE, { type: "photo_selected" });
    s = nameplateReducer(s, { type: "upload_finished" });
    s = nameplateReducer(s, {
      type: "recognized",
      fileId: "f-photo",
      identity: { manufacturer: "Allen-Bradley", model: "100-C09" },
      confidence: 0.7,
    });
    s = nameplateReducer(s, { type: "identity_edited", identity: ident });
    return nameplateReducer(s, { type: "confirm_submitted" });
  }

  it("confirmYieldedCitableSource is the gate between 'kept' and 'added'", async () => {
    const { confirmYieldedCitableSource } = await import("../../api/resources");
    expect(confirmYieldedCitableSource(ok())).toBe(true);
    // Bytes retained but never indexed ⇒ NOT a source.
    expect(
      confirmYieldedCitableSource(
        ok({ manual: { ...citableManual, indexed: false, docId: null } }),
      ),
    ).toBe(false);
    // Indexed but still only a candidate ⇒ NOT citable.
    expect(
      confirmYieldedCitableSource(ok({ manual: { ...citableManual, matchState: "candidate" } })),
    ).toBe(false);
    expect(confirmYieldedCitableSource(ok({ manual: null }))).toBe(false);
  });

  it("walks selecting_photo → uploading → recognizing → confirm_identity", async () => {
    const { nameplateReducer, INITIAL_NAMEPLATE_STATE } = await mod();
    let s = nameplateReducer(INITIAL_NAMEPLATE_STATE, { type: "photo_selected" });
    expect(s.name).toBe("uploading");
    s = nameplateReducer(s, { type: "upload_finished" });
    expect(s.name).toBe("recognizing");
    s = nameplateReducer(s, {
      type: "recognized",
      fileId: "f-photo",
      identity: { manufacturer: "Allen-Bradley" },
    });
    expect(s.name).toBe("confirm_identity");
    // A partial reading is merged onto the FULL editable shape.
    if (s.name === "confirm_identity") {
      expect(s.identity.manufacturer).toBe("Allen-Bradley");
      expect(s.identity.rpm).toBe("");
      expect(s.fileId).toBe("f-photo");
    }
  });

  it("confirm → searching → downloading → indexing → complete (with a real source)", async () => {
    const { nameplateReducer } = await mod();
    let s = await upToSearching();
    expect(s.name).toBe("searching");
    s = nameplateReducer(s, { type: "stage", stage: "downloading" });
    expect(s.name).toBe("downloading");
    s = nameplateReducer(s, { type: "stage", stage: "indexing" });
    expect(s.name).toBe("indexing");
    s = nameplateReducer(s, { type: "confirm_result", result: ok() });
    expect(s.name).toBe("complete");
    if (s.name === "complete") expect(s.manual.docId).toBe("d1");
  });

  it("REFUSES to complete when 'complete' isn't backed by a citable source", async () => {
    const { nameplateReducer } = await mod();
    // No manual at all.
    expect(
      nameplateReducer(await upToSearching(), {
        type: "confirm_result",
        result: ok({ manual: null }),
      }).name,
    ).toBe("error");
    // Bytes kept, nothing indexed — "Manual added" would be a lie.
    expect(
      nameplateReducer(await upToSearching(), {
        type: "confirm_result",
        result: ok({ manual: { ...citableManual, indexed: false, docId: null } }),
      }).name,
    ).toBe("error");
    // Indexed but only a candidate — not confirmed, so not citable.
    expect(
      nameplateReducer(await upToSearching(), {
        type: "confirm_result",
        result: ok({ manual: { ...citableManual, matchState: "candidate" } }),
      }).name,
    ).toBe("error");
  });

  it("maps every non-success confirm status to its own terminal reason", async () => {
    const { nameplateReducer, nameplateErrorCopy } = await mod();
    const cases: [string, string][] = [
      ["no_manual_found", "No official manual found"],
      ["search_unavailable", "Search service unavailable"],
      ["no_extractable_text", "PDF retained but has no extractable text"],
      ["manufacturer_model_required", "Manufacturer/model required"],
      ["download_rejected", "File retained even though later processing failed"],
    ];
    for (const [status, copy] of cases) {
      const start = await upToSearching();
      const s = nameplateReducer(start, {
        type: "confirm_result",
        result: ok({ status: status as never, manual: null }),
      });
      expect(s.name).toBe("error");
      if (s.name === "error") expect(nameplateErrorCopy(s.reason)).toBe(copy);
    }
  });

  it("candidate_review can be accepted (→ indexing) or rejected (→ edit)", async () => {
    const { nameplateReducer } = await mod();
    const start = await upToSearching();
    const review = nameplateReducer(start, {
      type: "confirm_result",
      result: ok({
        status: "candidate_review",
        manual: { ...citableManual, matchState: "candidate", enabledByDefault: false },
        candidate: {
          url: "https://ab.example/maybe.pdf",
          title: "maybe.pdf",
          host: "ab.example",
          validated: false,
          oemHost: true,
        },
        message: "Review it before adding.",
      }),
    });
    expect(review.name).toBe("candidate_review");
    if (review.name === "candidate_review") {
      expect(review.candidate?.host).toBe("ab.example");
      expect(review.message).toBe("Review it before adding.");
    }
    expect(nameplateReducer(review, { type: "candidate_accepted" }).name).toBe("indexing");
    expect(nameplateReducer(review, { type: "candidate_rejected" }).name).toBe(
      "confirm_identity",
    );
  });

  it("an unreadable nameplate is a terminal error, not a silent pass", async () => {
    const { nameplateReducer, INITIAL_NAMEPLATE_STATE, nameplateErrorCopy } = await mod();
    let s = nameplateReducer(INITIAL_NAMEPLATE_STATE, { type: "photo_selected" });
    s = nameplateReducer(s, { type: "upload_finished" });
    s = nameplateReducer(s, { type: "recognize_failed" });
    expect(s.name).toBe("error");
    if (s.name === "error") {
      expect(s.reason).toBe("unreadable_nameplate");
      expect(nameplateErrorCopy(s.reason)).toBe("Couldn't read the nameplate");
    }
  });

  it("NO event can move an error into complete", async () => {
    const { nameplateReducer } = await mod();
    const err = nameplateReducer(await upToSearching(), {
      type: "confirm_result",
      result: ok({ status: "no_manual_found", manual: null }),
    });
    expect(err.name).toBe("error");
    const events = [
      { type: "photo_selected" },
      { type: "upload_finished" },
      { type: "recognized", fileId: "x", identity: {} },
      { type: "confirm_submitted" },
      { type: "stage", stage: "indexing" },
      { type: "confirm_result", result: ok() },
      { type: "candidate_accepted" },
      { type: "candidate_rejected" },
      { type: "recognize_failed" },
      { type: "confirm_failed" },
    ] as const;
    for (const e of events) {
      expect(nameplateReducer(err, e as never).name).not.toBe("complete");
    }
    // Correcting the details is allowed — it goes back through the server.
    expect(nameplateReducer(err, { type: "edit_again" }).name).toBe("confirm_identity");
    expect(nameplateReducer(err, { type: "reset" }).name).toBe("selecting_photo");
  });

  it("complete is terminal — only reset leaves it", async () => {
    const { nameplateReducer } = await mod();
    const done = nameplateReducer(await upToSearching(), {
      type: "confirm_result",
      result: ok(),
    });
    expect(nameplateReducer(done, { type: "confirm_submitted" }).name).toBe("complete");
    expect(nameplateReducer(done, { type: "reset" }).name).toBe("selecting_photo");
  });

  it("every state has progress/terminal copy, and the required strings are exact", async () => {
    const { nameplateStatusCopy } = await mod();
    expect(nameplateStatusCopy({ name: "recognizing" })).toBe("Reading nameplate…");
    expect(
      nameplateStatusCopy({
        name: "confirm_identity",
        fileId: "f",
        identity: ident,
        confidence: null,
      }),
    ).toBe("Confirm this component");
    expect(nameplateStatusCopy({ name: "searching", fileId: "f", identity: ident })).toBe(
      "Looking for the official manual…",
    );
    expect(nameplateStatusCopy({ name: "downloading", fileId: "f", identity: ident })).toBe(
      "Downloading and validating…",
    );
    expect(nameplateStatusCopy({ name: "indexing", fileId: "f", identity: ident })).toBe(
      "Adding it to this notebook…",
    );
    expect(
      nameplateStatusCopy({
        name: "candidate_review",
        fileId: "f",
        identity: ident,
        manual: null,
        candidate: null,
        message: null,
      }),
    ).toBe("Found a possible manual—confirm before using");
    expect(
      nameplateStatusCopy({
        name: "complete",
        fileId: "f",
        identity: ident,
        manual: citableManual,
      }),
    ).toBe("Manual added—ask a question");
  });

  it("gates submission on manufacturer + model (the server's requirement)", async () => {
    const { canSubmitIdentity, NAMEPLATE_FIELDS, NAMEPLATE_FORM_HINT } = await mod();
    expect(canSubmitIdentity(ident)).toBe(true);
    expect(canSubmitIdentity({ ...ident, model: "  " })).toBe(false);
    expect(canSubmitIdentity({ ...ident, manufacturer: "" })).toBe(false);
    // A catalog number substitutes for the model — same rule the server uses.
    expect(canSubmitIdentity({ ...ident, model: "", catalogNumber: "100-C09D10" })).toBe(true);
    expect(canSubmitIdentity({ ...ident, model: "", catalogNumber: "" })).toBe(false);
    expect(NAMEPLATE_FIELDS.map((f) => f.label)).toEqual([
      "Manufacturer",
      "Model",
      "Catalog/part number",
      "Serial number",
      "Equipment type",
      "Voltage",
      "Full-load amps",
      "Horsepower",
      "Frequency",
      "RPM",
    ]);
    expect(NAMEPLATE_FORM_HINT).toBe("Read from the nameplate—edit anything that's wrong.");
  });
});

describe("Files screen pure helpers", () => {
  it("uses a photo icon for images and a doc icon otherwise", async () => {
    const { fileTypeIcon } = await import("../../screens/FilesScreen");
    expect(fileTypeIcon("image/jpeg")).toBe("🖼");
    expect(fileTypeIcon("application/pdf")).toBe("📄");
  });
  it("states processing honestly — never 'processing' for an unindexable file", async () => {
    const { processingLabel, attachedLabel } = await import("../../screens/FilesScreen");
    expect(processingLabel({ capability: "indexable", indexed: false })).toBe(
      "Indexing—not searchable yet",
    );
    expect(processingLabel({ capability: "indexable", indexed: true })).toMatch(/Searchable/);
    expect(processingLabel({ capability: "stored", indexed: false })).toBe(
      "Stored file—not searchable in chat",
    );
    expect(attachedLabel(0)).toBe("Not filed anywhere yet");
    expect(attachedLabel(1)).toBe("Attached to 1 place");
    expect(attachedLabel(3)).toBe("Attached to 3 places");
  });
  it("surfaces the server's 409 delete reasons verbatim, never a guess", async () => {
    const { deleteRefusalCopy } = await import("../../screens/FilesScreen");
    const { ApiError } = await import("../../api/client");
    expect(deleteRefusalCopy(new ApiError("client", 409, "has_links"), 2)).toMatch(
      /attached to 2 places — detach it first/,
    );
    expect(deleteRefusalCopy(new ApiError("client", 409, "verified_retained"), 0)).toBe(
      "Can't delete: verified documents are retained.",
    );
    // Not a 409 / not an ApiError ⇒ no invented reason.
    expect(deleteRefusalCopy(new ApiError("server", 500, "boom"), 0)).toBeNull();
    expect(deleteRefusalCopy(new Error("x"), 0)).toBeNull();
  });
});

describe("binary transport", () => {
  it("decodes base64 (what CapacitorHttp returns for blob) to exact bytes", async () => {
    const { base64ToBytes } = await import("../../api/client");
    // "%PDF-1.4" — the magic a mangled text-mode read would corrupt.
    expect(Array.from(base64ToBytes("JVBERi0xLjQ="))).toEqual([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
    ]);
    // Data-URL prefixes are tolerated.
    expect(base64ToBytes("data:image/png;base64,AAEC")).toEqual(
      new Uint8Array([0, 1, 2]),
    );
  });
});
