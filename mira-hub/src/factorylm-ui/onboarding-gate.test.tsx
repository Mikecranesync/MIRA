import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { OnboardingGate } from "./onboarding-gate";

// #4284 Codex F1 r2: the shell must not be interactive before the onboarding
// decision is known — otherwise a redirect for an unfinished tenant throws away
// whatever they started typing. The first paint is the withheld state.
describe("OnboardingGate — withholds the shell until the onboarding decision", () => {
  it("first paint shows a status line, not the shell", () => {
    const html = renderToString(<OnboardingGate><textarea aria-label="Ask MIRA" /></OnboardingGate>);
    expect(html).toContain("Checking your setup");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Ask MIRA");
  });
});
