// #3732: the session cookie jar (Capacitor Preferences key `flm.cookiejar.v1`,
// plain SharedPreferences XML) must reach neither logcat nor Android backups.
//
// These are source-of-truth assertions on the shipped native configuration,
// not behaviour mocks: both leaks were real on a Pixel 9a and an emulator
// (issue #3732 counts; values never recorded). Each assertion names the exact
// attribute a future edit would have to change to reopen the leak.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(at(rel), "utf8");

const MANIFEST = "android/app/src/main/AndroidManifest.xml";
const EXTRACTION_RULES = "android/app/src/main/res/xml/data_extraction_rules.xml";
const BACKUP_RULES = "android/app/src/main/res/xml/backup_rules.xml";
const CAP_CONFIG = "capacitor.config.ts";

describe("#3732 — the cookie jar stays out of logcat", () => {
  it("capacitor.config.ts pins loggingBehavior to \"none\" (never the implicit \"debug\" default, never \"production\")", () => {
    // Capacitor's bridge logs every plugin call's methodData (`Preferences.set
    // {"key":"flm.cookiejar.v1",…}`, `CapacitorHttp.request` with the Cookie
    // header) and every native result (`LOG FROM NATIVE {"value":…}`) whenever
    // loggingBehavior enables logging. "debug" is the unset default and logs on
    // every debuggable build — which is exactly what gets sideloaded for demos.
    const source = read(CAP_CONFIG);
    const match = source.match(/^\s*loggingBehavior:\s*"([a-z]+)"/m);
    expect(match, "loggingBehavior must be set explicitly").not.toBeNull();
    expect(match?.[1]).toBe("none");
  });
});

describe("#3732 — the cookie jar stays out of Android backups", () => {
  const manifest = read(MANIFEST);
  const application = manifest.slice(manifest.indexOf("<application"), manifest.indexOf(">", manifest.indexOf("<application")) + 1);

  it("android:allowBackup is false", () => {
    expect(application).toMatch(/android:allowBackup="false"/);
  });

  it("android:dataExtractionRules (API 31+) and android:fullBackupContent (legacy) are both declared — defence in depth if allowBackup is ever flipped", () => {
    expect(application).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
    expect(application).toMatch(/android:fullBackupContent="@xml\/backup_rules"/);
  });

  it("the extraction rules exclude SharedPreferences (the Preferences store) from cloud backup AND device transfer", () => {
    expect(existsSync(at(EXTRACTION_RULES))).toBe(true);
    const rules = read(EXTRACTION_RULES);
    for (const section of ["cloud-backup", "device-transfer"]) {
      const start = rules.indexOf(`<${section}`);
      const end = rules.indexOf(`</${section}>`);
      expect(start, `${section} section present`).toBeGreaterThan(-1);
      const body = rules.slice(start, end);
      expect(body).toMatch(/<exclude\s+domain="sharedpref"/);
      expect(body).toMatch(/<exclude\s+domain="database"/);
      expect(body).toMatch(/<exclude\s+domain="file"/);
    }
  });

  it("the legacy full-backup-content rules exclude the same stores", () => {
    expect(existsSync(at(BACKUP_RULES))).toBe(true);
    const rules = read(BACKUP_RULES);
    expect(rules).toMatch(/<full-backup-content>/);
    expect(rules).toMatch(/<exclude\s+domain="sharedpref"/);
    expect(rules).toMatch(/<exclude\s+domain="database"/);
    expect(rules).toMatch(/<exclude\s+domain="file"/);
  });
});
