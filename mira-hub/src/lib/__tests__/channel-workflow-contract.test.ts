import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseChannelWorkflowRequest,
  semanticFingerprint,
  semanticProjection,
  type ChannelWorkflowRequest,
} from "@/lib/channel-workflow-contract";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SHA = "a".repeat(64);

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: "1.0",
    tenantId: TENANT,
    actor: {
      userId: USER,
      externalUserId: "tg-42",
      uploaderId: USER,
    },
    channel: "telegram",
    eventId: "telegram-update-9001",
    conversation: {
      id: "telegram:-10042",
      assetId: "33333333-3333-4333-8333-333333333333",
    },
    action: "message",
    text: "Can you find the user manual?",
    caption: "Can you find the user manual?",
    attachments: [
      {
        attachmentId: "photo-largest",
        kind: "image",
        mimeType: "image/jpeg",
        filename: "danfoss-fc202.jpg",
        sizeBytes: 128,
        sha256: SHA,
      },
    ],
    ...overrides,
  };
}

describe("channel workflow v1 contract", () => {
  it("loads the complete production regression narrative and literal Danfoss identity", () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "../tests/fixtures/channel_workflow/danfoss_fc202_telegram.json",
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

    expect(fixture.observedFailures).toHaveLength(10);
    expect(fixture.equipment).toEqual({
      manufacturer: "Danfoss",
      product: "VLT AQUA Drive",
      productFamily: "VLT AQUA Drive",
      series: "FC-202",
      model: "FC-202",
      typeCode: "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
      partNumber: "131H4017",
      serialNumber: "02334H073",
      rating: "15 kW / 20 HP",
      input: "3-phase 200-240 V",
    });
    expect(fixture.sequence.map((s: { text: string }) => s.text)).toContain(
      "i gave you the user manual can you help me",
    );
  });

  it("accepts one complete request and preserves every identity/context boundary", () => {
    const parsed = parseChannelWorkflowRequest(request());

    expect(parsed).toMatchObject({
      contractVersion: "1.0",
      tenantId: TENANT,
      channel: "telegram",
      eventId: "telegram-update-9001",
      action: "message",
      conversation: {
        id: "telegram:-10042",
        assetId: "33333333-3333-4333-8333-333333333333",
      },
      attachments: [
        {
          attachmentId: "photo-largest",
          kind: "image",
          mimeType: "image/jpeg",
          filename: "danfoss-fc202.jpg",
          sizeBytes: 128,
          sha256: SHA,
        },
      ],
    });
  });

  it("accepts only explicit equipment fields on an identity confirmation", () => {
    const parsed = parseChannelWorkflowRequest(
      request({
        action: "confirm_identity",
        priorOperationId: "44444444-4444-4444-8444-444444444444",
        confirmedIdentity: {
          manufacturer: "Danfoss",
          series: "FC-202",
          typeCode: "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
          partNumber: "131H4017",
        },
        attachments: [],
      }),
    );

    expect(parsed.confirmedIdentity).toEqual({
      manufacturer: "Danfoss",
      series: "FC-202",
      typeCode: "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
      partNumber: "131H4017",
    });
    expect(() =>
      parseChannelWorkflowRequest(
        request({
          action: "confirm_identity",
          priorOperationId: "44444444-4444-4444-8444-444444444444",
          confirmedIdentity: { manufacturer: "Danfoss", verified: true },
          attachments: [],
        }),
      ),
    ).toThrow("unknown_identity_field");
  });

  it.each([
    ["non-UUID tenant", { tenantId: "staging" }, "invalid_tenant_id"],
    ["missing event", { eventId: "" }, "event_id_required"],
    [
      "non-canonical actor",
      { actor: { userId: "user-1", externalUserId: "42", uploaderId: USER } },
      "invalid_actor_id",
    ],
    ["missing conversation", { conversation: { id: "" } }, "conversation_id_required"],
    [
      "attachment without a SHA",
      {
        attachments: [
          {
            attachmentId: "p",
            kind: "image",
            mimeType: "image/jpeg",
            filename: "p.jpg",
            sizeBytes: 1,
            sha256: "",
          },
        ],
      },
      "invalid_attachment_sha256",
    ],
  ])("rejects %s", (_label, override, code) => {
    expect(() => parseChannelWorkflowRequest(request(override))).toThrow(code as string);
  });

  it("rejects unknown top-level and attachment properties instead of silently widening trust", () => {
    expect(() => parseChannelWorkflowRequest(request({ approved: true }))).toThrow(
      "unknown_request_field",
    );
    const bad = request();
    (bad.attachments as Array<Record<string, unknown>>)[0].verified = true;
    expect(() => parseChannelWorkflowRequest(bad)).toThrow("unknown_attachment_field");
  });

  it("produces the same semantic projection for Telegram, Slack, Hub, and mobile", () => {
    const transports: Array<{
      channel: ChannelWorkflowRequest["channel"];
      eventId: string;
      externalUserId: string;
      conversationId: string;
      attachmentId: string;
    }> = [
      {
        channel: "telegram",
        eventId: "tg:1",
        externalUserId: "42",
        conversationId: "telegram:-10042",
        attachmentId: "tg-file",
      },
      {
        channel: "slack",
        eventId: "slack:1",
        externalUserId: "U42",
        conversationId: "slack:C1:1700.1",
        attachmentId: "slack-file",
      },
      {
        channel: "hub",
        eventId: "hub:1",
        externalUserId: "browser-42",
        conversationId: "hub:notebook-screen",
        attachmentId: "hub-file",
      },
      {
        channel: "mobile",
        eventId: "mobile:1",
        externalUserId: "device-42",
        conversationId: "mobile:notebook-screen",
        attachmentId: "mobile-file",
      },
    ];

    const projections = transports.map((t) => {
      const raw = request({
        channel: t.channel,
        eventId: t.eventId,
        actor: { userId: USER, externalUserId: t.externalUserId, uploaderId: USER },
        conversation: {
          id: t.conversationId,
          assetId: "33333333-3333-4333-8333-333333333333",
        },
      });
      (raw.attachments as Array<Record<string, unknown>>)[0].attachmentId = t.attachmentId;
      return semanticProjection(parseChannelWorkflowRequest(raw));
    });

    expect(projections[1]).toEqual(projections[0]);
    expect(projections[2]).toEqual(projections[0]);
    expect(projections[3]).toEqual(projections[0]);
    expect(
      (projections[0].attachments as Array<{ sha256: string }>)[0].sha256,
    ).toBe(SHA);
  });

  it("fingerprints the complete request deterministically and detects event changes", () => {
    const parsed = parseChannelWorkflowRequest(request());
    const reordered = Object.fromEntries(Object.entries(request()).reverse());

    expect(semanticFingerprint(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(semanticFingerprint(parseChannelWorkflowRequest(reordered))).toBe(
      semanticFingerprint(parsed),
    );
    expect(
      semanticFingerprint(parseChannelWorkflowRequest(request({ eventId: "telegram-update-9002" }))),
    ).not.toBe(semanticFingerprint(parsed));
  });
});
