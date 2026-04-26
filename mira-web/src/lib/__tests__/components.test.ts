import { describe, expect, it } from "bun:test";
import {
  btnPrimary, btnGhost, btnMic,
  stateBadge,
  trustBand,
  stopCard,
  compareBlock,
  limitsList,
  priceCard,
  priceRow,
} from "../components.js";

// ─── Buttons ─────────────────────────────────────────────────────────────────

describe("btnPrimary()", () => {
  it("renders primary button", () => {
    const out = btnPrimary("Start Free");
    expect(out).toContain("fl-btn-primary");
    expect(out).toContain("Start Free");
    expect(out).toContain('type="button"');
  });
  it("uses submit type when specified", () => {
    expect(btnPrimary("Go", { type: "submit" })).toContain('type="submit"');
  });
  it("renders as anchor when href provided", () => {
    const out = btnPrimary("Pricing", { href: "/pricing" });
    expect(out).toContain("<a ");
    expect(out).toContain('href="/pricing"');
  });
});

describe("btnGhost()", () => {
  it("renders ghost button", () => {
    const out = btnGhost("Cancel");
    expect(out).toContain("fl-btn-ghost");
    expect(out).toContain("Cancel");
  });
});

describe("btnMic()", () => {
  it("has aria-label", () => {
    const out = btnMic();
    expect(out).toContain('aria-label="Voice input"');
    expect(out).toContain("fl-btn-mic");
  });
  it("uses custom aria-label", () => {
    const out = btnMic({ ariaLabel: "Speak now" });
    expect(out).toContain('aria-label="Speak now"');
  });
});

// ─── State Pill ───────────────────────────────────────────────────────────────

describe("stateBadge()", () => {
  it("renders indexed pill with default label", () => {
    const out = stateBadge("indexed");
    expect(out).toContain("fl-state-indexed");
    expect(out).toContain("Indexed");
    expect(out).toContain("fl-state-glyph");
  });
  it("renders partial with default label", () => {
    expect(stateBadge("partial")).toContain("Partial · Tap to rescan");
  });
  it("renders failed with default label", () => {
    expect(stateBadge("failed")).toContain("OCR failed · Tap to retry");
  });
  it("renders superseded with default label", () => {
    expect(stateBadge("superseded")).toContain("Superseded");
  });
  it("uses custom label when provided", () => {
    const out = stateBadge("indexed", "✓ Done");
    expect(out).toContain("✓ Done");
    expect(out).not.toContain("Indexed");
  });
  it("has role=status on failed/partial", () => {
    expect(stateBadge("failed")).toContain('role="status"');
    expect(stateBadge("partial")).toContain('role="status"');
  });
  it("no role on indexed/superseded", () => {
    expect(stateBadge("indexed")).not.toContain("role=");
    expect(stateBadge("superseded")).not.toContain("role=");
  });
});

// ─── Trust Band ───────────────────────────────────────────────────────────────

describe("trustBand()", () => {
  it("renders with items", () => {
    const out = trustBand("68,000+ chunks", ["Rockwell", "Siemens"]);
    expect(out).toContain("fl-trust-band");
    expect(out).toContain("fl-trust-eyebrow");
    expect(out).toContain("Rockwell");
    expect(out).toContain("Siemens");
  });
  it("returns empty string for empty items", () => {
    expect(trustBand("eyebrow", [])).toBe("");
  });
});

// ─── Stop Card ────────────────────────────────────────────────────────────────

