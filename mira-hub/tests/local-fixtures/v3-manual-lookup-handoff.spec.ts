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
// One the route's own stops catch (the energized-hazard directive); the route test pins that.
const SAFETY_QUESTION = "According to the manual, can I measure the DC bus while it's live?";
const TITLE = "Exact GS10 fixture";
const COMPONENT_ID = "33333333-3333-4333-8333-333333333333";
const COMPONENT_DOC = "44444444-4444-4444-8444-444444444444";
const COMPONENT_LABEL = "Drive B · ABB ACS355";
const COMPONENT_MANUAL = "ABB component manual fixture";
const COMPONENT_VERSION = 3;
// What the chat route saves on an answer asked under a selected component (componentAttributionEntry).
const COMPONENT_ATTRIBUTION = { kind: "component_attribution", componentId: COMPONENT_ID, revision: 1, selectionVersion: COMPONENT_VERSION, label: COMPONENT_LABEL };
const IDENTITY = { manufacturer: "AutomationDirect", model: "GS11N-20P2" };
const LABEL = `${IDENTITY.manufacturer} ${IDENTITY.model}`;
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

// #5746 (Mike, 2026-11-26): nothing holds a manual question for the project's manual. The chat
// route answers it the way main does: while the lookup runs it says it is looking and to ask again
// (`acquisitionDeclineText`, pinned in manual-question-during-lookup.route.test.ts); once the
// manual is in this notebook's Sources the next question is sent with it. This fake gives main's
// replies for the states this spec uses, as the route decides them; each one is saved, as the route
// saves it, so the Hub's history reload finds it.
const RUNNING_REPLY = `I don't have the ${LABEL} manual yet — I'm looking for the official one now. It will show up in this notebook's Sources when I find it; ask again in a minute and I'll answer from it and show you the page.`;
const FOUND_REPLY = `I found the official ${LABEL} manual and added it to this notebook's Sources. Reopen the notebook (or turn it on in Sources) and ask again — I'll answer from it and show you the page.`;
const NOT_FOUND_REPLY = `I looked for the official ${LABEL} manual and couldn't find one. Upload the manual (or the page that covers it) to this notebook, and I'll answer from it and show you the page.`;
type Sent = { message: string; threadId: string; sourceDocIds: string[]; clientRequestId: string; manualWait: string | null };
type Saved = { id: string; clientRequestId: string; question: string; answerStatus: string; answerText: string; evidence: object[]; createdAt: string };
type Status = {
  manufacturer: string; model: string; startedAt?: string; running: boolean;
  sourceState?: string; readySourceDocId?: string; message?: string; manualUrl?: string;
};
const decline = (text: string) => stream({ kind: "content", content: text }, { kind: "status", status: "insufficient_evidence" });
const savedDecline = (body: Sent, text: string): Saved => ({
  id: `saved-${body.clientRequestId}`, clientRequestId: body.clientRequestId, question: body.message,
  answerStatus: "insufficient_evidence", answerText: text, evidence: [], createdAt: STARTED_AT,
});

