/**
 * The public demo host — the visitor flow, end to end, at the seam that matters.
 *
 * `PublicDemo` had no direct coverage before this file: the machine view, the
 * polling loop and the chat client were each tested in their own package, but
 * the HOST that wires them together — config parsing, the ask, and what the
 * visitor is shown when the real route declines — was not.
 *
 * The decision under test is the sign-up flow. The shared chat route begins
 * with `sessionOr401`, so an anonymous visitor cannot be answered. That is the
 * route working as designed, and the honest end of the turn is an INVITATION,
 * not a red error. A genuine fault must stay a red error, or we would both
 * mislead the visitor and hide the bug from ourselves.
 */
import { describe, expect, it } from "bun:test";
import {
  PROFILES,
  chatUnavailable,
  createShellState,
  getFixture,
  type ChatResult,
  type ConversionIntent,
  type InteractionPart,
} from "@factorylm/interaction";
import {
  ASK_CONVERSION_INTENTS,
  DEFAULT_DEMO_CONFIG,
  assistantTurn,
  conversionDestination,
  parseDemoConfig,
  revealNewestTurn,
  userTurn,
} from "../PublicDemo";

const AT = "2026-09-15T12:00:00.000Z";
const state = () => createShellState(getFixture("empty"), PROFILES.public);

const partTypes = (parts: readonly InteractionPart[]) => parts.map((part) => part.type);
/**
 * The status part's OWN value — not the turn's lifecycle.
 *
 * They are two separate declarations of the same fact and nothing forces them
 * to agree. A turn whose lifecycle is `completed` while its status part says
 * `failed` renders the word "Failed" underneath an invitation, which is the
 * exact contradiction this whole change exists to remove. Asserting only the
 * lifecycle let that mutation through.
 */
const statusOf = (parts: readonly InteractionPart[]) =>
  parts.find((part): part is Extract<InteractionPart, { type: "status" }> => part.type === "status")?.status;

const prompt = (parts: readonly InteractionPart[]) =>
  parts.find((part): part is Extract<InteractionPart, { type: "conversion_prompt" }> =>
    part.type === "conversion_prompt");

describe("demo configuration comes from the query string, never from a commit", () => {
  it("defaults to local SimLab and local Hub with no notebook", () => {
    expect(parseDemoConfig("")).toEqual(DEFAULT_DEMO_CONFIG);
  });

  it("reads every knob, and an absent notebook stays absent rather than becoming a string", () => {
    const config = parseDemoConfig("?simlab=http://127.0.0.1:8098&hub=http://hub.test&notebook=nb-7");
    expect(config).toEqual({
      simlabUrl: "http://127.0.0.1:8098",
      hubUrl: "http://hub.test",
      appOrigin: "https://app.factorylm.com",
      notebookId: "nb-7",
    });
    // `notebookId` must be ABSENT, not `undefined`-valued: the chat client's
    // unconfigured branch keys on the property, and a present-but-undefined key
    // is what would let a "configured" preview silently have no notebook.
    expect("notebookId" in parseDemoConfig("")).toBe(false);
  });
});

describe("a declined anonymous turn ends in the door, not in an error", () => {
  for (const reason of ["unauthenticated", "not_configured"] as const) {
    it(`renders a conversion prompt for ${reason}, and completes rather than fails`, () => {
      const turn = assistantTurn("t1", chatUnavailable(reason), state(), AT);

      expect(partTypes(turn.parts)).toEqual(["conversion_prompt", "status"]);
      expect(turn.lifecycle).toBe("completed");
      // …and the status the visitor actually READS agrees with it.
      expect(statusOf(turn.parts)).toBe("completed");
      expect(prompt(turn.parts)?.prompt.intents).toEqual(ASK_CONVERSION_INTENTS);
      // The visitor reads the route's own sentence, not a marketing rewrite.
      expect(prompt(turn.parts)?.prompt.reason).toBe(chatUnavailable(reason).message);
    });
  }

  it("leads with Create workspace — the visitor asking about equipment usually has their own", () => {
    expect(ASK_CONVERSION_INTENTS[0]).toBe("create-workspace");
    // `try-your-equipment` belongs to the attachment menu. Offering three doors
    // for one action is how a conversion moment becomes a decision problem.
    expect(ASK_CONVERSION_INTENTS).not.toContain("try-your-equipment" as ConversionIntent);
  });

  it("still invents nothing: a declined turn carries no text part", () => {
    for (const reason of ["unauthenticated", "not_configured"] as const) {
      const turn = assistantTurn("t1", chatUnavailable(reason), state(), AT);
      expect(partTypes(turn.parts)).not.toContain("text");
      expect(partTypes(turn.parts)).not.toContain("source");
    }
  });
});

describe("a genuine fault stays a fault — never dressed up as a sign-up prompt", () => {
  for (const reason of ["unreachable", "http_error", "malformed_stream"] as const) {
    it(`renders an error for ${reason}, and fails rather than completing`, () => {
      const turn = assistantTurn("t1", chatUnavailable(reason), state(), AT);

      expect(partTypes(turn.parts)).toEqual(["error", "status"]);
      expect(turn.lifecycle).toBe("failed");
      expect(statusOf(turn.parts)).toBe("failed");
      expect(partTypes(turn.parts)).not.toContain("conversion_prompt");
    });
  }

  it("marks an unreachable hub offline and everything else a provider failure", () => {
    const offline = assistantTurn("t1", chatUnavailable("unreachable"), state(), AT);
    const broken = assistantTurn("t1", chatUnavailable("http_error"), state(), AT);
    const code = (parts: readonly InteractionPart[]) =>
      parts.find((part): part is Extract<InteractionPart, { type: "error" }> => part.type === "error")?.error.code;
    expect(code(offline.parts)).toBe("offline");
    expect(code(broken.parts)).toBe("provider_failure");
  });

  it("offers no conversion on ANY fault — a broken hub is not a sales opportunity", () => {
    for (const reason of ["unreachable", "http_error", "malformed_stream"] as const) {
      const turn = assistantTurn("t1", chatUnavailable(reason), state(), AT);
      const text = JSON.stringify(turn.parts);
      expect(text).not.toContain("create-workspace");
      expect(text).not.toContain("Create a workspace");
    }
  });
});

