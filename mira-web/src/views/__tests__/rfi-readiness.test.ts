import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderOffline } from "../offline.js";
import { renderSecurity } from "../security.js";

const trust = readFileSync(join(process.cwd(), "public", "trust.html"), "utf-8");
const security = renderSecurity("https://factorylm.com/security");
const offline = renderOffline("https://factorylm.com/offline");

describe("RFI readiness: trust, security and offline pages", () => {
  test("/trust no longer names an internal PR number or the secrets vendor in prose", () => {
    expect(trust).not.toMatch(/PR #\d+/);
    expect(trust).not.toContain("credentials live in Doppler");
    expect(trust).not.toContain("compliance roadmap");
    expect(trust).toContain('id="compliance"');
  });

  test("/trust lists the current host, not the retired DigitalOcean droplet", () => {
    expect(trust).not.toContain("DigitalOcean");
    expect(trust).toContain("OVHcloud");
  });

  test("/security names the live providers like /trust does", () => {
    expect(security).toContain("OpenAI, then OpenRouter");
    expect(security).not.toContain("We don't name providers");
    expect(security).toContain('href="/trust"');
  });

  test("/offline says it is a test build and lists what is not proven", () => {
    expect(offline).toContain("not available to customers yet");
    expect(offline).toContain("What we have not proven yet");
    expect(offline).toContain("That no data leaves the device.");
    expect(offline).toContain("Long disconnected operation.");
    expect(offline).not.toMatch(/180[- ]day|air[- ]gapped|FedRAMP authorized|deterministic/i);
  });

  // Owner gate: these pages carry [MIKE TO CONFIRM] markers for facts only the owner
  // can supply (host region, certifications, SAM/UEI/CAGE). This test stays red until
  // every marker is replaced, so the branch cannot merge with a placeholder on a live page.
  test("no owner placeholder is left on a public page", () => {
    for (const [name, html] of [["/trust", trust], ["/security", security], ["/offline", offline]] as const) {
      expect(html, `${name} still has an owner placeholder`).not.toContain("MIKE TO CONFIRM");
    }
  });
});
