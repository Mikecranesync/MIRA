/**
 * POST /projects/:id/live-troubleshoot
 *
 * Pulls live tag values from an Ignition gateway, merges them with the
 * project's static graph context (parsed ST + manifest), and asks a Groq
 * cascade LLM to produce a grounded troubleshooting answer.
 *
 * Spec: docs/superpowers/specs/2026-05-11-cra-236-live-troubleshoot-design.md
 * PRD §4: no Anthropic. Groq -> Cerebras -> Gemini only.
 */

import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import { findProject, type ProjectDef } from "../projects/registry.ts";
import { parseStructuredText } from "../parser/st.ts";
import {
  indexByName,
  loadManifest,
  type ManifestVariable,
} from "../parser/manifest.ts";

const CONTEXT_VAR_LIMIT = 64;

export interface LiveTagRead {
  path: string;
  value: unknown;
  quality: string;
  timestamp: string;
}

interface IgnitionTagReadResponse {
  // Ignition WebDev tag/read returns either an array of rows or an object
  // with a `results` key, depending on the WebDev script. Be tolerant.
  results?: Array<{
    path?: string;
    value?: unknown;
    quality?: string | { name?: string };
    timestamp?: string;
  }>;
}

export interface LiveTroubleshootBody {
  question?: string;
  ignitionUrl?: string;
  tagPrefix?: string;
}

interface LlmProvider {
  name: "groq" | "cerebras" | "gemini";
  url: string;
  apiKey: string;
  model: string;
}

function llmProviders(): LlmProvider[] {
  const providers: LlmProvider[] = [];
  const groq = process.env.GROQ_API_KEY;
  if (groq) {
    providers.push({
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: groq,
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    });
  }
  const cerebras = process.env.CEREBRAS_API_KEY;
  if (cerebras) {
    providers.push({
      name: "cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      apiKey: cerebras,
      model: process.env.CEREBRAS_MODEL ?? "llama3.1-8b",
    });
  }
  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) {
    // Gemini exposes an OpenAI-compatible endpoint under /v1beta/openai/.
    providers.push({
      name: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: gemini,
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    });
  }
  return providers;
}

function graphVariablesForProject(project: ProjectDef): ManifestVariable[] {
  // Mirrors buildTagsForProject's intersection logic but returns the raw
  // ManifestVariable rows (build-for-project transforms them into Ignition
  // tags with Pascal-cased names, which would lose the original identifier).
  const stSource = readFileSync(project.stPath, "utf8");
  const parsed = parseStructuredText(stSource);
  const manifest = loadManifest(project.manifestPath);
  const idx = indexByName(manifest);
  const used = new Set<string>([
    ...parsed.variables.map((v) => v.name),
    ...parsed.referencedIdentifiers,
  ]);
  const out: ManifestVariable[] = [];
  for (const name of used) {
    const v = idx.get(name);
    if (!v) continue;
    if (!v.modbusAddress) continue;
    out.push(v);
  }
  return out;
}

async function readIgnitionTags(
  ignitionUrl: string,
  paths: string[],
): Promise<LiveTagRead[]> {
  const user = process.env.IGNITION_USER ?? "admin";
  const password = process.env.IGNITION_PASSWORD ?? "password";
  const auth = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
  const timeoutMs = Number(process.env.IGNITION_TIMEOUT_MS ?? 5000);

  const url = `${ignitionUrl.replace(/\/$/, "")}/data/tag/read`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body: JSON.stringify({ paths }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    throw new Error(`ignition_${resp.status}`);
  }
  const data = (await resp.json()) as IgnitionTagReadResponse | LiveTagRead[];
  const rows = Array.isArray(data) ? data : (data.results ?? []);
  return rows.map((r, i) => {
    const quality =
      typeof r.quality === "string"
        ? r.quality
        : (r.quality?.name ?? "Unknown");
    return {
      path: r.path ?? paths[i] ?? "",
      value: r.value ?? null,
      quality,
      timestamp: r.timestamp ?? new Date().toISOString(),
    };
  });
}

