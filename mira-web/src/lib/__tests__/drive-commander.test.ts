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
    expect(locs.length).toBe(
      packLocCount("powerflex-525") +
        packLocCount("powerflex-40") +
        packLocCount("siemens-g120")
    );
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

describe("citation invariant — every public technical page is grounded", () => {
  for (const slug of ["powerflex-525", "powerflex-40"]) {
    test(`${slug}: every fault + parameter page carries the pack citation`, () => {
      const p = getPack(slug)!;
      for (const f of listFaults(p)) {
        expect(renderFaultPage(p, getFault(p, f.display)!)).toContain(p.manualDoc);
      }
      for (const param of listParameters(p)) {
        expect(renderParameterPage(p, param)).toContain(p.manualDoc);
      }
    });
  }
});

// ── Siemens G120 pack truth pins (2026-07-17) ────────────────────────────
// The original pack (#2621) fabricated its data: fault meanings were shifted
// (F30001 "DC link overvoltage" — the real manual says Overcurrent), five
// fault codes (F30006–F30010) and five parameters (p0104/p0105/p0293/p0644/
// p0645) do not exist in the manual at all, and every entry cited the same
// page of an unverifiable document. These pins hold the pack to the genuine
// SINAMICS G120C List Manual (LH13, 04/2014, A5E33840768B AA, sha256
// 82aad5dd…bcda268) so a regenerated pack can never silently regress.
describe("siemens g120 pack — manual-verified truth pins", () => {
  const pack = getPack("siemens-g120")!;

  test("fault meanings match the List Manual (the shifted originals stay dead)", () => {
    expect(pack.faultCodes["30001"]).toContain("Overcurrent");
    expect(pack.faultCodes["30002"]).toContain("overvoltage");
    expect(pack.faultCodes["30003"]).toContain("undervoltage");
    expect(pack.faultCodes["30011"]).toContain("Line phase failure");
    expect(pack.faultCodes["7011"]).toContain("Motor overtemperature");
  });

  test("fabricated fault codes F30006–F30010 are gone", () => {
    for (const k of ["30006", "30007", "30008", "30009", "30010"])
      expect(pack.faultCodes[k]).toBeUndefined();
  });

  test("fabricated parameters are gone; verified ones carry real distinct pages", () => {
    const ids = listParameters(pack).map((p) => p.parameter_id);
    for (const dead of ["p0104", "p0105", "p0293", "p0644", "p0645", "P0104", "P0644"])
      expect(ids).not.toContain(dead);
    expect(getParameter(pack, "p0304")!.name).toBe("Rated motor voltage");
    expect(getParameter(pack, "p2000")!.name).toContain("Reference speed");
    const pages = new Set(listParameters(pack).map((p) => p.source_citation?.page));
    expect(pages.size).toBeGreaterThan(5); // never again 18 entries all citing "413"
  });

  test("citations name the real, hash-pinned manual", () => {
    for (const p of listParameters(pack)) {
      expect(p.source_citation?.doc).toContain("List Manual");
      expect(p.source_citation?.doc).not.toContain("0319_en-US");
    }
  });

  test("fault→parameter links only where the manual's remedy names the parameter", () => {
    const p0210 = getParameter(pack, "p0210")!;
    expect(p0210.related_faults).toContain("F30002");
    expect(p0210.related_faults).toContain("F30003");
    expect(getParameter(pack, "p0605")!.related_faults).toContain("F07011");
    // rated-motor-data params are cited but not fault-linked (manual doesn't link them)
    expect(getParameter(pack, "p0304")!.related_faults).toEqual([]);
  });
});

