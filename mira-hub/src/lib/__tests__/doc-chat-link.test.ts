import { describe, it, expect } from "vitest";

// ARPK Phase 1d — the per-document Chat deep link. One builder, used by the
// documents list + detail surfaces; (hub)/namespace/page.tsx parses these
// exact params (node / chat / doc / docname) to open NodeChat doc-scoped.

import { docChatHref, isDocChattable } from "../doc-chat-link";

const DOC = {
  doc_id: "5f9b2c1a-0000-4000-8000-000000000001",
  node_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  title: "T2108 Manual EN.pdf",
};

describe("docChatHref", () => {
  it("builds the namespace deep link with node, chat, doc, and encoded docname", () => {
    const href = docChatHref(DOC);
    expect(href).toBe(
      `/namespace?node=${DOC.node_id}&chat=1&doc=${DOC.doc_id}&docname=T2108%20Manual%20EN.pdf`,
    );
  });
});

describe("isDocChattable", () => {
  it("true only when both v2 keys are present", () => {
    expect(isDocChattable(DOC)).toBe(true);
    expect(isDocChattable({ doc_id: null, node_id: DOC.node_id })).toBe(false);
    expect(isDocChattable({ doc_id: DOC.doc_id, node_id: null })).toBe(false);
  });
});
