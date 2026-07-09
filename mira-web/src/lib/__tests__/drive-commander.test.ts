/**
 * Drive Commander public surface (AB-1) — verifies the PowerFlex 525 pages render
 * from the vendored pack with CITED content, stay indexable, never leak Pro
 * value-tables into the free DOM, and handle unknown fault codes. Data + renderer
 * only (no server/DB import).
 */
import { describe, test, expect } from "bun:test";
import {
  getPack,
  getFault,
  getParameter,
  listFaults,
  listParameters,
  driveCommanderSitemapLocs,
} from "../drive-pack-data.js";
import {
  renderDriveLandingPage,
  renderFaultPage,
  renderFaultNotFound,
  renderParameterPage,
  renderParameterNotFound,
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

describe("parameter pages (AB-2)", () => {
  const pack = getPack("powerflex-525")!;

  test("case-insensitive parameter lookup", () => {
    expect(getParameter(pack, "C125")?.parameter_id).toBe("C125");
    expect(getParameter(pack, "c125")?.parameter_id).toBe("C125");
    expect(getParameter(pack, "nope")).toBeNull();
  });

  test("renders cited, indexable, and cross-links related faults — no value table", () => {
    const c125 = getParameter(pack, "C125")!;
    const html = renderParameterPage(pack, c125);
    expect(html).toContain("<title>");
    expect(html).toContain("C125");
    expect(html).toContain('rel="canonical"');
    expect(html).not.toContain("noindex");
    expect(html).toContain(MANUAL); // cited
    expect(html).toMatch(/p\.\d+/);
    // cross-links to its related faults (F081/F082/F083)
    expect(html).toContain("/drive-commander/powerflex-525/faults/F081");
    // Pro value table still withheld
    const distinctive: string[] = (c125.value_meanings ?? [])
      .map((v) => v.meaning)
      .filter((m) => m.includes(" "));
    for (const m of distinctive) expect(html).not.toContain(m);
    expect(html).not.toContain("value_meanings");
  });

  test("fault page links out to full parameter pages", () => {
    const html = renderFaultPage(pack, getFault(pack, "F081")!);
    expect(html).toContain("/drive-commander/powerflex-525/parameters/C125");
  });

  test("unknown parameter -> noindex placeholder", () => {
    const html = renderParameterNotFound(pack, "Z999");
    expect(html).toContain("noindex");
    expect(html).toContain("Z999");
  });
});

describe("sitemap", () => {
  test("includes the landing, a fault page, and a parameter page", () => {
    const locs = driveCommanderSitemapLocs();
    expect(locs).toContain("/drive-commander/powerflex-525");
    expect(locs.some((l) => /\/faults\/F\d+$/.test(l))).toBe(true);
    expect(locs.some((l) => /\/parameters\/C125$/.test(l))).toBe(true);
    // per pack: 1 landing + N faults + M params — summed over every promoted pack
    const packLocCount = (slug: string) => {
      const p = getPack(slug)!;
      return 1 + listFaults(p).length + listParameters(p).length;
    };
    expect(locs.length).toBe(packLocCount("powerflex-525") + packLocCount("powerflex-40"));
  });
});

describe("second pack — PowerFlex 40 (AB-3)", () => {
  const pf40 = getPack("powerflex-40");

  test("loads and is distinct from PowerFlex 525", () => {
    expect(pf40).not.toBeNull();
    expect(pf40!.family.series).toBe("PowerFlex 40");
    expect(Object.keys(pf40!.faultCodes).length).toBe(26);
    expect(pf40!.parameters.length).toBe(9);
    expect(pf40!.provenanceLabel).toBe("manual-cited");
  });

  test("landing + a cited fault page render and stay indexable", () => {
    const landing = renderDriveLandingPage(pf40!);
    expect(landing).toContain("PowerFlex 40");
    expect(landing).toContain('rel="canonical"');
    expect(landing).not.toContain("noindex");

    const withDetail = listFaults(pf40!).filter((f) => f.hasDetail);
    expect(withDetail.length).toBeGreaterThan(0);
    const fh = renderFaultPage(pf40!, getFault(pf40!, withDetail[0].display)!);
    expect(fh).toContain(pf40!.manualDoc); // cited
    expect(fh).toMatch(/p\.\d+/);
    expect(fh).not.toContain("noindex");
  });

  test("sitemap includes the pf40 landing", () => {
    expect(driveCommanderSitemapLocs()).toContain("/drive-commander/powerflex-40");
  });
});
