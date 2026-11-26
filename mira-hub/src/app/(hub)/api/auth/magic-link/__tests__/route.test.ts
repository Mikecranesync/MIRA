// POST /api/auth/magic-link — #5744: the emailed link returns to the page the
// technician opened. The route sends through Resend; these tests read the link
// from the email body the route hands to fetch.
// Run: cd mira-hub && npx vitest run "magic-link/__tests__/route"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/users", () => ({
  createMagicToken: vi.fn(async () => "tok123"),
  findUserByEmail: vi.fn(async (email: string) => ({ email, plan: "pro", status: "approved" })),
}));

import { POST } from "../route";
import { requestAuthLink } from "@/capabilities/auth-link";
import { ONBOARDING_VERSION } from "@/capabilities/onboarding-policy";
import { findUserByEmail } from "@/lib/users";

const VIEWER = "/v3/source/?file=6c1f0b2e-1111-2222-3333-444455556666&page=26";
let n = 0;
// The route rate-limits per recipient, so every request uses a fresh address.
const email = () => `tech${++n}@example.com`;

function post(body: unknown): Request {
  return new Request("http://localhost/api/auth/magic-link/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

let sent: ReturnType<typeof vi.fn>;

function loggedLink(): URL {
  expect(sent, "the route sent the email").toHaveBeenCalledTimes(1);
  const html = JSON.parse(String((sent.mock.calls[0][1] as RequestInit).body)).html as string;
  const href = /href="([^"]+)"/.exec(html)?.[1];
  expect(href, "the email holds a link").toBeTruthy();
  return new URL(href!.replace(/&amp;/g, "&"));
}

const token = (link: URL) => new URLSearchParams(link.hash.slice(1)).get("token");

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.test");
  vi.stubEnv("NEXT_PUBLIC_API_BASE", "/hub");
  sent = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", sent);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("POST /api/auth/magic-link — return path (#5744)", () => {
  it("puts the page the technician opened on the emailed link", async () => {
    const res = await POST(post({ email: email(), returnTo: VIEWER }));
    expect(res.status).toBe(200);
    const link = loggedLink();
    expect(link.pathname).toBe("/hub/magic/");
    expect(token(link)).toBe("tok123");
    expect(link.searchParams.has("token")).toBe(false);
    expect(link.searchParams.get("next")).toBe(VIEWER);
  });

  it("control: a request without a return path sends the plain link", async () => {
    await POST(post({ email: email() }));
    const link = loggedLink();
    expect(token(link)).toBe("tok123");
    expect(link.searchParams.has("next")).toBe(false);
  });

  it("never puts another host on the emailed link", async () => {
    await POST(post({ email: email(), returnTo: "//evil.example/x" }));
    expect(loggedLink().searchParams.has("next")).toBe(false);
  });

  // #5751 Codex F1: the emailed URL leaves the Hub (mail provider, mistyped
  // address), so a work-order link's pre-filled fault text never rides it.
  it("never puts work-order details on the emailed link", async () => {
    const workOrder = "/workorders/new/?asset=CV-101&prefill_title=Motor%20overcurrent%20trip";
    await POST(post({ email: email(), returnTo: workOrder }));
    const link = loggedLink();
    expect(link.searchParams.has("next")).toBe(false);
    expect(link.toString()).not.toMatch(/overcurrent|prefill|CV-101/i);
  });

  // #5751 Codex F3: a malformed optional return path must not stop the email.
  it("still sends the plain link when the return path holds an unpaired surrogate", async () => {
    const res = await POST(post({ email: email(), returnTo: `${VIEWER}\uD800` }));
    expect(res.status).toBe(200);
    const link = loggedLink();
    expect(token(link)).toBe("tok123");
    expect(link.searchParams.has("next")).toBe(false);
  });

  // Control: the signup verification email is a different link; it never
  // carries a return path, whatever the request sends.
  it("the signup email ignores a return path", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    vi.mocked(findUserByEmail).mockResolvedValueOnce(null);
    const res = await requestAuthLink(
      post({ email: email(), returnTo: VIEWER, accepted: true, agreementVersion: ONBOARDING_VERSION, intent: "technician" }),
      true,
    );
    expect(res.status).toBe(200);
    const link = loggedLink();
    expect(link.pathname).toBe("/hub/signup/");
    expect(link.searchParams.has("next")).toBe(false);
    expect(token(link)).toBe("tok123");
  });
});