function buildPrompt(
  question: string,
  variables: ManifestVariable[],
  liveTags: LiveTagRead[],
): { system: string; user: string } {
  const system = [
    "You are a PLC troubleshooting assistant for industrial maintenance technicians.",
    "Answer ONLY from the live tag values and graph context provided below.",
    "Cite each tag value you use as `name = value [live]`.",
    "If the answer is not derivable from the provided data, say so plainly — do not invent tags or values.",
    "Be terse: 3-6 sentences max. Lead with the diagnosis.",
  ].join(" ");

  const ctxLines = variables.slice(0, CONTEXT_VAR_LIMIT).map((v) => {
    const addr = v.modbusAddress ?? v.address ?? "n/a";
    return `- ${v.name} (${v.dataType}, addr=${addr}${v.direction ? `, dir=${v.direction}` : ""})`;
  });

  const liveLines = liveTags.map(
    (t) => `- ${t.path} = ${JSON.stringify(t.value)} [quality=${t.quality}, ts=${t.timestamp}]`,
  );

  const user = [
    `Question: ${question}`,
    "",
    "Graph context (variables, types, addresses):",
    ctxLines.join("\n"),
    "",
    "Live tag values from Ignition:",
    liveLines.join("\n"),
  ].join("\n");

  return { system, user };
}

interface LlmResult {
  answer: string;
  provider: string;
}

async function callLlmCascade(
  system: string,
  user: string,
): Promise<LlmResult> {
  const providers = llmProviders();
  if (providers.length === 0) {
    throw new Error("llm_unavailable");
  }
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let lastError = "";
  for (const p of providers) {
    try {
      const resp = await fetch(p.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify({
          model: p.model,
          messages,
          temperature: 0.2,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        lastError = `${p.name}_${resp.status}`;
        continue;
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const answer = data.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        lastError = `${p.name}_empty`;
        continue;
      }
      return { answer, provider: p.name };
    } catch (err) {
      lastError = `${p.name}_${err instanceof Error ? err.message : "error"}`;
      continue;
    }
  }
  throw new Error(`llm_cascade_failed:${lastError}`);
}

export async function handleLiveTroubleshoot(
  req: Request<{ id: string }, unknown, LiveTroubleshootBody>,
  res: Response,
): Promise<void> {
  const project = findProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project_not_found", id: req.params.id });
    return;
  }

  const { question, ignitionUrl, tagPrefix } = req.body ?? {};
  if (!question || !ignitionUrl || !tagPrefix) {
    res.status(400).json({
      error: "bad_request",
      message: "question, ignitionUrl, and tagPrefix are required",
    });
    return;
  }

  let variables: ManifestVariable[];
  try {
    variables = graphVariablesForProject(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "build_failed", message });
    return;
  }

  const prefix = tagPrefix.replace(/\/$/, "");
  const paths = variables.map((v) => `${prefix}/${v.name}`);

  let tagsRead: LiveTagRead[];
  try {
    tagsRead = await readIgnitionTags(ignitionUrl, paths);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "ignition_unreachable", message });
    return;
  }

  const { system, user } = buildPrompt(question, variables, tagsRead);

  let llm: LlmResult;
  try {
    llm = await callLlmCascade(system, user);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.startsWith("llm_unavailable") ? "llm_unavailable" : "llm_cascade_failed";
    res.status(502).json({ error: code, message });
    return;
  }

  const contextUsed = variables
    .slice(0, CONTEXT_VAR_LIMIT)
    .map((v) => `variable:${v.name} (${v.dataType}, ${v.modbusAddress ?? v.address ?? "no-addr"})`);

  res.json({
    answer: llm.answer,
    tags_read: tagsRead,
    context_used: contextUsed,
    provider: llm.provider,
  });
}
