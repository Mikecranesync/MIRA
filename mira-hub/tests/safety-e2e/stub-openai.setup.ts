// Zero-network stand-in for api.openai.com, for proving the driver's $ cap on the
// exact paid generator without a key or a call (#4372 SAFE lane). Installed as a
// vitest setupFile, i.e. BEFORE run.e2e.ts captures `realFetch`, so every OpenAI
// call lands here; any other host throws. Usage: vitest.stub-openai.config.ts.
import { appendFileSync } from "node:fs";

const LOG = process.env.STUB_LOG ?? "/dev/null";
const P = Number(process.env.STUB_PROMPT_TOKENS ?? "200000");
const C = Number(process.env.STUB_COMPLETION_TOKENS ?? "20000");
const SERVED = process.env.STUB_SERVED_MODEL ?? "gpt-5.4-mini-2026-03-17";
const ANSWER = "Check belt tension every 250 operating hours, per the CV-9 maintenance note [1].";

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.host !== "api.openai.com") throw new Error(`stub: refusing real network to ${url.host}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string; stream?: boolean };
  appendFileSync(LOG, JSON.stringify({ path: url.pathname, model: body.model, stream: Boolean(body.stream) }) + "\n");
  const usage = { prompt_tokens: P, completion_tokens: C, prompt_tokens_details: { cached_tokens: 0 } };
  if (body.stream) {
    const frames = [
      { id: "s1", model: SERVED, choices: [{ index: 0, delta: { content: ANSWER } }] },
      { id: "s1", model: SERVED, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { id: "s1", model: SERVED, choices: [], usage },
    ];
    const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  const json = {
    id: "j1",
    model: SERVED,
    choices: [{ index: 0, message: { role: "assistant", content: '{"verdict":"safe","reason":"stub"}' }, finish_reason: "stop" }],
    usage,
  };
  return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;
