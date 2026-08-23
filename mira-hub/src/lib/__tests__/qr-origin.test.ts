/**
 * Printed-sticker origin contract (plan slice I5, sub-change).
 *
 * A sticker is physical and permanent. If the printed URL is not one the
 * FactoryLM app trusts, the label is unscannable forever and the only fix is a
 * walk around the plant with a scraper. So the producer is pinned here against
 * the two things that must agree with it:
 *
 *   - the CONSUMER: mira-mobile/src/lib/tags.ts, whose `TRUSTED_ORIGIN` the
 *     in-app scanner enforces via isTrustedDeepLink;
 *   - the OTHER producer: tools/qr-label-pdf.py, which already hardcoded the
 *     right base while the web page derived it from window.location.origin.
 *
 * These read the real files rather than restating their values, so a change to
 * either side fails here instead of at a machine.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { QR_CANONICAL_ORIGIN, isOffCanonicalOrigin, qrUrlForTag } from "../qr-origin";

const REPO = path.resolve(__dirname, "../../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

describe("printed QR origin", () => {
  it("encodes the canonical production URL for a tag", () => {
    expect(qrUrlForTag("CV-101")).toBe("https://app.factorylm.com/m/CV-101");
  });

  it("matches the origin the mobile scanner actually trusts", () => {
    const tags = read("mira-mobile/src/lib/tags.ts");
    const m = tags.match(/TRUSTED_ORIGIN\s*=\s*\{\s*protocol:\s*"([^"]+)"\s*,\s*host:\s*"([^"]+)"/);
    expect(m, "TRUSTED_ORIGIN not found in mira-mobile/src/lib/tags.ts").toBeTruthy();
    const [, protocol, host] = m!;
    // A sticker encoding anything else is refused by isTrustedDeepLink, silently.
    expect(`${protocol}//${host}`).toBe(QR_CANONICAL_ORIGIN);
  });

  it("matches the base URL the PDF label producer hardcodes", () => {
    const py = read("tools/qr-label-pdf.py");
    const m = py.match(/BASE_URL\s*=\s*"([^"]+)"/);
    expect(m, "BASE_URL not found in tools/qr-label-pdf.py").toBeTruthy();
    // The python producer writes ".../m"; the web producer composes ".../m/<tag>".
    expect(m![1]).toBe(`${QR_CANONICAL_ORIGIN}/m`);
  });

  it("the print page never derives the encoded value from the browser", () => {
    const page = read("mira-hub/src/app/(hub)/assets/print-qr/page.tsx");
    // The regression this guards: `value={`${origin}/m/${a.tag}`}` printed
    // localhost stickers with no warning.
    expect(page).not.toMatch(/QrCodeImage[^>]*value=\{`\$\{origin\}/);
    expect(page).toMatch(/qrUrlForTag\(a\.tag\)/);
  });

  it("warns when printing from somewhere other than production", () => {
    expect(isOffCanonicalOrigin("http://localhost:3000")).toBe(true);
    expect(isOffCanonicalOrigin("http://165.245.138.91:4101")).toBe(true);
    expect(isOffCanonicalOrigin(QR_CANONICAL_ORIGIN)).toBe(false);
    // Server-side render has no origin to compare — silence, not a false alarm.
    expect(isOffCanonicalOrigin("")).toBe(false);
    expect(isOffCanonicalOrigin(null)).toBe(false);
  });
});
