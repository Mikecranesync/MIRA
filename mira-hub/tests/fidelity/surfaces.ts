/**
 * The two surfaces under comparison (ADR-0038): how to open a notebook, send a
 * message, and extract one normalized rendered-turn record from each. Only the
 * selectors differ; the record shape is shared so records compare directly.
 */
import type { Locator, Page } from "@playwright/test";
import { NB } from "./harness";

export type Surface = "reference" | "clone";

export type TurnRecord = {
  answer: string | null;
  citations: { n: string; title: string; page: string | null }[];
  safety: { present: boolean; kind: "stop" | "warning" | null; first: boolean | null };
  evidence: string | null;
};

type Ui = {
  url: string;
  composer: (p: Page) => Locator;
  /** Visible once the notebook detail (and its 1 enabled source) has loaded. */
  ready: (p: Page) => Locator;
  /** The newest assistant turn, once it has finished streaming. */
  settled: (p: Page) => Promise<Locator>;
  answer: string;
  safety: string;
  evidence: string;
  /** After a citation click: the frame showing the cited document. */
  viewerFrame: (p: Page) => Locator;
};

export const UI: Record<Surface, Ui> = {
  // Classic notebook chat: (hub)/equipment/[id] → components/equipment/NotebookChat.tsx
  reference: {
    url: `/hub/equipment/${NB}/`,
    composer: (p) => p.getByRole("textbox", { name: "Ask this machine anything" }),
    ready: (p) => p.getByRole("button", { name: /Sources · 1\/1/ }),
    settled: async (p) => {
      const log = p.getByTestId("notebook-chat-log");
      await log.and(p.locator(':not([aria-busy="true"])')).waitFor({ timeout: 30_000 });
      await log.getByTestId("answer-body").last().waitFor({ timeout: 30_000 });
      return log;
    },
    answer: '[data-testid="answer-body"]',
    safety: '[data-testid="safety-notice-banner"], [data-testid="hazard-directive-banner"]',
    evidence: '[data-testid="basis-caption"]',
    viewerFrame: (p) => p.locator('iframe[src*="/api/namespace/files/"]'),
  },
  // Unified shell: app/v3 → factorylm-ui/hub-host.tsx (+ to-interaction.ts)
  clone: {
    url: `/hub/v3/?notebook=${NB}`,
    composer: (p) => p.getByRole("textbox", { name: "Ask MIRA" }),
    ready: (p) => p.getByText(/Answers cite 1 selected source/),
    settled: async (p) => {
      const turn = p.locator('.fl-turn--aui[data-role="assistant"]').last();
      await turn.and(p.locator(':not([data-lifecycle="running"])')).waitFor({ timeout: 30_000 });
      return turn;
    },
    answer: '[data-part-type="text"]',
    safety: '[data-part-type="safety_notice"]',
    evidence: '[data-part-type="evidence_basis"]',
    viewerFrame: (p) => p.locator('[aria-label="Source viewer"] iframe'),
  },
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** One assistant turn → the comparable record (AC4). Missing parts are null, never a throw. */
export async function extractTurn(surface: Surface, turn: Locator): Promise<TurnRecord> {
  const ui = UI[surface];
  const answerEl = turn.locator(ui.answer).last();
  const answer = (await answerEl.count()) ? norm(await answerEl.innerText()) : null;

  const labels = await turn.getByRole("button", { name: /^Open citation / }).evaluateAll(
    (els) => els.map((e) => e.getAttribute("aria-label") ?? ""),
  );
  const seen = new Map<string, TurnRecord["citations"][number]>();
  for (const l of labels) {
    const m = /^Open citation (\S+): (.*?)(?:, page (\S+))?$/.exec(l);
    if (m && !seen.has(m[1])) seen.set(m[1], { n: m[1], title: m[2], page: m[3] ?? null });
  }
  const citations = [...seen.values()].sort((a, b) => a.n.localeCompare(b.n));

  const safetyEl = turn.locator(ui.safety).first();
  let safety: TurnRecord["safety"] = { present: false, kind: null, first: null };
  if (await safetyEl.count()) {
    const kind = await safetyEl.evaluate((e) => {
      const sev = e.getAttribute("data-severity");
      if (sev) return sev === "stop" ? "stop" : "warning";
      return e.getAttribute("data-testid") === "safety-notice-banner" ? "stop" : "warning";
    });
    // "first" = the notice precedes the answer text in document order.
    const first = answer === null ? null : await safetyEl.evaluate(
      (s, a) => !!(s.compareDocumentPosition(a as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
      await answerEl.elementHandle(),
    );
    safety = { present: true, kind, first };
  }

  const evEl = turn.locator(ui.evidence).first();
  const evidence = (await evEl.count()) ? norm((await evEl.innerText()).replace(/^●\s*/, "")) : null;
  return { answer, citations, safety, evidence };
}
