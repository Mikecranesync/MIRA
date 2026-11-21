import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { DOC, FILE, NB, oracle } from "../fidelity/harness";

const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";
const TENANT = "11111111-1111-4111-8111-111111111111";
const THREAD = "manual-handoff";
const LOOKUP = "Find me the manual for this drive.";
const QUESTION = "According to the manual, what is the nominal bus voltage?";
const SAFETY_QUESTION = "According to the manual, can I work on the energized 480V panel?";
const TITLE = "Exact GS10 fixture";
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

for (const mode of ["preparing", "ready", "opening", "safety"] as const) {
  test(`exact manual handoff in the ${mode} case`, async ({ page, context, baseURL }) => {
    const opening = mode === "opening";
    const safety = mode === "safety";
    const token = await encode({
      token: { uid: "e2e-manual-handoff", tid: TENANT, status: "trial", trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      secret: AUTH_SECRET,
    });
    await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL }]);
    const pdf = await readFile(path.join(__dirname, "../equipment/fixtures/diagnostic-fixture.pdf"));
    const scopeRequested = latch();
    const scope = latch();
    const answerHistory = latch();
    const initialDetail = latch();
    let confirmed = opening;
    let ready = false;
    let looks = 0;
    let failFirstHistory = true;
    let savedAnswerReads = 0;
    let lookup: { clientRequestId: string } | undefined;
    let asked: { clientRequestId: string } | undefined;
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
        return route.fulfill(json({ components: [], selection: null, selectionVersion: null, headings: [] }));
      }
      if (p === `${nbPath}/look`) {
        looks += 1;
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
        if (body.message === SAFETY_QUESTION) return route.fulfill(stream(
          { kind: "content", content: "Make the equipment safe before working on it." },
          { kind: "safety", trigger: "energized-electrical-hazard" },
          { kind: "status", status: "answered" },
        ));
        asked = body;
        return route.fulfill(stream(
          { kind: "content", content: ANSWER },
          { kind: "sources", citations: [CITATION] },
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
          answerText: ANSWER, evidence: [CITATION], createdAt: new Date().toISOString(),
        };
        return route.fulfill(json({
          ...oracle.detailEmpty,
          notebook: confirmed ? { ...notebook, ...IDENTITY, identityStatus: "user_confirmed" } : notebook,
          turns: [savedLookup, savedAnswer].filter(Boolean),
          sources: ready ? [SOURCE] : [],
          manualSearch: confirmed ? {
            ...IDENTITY, startedAt: STARTED_AT, running: !ready,
            ...(ready ? { sourceState: "ready", readySourceDocId: DOC, message: "Exact fixture manual is ready in Sources." } :
              { sourceState: "preparing", message: "Preparing the fixture manual." }),
          } : null,
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
    if (!opening) {
      await page.getByRole("button", { name: "Add attachment", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Photo", exact: true }).click();
      await (await chooser).setFiles({ name: "nameplate.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic nameplate bytes") });
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
    if (mode === "ready") {
      ready = true;
      await expect(sourceReady).toBeVisible();
    }
    await composer.fill(safety ? SAFETY_QUESTION : QUESTION);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    if (opening) {
      await expect(composer).toHaveValue(QUESTION);
      expect(chatBodies).toHaveLength(0);
      initialDetail.release();
      scope.release();
      await expect(page.getByText(/Searching AutomationDirect/).last()).toBeVisible();
    }
    if (safety) {
      await expect(page.getByText("Make the equipment safe before working on it.", { exact: true })).toBeVisible();
      expect(chatBodies.at(-1)).toMatchObject({ message: SAFETY_QUESTION, sourceDocIds: [] });
      expect(ready).toBe(false);
      return;
    }
    if (mode !== "ready") {
      await expect(composer).toHaveValue(QUESTION);
      expect(chatBodies).toHaveLength(opening ? 0 : 1);
      ready = true;
    }

    const citation = page.getByRole("button", { name: /^Open citation 1: Exact GS10 fixture, page 1$/ });
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
