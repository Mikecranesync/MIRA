import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn(), signOut: vi.fn(), useSession: () => ({ data: { user: { status: "pending", trialExpiresAt: null } } }) }));
import Signup from "@/app/signup/page";
import Pending from "@/app/(hub)/pending-approval/page";
import Upgrade from "@/app/(hub)/upgrade/page";
import Quickstart from "@/app/quickstart/page";
import { TrialBanner } from "@/components/trial-banner";

describe("pilot entry contract", () => {
  it("offers an application with manual approval and no waiting clock", () => {
    const html = renderToStaticMarkup(<Signup />);
    expect(html).toContain("Apply for a free 30-day MIRA pilot");
    expect(html).toContain("Waiting uses no pilot days");
    expect(html).toContain("Paid continuation is agreed separately");
    expect(html).not.toMatch(/7-day free trial|Track faults, work orders|not guesses/);
  });
  it("pending is review, not a timed promise or a CMMS entitlement", () => {
    const html = renderToStaticMarkup(<Pending />);
    expect(html).toContain("Your pilot clock has not started");
    expect(html).toContain("Applying does not reserve a place");
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/15 sec|full CMMS|review your request shortly/);
    expect(renderToStaticMarkup(<TrialBanner />)).toBe("");
  });
  it("continuation and consulting are distinct inquiries, never checkout", () => {
    const html = renderToStaticMarkup(<Upgrade />);
    expect(html).toContain("Discuss paid continuation");
    expect(html).toContain("Ask about consulting");
    expect(html).not.toMatch(/\$500|\$499|\$2|href="[^\"]*checkout|\/buy\?|3-mo min|money-back guarantee/);
  });
  it("public sample identifies its data boundary and routes to application", () => {
    const html = renderToStaticMarkup(<Quickstart />);
    expect(html).toContain("private workspace");
    expect(html).toContain("Apply for a free pilot");
    expect(html).not.toMatch(/no fabrication|60 seconds|Try MIRA Free/);
  });
});
