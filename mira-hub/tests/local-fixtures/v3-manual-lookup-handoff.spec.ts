import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Request } from "@playwright/test";
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

// #5746 (option A): the chat route decides whether a manual question can be answered now
// (`manualWaitDecision` in capabilities/send-wait-subject.ts, pinned in its own tests). This fake
// makes the same decision for the questions this spec asks: only when the Hub asks for it
// (`x-mira-manual-wait: 1`) and the question asks for the manual. A safety ask, a photo, a guided
// hand-off or a component turn keeps its own path, and a question about another exact model (the
// look-alike) is answered. A refused post is kept apart from the answered ones.
type Sent = { message: string; threadId: string; sourceDocIds: string[]; clientRequestId: string; wait: string | null; reason?: string };
type Status = {
  manufacturer: string; model: string; startedAt?: string; running: boolean;
  sourceState?: string; readySourceDocId?: string; message?: string; manualUrl?: string;
};
type Refusal = { error: "manual_not_ready" | "manual_unavailable"; reason: string; lookup: Omit<Status, "message" | "manualUrl"> | null };
const waitHeader = (request: Request) => request.headers()["x-mira-manual-wait"] ?? null;
const asksForManual = (message: string) => /\bthe manual\b/i.test(message) && !/\benergized\b/i.test(message);
function manualWait(request: Request, sent: Record<string, unknown>, status: Status | null | "read_failed"): Refusal | null {
  const body = sent as { message?: string; visualEvidence?: unknown; guidedEscalation?: unknown; componentSelection?: { componentId?: string | null }; sourceDocIds?: string[] };
  const message = String(body.message ?? "");
  if (waitHeader(request) !== "1" || !asksForManual(message)) return null;
  if (body.visualEvidence || body.guidedEscalation || body.componentSelection?.componentId) return null;
  if (status === "read_failed") return { error: "manual_unavailable", reason: "unknown", lookup: null };
  if (!status || /GS11N-20P25/.test(message)) return null;
  const { message: _shown, manualUrl: _link, ...lookup } = status;
  void _shown; void _link;
  if (status.running) return { error: "manual_not_ready", reason: "running", lookup };
  if (status.sourceState === "ready") {
    return (body.sourceDocIds ?? []).includes(String(status.readySourceDocId)) ? null : { error: "manual_not_ready", reason: "ready_not_sent", lookup };
  }
  if (status.sourceState === "unavailable") return { error: "manual_unavailable", reason: "unavailable", lookup };
  return null;
}
// As the route answers it: inside the progress stream (the Hub always asks for it), or plain.
const refusal = (held: Refusal, transport: "stream" | "json" = "stream") =>
  transport === "json" ? json(held, 409) : stream({ kind: "http_error", status: 409, body: held });
