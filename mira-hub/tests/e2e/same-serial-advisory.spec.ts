/**
 * The repeated-serial warning after its first release (#5649): the follow-ups from its review and the
 * tablet it is used on. A real browser against the production build; every /api/** request is answered
 * here, so nothing reaches a database. The warning's first cases are in equipment-nav.spec.ts and are
 * not repeated.
 *
 * What is proved:
 *   - #5656: the warning is about the revision its save made. A checklist that holds a later revision
 *     ends it; one that holds the same revision keeps it.
 *   - #5661 A1: two matches that read alike are numbered on the screen as well as in the button name.
 *   - #5661 A2: a save the server committed, followed by a failed re-read, is reported as saved.
 *   - #5657 F4: a second tap on Show in checklist brings the row back into view.
 *   - on a tablet, portrait and landscape, by touch: the warning is in view after the save and every
 *     button is a full touch target.
 *   - by keyboard: Tab reaches each button of the warning in order; Enter and Space press them.
 *   - what a screen reader is given: the group's name, the headline as a status, each button's name.
 *
 * Auth: a next-auth JWE signed with the SAME AUTH_SECRET the server boots with
 * (playwright.command-center.config.ts).
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { installRoutes, NB } from "../fidelity/harness";

const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const THREAD = "e2e-same-serial-thread";
const VFD = "44444444-4444-4444-8444-444444444444";
const MLC = "77777777-7777-4777-8777-777777777777";
const TWIN = "56565656-5656-4656-8656-565656565656";
const OTHER_NB = "99999999-9999-4999-8999-999999999999";
const AWAY = "88888888-8888-4888-8888-888888888888";
const SERIAL = "E2E-SN-0042"; // made up
/** The revision the save route below answers with. */
const SAVED_REVISION = 4;

async function auth(context: BrowserContext, baseURL: string) {
  const trialExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const token = await encode({
    token: { uid: "e2e-same-serial", tid: TENANT_ID, status: "trial", trialExpiresAt, email: "e2e-same-serial@factorylm-test.com" },
    secret: AUTH_SECRET,
  });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL }]);
}

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const vfdRev = {
  componentId: VFD, revision: 3, rawLabel: "AutomationDirect GS10", inputKind: "typed",
  manufacturer: "AutomationDirect", family: "GS10", catalogNumber: null, serialNumber: null,
  hardwareRevision: null, localTag: "VFD1", identityStatus: "user_confirmed", unresolved: [],
  confirmedAt: "2026-11-14T03:00:00.000Z", createdAt: "2026-11-14T03:00:00.000Z",
};
const vfdView = {
  id: VFD, position: 0, kind: "VFD", origin: "device_schedule", status: "confirmed", statusLabel: "confirmed",
  label: "VFD1 · AutomationDirect GS10", current: vfdRev, documents: [], hasOwnDocument: false, evidence: "Confirmed by a technician.",
};
const other = (id: string, position: number, tag: string) => ({
  ...vfdView, id, position, kind: "MLC", label: `${tag} · MLC`,
  current: { ...vfdRev, componentId: id, revision: 1, rawLabel: "MLC", family: "MLC", localTag: tag },
});
const filler = (i: number) => other(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, i + 1, `M${i + 1}`);

type RouteOpts = {
  /** 1-based checklist reads that answer 500. Read 1 is the page load; read 2 follows the save. */
  failReads?: number[];
  /** From this checklist read on, the saved component is at this revision, under this label. */
  later?: { fromRead: number; revision: number; label: string };
  /** Components listed between the saved one and Q1, so Q1 is far down a long checklist. */
  fillers?: number;
  /** What the save route's `sameSerial` field says. */
  sameSerial: unknown;
};
type Seen = { benchReads: number; saves: Record<string, unknown>[]; selectionPuts: number };

