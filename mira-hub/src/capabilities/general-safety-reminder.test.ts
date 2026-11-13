import { describe, expect, it } from "vitest";
import { generalSafetyReminder } from "./general-safety-reminder";

describe("#5408 generalSafetyReminder", () => {
  const isolation = "⚠️ **Isolation.** Lock and tag every energy source (electrical, pneumatic, hydraulic, gravity) and verify zero energy before hands-on work.";
  it.each(["", " (p.61)", " (p.2-15)"])("recognizes an exact fixed banner with legacy suffix %s", (suffix) => {
    const shown = generalSafetyReminder(isolation + suffix);
    expect(shown).toContain("**Isolation.**");
    expect(shown).toContain("General safety reminder");
    expect(shown).not.toMatch(/\(p\./);
    expect(generalSafetyReminder(shown)).toBe(shown);
  });
  it("does not relabel a manual quote or delete its citation", () => {
    const text = "⚠️ **Manual warning.** WARNING: isolate power. (p.26)";
    expect(generalSafetyReminder(text)).toBe(text);
  });
  it("does not erase additional authored text after a banner (control)", () => {
    const text = isolation + " The manual adds a separate restriction [1].";
    expect(generalSafetyReminder(text)).toBe(text);
  });
});
