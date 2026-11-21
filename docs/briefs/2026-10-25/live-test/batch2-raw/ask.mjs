import { api, json, login } from "./hub.mjs";
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
// usage: node ask.mjs <label> <notebookId> <docId|-> <question> [extraBodyJSON]
export async function ask(label, notebookId, docId, question, extra = {}) {
  const body = { message: question, ...(docId ? { sourceDocIds: [docId] } : {}), ...extra };
  const t0 = Date.now(); let ttft = null;
  const res = await api(`/api/equipment-notebooks/${notebookId}/chat/`, json(body));
  const headers = Object.fromEntries([...res.headers].filter(([k]) => !/cookie/i.test(k)));
  let raw = "";
  if (res.body) {
    const reader = res.body.getReader(); const dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      const chunk = dec.decode(value, { stream: true }); raw += chunk;
      if (ttft === null && /"kind":"content"/.test(raw)) ttft = Date.now() - t0; }
  }
  const total = Date.now() - t0;
  const frames = []; let answer = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue; const p = line.slice(6);
    if (p === "[DONE]") { frames.push({ kind: "[DONE]" }); continue; }
    try { const o = JSON.parse(p); if (o.kind === "content") answer += o.content ?? ""; else frames.push(o); } catch {}
  }
  const rec = { label, notebookId, docId, question, requestBody: body, httpStatus: res.status, headers, ttftMs: ttft, totalMs: total,
    kinds: frames.map(f=>f.kind), answer, frames, startedAt: new Date(t0).toISOString() };
  writeFileSync(`${process.env.RAW_DIR || "raw"}/${label}.sse.txt`, raw);
  writeFileSync(`${process.env.RAW_DIR || "raw"}/${label}.json`, JSON.stringify(rec, null, 2));
  return rec;
}
if (process.argv[1].endsWith("ask.mjs")) {
  const [label, nb, doc, q, extra] = process.argv.slice(2);
  await login();
  const r = await ask(label, nb, doc === "-" ? null : doc, q, extra ? JSON.parse(extra) : {});
  console.log(JSON.stringify({ http: r.httpStatus, ttft: r.ttftMs, total: r.totalMs, kinds: r.kinds, answer: r.answer }, null, 1));
  console.log(JSON.stringify(r.frames, null, 1).slice(0, 5000));
}