describe("a real answer is passed through untouched", () => {
  it("keeps the route's own parts and lifecycle — the host adds nothing", () => {
    const answered: ChatResult = {
      ok: true,
      parts: [
        { type: "text", text: "Case Packer 01 faulted on CP001." },
        { type: "source", source: { id: "doc-1", title: "Case packer manual", kind: "oem_documentation", locator: "p. 12" } },
        { type: "status", status: "completed" },
      ],
      lifecycle: "completed",
    };
    const turn = assistantTurn("t1", answered, state(), AT);
    expect(turn.parts).toEqual(answered.parts);
    expect(turn.lifecycle).toBe("completed");
    expect(partTypes(turn.parts)).not.toContain("conversion_prompt");
  });
});

describe("turn identity", () => {
  it("numbers user and assistant turns off the thread the visitor can see", () => {
    const base = state();
    expect(userTurn("t1", "why did it stop?", base, AT).id).toBe("t1-u-1");
    expect(assistantTurn("t1", chatUnavailable("unreachable"), base, AT).id).toBe("t1-a-1");
  });

  it("carries the active context onto every turn, so the shell can attribute it", () => {
    const base = state();
    expect(userTurn("t1", "q", base, AT).context).toEqual(base.activeContext);
    expect(assistantTurn("t1", chatUnavailable("unauthenticated"), base, AT).context).toEqual(base.activeContext);
  });
});

describe("the answer the visitor is asked to act on is brought on screen", () => {
  /**
   * Drive `revealNewestTurn` against a controllable page.
   *
   * The real defect this guards was measured in a browser, not inferred: with
   * the machine panel rendered the document is taller than the viewport, so the
   * PAGE scrolls rather than the conversation, and the conversion prompt's
   * buttons landed below the fold on mobile.
   */
  function withPage(scrollHeight: number, clientHeight: number) {
    const scrolled: { top?: number }[] = [];
    const frames: FrameRequestCallback[] = [];
    const win = globalThis.window as unknown as Record<string, unknown>;
    const originalRaf = win.requestAnimationFrame;
    const originalScrollTo = win.scrollTo;
    const originalElement = Object.getOwnPropertyDescriptor(document, "scrollingElement");

    win.requestAnimationFrame = ((cb: FrameRequestCallback) => { frames.push(cb); return frames.length; }) as unknown;
    win.scrollTo = ((options: { top?: number }) => { scrolled.push(options); }) as unknown;
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      get: () => ({ scrollHeight, clientHeight }),
    });

    return {
      scrolled,
      run: () => { revealNewestTurn(); frames.splice(0).forEach((frame) => frame(0)); },
      restore: () => {
        win.requestAnimationFrame = originalRaf;
        win.scrollTo = originalScrollTo;
        if (originalElement) Object.defineProperty(document, "scrollingElement", originalElement);
        else Reflect.deleteProperty(document as unknown as object, "scrollingElement");
      },
    };
  }

  it("scrolls to the foot of the page when the turn would otherwise be below the fold", () => {
    const page = withPage(1170, 915);
    try {
      page.run();
      expect(page.scrolled).toHaveLength(1);
      expect(page.scrolled[0]?.top).toBe(1170);
    } finally {
      page.restore();
    }
  });

  it("does nothing when the page already fits — a jump on a page that cannot scroll is a flicker", () => {
    const page = withPage(900, 900);
    try {
      page.run();
      expect(page.scrolled).toHaveLength(0);
    } finally {
      page.restore();
    }
  });
});

describe("the conversion CTA hands off to the real product", () => {
  it("sends sign-in to the Hub login and both equipment intents to signup", () => {
    // The demo cannot answer an anonymous question by design, so this
    // navigation IS the funnel's exit. A CTA that records an intent and goes
    // nowhere would make the whole flow a dead end.
    const app = "https://app.factorylm.com";
    expect(conversionDestination("sign-in", app)).toBe("https://app.factorylm.com/login");
    expect(conversionDestination("create-workspace", app)).toBe("https://app.factorylm.com/signup");
    expect(conversionDestination("try-your-equipment", app)).toBe("https://app.factorylm.com/signup");
  });

  it("defaults to production and never emits a double slash", () => {
    expect(DEFAULT_DEMO_CONFIG.appOrigin).toBe("https://app.factorylm.com");
    expect(conversionDestination("sign-in", "https://app.factorylm.com/")).toBe(
      "https://app.factorylm.com/login",
    );
  });

  it("is overridable for local verification without baking a host into the bundle", () => {
    expect(parseDemoConfig("?app=http://127.0.0.1:3101").appOrigin).toBe("http://127.0.0.1:3101");
    expect(conversionDestination("create-workspace", "http://127.0.0.1:3101")).toBe(
      "http://127.0.0.1:3101/signup",
    );
  });
});