// ── De-slop invariants (2026-07-17) ──────────────────────────────────────
// The public surface must stay on the shared dark-datasheet tokens with no
// AI-slop markers: no emoji icons, no duplicated fault list, honest counts,
// and a real post-payment state.
describe("de-slop invariants", () => {
  const pack = getPack("powerflex-525")!;
  const landing = renderDriveLandingPage(pack);

  test("no emoji or pictograph icons anywhere in the rendered pages", () => {
    const pages = [
      landing,
      renderFaultPage(pack, getFault(pack, "F5")!),
      renderParameterPage(pack, listParameters(pack)[0]!),
    ];
    // Pictographs, dingbats, misc symbols — the emoji ranges + the old
    // &#128274;/&#128279; entities.
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|&#12827\d;/u;
    for (const html of pages) expect(emoji.test(html)).toBe(false);
  });

  test("landing renders each fault chip exactly once (no duplicate list)", () => {
    const first = listFaults(pack)[0]!;
    const href = `/drive-commander/${pack.modelSlug}/faults/${first.display}`;
    const count = landing.split(`href="${href}"`).length - 1;
    expect(count).toBe(1);
  });

  test("landing does not overclaim 'All N fault codes'", () => {
    expect(landing).not.toMatch(/All \d+ .* fault codes/);
    expect(landing).toContain("faults in this pack");
  });

  test("every fault chip carries a tag (no empty trailing span)", () => {
    const chips = landing.match(/<a class="fault-chip"[\s\S]*?<\/a>/g) ?? [];
    expect(chips.length).toBeGreaterThan(0);
    for (const chipHtml of chips.filter((c) => c.includes("/faults/")))
      expect(/class="tag[ "]/.test(chipHtml)).toBe(true);
  });

  test("colors come from tokens: /_tokens.css linked, no hex outside theme-color meta", () => {
    expect(landing).toContain('href="/_tokens.css"');
    const body = landing.replace(/<meta name="theme-color"[^>]*>/, "");
    expect(/#[0-9a-fA-F]{6}\b/.test(body.replace(/#[\w-]+"/g, ""))).toBe(false);
  });

  test("?checkout=success renders a confirmation and hides the Pro sell", () => {
    const paid = renderDriveLandingPage(pack, { checkout: "success" });
    expect(paid).toContain("Payment confirmed");
    expect(paid).not.toContain("Unlock Drive Commander Pro");
    // plain load still sells Pro and shows no banner
    expect(landing).toContain("Unlock Drive Commander Pro");
    expect(landing).not.toContain("Payment confirmed");
  });

  test("?checkout=cancelled renders the quiet note", () => {
    const cancelled = renderDriveLandingPage(pack, { checkout: "cancelled" });
    expect(cancelled).toContain("Checkout cancelled");
    expect(cancelled).toContain("Unlock Drive Commander Pro");
  });
});

// ── PowerFlex truth pins (2026-07-17, issue #2777 audit) ─────────────────
// Both packs passed the source-pinned audit against the hash-pinned Rockwell
// manuals (520-UM001O-EN-E: 48/48 faults + 45/45 params page-exact;
// 22B-UM001J-EN-E: 26/26 + 9/9). These pins hold the audited meanings so a
// regenerated pack can never silently shift them (the G120 failure class).
describe("powerflex packs — manual-verified truth pins (#2777)", () => {
  test("PF525 fault meanings match 520-UM001 (p.161 fault table)", () => {
    const p = getPack("powerflex-525")!;
    expect(p.faultCodes["4"]).toBe("UnderVoltage");
    expect(p.faultCodes["5"]).toBe("OverVoltage");
    expect(p.faultCodes["7"]).toBe("Motor Overload");
    expect(p.faultCodes["8"]).toBe("Heatsink OvrTmp");
  });

  test("PF40 fault meanings match 22B-UM001 (Table 10, p.93)", () => {
    const p = getPack("powerflex-40")!;
    expect(p.faultCodes["4"]).toBe("UnderVoltage");
    expect(p.faultCodes["5"]).toBe("OverVoltage");
    expect(p.faultCodes["12"]).toBe("HW OverCurrent");
  });

  test("audited pack shapes stay stable (counts + hash-pinned verification block)", () => {
    const p525 = getPack("powerflex-525")!;
    const p40 = getPack("powerflex-40")!;
    expect(Object.keys(p525.faultCodes).length).toBe(48);
    expect(listParameters(p525).length).toBe(45);
    expect(Object.keys(p40.faultCodes).length).toBe(26);
    expect(listParameters(p40).length).toBe(9);
    // verification blocks recorded at the pack of record and vendored through
    expect((powerflex525 as any).provenance.verification.manual_sha256).toBe(
      "b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6",
    );
  });

  test("negative: codes absent from BOTH manuals stay unsupported", () => {
    // F999/F200/F055 verified absent from 520-UM001O and 22B-UM001J text
    // layers (regex sweep of all F-number tokens). NOTE: the first draft of
    // this pin used F100 — which IS a real PF525 fault (Parameter Chksum);
    // the pin itself caught the from-memory error. Negatives must come from
    // the manual sweep, never from memory.
    for (const slug of ["powerflex-525", "powerflex-40"]) {
      const p = getPack(slug)!;
      for (const bogus of ["F999", "F200", "F055"]) {
        expect(getFault(p, bogus)).toBeNull();
      }
    }
  });
});
