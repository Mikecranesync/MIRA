import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => "test-nonce" })),
}));

vi.mock("next/script", () => ({
  default: (props: Record<string, unknown>) => (
    <div
      id={String(props.id ?? "")}
      data-src={String(props.src ?? "")}
      data-nonce={String(props.nonce ?? "")}
    />
  ),
}));

const ENV_KEYS = ["PLG_POSTHOG_KEY", "NEXT_PUBLIC_BASE_PATH"];

describe("PostHogInit", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.resetModules();
  });

  it("renders nothing when the ingest key is unset", async () => {
    const { PostHogInit } = await import("./PostHogInit");
    const node = await PostHogInit();
    expect(node).toBeNull();
  });

  it("loads the same-origin init script with the layout nonce when the key is set", async () => {
    process.env.PLG_POSTHOG_KEY = "phc_test";
    vi.resetModules();
    const { PostHogInit } = await import("./PostHogInit");
    const node = await PostHogInit();
    expect(node).not.toBeNull();
    const html = renderToStaticMarkup(node as React.ReactElement);
    expect(html).toContain("/hub/api/public/posthog-init");
    expect(html).toContain('id="posthog-init"');
    expect(html).toContain('data-nonce="test-nonce"');
    expect(html).not.toContain("phc_test");
  });
});
