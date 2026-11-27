// #6085: the subject reader passes the identity cards saved on a conversation's turns to the
// thread scope, so the question a confirmed card came from reads as the confirmed machine.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/manual-status-subject-card
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/equipment-notebooks", () => ({ listTurns: vi.fn(async () => []) }));

import { subjectReader, TURN_WINDOW } from "@/capabilities/manual-status-subject";
import { listTurns } from "@/lib/equipment-notebooks";

const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";
const MACHINE = { manufacturer: "Siemens", model: "TP700", catalogNumber: "", recordCatalog: null };

type Turn = Parameters<typeof subjectReader>[0]["turns"][number];
const turn = (question: string, evidence: unknown[] = []) => ({ question, evidence }) as unknown as Turn;
const shown = (turns: Turn[]) =>
  subjectReader({ tenantId: "t", notebookId: "n", viewerUserId: "u", threadId: "th", turns, machine: MACHINE }).shown();

describe("subjectReader reads the identity cards saved on the turns (#6085)", () => {
  it("is own for the thread whose first turn carries the confirmed machine's card", async () => {
    await expect(shown([turn(J2, [{ kind: "identity_proposal", manufacturer: "Siemens", model: "TP700" }])])).resolves.toBe("own");
  });

  it("stays own for a follow-up with no model named", async () => {
    const turns = [turn(J2, [{ kind: "identity_proposal", manufacturer: "Siemens", model: "TP700" }]), turn("What is the rated supply voltage?")];
    await expect(shown(turns)).resolves.toBe("own");
  });

  it("control: the same turn with no card is other", async () => {
    await expect(shown([turn(J2)])).resolves.toBe("other");
  });

  it("control: a card for another model, a malformed card or other evidence changes nothing", async () => {
    await expect(shown([turn(J2, [{ kind: "identity_proposal", manufacturer: "Siemens", model: "TP900" }])])).resolves.toBe("other");
    await expect(shown([turn(J2, [{ kind: "identity_proposal", manufacturer: "Siemens" }])])).resolves.toBe("other");
    await expect(shown([turn(J2, [{ kind: "manual_citation", manufacturer: "Siemens", model: "TP700" }])])).resolves.toBe("other");
  });

  it("reads the cards on the wider read when the newest window settles nothing", async () => {
    const followUps = Array.from({ length: TURN_WINDOW }, () => turn("What does the screen show?"));
    const cardTurn = turn(J2, [{ kind: "identity_proposal", manufacturer: "Siemens", model: "TP700" }]);
    const named = turn("Does the 6AV2124-0GC01-0AX0 need a fuse?");
    vi.mocked(listTurns).mockResolvedValueOnce([cardTurn, named, ...followUps] as never);
    await expect(shown(followUps)).resolves.toBe("own");
    vi.mocked(listTurns).mockResolvedValueOnce([turn(J2), named, ...followUps] as never);
    await expect(shown(followUps)).resolves.toBe("other");
  });
});
