import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { BenchState } from "../../src/capabilities/bench-components/http";
import { DOC, FILE, NB, oracle } from "../fidelity/harness";
import { installSessionCookie } from "./harness/fixture-harness.cjs";

const PORT = 3941; // must match playwright.v3-project-resume.config.ts
const TENANT = "11111111-1111-4111-8111-111111111111";
const THREAD = "manual-handoff";
const LOOKUP = "Find me the manual for this drive.";
const QUESTION = "According to the manual, what is the nominal bus voltage?";
const SAFETY_QUESTION = "According to the manual, can I work on the energized 480V panel?";
const TITLE = "Exact GS10 fixture";
const COMPONENT_ID = "33333333-3333-4333-8333-333333333333";
const COMPONENT_DOC = "44444444-4444-4444-8444-444444444444";
const COMPONENT_LABEL = "Drive B · ABB ACS355";
const COMPONENT_MANUAL = "ABB component manual fixture";
const COMPONENT_VERSION = 3;
// What the chat route saves on an answer asked under a selected component (componentAttributionEntry).
const COMPONENT_ATTRIBUTION = { kind: "component_attribution", componentId: COMPONENT_ID, revision: 1, selectionVersion: COMPONENT_VERSION, label: COMPONENT_LABEL };
const IDENTITY = { manufacturer: "AutomationDirect", model: "GS11N-20P2" };
const STARTED_AT = "2026-11-21T12:00:00.000Z";
const SOURCE = {
  ...oracle.detailEmpty.sources[0], docId: DOC, filename: TITLE, fileId: FILE,
  enabledByDefault: true, matchState: "verified", readiness: { state: "chat_ready_basic", canChat: true },
};
const CITATION = {
  citationId: "1", docId: DOC, fileId: FILE, sourceTitle: TITLE, page: 1, quote: "The fixture reports a bus voltage of 337 volts under idle conditions.",
  sourceType: "manual", sourceUrl: "https://manual.example.invalid/fixture.pdf",
};
const ANSWER = "The bus voltage is 337 volts under idle conditions. [1]";
const COMPONENT_STATE: BenchState = {
  components: [{
    id: COMPONENT_ID, position: 0, kind: "drive", origin: "technician", status: "confirmed",
    statusLabel: "Confirmed", label: COMPONENT_LABEL, hasOwnDocument: true, evidence: "Confirmed by a technician.",
    current: {
      componentId: COMPONENT_ID, revision: 1, rawLabel: "ABB ACS355", inputKind: "typed",
      manufacturer: "ABB", family: null, catalogNumber: "ACS355", serialNumber: null,
      hardwareRevision: null, localTag: "Drive B", identityStatus: "user_confirmed",
      unresolved: [], confirmedAt: STARTED_AT, createdAt: STARTED_AT,
    },
    documents: [{ docId: COMPONENT_DOC, filename: COMPONENT_MANUAL, selected: true, model: "covers", declared: [], ready: true, readyLabel: "Ready" }],
  }],
  selection: { componentId: COMPONENT_ID, revision: 1, version: COMPONENT_VERSION, current: true, selectedVia: "picker", selectedAt: STARTED_AT },
  selectionVersion: COMPONENT_VERSION,
  lastTurn: null, turnComponents: {}, tallies: {}, documentNumbers: [],
};

const json = (data: unknown, status = 200) => ({ status, contentType: "application/json", json: data });
const stream = (...frames: unknown[]) => ({
  status: 200, contentType: "text/event-stream",
  body: frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n",
});
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