/** Fidelity surface first, then (registered later, so tried first) the routes under test. */
async function routes(page: Page, opts: RouteOpts): Promise<Seen> {
  await installRoutes(page, "G");
  const seen: Seen = { benchReads: 0, saves: [], selectionPuts: 0 };
  const fillers = Array.from({ length: opts.fillers ?? 0 }, (_, i) => filler(i));

  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/(\?.*)?$/, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    seen.benchReads += 1;
    if (opts.failReads?.includes(seen.benchReads)) return route.fulfill(json({ error: "internal" }, 500));
    const later = opts.later && seen.benchReads >= opts.later.fromRead ? opts.later : null;
    const saved = later ? { ...vfdView, label: later.label, current: { ...vfdRev, revision: later.revision } } : vfdView;
    return route.fulfill(json({
      components: [saved, ...fillers, other(MLC, fillers.length + 1, "Q1"), other(TWIN, fillers.length + 2, "Q1")],
      selection: null, selectionVersion: null, lastTurn: null, turnComponents: {}, tallies: {}, documentNumbers: [],
    }));
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/selection\/?$/, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    seen.selectionPuts += 1;
    return route.fulfill(json({ status: "set" }));
  });
  // The save route: it commits (201) and answers as the server does.
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/[^/]+\/revisions\/?$/, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    seen.saves.push(route.request().postDataJSON());
    return route.fulfill(json({
      status: "created", current: { ...vfdRev, revision: SAVED_REVISION, serialNumber: SERIAL }, changed: ["serialNumber"], selection: null, sameSerial: opts.sameSerial,
    }, 201));
  });
  // Find equipment is off, as it ships.
  await page.route(/\/api\/equipment-browser\//, (route) => route.fulfill(json({ error: "equipment_nav_disabled" }, 404)));
  return seen;
}

const here = { componentId: MLC, notebookId: NB, notebookName: "GS10 — Line 3 conveyor", label: "Q1 · MLC", retired: false };
const twin = { ...here, componentId: TWIN };
const away = { componentId: AWAY, notebookId: OTHER_NB, notebookName: "Packaging line", label: "VFD1 · AutomationDirect GS10", retired: false };
const checked = (candidates: unknown[]) => ({ status: "checked", candidates, truncated: false });

const checklist = (page: Page) => page.getByTestId("bench-components-panel");
const checklistRow = (page: Page, id: string) => checklist(page).getByTestId(`bench-component-${id}`);
const serialWarning = (page: Page) => checklist(page).getByRole("group", { name: "Repeated serial number" });
const notRunNote = (page: Page) => checklist(page).getByTestId("bench-same-serial-not-run");
const saved = (page: Page) => checklist(page).getByTestId("bench-message");
const openButton = (page: Page, id: string) => checklist(page).getByTestId(`bench-same-serial-open-${id}`);
const CONFIRMED = "Confirmed. Questions about it now use what you confirmed.";

async function open(page: Page, context: BrowserContext, baseURL: string | undefined, opts: RouteOpts): Promise<Seen> {
  await auth(context, baseURL!);
  const seen = await routes(page, opts);
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  return seen;
}

/** The checklist opens from More → Pick a part while the whole machine is the subject (Mike, 2026-11-20). */
async function openChecklist(page: Page, press: "click" | "tap" = "click") {
  await page.getByTestId("notebook-more")[press]();
  await page.getByTestId("notebook-more-item-part")[press]();
}

async function confirmWithSerial(page: Page, press: "click" | "tap" = "click") {
  await openChecklist(page, press);
  await checklistRow(page, VFD).getByRole("button", { name: "Edit label" })[press]();
  await checklist(page).getByTestId("bench-card-serialNumber").fill(SERIAL);
  await checklist(page).getByTestId("bench-card-confirm")[press]();
}

