/**
 * Drive Commander public surface (AB-1) — verifies the PowerFlex 525 pages render
 * from the vendored pack with CITED content, stay indexable, never leak Pro
 * value-tables into the free DOM, and handle unknown fault codes. Data + renderer
 * only (no server/DB import).
 */
import { describe, test, expect } from "bun:test";
import { getPack, getFault, listFaults } from "../drive-pack-data.js";
import {
  renderDriveLandingPage,
  renderFaultPage,
  renderFaultNotFound,
} from "../drive-commander-renderer.js";
import powerflex525 from "../../data/drive-packs/powerflex_525.json";

const MANUAL = "PowerFlex 525 Adjustable Frequency AC Drive User Manual";

describe("drive-pack-data", () => {
  test("loads the vendored PowerFlex 525 pack", () => {
    const pack = getPack("powerflex-525");
    expect(pack).not.toBeNull();
    expect(pack!.family.series).toBe("PowerFlex 525");
    expect(Object.keys(pack!.faultCodes).length).toBe(48);
    expect(pack!.provenanceLabel).toBe("manual-cited");
  });

  test("unknown model returns null", () => {
    expect(getPack("nope")).toBeNull();
  });

  test("normalises fault code input (F007 == 7 == 007)", () => {
    const pack = getPack("powerflex-525")!;
    const a = getFault(pack, "F007");
    expect(a?.key).toBe("7");
    expect(getFault(pack, "7")?.key).toBe("7");
    expect(getFault(pack, "007")?.key).toBe("7");
    expect(a?.display).toBe("F007");
  });

  test("unknown fault code returns null", () => {
    expect(getFault(getPack("powerflex-525")!, "F999")).toBeNull();
  });

  test("at least 5 faults have cited parameter detail", () => {
    const withDetail = listFaults(getPack("powerflex-525")!).filter((f) => f.hasDetail);
    expect(withDetail.length).toBeGreaterThanOrEqual(5);
  });
});

describe("landing page", () => {
  const html = renderDriveLandingPage(getPack("powerflex-525")!);
  test("is a complete, indexable HTML doc", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('rel="canonical"');
    expect(html).not.toContain("noindex");
  });
  test("names the product and lists fault chips", () => {
    expect(html).toContain("PowerFlex 525");
    expect((html.match(/fault-chip/g) || []).length).toBeGreaterThanOrEqual(47);
  });
  test("shows provenance grounding", () => {
    expect(html).toContain(MANUAL);
  });
});

describe("fault pages — cited, no Pro leak", () => {
  const pack = getPack("powerflex-525")!;
  const targets = listFaults(pack).filter((f) => f.hasDetail).slice(0, 5);

  test("5 fault pages render cited content and stay indexable", () => {
    expect(targets.length).toBe(5);
    for (const t of targets) {
      const html = renderFaultPage(pack, getFault(pack, t.display)!);
      expect(html).toContain("<title>");
      expect(html).toContain(t.name); // decoded meaning
      expect(html).toContain('rel="canonical"');
      expect(html).not.toContain("noindex");
      // rule 6: every fault answer is cited from the pack
      expect(html).toContain(MANUAL);
      expect(html).toMatch(/p\.\d+/);
    }
  });

  test("free DOM never leaks the Pro value-meaning table", () => {
    // C125 (linked to F081/2/3) has value_meanings 0=Fault,1=Coast Stop,2=Stop,3=Continu Last.
    const c125 = (powerflex525 as any).parameters.find((p: any) => p.parameter_id === "C125");
    const distinctive: string[] = (c125?.value_meanings ?? [])
      .map((v: any) => v.meaning as string)
      .filter((m: string) => m.includes(" "));
    const html = renderFaultPage(pack, getFault(pack, "F081")!);
    expect(html).toContain("C125"); // the linked cited param IS shown (free)
    expect(html).not.toContain("value_meanings"); // raw key never emitted
    expect(distinctive.length).toBeGreaterThan(0);
    for (const m of distinctive) expect(html).not.toContain(m); // no value table
  });
});

describe("unknown fault code", () => {
  test("renders a noindex placeholder naming the code (no crash)", () => {
    const html = renderFaultNotFound(getPack("powerflex-525")!, "F999");
    expect(html).toContain("noindex");
    expect(html).toContain("F999");
  });
});