for (const mode of ["preparing", "ready", "opening", "lookup-failed", "safety", "attached-safety", "component", "bench-unavailable"] as const) {
  test(`exact manual handoff in the ${mode} case`, async ({ page, context, baseURL }) => {
    const lookupFails = mode === "lookup-failed";
    const component = mode === "component";
    const benchUnavailable = mode === "bench-unavailable";
    const opening = mode === "opening" || lookupFails || component || benchUnavailable;
    const safety = mode === "safety";
    const attachedSafety = mode === "attached-safety";
    // Origin check first, then the per-run secret: nothing is minted for any other origin.
    await installSessionCookie(context, baseURL, PORT, {
      uid: "e2e-manual-handoff", tid: TENANT, status: "trial", trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const pdf = await readFile(path.join(__dirname, "../equipment/fixtures/diagnostic-fixture.pdf"));
    const scopeRequested = latch();
    const scope = latch();
    const answerHistory = latch();
    const initialDetail = latch();
    const secondLookRequested = latch();
    const secondLook = latch();
    let lostManual = false;
    let confirmed = opening;
    let ready = false;
    let looks = 0;
    let failFirstHistory = true;
    let savedAnswerReads = 0;
    let lookup: { clientRequestId: string } | undefined;
    let asked: { clientRequestId: string } | undefined;
    const source = component ? { ...SOURCE, docId: COMPONENT_DOC, filename: COMPONENT_MANUAL } : SOURCE;
    const citationEntry = component ? { ...CITATION, docId: COMPONENT_DOC, sourceTitle: COMPONENT_MANUAL } : CITATION;
    const chatBodies: { message: string; threadId: string; sourceDocIds: string[] }[] = [];
    const notebook = { ...oracle.detailEmpty.notebook, displayName: "Manual handoff fixture", sourceCount: 0, manufacturer: null, model: null, identityStatus: "unknown" };
    const nbPath = `/api/equipment-notebooks/${NB}`;
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const p = url.pathname.replace(/(.)\/$/, "$1");
      const method = request.method();
      if (p === "/api/auth/session") return route.fulfill(json({ user: { name: "Technician" }, expires: "2099-01-01T00:00:00Z" }));
      if (p === "/api/auth/_log") return route.fulfill(json({}));
      if (p === "/api/equipment-notebooks") return route.fulfill(json({ notebooks: [notebook] }));
      if (p === `${nbPath}/components`) {
        scopeRequested.release();
        await scope.promise;
        if (benchUnavailable) return route.fulfill(json({ error: "components_unavailable" }, 503));
        return route.fulfill(json(component ? COMPONENT_STATE : { components: [], selection: null, selectionVersion: null, headings: [] }));
      }
      if (p === `${nbPath}/look`) {
        looks += 1;
        if (attachedSafety && looks === 2) {
          secondLookRequested.release();
          await secondLook.promise;
        }
        return route.fulfill(json({
          fileId: FILE, attachment: { linkId: "attachment" }, observationPersisted: true,
          observation: { text: "AutomationDirect, MODEL: GS11N-20P2", capturedAt: STARTED_AT },
        }));
      }
      if (p === `${nbPath}/identity/confirm`) {
        expect(request.postDataJSON()).toEqual(IDENTITY);
        confirmed = true;
        return route.fulfill(json({ ok: true, manualReady: false, searching: true, startedAt: STARTED_AT }));
      }
      if (p === `${nbPath}/chat` && method === "POST") {
        const body = request.postDataJSON();
        chatBodies.push(body);
        if (body.message === LOOKUP) {
          expect(body.visualEvidence.fileId).toBe(FILE);
          lookup = body;
          return route.fulfill(stream(
            { kind: "evidence", visualEvidence: { kind: "visual_observation", fileId: FILE, capturedAt: STARTED_AT, provenance: "phone_photo" } },
            { kind: "status", status: "insufficient_evidence", message: "Confirm the equipment." },
            { kind: "identity_proposal", ...IDENTITY },
          ));
        }
        if (body.message === SAFETY_QUESTION) {
          if (attachedSafety) expect(body.visualEvidence.fileId).toBe(FILE);
          return route.fulfill(stream(
          { kind: "content", content: "Make the equipment safe before working on it." },
          { kind: "safety", trigger: "energized-electrical-hazard" },
          { kind: "status", status: "answered" },
          ));
        }
        asked = body;
        return route.fulfill(stream(
          { kind: "content", content: ANSWER },
          { kind: "sources", citations: [citationEntry] },
          ...(component ? [{ kind: "component", componentId: COMPONENT_ID, revision: 1, selectionVersion: COMPONENT_VERSION, label: COMPONENT_LABEL, actions: [] }] : []),
          { kind: "status", status: "answered" },
        ));
      }
      if (p === nbPath && method === "GET") {
        expect(url.searchParams.get("threadId")).toBe(THREAD);
        if (opening) await initialDetail.promise;
        if (lookup && failFirstHistory) {
          failFirstHistory = false;
          return route.fulfill(json({ error: "temporary_fixture_read_failure" }, 500));
        }
        if (asked) {
          await answerHistory.promise;
          savedAnswerReads += 1;
        }
        const savedLookup = (lookup || opening) && {
          id: "saved-lookup", clientRequestId: lookup?.clientRequestId ?? "reopened-lookup", question: LOOKUP, answerStatus: "insufficient_evidence",
          answerText: "Confirm the equipment.", evidence: [{ kind: "identity_proposal", ...IDENTITY }], createdAt: STARTED_AT,
        };
        const savedAnswer = asked && {
          id: "saved-answer", clientRequestId: asked.clientRequestId, question: QUESTION, answerStatus: "answered",
          answerText: ANSWER, evidence: component ? [citationEntry, COMPONENT_ATTRIBUTION] : [citationEntry], createdAt: new Date().toISOString(),
        };
        const savedTurns = [savedLookup, savedAnswer].filter(Boolean) as { id: string; clientRequestId: string; evidence: { kind?: string }[] }[];
        const newest = savedTurns.at(-1);
        // #5750: as the detail route does, an answer asked under a selected component is about that
        // component, so the project's status is withheld there (manualSearchScope "other_model").
        const componentAnswer = Boolean(newest?.evidence.some(entry => entry.kind === "component_attribution"));
        const manualSearch = confirmed && !componentAnswer ? {
          ...IDENTITY, startedAt: STARTED_AT, running: !ready && !lostManual,
          ...(ready ? { sourceState: "ready", readySourceDocId: DOC, message: "Exact fixture manual is ready in Sources." } :
            lostManual ? { sourceState: "unavailable", message: "The fixture manual is unavailable." } :
            { sourceState: "preparing", message: "Preparing the fixture manual." }),
        } : null;
        return route.fulfill(json({
          ...oracle.detailEmpty,
          notebook: confirmed ? { ...notebook, ...IDENTITY, identityStatus: "user_confirmed" } : notebook,
          turns: savedTurns,
          sources: ready || component ? [source] : [],
          manualSearch,
          ...(confirmed && componentAnswer ? { manualSearchScope: "other_model" } : {}),
          // #5750: as the detail route does, a thread-scoped read names the saved answer its status
          // was checked against (the newest turn); the Hub shows the status under that answer only.
          ...(manualSearch ? { manualSearchAnswer: newest ? { turnId: newest.id, clientRequestId: newest.clientRequestId ?? null } : null } : {}),
        }));
      }
      if (p === `/api/namespace/files/${FILE}`) return route.fulfill({
        status: 200, contentType: "application/pdf", body: pdf,
        headers: { "content-disposition": 'inline; filename="Exact GS10 fixture.pdf"' },
      });
      return route.fulfill(json({}, 404));
    });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await scopeRequested.promise;
    const composer = page.getByRole("textbox", { name: "Ask MIRA", exact: true });
    if (component) {
      initialDetail.release();
      scope.release();
      await expect(page.getByText(`Asking about ${COMPONENT_LABEL}`, { exact: true })).toBeVisible();
      const searching = page.getByText(/Searching AutomationDirect/).last();
      await expect(searching).toBeVisible();
      await composer.fill(QUESTION);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const citation = page.getByRole("button", { name: `Open citation 1: ${COMPONENT_MANUAL}, page 1`, exact: true });
      await expect(citation).toBeVisible({ timeout: 8_000 });
      expect(chatBodies).toEqual([expect.objectContaining({
        message: QUESTION, threadId: THREAD, sourceDocIds: [COMPONENT_DOC],
        componentSelection: { threadId: THREAD, componentId: COMPONENT_ID, selectionVersion: COMPONENT_VERSION },
      })]);
      lostManual = true;
      answerHistory.release();
      await expect.poll(() => savedAnswerReads).toBeGreaterThan(0);
      await expect(page.locator('[data-turn-id="saved-answer-a"]')).toHaveCount(1);
      // The saved answer was asked under the selected component: the project's status is withheld
      // there, so no project status line is shown, and the component's citation stays.
      await expect(page.locator('[data-part-type="manual_search_status"]')).toHaveCount(0);
      await expect(citation).toBeVisible();
      return;
    }
    const attachPhoto = async () => {
      await page.getByRole("button", { name: "Add attachment", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Photo", exact: true }).click();
      await (await chooser).setFiles({ name: "nameplate.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic nameplate bytes") });
    };
    if (!opening) {
      await attachPhoto();
      const pending = page.getByRole("list", { name: "Pending attachments" });
      await expect(pending.getByText("nameplate.jpg")).toBeVisible();
      await composer.fill(LOOKUP);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(pending.getByText("nameplate.jpg")).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
      expect(looks).toBe(0);
      scope.release();
      await page.getByRole("button", { name: "Use its manuals", exact: true }).click({ timeout: 15_000 });
      await expect(page.getByText("Confirmed.", { exact: true })).toBeVisible();
    }

    const sourceReady = page.getByText("Exact fixture manual is ready in Sources.", { exact: true }).last();
    if (mode === "ready" || attachedSafety) {
      ready = true;
      await expect(sourceReady).toBeVisible();
    }
    await composer.fill(safety ? SAFETY_QUESTION : QUESTION);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    if (opening) {
      await expect(composer).toHaveValue(QUESTION);
      expect(chatBodies).toHaveLength(0);
      initialDetail.release();
      if (!lookupFails) scope.release();
      await expect(page.getByText(/Searching AutomationDirect/).last()).toBeVisible();
      if (lookupFails) {
        lostManual = true;
        await expect(page.getByText("The fixture manual is unavailable.", { exact: true })).toBeVisible();
        scope.release();
        await expect(page.getByText(/The manual isn't ready/)).toBeVisible();
        await expect(composer).toHaveValue(QUESTION);
        expect(chatBodies).toHaveLength(0);
        return;
      }
    }
    if (safety) {
      await expect(page.getByText("Make the equipment safe before working on it.", { exact: true })).toBeVisible();
      expect(chatBodies.at(-1)).toMatchObject({ message: SAFETY_QUESTION, sourceDocIds: [] });
      expect(ready).toBe(false);
      return;
    }
    if (mode !== "ready" && !attachedSafety) {
      await expect(composer).toHaveValue(QUESTION);
      expect(chatBodies).toHaveLength(opening ? 0 : 1);
      ready = true;
    }

    const citation = page.getByRole("button", { name: /^Open citation 1: Exact GS10 fixture, page 1$/ });
    if (attachedSafety) {
      await expect(citation).toBeVisible();
      await attachPhoto();
      await composer.fill(SAFETY_QUESTION);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await secondLookRequested.promise;
      ready = false;
      lostManual = true;
      answerHistory.release();
      await expect(page.getByText("The fixture manual is unavailable.", { exact: true })).toBeVisible();
      secondLook.release();
      await expect(page.getByText("Make the equipment safe before working on it.", { exact: true })).toBeVisible();
      expect(chatBodies.at(-1)).toMatchObject({ message: SAFETY_QUESTION, sourceDocIds: [] });
      expect(looks).toBe(2);
      return;
    }
    await citation.click();
    expect(chatBodies).toEqual([
      ...(opening ? [] : [expect.objectContaining({ message: LOOKUP, sourceDocIds: [], threadId: THREAD })]),
      expect.objectContaining({ message: QUESTION, sourceDocIds: [DOC], threadId: THREAD }),
    ]);
    expect(looks).toBe(opening ? 0 : 1);
    expect(context.pages()).toHaveLength(1);
    const dialog = page.getByRole("dialog", { name: "Source viewer", exact: true });
    const canvas = dialog.frameLocator("iframe").locator('canvas[data-rendered-page="1"]');
    await expect(canvas).toBeVisible();
    expect(await canvas.evaluate((element: HTMLCanvasElement) => {
      const data = element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data;
      return data.some((value, index) => index % 4 === 0 && value < 128);
    })).toBe(true);
    answerHistory.release();
    await expect.poll(() => savedAnswerReads).toBeGreaterThan(0);
    await expect(page.locator('[data-turn-id="saved-answer-a"]')).toHaveCount(1);
    await expect(dialog).toBeVisible();
    await expect(canvas).toBeVisible();
    await dialog.getByRole("button", { name: "Close source viewer", exact: true }).click();
    const chat = page.getByRole("region", { name: "Conversation" });
    await expect(chat.getByText(QUESTION, { exact: true })).toHaveCount(1);
    await expect(citation).toBeVisible();
    expect(new URL(page.url()).searchParams.get("thread")).toBe(THREAD);
  });
}

// #5746 round 4 F1: after an answer about a selected component, the detail read withholds the
// project's status from display (#5750). A whole-machine question that waits for the manual must
// still wait for it: the route then sends the project's lookup for the send wait only
// (`wholeMachineManualSearch`, no message or link), and nothing new is shown.
const WHOLE_QUESTION = "According to the manual, what is the nominal supply voltage?";
const GENERAL_QUESTION = "What is the rated current?";
for (const mode of ["return", "return-lost", "cold", "controls"] as const) {
  const title = mode === "controls"
    ? "after a component answer, a component question and a question that needs no manual are sent at once"
    : `after a component answer, a whole-machine manual question waits in the ${mode} case`;
  test(title, async ({ page, context, baseURL }) => {
    const cold = mode === "cold";
    await installSessionCookie(context, baseURL, PORT, {
      uid: "e2e-manual-handoff", tid: TENANT, status: "trial", trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    let componentSelected = !cold;
    let ready = false;
    let lost = false;
    let asked: { clientRequestId: string } | undefined = cold ? { clientRequestId: "saved-component-question" } : undefined;
    let withheldReads = 0;
    const chatBodies: { message: string; threadId: string; sourceDocIds: string[] }[] = [];
    const selectionWrites: { componentId: string | null }[] = [];
    const componentSource = { ...SOURCE, docId: COMPONENT_DOC, filename: COMPONENT_MANUAL };
    const notebook = { ...oracle.detailEmpty.notebook, displayName: "Manual handoff fixture", sourceCount: 0, ...IDENTITY, identityStatus: "user_confirmed" };
    const nbPath = `/api/equipment-notebooks/${NB}`;
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const p = url.pathname.replace(/(.)\/$/, "$1");
      const method = request.method();
      if (p === "/api/auth/session") return route.fulfill(json({ user: { name: "Technician" }, expires: "2099-01-01T00:00:00Z" }));
      if (p === "/api/auth/_log") return route.fulfill(json({}));
      if (p === "/api/equipment-notebooks") return route.fulfill(json({ notebooks: [notebook] }));
      if (p === `${nbPath}/components/selection` && method === "PUT") {
        const body = request.postDataJSON();
        selectionWrites.push(body);
        expect(body).toMatchObject({ threadId: THREAD, componentId: null });
        componentSelected = false;
        return route.fulfill(json({ status: "cleared", selection: null }));
      }
      if (p === `${nbPath}/components`) {
        return route.fulfill(json(componentSelected ? COMPONENT_STATE : {
          ...COMPONENT_STATE, selection: null, selectionVersion: COMPONENT_VERSION + 1,
        }));
      }
      if (p === `${nbPath}/chat` && method === "POST") {
        const body = request.postDataJSON();
        chatBodies.push(body);
        if (body.message === QUESTION || body.componentSelection?.componentId) {
          if (body.message === QUESTION) asked = body;
          return route.fulfill(stream(
            { kind: "content", content: ANSWER },
            { kind: "sources", citations: [{ ...CITATION, docId: COMPONENT_DOC, sourceTitle: COMPONENT_MANUAL }] },
            { kind: "component", componentId: COMPONENT_ID, revision: 1, selectionVersion: COMPONENT_VERSION, label: COMPONENT_LABEL, actions: [] },
            { kind: "status", status: "answered" },
          ));
        }
        return route.fulfill(stream(
          { kind: "content", content: ANSWER },
          { kind: "sources", citations: [CITATION] },
          { kind: "status", status: "answered" },
        ));
      }
      if (p === nbPath && method === "GET") {
        expect(url.searchParams.get("threadId")).toBe(THREAD);
        const savedLookup = {
          id: "saved-lookup", clientRequestId: "reopened-lookup", question: LOOKUP, answerStatus: "insufficient_evidence",
          answerText: "Confirm the equipment.", evidence: [{ kind: "identity_proposal", ...IDENTITY }], createdAt: STARTED_AT,
        };
        const savedAnswer = asked && {
          id: "saved-answer", clientRequestId: asked.clientRequestId, question: QUESTION, answerStatus: "answered", answerText: ANSWER,
          evidence: [{ ...CITATION, docId: COMPONENT_DOC, sourceTitle: COMPONENT_MANUAL }, COMPONENT_ATTRIBUTION], createdAt: STARTED_AT,
        };
        const lookupStatus = {
          ...IDENTITY, startedAt: STARTED_AT, running: !ready && !lost,
          ...(ready ? { sourceState: "ready", readySourceDocId: DOC } : lost ? { sourceState: "unavailable" } : { sourceState: "preparing" }),
        };
        const sources = [componentSource, ...(ready ? [SOURCE] : [])];
        if (!savedAnswer) {
          // The newest answer is the lookup: the status is shown under it, as before.
          return route.fulfill(json({
            ...oracle.detailEmpty, notebook, turns: [savedLookup], sources,
            manualSearch: { ...lookupStatus, message: "Preparing the fixture manual." },
            manualSearchAnswer: { turnId: savedLookup.id, clientRequestId: savedLookup.clientRequestId },
          }));
        }
        // As the detail route does: the newest answer was asked under the component, so the
        // project's status is withheld from display, and only the send wait gets the lookup.
        withheldReads += 1;
        return route.fulfill(json({
          ...oracle.detailEmpty, notebook, turns: [savedLookup, savedAnswer], sources,
          manualSearch: null, manualSearchScope: "other_model", wholeMachineManualSearch: lookupStatus,
        }));
      }
      return route.fulfill(json({}, 404));
    });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    const composer = page.getByRole("textbox", { name: "Ask MIRA", exact: true });
    const statusParts = page.locator('[data-part-type="manual_search_status"]');
    if (!cold) {
      await expect(page.getByText(`Asking about ${COMPONENT_LABEL}`, { exact: true })).toBeVisible();
      await expect(page.getByText(/Searching AutomationDirect/).last()).toBeVisible();
      await composer.fill(QUESTION);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByRole("button", { name: `Open citation 1: ${COMPONENT_MANUAL}, page 1`, exact: true })).toBeVisible({ timeout: 8_000 });
      // The component question is not held for the project's manual.
      expect(chatBodies).toEqual([expect.objectContaining({ message: QUESTION, sourceDocIds: [COMPONENT_DOC] })]);
      // At least one poll reads the withheld status before the technician goes back.
      await expect.poll(() => withheldReads, { timeout: 15_000 }).toBeGreaterThan(1);
      await expect(statusParts).toHaveCount(0);
      if (mode === "controls") {
        // With the component still selected, a manual question is about the component: sent at once.
        await composer.fill(WHOLE_QUESTION);
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect.poll(() => chatBodies.length, { timeout: 5_000 }).toBe(2);
        expect(chatBodies[1]).toMatchObject({ message: WHOLE_QUESTION, componentSelection: { componentId: COMPONENT_ID } });
        await expect(page.getByRole("button", { name: `Open citation 1: ${COMPONENT_MANUAL}, page 1`, exact: true })).toHaveCount(2, { timeout: 8_000 });
      }
      await page.getByRole("button", { name: "Back to whole machine", exact: true }).click();
      await expect.poll(() => selectionWrites.length).toBe(1);
      await expect(page.getByText(`Asking about ${COMPONENT_LABEL}`, { exact: true })).toHaveCount(0);
      if (mode === "controls") {
        // About the whole machine, a question that needs no manual is sent at once too.
        const sent = chatBodies.length;
        await composer.fill(GENERAL_QUESTION);
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect.poll(() => chatBodies.length, { timeout: 5_000 }).toBe(sent + 1);
        expect(chatBodies.at(-1)).toMatchObject({ message: GENERAL_QUESTION, componentSelection: { componentId: null } });
        await expect(statusParts).toHaveCount(0);
        return;
      }
    } else {
      await expect.poll(() => withheldReads).toBeGreaterThan(0);
      await expect(page.locator('[data-turn-id="saved-answer-a"]')).toHaveCount(1);
    }
    const before = chatBodies.length;
    await composer.fill(WHOLE_QUESTION);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    // Held: a further read happens and still nothing is sent; nothing new is shown.
    const readsAtSend = withheldReads;
    await expect.poll(() => withheldReads, { timeout: 15_000 }).toBeGreaterThan(readsAtSend);
    expect(chatBodies).toHaveLength(before);
    await expect(composer).toHaveValue(WHOLE_QUESTION);
    await expect(statusParts).toHaveCount(0);
    if (mode === "return-lost") {
      lost = true;
      await expect(page.getByText(/The manual isn't ready/)).toBeVisible({ timeout: 15_000 });
      await expect(composer).toHaveValue(WHOLE_QUESTION);
      expect(chatBodies).toHaveLength(before);
      return;
    }
    ready = true;
    await expect.poll(() => chatBodies.filter(body => body.message === WHOLE_QUESTION).length, { timeout: 20_000 }).toBe(1);
    expect(chatBodies).toHaveLength(before + 1);
    expect(chatBodies.at(-1)).toMatchObject({ message: WHOLE_QUESTION, threadId: THREAD });
    expect(chatBodies.at(-1)!.sourceDocIds).toContain(DOC);
  });
}