const UNAVAILABLE = "This project's manual isn't available, so MIRA didn't answer from it.";

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
    const chatBodies: Sent[] = [];
    const refused: Sent[] = [];
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
        const held = manualWait(request, body, projectStatus());
        if (held) {
          refused.push({ ...body, wait: waitHeader(request), reason: held.reason });
          return route.fulfill(refusal(held));
        }
        chatBodies.push({ ...body, wait: waitHeader(request) });
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
      expect(refused).toEqual([]);
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
        // The route holds it: the manual is unavailable. Paused at once, the question kept.
        const banner = page.getByRole("alert", { name: "Send error" });
        await expect(banner.getByText("Send paused", { exact: true })).toBeVisible();
        await expect(banner.getByText(UNAVAILABLE, { exact: false })).toBeVisible();
        await expect(composer).toHaveValue(QUESTION);
        expect(chatBodies).toHaveLength(0);
        expect(refused).toEqual([expect.objectContaining({ message: QUESTION, wait: "1", reason: "unavailable" })]);
        // Send without the manual is offered only while the draft is that question, unedited (#5686:
        // an edited draft is a new draft, even if its text comes back).
        const withoutManual = banner.getByRole("button", { name: "Send without the manual", exact: true });
        await expect(withoutManual).toBeVisible();
        const edited = `${QUESTION} Thanks.`;
        await composer.fill(edited);
        await expect(withoutManual).toHaveCount(0);
        // The edited question goes through the route again and is paused again, its draft kept.
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect.poll(() => refused.length).toBe(2);
        expect(refused[1]).toMatchObject({ message: edited, wait: "1", reason: "unavailable" });
        await expect(composer).toHaveValue(edited);
        expect(chatBodies).toHaveLength(0);
        // One send without the wait, answered as main answers it; never asked with the wait again.
        await withoutManual.click();
        await expect.poll(() => chatBodies.length).toBe(1);
        expect(chatBodies[0]).toMatchObject({ message: edited, wait: null });
        expect(refused).toHaveLength(2);
        await expect(composer).toHaveValue("");
        return;
      }
    }
    if (safety) {
      await expect(page.getByText("Make the equipment safe before working on it.", { exact: true })).toBeVisible();
      expect(chatBodies.at(-1)).toMatchObject({ message: SAFETY_QUESTION, sourceDocIds: [] });
      expect(refused).toEqual([]);
      expect(ready).toBe(false);
      return;
    }
    if (mode !== "ready" && !attachedSafety) {
      // Held by the route while the manual is prepared: nothing answered, the question kept.
      await expect.poll(() => refused.length).toBe(1);
      expect(refused[0]).toMatchObject({ message: QUESTION, wait: "1", reason: "running" });
      await expect(composer).toHaveValue(QUESTION);
      expect(chatBodies).toHaveLength(opening ? 0 : 1);
      ready = true;
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
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await secondLookRequested.promise;
      expect(refused).toEqual([]);
      secondLook.release();
      await expect(page.getByText("Make the equipment safe before working on it.", { exact: true })).toBeVisible();
      expect(chatBodies.at(-1)).toMatchObject({ message: SAFETY_QUESTION, sourceDocIds: [], wait: null });
      expect(refused).toEqual([]);
      expect(looks).toBe(2);
      return;
    }
    await citation.click();
    expect(chatBodies).toEqual([
      ...(opening ? [] : [expect.objectContaining({ message: LOOKUP, sourceDocIds: [], threadId: THREAD })]),
      // Asked once more, with the manual, by the same send path (the wait header on).
      expect.objectContaining({ message: QUESTION, sourceDocIds: [DOC], threadId: THREAD, wait: "1" }),
    ]);
    expect(refused).toHaveLength(mode === "ready" ? 0 : 1);
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
// project's status from display (#5750). A whole-machine question that needs the manual is still
// held for it by the chat route, and the Hub follows the lookup the detail read names for that
// wait only (`wholeMachineManualSearch`, no message or link); nothing new is shown.
const WHOLE_QUESTION = "According to the manual, what is the nominal supply voltage?";
const GENERAL_QUESTION = "What is the rated current?";
// #5746 round 5 F6: another session starts a newer lookup just before the Hub's poll budget for
// the first one runs out.
const NEWER_STARTED_AT = "2026-11-21T12:05:00.000Z";
for (const mode of ["return", "return-lost", "cold", "controls", "newer-lookup"] as const) {
  const title = mode === "controls"
    ? "after a component answer, a component question and a question that needs no manual are sent at once"
    : mode === "newer-lookup"
      ? "after a component answer, a whole-machine manual question waits for a newer lookup started as the first one times out"
      : `after a component answer, a whole-machine manual question waits in the ${mode} case`;
  test(title, async ({ page, context, baseURL }) => {
    const newer = mode === "newer-lookup";
    const cold = mode === "cold" || newer;
    await installSessionCookie(context, baseURL, PORT, {
      uid: "e2e-manual-handoff", tid: TENANT, status: "trial", trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    let componentSelected = !cold;
    let ready = false;
    let lost = false;
    let startedAt = STARTED_AT;
    let asked: { clientRequestId: string } | undefined = cold ? { clientRequestId: "saved-component-question" } : undefined;
    let withheldReads = 0;
    const chatBodies: Sent[] = [];
    const refused: Sent[] = [];
    const lookupStatus = (): Status => ({
      ...IDENTITY, startedAt, running: !ready && !lost,
      ...(ready ? { sourceState: "ready", readySourceDocId: DOC } : lost ? { sourceState: "unavailable" } : { sourceState: "preparing" }),
    });
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
        const held = manualWait(request, body, lookupStatus());
        if (held) {
          refused.push({ ...body, wait: waitHeader(request), reason: held.reason });
          return route.fulfill(refusal(held));
        }
        chatBodies.push({ ...body, wait: waitHeader(request) });
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
        const sources = [componentSource, ...(ready ? [SOURCE] : [])];
        if (!savedAnswer) {
          // The newest answer is the lookup: the status is shown under it, as before.
          return route.fulfill(json({
            ...oracle.detailEmpty, notebook, turns: [savedLookup], sources,
            manualSearch: { ...lookupStatus(), message: "Preparing the fixture manual." },
            manualSearchAnswer: { turnId: savedLookup.id, clientRequestId: savedLookup.clientRequestId },
          }));
        }
        // As the detail route does: the newest answer was asked under the component, so the
        // project's status is withheld from display, and only the Hub's manual wait gets the lookup.
        withheldReads += 1;
        return route.fulfill(json({
          ...oracle.detailEmpty, notebook, turns: [savedLookup, savedAnswer], sources,
          manualSearch: null, manualSearchScope: "other_model", wholeMachineManualSearch: lookupStatus(),
        }));
      }
      return route.fulfill(json({}, 404));
    });
    // The poll waits 4s, then 10s, between reads: the newer-lookup case jumps the page's clock
    // forward instead of waiting three minutes. Time otherwise runs as normal.
    if (newer) await page.clock.install();
    const advanceUntil = (reached: () => boolean) => expect.poll(async () => {
      if (!reached()) await page.clock.fastForward(5_000);
      return reached();
    }, { timeout: 60_000, intervals: [100] }).toBe(true);
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
        expect(refused).toEqual([]);
        return;
      }
    } else {
      await expect.poll(() => withheldReads).toBeGreaterThan(0);
      await expect(page.locator('[data-turn-id="saved-answer-a"]')).toHaveCount(1);
    }
    if (newer) {
      // The first read and 17 polls follow the first lookup, whose budget is 21 polls. Then
      // another session starts a newer one, and the polls go on past the first budget.
      await advanceUntil(() => withheldReads >= 18);
      startedAt = NEWER_STARTED_AT;
      await advanceUntil(() => withheldReads >= 22);
    }
    const before = chatBodies.length;
    await composer.fill(WHOLE_QUESTION);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    // Held by the route: the newest answer was about the component, and this question is about the
    // whole machine, whose lookup is still preparing.
    if (newer) await page.waitForTimeout(1_000);
    await expect.poll(() => refused.length).toBe(1);
    expect(refused[0]).toMatchObject({ message: WHOLE_QUESTION, wait: "1", reason: "running" });
    expect(chatBodies).toHaveLength(before);
    // Held: a further read happens and still nothing is answered; nothing new is shown.
    const readsAtSend = withheldReads;
    if (newer) await advanceUntil(() => withheldReads > readsAtSend);
    else await expect.poll(() => withheldReads, { timeout: 15_000 }).toBeGreaterThan(readsAtSend);
    expect(chatBodies).toHaveLength(before);
    await expect(composer).toHaveValue(WHOLE_QUESTION);
    await expect(statusParts).toHaveCount(0);
    if (mode === "return-lost") {
      lost = true;
      // The lookup settles as unavailable: asked once more, held again, and paused. No loop.
      await expect(page.getByText(UNAVAILABLE, { exact: false })).toBeVisible({ timeout: 15_000 });
      await expect(composer).toHaveValue(WHOLE_QUESTION);
      expect(chatBodies).toHaveLength(before);
      expect(refused.map(held => held.reason)).toEqual(["running", "unavailable"]);
      await expect(page.getByRole("button", { name: "Send without the manual", exact: true })).toBeVisible();
      await page.waitForTimeout(3_000);
      expect(refused).toHaveLength(2);
      return;
    }
    ready = true;
    if (newer) await advanceUntil(() => chatBodies.some(body => body.message === WHOLE_QUESTION));
    await expect.poll(() => chatBodies.filter(body => body.message === WHOLE_QUESTION).length, { timeout: 20_000 }).toBe(1);
    expect(chatBodies).toHaveLength(before + 1);
    expect(chatBodies.at(-1)).toMatchObject({ message: WHOLE_QUESTION, threadId: THREAD, wait: "1" });
    expect(chatBodies.at(-1)!.sourceDocIds).toContain(DOC);
    expect(refused).toHaveLength(1);
  });
}