/** A proof screenshot, taken only when the run names a folder for it (MIRA_PROOF_SHOTS). */
async function proofShot(page: Page, name: string) {
  const dir = process.env.MIRA_PROOF_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/2026-11-19_repeated-serial-${name}.png` });
}

test("a checklist that holds a later revision of the saved component ends the warning (#5656)", async ({ page, context, baseURL }) => {
  // The save made revision 4. By the re-read that follows it, the component is at revision 5 under
  // another label: corrected on another screen in between.
  const seen = await open(page, context, baseURL, {
    sameSerial: checked([away]),
    later: { fromRead: 2, revision: SAVED_REVISION + 1, label: "VFD1 · AutomationDirect GS20" },
  });
  await confirmWithSerial(page);

  await expect(saved(page)).toHaveText(CONFIRMED);
  await expect(checklistRow(page, VFD)).toContainText("VFD1 · AutomationDirect GS20");
  expect(seen.saves).toHaveLength(1);
  // The serial that was checked belongs to revision 4, so nothing is said about it under revision 5's label.
  await expect(serialWarning(page)).toHaveCount(0);
  await expect(notRunNote(page)).toHaveCount(0);
  await expect(checklist(page)).not.toContainText("is saved as confirmed");
});

test("control: a checklist that holds the revision the save made keeps the warning, under that revision's label (#5656)", async ({ page, context, baseURL }) => {
  await open(page, context, baseURL, {
    sameSerial: checked([away]),
    later: { fromRead: 2, revision: SAVED_REVISION, label: "VFD1 · AutomationDirect GS10 rev C" },
  });
  await confirmWithSerial(page);

  await expect(saved(page)).toHaveText(CONFIRMED);
  await expect(serialWarning(page).getByRole("status")).toHaveText("This serial number is already on another component.");
  await expect(serialWarning(page)).toContainText("VFD1 · AutomationDirect GS10 rev C is saved as confirmed.");
});

test("two matches that read alike are numbered on the screen and in their button names (#5661 A1)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, context, baseURL, { sameSerial: checked([here, away, twin]) });
  await confirmWithSerial(page);

  const warning = serialWarning(page);
  await expect(warning.getByRole("status")).toHaveText("This serial number is already on 3 other components.");
  await expect(warning.getByTestId(`bench-same-serial-match-${MLC}`)).toContainText("Q1 · MLC (1 of 2) in this machine's checklist");
  await expect(warning.getByTestId(`bench-same-serial-match-${TWIN}`)).toContainText("Q1 · MLC (2 of 2) in this machine's checklist");
  await expect(openButton(page, MLC)).toHaveAccessibleName("Show in checklist: Q1 · MLC (1 of 2)");
  await expect(openButton(page, TWIN)).toHaveAccessibleName("Show in checklist: Q1 · MLC (2 of 2)");
  // A match that reads like no other is not numbered.
  await expect(warning.getByTestId(`bench-same-serial-match-${AWAY}`)).not.toContainText(" of ");
  await expect(warning.getByTestId(`bench-same-serial-place-${AWAY}`)).toHaveCount(0);
  await proofShot(page, "numbered-twins_desktop");

  // Each numbered button shows its own row.
  await openButton(page, TWIN).click();
  await expect(checklistRow(page, TWIN)).toHaveAttribute("data-found", "true");
  await expect(checklistRow(page, MLC)).not.toHaveAttribute("data-found", "true");

  await page.setViewportSize({ width: 412, height: 915 });
  await warning.getByRole("status").scrollIntoViewIfNeeded();
  await proofShot(page, "numbered-twins_mobile");
});

for (const [kind, button, words] of [
  ["Confirm", "bench-card-confirm", "Confirmed. The component list couldn't be refreshed just now."],
  ["Save, not confirmed", "bench-card-save", "Saved — not confirmed yet. The component list couldn't be refreshed just now."],
] as const) {
  test(`a committed ${kind} whose checklist re-read fails is reported as saved, not as a lost connection (#5661 A2)`, async ({ page, context, baseURL }) => {
    const seen = await open(page, context, baseURL, { sameSerial: checked([away]), failReads: [2] });
    await openChecklist(page);
    await checklistRow(page, VFD).getByRole("button", { name: "Edit label" }).click();
    await checklist(page).getByTestId("bench-card-serialNumber").fill(SERIAL);
    await checklist(page).getByTestId(button).click();

    await expect(saved(page)).toHaveText(words);
    await expect(checklist(page)).not.toContainText("didn't reach the server");
    expect(seen.saves).toHaveLength(1);
    await expect(checklist(page).getByTestId("bench-card")).toHaveCount(0);
  });
}

test("a second tap on Show in checklist brings the row back into view (#5657 F4)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Q1 is the last of a long checklist, far below the warning.
  const seen = await open(page, context, baseURL, { sameSerial: checked([here]), fillers: 40 });
  await confirmWithSerial(page);

  await openButton(page, MLC).click();
  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
  await expect(checklistRow(page, MLC)).toBeInViewport();

  // Back to the top, where the warning is: the row is out of sight again.
  await saved(page).scrollIntoViewIfNeeded();
  await expect(saved(page)).toBeInViewport();
  await expect(checklistRow(page, MLC)).not.toBeInViewport();

  await openButton(page, MLC).click();
  await expect(checklistRow(page, MLC)).toBeInViewport();
  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
  // Showing is not selecting, however many times.
  expect(seen.selectionPuts).toBe(0);
});