for (const mode of ["preparing", "ready", "opening", "lookup-failed", "safety", "attached-safety", "component", "bench-unavailable", "lookup-failed-bench-unavailable"] as const) {
  test(`exact manual handoff in the ${mode} case`, async ({ page, context, baseURL }) => {
    const lookupFails = mode === "lookup-failed" || mode === "lookup-failed-bench-unavailable";
    const component = mode === "component";
    const benchUnavailable = mode === "bench-unavailable" || mode === "lookup-failed-bench-unavailable";
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
    const declined: Saved[] = [];
    const source = component ? { ...SOURCE, docId: COMPONENT_DOC, filename: COMPONENT_MANUAL } : SOURCE;
    const citationEntry = component ? { ...CITATION, docId: COMPONENT_DOC, sourceTitle: COMPONENT_MANUAL } : CITATION;
    const chatBodies: Sent[] = [];
    const projectStatus = (): Status | null => confirmed ? {
      ...IDENTITY, startedAt: STARTED_AT, running: !ready && !lostManual,
      ...(ready ? { sourceState: "ready", readySourceDocId: DOC, message: "Exact fixture manual is ready in Sources." } :
        lostManual ? { sourceState: "unavailable", message: "The fixture manual is unavailable." } :
        { sourceState: "preparing", message: "Preparing the fixture manual." }),
    } : null;
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
        chatBodies.push({ ...body, manualWait: request.headers()["x-mira-manual-wait"] ?? null });
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
        // Main's replies when the question goes without the project's manual.
        if (!component && !body.sourceDocIds.includes(DOC)) {
          const text = lostManual ? NOT_FOUND_REPLY : RUNNING_REPLY;
          declined.push(savedDecline(body, text));
          return route.fulfill(decline(text));
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
        const savedTurns = [savedLookup, ...declined, savedAnswer].filter(Boolean) as { id: string; clientRequestId: string; evidence: { kind?: string }[] }[];
        const newest = savedTurns.at(-1);
        // #5750: as the detail route does, an answer asked under a selected component is about that
        // component, so the project's status is withheld there (manualSearchScope "other_model").
        const componentAnswer = Boolean(newest?.evidence.some(entry => entry.kind === "component_attribution"));
        const manualSearch = componentAnswer ? null : projectStatus();
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
    const sendButton = page.getByRole("button", { name: "Send", exact: true });
    const chat = page.getByRole("region", { name: "Conversation" });
    if (component) {
      initialDetail.release();
      scope.release();
      await expect(page.getByText(`Asking about ${COMPONENT_LABEL}`, { exact: true })).toBeVisible();
      const searching = page.getByText(/Searching AutomationDirect/).last();
      await expect(searching).toBeVisible();
      await composer.fill(QUESTION);
      await sendButton.click();
      const citation = page.getByRole("button", { name: `Open citation 1: ${COMPONENT_MANUAL}, page 1`, exact: true });
      await expect(citation).toBeVisible({ timeout: 8_000 });
      expect(chatBodies).toEqual([expect.objectContaining({
        message: QUESTION, threadId: THREAD, sourceDocIds: [COMPONENT_DOC], manualWait: null,
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
      await sendButton.click();
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
    await sendButton.click();
    const asksBefore = opening ? 0 : 1;
    if (opening) {
      // Sent while the project is still opening: the composer keeps it until the project's detail
      // and question target are read, then sends it once.
      await expect(composer).toHaveValue(QUESTION);
      expect(chatBodies).toHaveLength(0);
      initialDetail.release();
      if (!lookupFails) scope.release();
      await expect(page.getByText(/Searching AutomationDirect/).last()).toBeVisible();
      if (lookupFails) {
        lostManual = true;
        await expect(page.getByText("The fixture manual is unavailable.", { exact: true })).toBeVisible();
        expect(chatBodies).toHaveLength(0);
        scope.release();
        // Sent once, without the manual, and answered as main answers it: nothing is held.
        await expect(chat.getByText(NOT_FOUND_REPLY, { exact: true }).last()).toBeVisible();
        expect(chatBodies).toEqual([expect.objectContaining({ message: QUESTION, sourceDocIds: [], manualWait: null })]);
        await expect(composer).toHaveValue("");
        await expect(page.getByRole("alert", { name: "Send error" })).toHaveCount(0);
        return;
      }
    }
    if (safety) {
      await expect(page.getByText("Make the equipment safe before working on it.", { exact: true })).toBeVisible();
      expect(chatBodies.at(-1)).toMatchObject({ message: SAFETY_QUESTION, sourceDocIds: [], manualWait: null });
      expect(ready).toBe(false);
      return;
    }
    if (mode !== "ready" && !attachedSafety) {
      // Asked while the manual is prepared: sent at once, without it, and answered with main's
      // reply. The question is not kept or asked again on its own.
      await expect(chat.getByText(RUNNING_REPLY, { exact: true }).last()).toBeVisible();
      expect(chatBodies).toHaveLength(asksBefore + 1);
      expect(chatBodies.at(-1)).toMatchObject({ message: QUESTION, sourceDocIds: [], manualWait: null });
      await expect(composer).toHaveValue("");
      await expect(page.getByRole("alert", { name: "Send error" })).toHaveCount(0);
      // The lookup finishes: the Hub's follow reads it, with the manual in Sources.
      ready = true;
      await expect(sourceReady).toBeVisible({ timeout: 20_000 });
      expect(chatBodies).toHaveLength(asksBefore + 1);
      // Asked again by the technician, now with the manual.
      await composer.fill(QUESTION);
      await sendButton.click();
    }

    const citation = page.getByRole("button", { name: /^Open citation 1: Exact GS10 fixture, page 1$/ });
    if (attachedSafety) {
      await expect(citation).toBeVisible();
      // The manual is lost before the next question. The answer's saved read returns it (#5686 keeps
      // the composer busy until that read returns, so it is released before the next send).
      ready = false;
      lostManual = true;
      answerHistory.release();
      await expect(page.getByText("The fixture manual is unavailable.", { exact: true })).toBeVisible();
      await attachPhoto();
      await composer.fill(SAFETY_QUESTION);
      await sendButton.click();
      await secondLookRequested.promise;
      secondLook.release();
      await expect(page.getByText("Make the equipment safe before working on it.", { exact: true })).toBeVisible();
      expect(chatBodies.at(-1)).toMatchObject({ message: SAFETY_QUESTION, sourceDocIds: [], manualWait: null });
      expect(looks).toBe(2);
      return;
    }
    await citation.click();
    expect(chatBodies).toEqual([
      ...(opening ? [] : [expect.objectContaining({ message: LOOKUP, sourceDocIds: [], threadId: THREAD })]),
      ...(mode === "ready" ? [] : [expect.objectContaining({ message: QUESTION, sourceDocIds: [], threadId: THREAD })]),
      expect.objectContaining({ message: QUESTION, sourceDocIds: [DOC], threadId: THREAD, manualWait: null }),
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
    await expect(chat.getByText(QUESTION, { exact: true })).toHaveCount(mode === "ready" ? 1 : 2);
    await expect(citation).toBeVisible();
    expect(new URL(page.url()).searchParams.get("thread")).toBe(THREAD);
  });
}

// The composer's own queue (kept): a send before this conversation's detail and question target are
// read waits for them, and Stop pauses it with the draft kept. And #5750's status scoping: in a
// thread that asked about a look-alike model, the project's status is withheld, so nothing follows
// the lookup there; a manual that lands unseen comes in with the next answer's history read.
const OWN_MODEL_QUESTION = "According to the manual, what is the acceleration parameter for the GS11N-20P2?";
const OTHER_QUESTION = "What is the rated current?";
const PHOTO_QUESTION = "What does this nameplate say?";
const PAUSED = "Send paused. Your message and attachments are still here.";
const TITLES = {
  "detail-late": "a question sent while the project is still opening waits for it, then goes once",
  "photo-retry": "Stop while a photo send waits for its target pauses it; Try again sends it once with the photo",
  retire: "a send after a paused one ends the pause, so its own failure offers Try again",
  "withheld-lands-unseen": "in a look-alike thread a manual that lands unseen comes in with the next answer, and the next question cites it",
} as const;
for (const mode of Object.keys(TITLES) as (keyof typeof TITLES)[]) {
  test(TITLES[mode], async ({ page, context, baseURL }) => {
    await installSessionCookie(context, baseURL, PORT, {
      uid: "e2e-manual-handoff", tid: TENANT, status: "trial", trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const scope = latch();
    const detailHeld = latch();
    if (mode !== "photo-retry" && mode !== "retire") scope.release();
    if (mode !== "detail-late") detailHeld.release();
    let ready = false;
    let reads = 0;
    let looks = 0;
    let failNext = false;
    const chatBodies: Sent[] = [];
    const notebook = { ...oracle.detailEmpty.notebook, displayName: "Manual handoff fixture", sourceCount: 0, ...IDENTITY, identityStatus: "user_confirmed" };
    const nbPath = `/api/equipment-notebooks/${NB}`;
    const savedLookAlike = {
      id: "saved-look-alike", clientRequestId: "look-alike", question: "Find me the manual for AutomationDirect GS11N-20P25",
      answerStatus: "insufficient_evidence", answerText: "No manual is attached for that model.", evidence: [], createdAt: STARTED_AT,
    };
    // Each answered question is saved, as the chat route does, so the Hub's history reload finds it.
    const answered: Saved[] = [];
    const withheld = mode === "withheld-lands-unseen";
    const lookupStatus = (): Status => ({
      ...IDENTITY, startedAt: STARTED_AT, running: !ready,
      ...(ready ? { sourceState: "ready", readySourceDocId: DOC, message: "Exact fixture manual is ready in Sources." } : { sourceState: "preparing", message: "Preparing the fixture manual." }),
    });
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const p = url.pathname.replace(/(.)\/$/, "$1");
      const method = request.method();
      if (p === "/api/auth/session") return route.fulfill(json({ user: { name: "Technician" }, expires: "2099-01-01T00:00:00Z" }));
      if (p === "/api/auth/_log") return route.fulfill(json({}));
      if (p === "/api/equipment-notebooks") return route.fulfill(json({ notebooks: [notebook] }));
      if (p === `${nbPath}/components`) {
        await scope.promise;
        return route.fulfill(json({ components: [], selection: null, selectionVersion: null, headings: [] }));
      }
      if (p === `${nbPath}/look`) {
        looks += 1;
        return route.fulfill(json({
          fileId: FILE, attachment: { linkId: "attachment" }, observationPersisted: true,
          observation: { text: "AutomationDirect, MODEL: GS11N-20P2", capturedAt: STARTED_AT },
        }));
      }
      if (p === `${nbPath}/chat` && method === "POST") {
        const sent = request.postDataJSON();
        chatBodies.push({ ...sent, manualWait: request.headers()["x-mira-manual-wait"] ?? null });
        if (failNext) {
          failNext = false;
          return route.fulfill(json({ error: "upstream" }, 500));
        }
        if (withheld && !sent.sourceDocIds.includes(DOC)) {
          // Main's reply once the lookup has finished but the question went without its manual.
          const text = ready ? FOUND_REPLY : RUNNING_REPLY;
          answered.push(savedDecline(sent, text));
          return route.fulfill(decline(text));
        }
        answered.push({
          id: `saved-${sent.clientRequestId}`, clientRequestId: sent.clientRequestId, question: sent.message,
          answerStatus: "answered", answerText: ANSWER, evidence: [CITATION], createdAt: STARTED_AT,
        });
        return route.fulfill(stream(
          { kind: "content", content: ANSWER },
          { kind: "sources", citations: [CITATION] },
          { kind: "status", status: "answered" },
        ));
      }
      if (p === nbPath && method === "GET") {
        expect(url.searchParams.get("threadId")).toBe(THREAD);
        reads += 1;
        if (reads === 1) await detailHeld.promise;
        return route.fulfill(json({
          ...oracle.detailEmpty, notebook, sources: ready || !withheld ? [SOURCE] : [],
          ...(withheld
            // As the detail route does in a look-alike thread: the project's status is withheld.
            ? { turns: [savedLookAlike, ...answered], manualSearch: null, manualSearchScope: "other_model" }
            : { turns: answered, manualSearch: null }),
        }));
      }
      return route.fulfill(json({}, 404));
    });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    const composer = page.getByRole("textbox", { name: "Ask MIRA", exact: true });
    const chat = page.getByRole("region", { name: "Conversation" });
    const sendButton = page.getByRole("button", { name: "Send", exact: true });
    const stopButton = page.getByRole("button", { name: "Stop", exact: true });
    const tryAgain = page.getByRole("button", { name: "Try again", exact: true });

    if (mode === "detail-late") {
      // Sent before the project's detail has loaded: the composer keeps it, and nothing goes.
      await composer.fill(OWN_MODEL_QUESTION);
      await sendButton.click();
      await page.waitForTimeout(1_000);
      expect(reads).toBe(1);
      expect(chatBodies).toHaveLength(0);
      await expect(composer).toHaveValue(OWN_MODEL_QUESTION);
      detailHeld.release();
      await expect.poll(() => chatBodies.length, { timeout: 15_000 }).toBe(1);
      expect(chatBodies[0]).toMatchObject({ message: OWN_MODEL_QUESTION, threadId: THREAD, sourceDocIds: [DOC], manualWait: null });
      await expect(page.getByText(ANSWER.replace(" [1]", ""), { exact: false })).toBeVisible();
      await expect(composer).toHaveValue("");
      await page.waitForTimeout(1_000);
      expect(chatBodies).toHaveLength(1);
      return;
    }

    if (mode === "photo-retry") {
      // A photo send waits for the question target, which this spec holds.
      await page.getByRole("button", { name: "Add attachment", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Photo", exact: true }).click();
      await (await chooser).setFiles({ name: "nameplate.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic nameplate bytes") });
      const pending = page.getByRole("list", { name: "Pending attachments" });
      await expect(pending.getByText("nameplate.jpg")).toBeVisible();
      await composer.fill(PHOTO_QUESTION);
      await sendButton.click();
      await stopButton.click();
      await expect(page.getByText(PAUSED)).toBeVisible();
      // Stopped, not sent: the Stop click did not submit the draft.
      await expect(stopButton).toHaveCount(0);
      await expect(pending.getByText("nameplate.jpg")).toBeVisible();
      await tryAgain.click();
      await expect(stopButton).toBeVisible();
      await expect(page.getByText(PAUSED)).toHaveCount(0);
      expect(looks).toBe(0);
      scope.release();
      await expect.poll(() => looks, { timeout: 15_000 }).toBe(1);
      await expect.poll(() => chatBodies.length, { timeout: 15_000 }).toBe(1);
      await expect(pending.getByText("nameplate.jpg")).toHaveCount(0);
      expect(chatBodies[0]).toMatchObject({ message: PHOTO_QUESTION, manualWait: null });
      return;
    }

    if (mode === "retire") {
      // A question waits for its target and is stopped: paused, its Try again the draft's own.
      await composer.fill(OTHER_QUESTION);
      await sendButton.click();
      await stopButton.click();
      await expect(page.getByText(PAUSED)).toBeVisible();
      // The target is read, and the technician sends a different question instead. It starts, so
      // the pause ends; it fails on the way to chat, and its own Try again is offered.
      scope.release();
      failNext = true;
      await composer.fill(OWN_MODEL_QUESTION);
      await sendButton.click();
      await expect.poll(() => chatBodies.length, { timeout: 15_000 }).toBe(1);
      expect(chatBodies[0]).toMatchObject({ message: OWN_MODEL_QUESTION, manualWait: null });
      await expect(page.getByText(PAUSED)).toHaveCount(0);
      await expect(tryAgain).toBeVisible();
      await tryAgain.click();
      await expect.poll(() => chatBodies.length, { timeout: 15_000 }).toBe(2);
      expect(chatBodies[1]).toMatchObject({ message: OWN_MODEL_QUESTION });
      // The stopped question was never sent.
      expect(chatBodies.filter(body => body.message === OTHER_QUESTION)).toHaveLength(0);
      return;
    }

    // withheld-lands-unseen: opened while the lookup runs, in a look-alike thread.
    await expect(page.getByText(savedLookAlike.question, { exact: true })).toBeVisible();
    const statusParts = page.locator('[data-part-type="manual_search_status"]');
    await expect(statusParts).toHaveCount(0);
    // The manual lands. The status is withheld here, so nothing follows the lookup, and nothing
    // reads the project on a timer.
    const readsAtLoad = reads;
    ready = true;
    await page.waitForTimeout(6_000);
    expect(reads).toBe(readsAtLoad);
    // The question goes with the sources the page holds (none), and gets main's reply.
    await composer.fill(OWN_MODEL_QUESTION);
    await sendButton.click();
    await expect(chat.getByText(FOUND_REPLY, { exact: true }).last()).toBeVisible();
    expect(chatBodies).toEqual([expect.objectContaining({ message: OWN_MODEL_QUESTION, sourceDocIds: [], manualWait: null })]);
    // That answer's history read brings the manual in; asked again without reopening, it cites it.
    await expect.poll(() => reads, { timeout: 15_000 }).toBeGreaterThan(readsAtLoad);
    await composer.fill(OWN_MODEL_QUESTION);
    await sendButton.click();
    await expect.poll(() => chatBodies.length, { timeout: 15_000 }).toBe(2);
    expect(chatBodies[1]).toMatchObject({ message: OWN_MODEL_QUESTION, sourceDocIds: [DOC], manualWait: null });
    await expect(page.getByRole("button", { name: /^Open citation 1: Exact GS10 fixture, page 1$/ })).toBeVisible();
    await expect(statusParts).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("thread")).toBe(THREAD);
  });
}