// #5746 round 6 F1 / option A: in a thread that asked about a look-alike model, the project's
// status is withheld (#5750). A question that names the project's own model still needs its manual:
// the chat route holds it while the manual is prepared (faked above, as the route decides), the Hub
// follows the project's readiness (`projectManualReadiness`) and asks once more when it settles.
// Round 6 F7 / round 7 F7: Try again goes through the same route, and keeps an attached photo.
const OWN_MODEL_QUESTION = "According to the manual, what is the acceleration parameter for the GS11N-20P2?";
const LOOK_ALIKE_QUESTION = "According to the manual, what is the acceleration parameter for the GS11N-20P25?";
const PHOTO_QUESTION = "What does this nameplate say?";
// The composer's own pause (a send waiting for its question target), and a held question's Stop.
const PAUSED = "Send paused. Your message and attachments are still here.";
const STOPPED = "You stopped the wait for the manual.";
const TITLES = {
  own: "after a look-alike question, a question naming the project's model is held until its manual is ready",
  "own-plain-409": "the same hold works when the route's refusal comes as a plain 409",
  "look-alike": "after a look-alike question, a question naming the look-alike is answered at once",
  "read-fails": "when the route cannot read the manual's state, the send pauses and Send without the manual asks once",
  "stop-retry": "Stop pauses a held question, nothing polls, and Try again once the manual is ready sends it with the manual",
  "photo-retry": "Stop then Try again keeps the attached photo, and a photo send is never held",
  "retry-after-failure": "a new send retires an earlier failure's Try again, so Try again asks the held question",
  "detail-late": "a question sent while the project is still opening is held once it loads",
  "ready-unseen": "a question sent with a stale read of a ready manual is held, re-read, and sent with it",
  "reread-hangs": "Stop during a re-read that never answers pauses, and Try again sends it with the manual",
} as const;
for (const mode of Object.keys(TITLES) as (keyof typeof TITLES)[]) {
  test(TITLES[mode], async ({ page, context, baseURL }) => {
    await installSessionCookie(context, baseURL, PORT, {
      uid: "e2e-manual-handoff", tid: TENANT, status: "trial", trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const scope = latch();
    const detailHeld = latch();
    const rereadHeld = latch();
    let holdNextRead = false;
    if (mode !== "photo-retry") scope.release();
    if (mode !== "detail-late") detailHeld.release();
    let ready = false;
    let reads = 0;
    let looks = 0;
    const chatBodies: Sent[] = [];
    const refused: Sent[] = [];
    const notebook = { ...oracle.detailEmpty.notebook, displayName: "Manual handoff fixture", sourceCount: 0, ...IDENTITY, identityStatus: "user_confirmed" };
    const nbPath = `/api/equipment-notebooks/${NB}`;
    const savedLookAlike = {
      id: "saved-look-alike", clientRequestId: "look-alike", question: "Find me the manual for AutomationDirect GS11N-20P25",
      answerStatus: "insufficient_evidence", answerText: "No manual is attached for that model.", evidence: [], createdAt: STARTED_AT,
    };
    // Each answered question is saved, as the chat route does, so the Hub's history reload finds it
    // and stops; the only reads left on a timer are the manual wait's.
    const answered: (typeof savedLookAlike)[] = [];
    const lookupStatus = (): Status => ({
      ...IDENTITY, startedAt: STARTED_AT, running: !ready,
      ...(ready ? { sourceState: "ready", readySourceDocId: DOC } : { sourceState: "preparing" }),
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
        const held = manualWait(request, sent, mode === "read-fails" ? "read_failed" : lookupStatus());
        if (held) {
          refused.push({ ...sent, wait: waitHeader(request), reason: held.reason });
          return route.fulfill(refusal(held, mode === "own-plain-409" ? "json" : "stream"));
        }
        chatBodies.push({ ...sent, wait: waitHeader(request) });
        if (mode === "retry-after-failure" && chatBodies.length === 1) return route.fulfill(json({ error: "upstream" }, 500));
        answered.push({
          id: `saved-${sent.clientRequestId}`, clientRequestId: sent.clientRequestId, question: sent.message,
          answerStatus: "answered", answerText: ANSWER, evidence: [], createdAt: STARTED_AT,
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
        if (holdNextRead) {
          holdNextRead = false;
          await rereadHeld.promise;
        }
        // As the detail route does in a look-alike thread: the status is withheld from display,
        // and only the project's readiness is named, without a message or a link.
        // A held read the page has since given up on may no longer be answerable.
        return route.fulfill(json({
          ...oracle.detailEmpty, notebook, turns: [savedLookAlike, ...answered], sources: ready ? [SOURCE] : [],
          manualSearch: null, manualSearchScope: "other_model", projectManualReadiness: lookupStatus(),
        })).catch(() => undefined);
      }
      return route.fulfill(json({}, 404));
    });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    const composer = page.getByRole("textbox", { name: "Ask MIRA", exact: true });
    const statusParts = page.locator('[data-part-type="manual_search_status"]');
    const sendButton = page.getByRole("button", { name: "Send", exact: true });
    const stopButton = page.getByRole("button", { name: "Stop", exact: true });
    const tryAgain = page.getByRole("button", { name: "Try again", exact: true });
    const withoutManual = page.getByRole("button", { name: "Send without the manual", exact: true });
    if (mode === "detail-late") {
      // Sent before the project's detail has loaded: the composer waits for it, and nothing goes.
      await composer.fill(OWN_MODEL_QUESTION);
      await sendButton.click();
      await page.waitForTimeout(1_000);
      expect(reads).toBe(1);
      expect(refused).toEqual([]);
      expect(chatBodies).toHaveLength(0);
      detailHeld.release();
    }
    await expect(page.getByText(savedLookAlike.question, { exact: true })).toBeVisible();
    await expect(statusParts).toHaveCount(0);

    if (mode === "ready-unseen" || mode === "reread-hangs") {
      // The manual becomes ready while nothing waits, so nothing polls this thread: the page
      // still holds the read that said preparing, with no source to send.
      const readsAtLoad = reads;
      ready = true;
      await page.waitForTimeout(1_500);
      expect(reads).toBe(readsAtLoad);
      holdNextRead = mode === "reread-hangs";
      await composer.fill(OWN_MODEL_QUESTION);
      await sendButton.click();
      // Sent with that read: the route holds it, the manual ready but not in the request (r7 F9).
      await expect.poll(() => refused.length).toBe(1);
      expect(refused[0]).toMatchObject({ message: OWN_MODEL_QUESTION, sourceDocIds: [], wait: "1", reason: "ready_not_sent" });
      if (mode === "reread-hangs") {
        // The re-read the wait asks for never answers. Stop pauses the question, its draft kept.
        await expect.poll(() => reads).toBe(readsAtLoad + 1);
        await stopButton.click();
        await expect(page.getByText(STOPPED, { exact: false })).toBeVisible();
        await expect(composer).toHaveValue(OWN_MODEL_QUESTION);
        expect(chatBodies).toHaveLength(0);
        // Try again asks the route again, one post, which holds it again; this re-read answers.
        await tryAgain.click();
        await expect.poll(() => refused.length).toBe(2);
      }
      await expect.poll(() => chatBodies.length, { timeout: 15_000 }).toBe(1);
      expect(chatBodies[0]).toMatchObject({ message: OWN_MODEL_QUESTION, threadId: THREAD, wait: "1" });
      expect(chatBodies[0].sourceDocIds).toContain(DOC);
      expect(refused).toHaveLength(mode === "reread-hangs" ? 2 : 1);
      rereadHeld.release();
      return;
    }

    if (mode === "photo-retry") {
      // A photo send waits only for the question target, which this spec holds.
      await page.getByRole("button", { name: "Add attachment", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Photo", exact: true }).click();
      await (await chooser).setFiles({ name: "nameplate.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic nameplate bytes") });
      const pending = page.getByRole("list", { name: "Pending attachments" });
      await expect(pending.getByText("nameplate.jpg")).toBeVisible();
      await composer.fill(PHOTO_QUESTION);
      await sendButton.click();
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(page.getByText(PAUSED)).toBeVisible();
      // Stopped, not held again: the Stop click did not submit the draft.
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
      // A send with attachments keeps main's path: it never asks the route to hold it.
      expect(chatBodies[0]).toMatchObject({ message: PHOTO_QUESTION, wait: null });
      expect(refused).toEqual([]);
      return;
    }

    if (mode === "look-alike") {
      await composer.fill(LOOK_ALIKE_QUESTION);
      await sendButton.click();
      await expect.poll(() => chatBodies.length, { timeout: 5_000 }).toBe(1);
      expect(chatBodies[0]).toMatchObject({ message: LOOK_ALIKE_QUESTION, threadId: THREAD, wait: "1" });
      expect(refused).toEqual([]);
      return;
    }

    if (mode === "read-fails") {
      // The route cannot read the manual's state: it holds the question rather than answer it.
      await composer.fill(OWN_MODEL_QUESTION);
      await sendButton.click();
      await expect(page.getByText("Send paused", { exact: true })).toBeVisible();
      await expect(page.getByText(UNAVAILABLE, { exact: false })).toBeVisible();
      expect(refused).toEqual([expect.objectContaining({ message: OWN_MODEL_QUESTION, wait: "1", reason: "unknown" })]);
      expect(chatBodies).toHaveLength(0);
      await expect(composer).toHaveValue(OWN_MODEL_QUESTION);
      // No wait for a lookup that cannot be read: nothing more is asked on a timer.
      await page.waitForTimeout(3_000);
      expect(refused).toHaveLength(1);
      // One send without the wait: asked once, and the composer is clear.
      await withoutManual.click();
      await expect.poll(() => chatBodies.length).toBe(1);
      expect(chatBodies[0]).toMatchObject({ message: OWN_MODEL_QUESTION, wait: null });
      await expect(composer).toHaveValue("");
      await expect(withoutManual).toHaveCount(0);
      expect(refused).toHaveLength(1);
      return;
    }

    if (mode === "stop-retry" || mode === "retry-after-failure") {
      if (mode === "retry-after-failure") {
        // An earlier question fails on the way to chat; its own retry is offered.
        await composer.fill(GENERAL_QUESTION);
        await sendButton.click();
        await expect.poll(() => chatBodies.length, { timeout: 5_000 }).toBe(1);
        await expect(tryAgain).toBeVisible();
      }
      const answeredBefore = chatBodies.length;
      // A new send retires that Try again (r7 F7); the route holds this one.
      await composer.fill(OWN_MODEL_QUESTION);
      await sendButton.click();
      await expect.poll(() => refused.length).toBe(1);
      expect(refused[0]).toMatchObject({ message: OWN_MODEL_QUESTION, wait: "1", reason: "running" });
      const readsAtHold = reads;
      await expect.poll(() => reads, { timeout: 15_000 }).toBeGreaterThan(readsAtHold);
      await stopButton.click();
      await expect(page.getByText(STOPPED, { exact: false })).toBeVisible();
      await expect(stopButton).toHaveCount(0);
      await expect(withoutManual).toBeVisible();
      await expect(composer).toHaveValue(OWN_MODEL_QUESTION);
      // Paused: nothing reads the project on a timer, and nothing is asked.
      ready = true;
      const readsAtStop = reads;
      await page.waitForTimeout(5_000);
      expect(reads).toBe(readsAtStop);
      expect(refused).toHaveLength(1);
      expect(chatBodies).toHaveLength(answeredBefore);
      // Try again is one post, through the composer, with the read the page holds (preparing, no
      // source): the route holds it as ready but not sent, the Hub reads again, and asks once more.
      await tryAgain.click();
      await expect.poll(() => refused.length).toBe(2);
      expect(refused[1]).toMatchObject({ message: OWN_MODEL_QUESTION, wait: "1", reason: "ready_not_sent" });
      await expect.poll(() => chatBodies.length, { timeout: 15_000 }).toBe(answeredBefore + 1);
      expect(chatBodies.at(-1)).toMatchObject({ message: OWN_MODEL_QUESTION, wait: "1" });
      expect(chatBodies.at(-1)!.sourceDocIds).toContain(DOC);
      // The earlier failed question was never asked again.
      expect(chatBodies.filter(body => body.message === GENERAL_QUESTION)).toHaveLength(answeredBefore);
      return;
    }

    // own, own-plain-409, detail-late: held while the manual is prepared, then asked once more with it.
    if (mode !== "detail-late") {
      await composer.fill(OWN_MODEL_QUESTION);
      await sendButton.click();
    }
    await expect.poll(() => refused.length).toBe(1);
    expect(refused[0]).toMatchObject({ message: OWN_MODEL_QUESTION, threadId: THREAD, wait: "1", reason: "running" });
    // Held: the Hub reads the project's lookup again, and nothing is answered or shown.
    const readsAtHold = reads;
    await expect.poll(() => reads, { timeout: 15_000 }).toBeGreaterThan(readsAtHold);
    expect(chatBodies).toHaveLength(0);
    await expect(composer).toHaveValue(OWN_MODEL_QUESTION);
    await expect(statusParts).toHaveCount(0);
    ready = true;
    await expect.poll(() => chatBodies.length, { timeout: 20_000 }).toBe(1);
    expect(chatBodies[0]).toMatchObject({ message: OWN_MODEL_QUESTION, threadId: THREAD, wait: "1" });
    expect(chatBodies[0].sourceDocIds).toContain(DOC);
    expect(refused).toHaveLength(1);
    await expect(page.getByText(ANSWER.replace(" [1]", ""), { exact: false })).toBeVisible();
    await expect(composer).toHaveValue("");
    if (mode === "own") {
      // The wait ends with the question it held: once answered, nothing reads the project again on
      // a timer.
      await page.waitForTimeout(1_000);
      const readsAfterAnswer = reads;
      await page.waitForTimeout(6_000);
      expect(reads).toBe(readsAfterAnswer);
    }
  });
}