for (const [name, viewport] of [["portrait", { width: 800, height: 1280 }], ["landscape", { width: 1280, height: 800 }]] as const) {
  test.describe(`on a tablet, ${name}, by touch`, () => {
    test.use({ viewport, hasTouch: true });

    test(`the warning is in view after the save and every button is a full touch target (${name})`, async ({ page, context, baseURL }) => {
      const seen = await open(page, context, baseURL, { sameSerial: checked([here, away, twin]) });
      await confirmWithSerial(page, "tap");

      const warning = serialWarning(page);
      await expect(saved(page)).toHaveText(CONFIRMED);
      await expect(saved(page)).toBeInViewport();
      await expect(warning.getByRole("status")).toBeInViewport();
      await expect(warning).not.toContainText(SERIAL);
      const buttons = warning.getByRole("button");
      await expect(buttons).toHaveCount(4); // three matches and OK
      for (const b of await buttons.all()) {
        const box = await b.boundingBox();
        expect(box, "the button has a place on the screen").not.toBeNull();
        expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
      }
      // Nothing of the warning is cut off at the side.
      const group = await warning.boundingBox();
      expect(group!.x).toBeGreaterThanOrEqual(0);
      expect(group!.x + group!.width).toBeLessThanOrEqual(viewport.width);
      await proofShot(page, `warning_tablet-${name}`);

      // A tap shows the match; nothing is selected and the warning stays until OK.
      await openButton(page, MLC).tap();
      await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
      await expect(warning).toBeVisible();
      expect(seen.selectionPuts).toBe(0);
      await warning.getByRole("button", { name: "OK" }).scrollIntoViewIfNeeded();
      await warning.getByRole("button", { name: "OK" }).tap();
      await expect(serialWarning(page)).toHaveCount(0);
      await expect(saved(page)).toHaveText(CONFIRMED);
    });
  });
}

test("by keyboard: Tab reaches each button of the warning in order; Enter and Space press them", async ({ page, context, baseURL }) => {
  await open(page, context, baseURL, { sameSerial: checked([here, away, twin]) });
  await confirmWithSerial(page);
  const warning = serialWarning(page);
  await expect(warning.getByRole("status")).toBeVisible();

  // Start at the sheet's own Close button and walk forward.
  await checklist(page).getByRole("button", { name: "Close", exact: true }).focus();
  const order: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? ""));
  }
  const expected = [`bench-same-serial-open-${MLC}`, `bench-same-serial-open-${AWAY}`, `bench-same-serial-open-${TWIN}`, "bench-same-serial-dismiss"];
  expect(order.filter((id) => id.startsWith("bench-same-serial-"))).toEqual(expected);
  // Nothing else is between them: the four are consecutive stops.
  const first = order.indexOf(expected[0]);
  expect(order.slice(first, first + expected.length)).toEqual(expected);

  // Enter on a match shows it. Each walk starts again from Close, so nothing depends on where the last ended.
  await checklist(page).getByRole("button", { name: "Close", exact: true }).focus();
  for (let i = 0; i <= first; i += 1) await page.keyboard.press("Tab");
  await expect(openButton(page, MLC)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");

  // Space on OK puts the warning away.
  await checklist(page).getByRole("button", { name: "Close", exact: true }).focus();
  for (let i = 0; i <= first + 3; i += 1) await page.keyboard.press("Tab");
  await expect(checklist(page).getByTestId("bench-same-serial-dismiss")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(serialWarning(page)).toHaveCount(0);
  await expect(saved(page)).toHaveText(CONFIRMED);
});

test("what a screen reader is given: the group's name, the headline as a status, and each button's own name", async ({ page, context, baseURL }) => {
  await open(page, context, baseURL, { sameSerial: checked([here, away, twin]) });
  await confirmWithSerial(page);

  const warning = checklist(page).getByTestId("bench-same-serial");
  await expect(warning).toHaveRole("group");
  await expect(warning).toHaveAccessibleName("Repeated serial number");
  const headline = warning.getByTestId("bench-same-serial-headline");
  await expect(headline).toHaveRole("status");
  await expect(headline).toHaveText("This serial number is already on 3 other components.");
  await expect(saved(page)).toHaveRole("status");
  await expect(openButton(page, MLC)).toHaveAccessibleName("Show in checklist: Q1 · MLC (1 of 2)");
  await expect(openButton(page, TWIN)).toHaveAccessibleName("Show in checklist: Q1 · MLC (2 of 2)");
  await expect(openButton(page, AWAY)).toHaveAccessibleName("Open Packaging line in a new chat: VFD1 · AutomationDirect GS10");
  await expect(warning.getByTestId("bench-same-serial-dismiss")).toHaveAccessibleName("OK");
  // No two buttons of the warning share a name, and the serial number is in none of them.
  const names = await warning.getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent ?? ""));
  expect(new Set(names).size).toBe(names.length);
  expect(names.join(" ")).not.toContain(SERIAL);
});