describe("stopCard()", () => {
  it("always prefixes headline with ⚠ STOP —", () => {
    const out = stopCard("LOTO required", "Body text", []);
    expect(out).toContain("⚠ STOP — LOTO required");
  });
  it("does not double-prefix", () => {
    const out = stopCard("⚠ STOP — already prefixed", "B", []);
    const count = (out.match(/⚠ STOP —/g) ?? []).length;
    expect(count).toBe(1);
  });
  it("has role=alert", () => {
    expect(stopCard("H", "B", [])).toContain('role="alert"');
  });
  it("renders CTA buttons", () => {
    const out = stopCard("H", "B", [{ label: "Open LOTO" }, { label: "Notify lead" }]);
    expect(out).toContain("Open LOTO");
    expect(out).toContain("Notify lead");
    expect(out).toContain("fl-stop-btn");
  });
  it("renders CTA as anchor when href provided", () => {
    const out = stopCard("H", "B", [{ label: "Docs", href: "/docs/loto" }]);
    expect(out).toContain('href="/docs/loto"');
  });
});

// ─── Compare Block ────────────────────────────────────────────────────────────

describe("compareBlock()", () => {
  const base = () =>
    compareBlock("Question?", "Bad AI", "bad answer", "note", "MIRA", "good answer");
  it("renders both columns", () => {
    const out = base();
    expect(out).toContain("fl-col-bad");
    expect(out).toContain("fl-col-good");
    expect(out).toContain("bad answer");
    expect(out).toContain("good answer");
  });
  it("omits citations row when empty", () => {
    expect(base()).not.toContain("fl-col-citations");
  });
  it("renders citations when provided", () => {
    const out = compareBlock("Q", "Bad", "b", "n", "Good", "g", ["📄 Manual §4"]);
    expect(out).toContain("fl-col-citations");
    expect(out).toContain("📄 Manual §4");
  });
  it("wraps question in quotes", () => {
    expect(base()).toContain('"Question?"');
  });
});

// ─── Limits List ──────────────────────────────────────────────────────────────

describe("limitsList()", () => {
  it("renders items", () => {
    const out = limitsList("Intro", [{ headline: "No PLC.", body: "Post-MVP." }]);
    expect(out).toContain("fl-limits-list");
    expect(out).toContain("No PLC.");
    expect(out).toContain("Post-MVP.");
  });
  it("renders empty state", () => {
    const out = limitsList("Intro", []);
    expect(out).toContain("Nothing to disclose. Yet.");
    expect(out).not.toContain("fl-limits-list");
  });
});

// ─── Price Card ───────────────────────────────────────────────────────────────

describe("priceCard()", () => {
  const recommended = () =>
    priceCard({
      name: "FactoryLM Projects",
      pitch: "Full workspace",
      amount: "97",
      period: "/mo/plant",
      features: ["Feature A", "Feature B"],
      ctaLabel: "Start Free",
      ctaHref: "/cmms",
      fineprint: "No credit card.",
      variant: "recommended",
    });

  it("renders recommended card with ribbon", () => {
    const out = recommended();
    expect(out).toContain("fl-price-card-recommended");
    expect(out).toContain("Most popular");
    expect(out).toContain("fl-price-ribbon");
  });
  it("renders price amount", () => {
    const out = recommended();
    expect(out).toContain("97");
    expect(out).toContain("/mo/plant");
  });
  it("renders features with check marks", () => {
    const out = recommended();
    expect(out).toContain("Feature A");
    expect(out).toContain("Feature B");
  });
  it("renders fineprint", () => {
    expect(recommended()).toContain("No credit card.");
  });
  it("renders Free card without dollar sign", () => {
    const out = priceCard({
      name: "MIRA Free",
      pitch: "Pitch",
      amount: "Free",
      features: [],
      ctaLabel: "Start",
      ctaHref: "/cmms",
      variant: "free",
    });
    expect(out).toContain(">Free<");
    expect(out).not.toContain("fl-price-currency");
  });
  it("renders free card with ghost CTA", () => {
    const out = priceCard({
      name: "Free",
      pitch: "p",
      amount: "Free",
      features: [],
      ctaLabel: "Go",
      ctaHref: "/cmms",
      variant: "free",
    });
    expect(out).toContain("fl-btn-ghost");
  });
  it("priceRow wraps cards", () => {
    expect(priceRow(["<div>a</div>", "<div>b</div>"])).toContain("fl-price-row");
  });
});
