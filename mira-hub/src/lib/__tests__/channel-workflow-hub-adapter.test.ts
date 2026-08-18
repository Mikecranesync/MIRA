import { describe, expect, it } from "vitest";

import {
  canonicalFileTargets,
  parseNotebookChatResponse,
} from "@/lib/channel-workflow-hub-adapter";
import type { ChannelWorkspace } from "@/lib/channel-workspaces";

const WORKSPACE: ChannelWorkspace = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  channel: "telegram",
  conversationId: "telegram:-42",
  generation: 1,
  notebookId: "33333333-3333-4333-8333-333333333333",
  notebookNodeId: "44444444-4444-4444-8444-444444444444",
  selectedNodeId: "55555555-5555-4555-8555-555555555555",
  assetId: "66666666-6666-4666-8666-666666666666",
  equipmentIdentity: null,
  lastFileId: null,
  lastDocId: null,
  pendingIntent: null,
  pendingOperationId: null,
  status: "confirmed",
};

describe("canonical Hub workflow adapter", () => {
  it("attaches an intake to conversation, notebook, asset, and selected node", () => {
    expect(canonicalFileTargets(WORKSPACE, "VLT User Manual.pdf")).toEqual([
      {
        targetType: "troubleshooting_session",
        targetId: WORKSPACE.sessionId,
        role: "conversation_upload",
        displayLabel: "VLT User Manual.pdf",
      },
      {
        targetType: "equipment_notebook",
        targetId: WORKSPACE.notebookId,
        role: "manual",
        displayLabel: "VLT User Manual.pdf",
      },
      {
        targetType: "cmms_asset",
        targetId: WORKSPACE.assetId,
        role: "manual",
        displayLabel: "VLT User Manual.pdf",
      },
      {
        targetType: "namespace_node",
        targetId: WORKSPACE.selectedNodeId,
        role: "manual",
        displayLabel: "VLT User Manual.pdf",
      },
    ]);
  });

  it("reduces the canonical notebook SSE into one cited semantic answer", async () => {
    const response = new Response(
      [
        'data: {"kind":"content","content":"Set parameter "}\n\n',
        'data: {"kind":"content","content":"1-90 [1]."}\n\n',
        'data: {"kind":"sources","citations":[{"citationId":"1","docId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","fileId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sourceTitle":"VLT User Manual.pdf","page":72,"quote":"Motor thermal protection"}],"sourceSnapshot":["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]}\n\n',
        'data: {"kind":"status","status":"answered"}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );

    await expect(parseNotebookChatResponse(response)).resolves.toEqual({
      status: "answered",
      text: "Set parameter 1-90 [1].",
      citations: [
        {
          citationId: "1",
          docId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          fileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          sourceTitle: "VLT User Manual.pdf",
          page: 72,
          quote: "Motor thermal protection",
        },
      ],
    });
  });

  it("fails closed when the chat route returns JSON instead of a source-scoped stream", async () => {
    const response = Response.json({ error: "source_not_in_notebook" }, { status: 403 });
    await expect(parseNotebookChatResponse(response)).rejects.toThrow(
      "notebook_chat_source_not_in_notebook",
    );
  });
});
