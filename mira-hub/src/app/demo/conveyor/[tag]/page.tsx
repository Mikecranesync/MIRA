"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Activity, AlertCircle, Bot, Loader2, Send, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { API_BASE } from "@/lib/config";

type Component = {
  id: string;
  name: string;
  asset_tag: string | null;
  component_kind: string | null;
  plc_tag: string | null;
};

type Equipment = {
  id: string;
  name: string;
  asset_tag: string | null;
  manufacturer: string | null;
  model: string | null;
  components: Component[];
};

type Line = { id: string; name: string; equipment: Equipment[] };
type Area = { id: string; name: string; lines: Line[] };
type Site = { id: string; name: string; areas: Area[] };

type SignalRow = {
  plc_tag: string;
  component_id: string | null;
  component_name: string | null;
  asset_id: string | null;
  asset_name: string | null;
  last_value_text: string | null;
  last_value_numeric: number | null;
  last_value_bool: boolean | null;
  last_seen_at: string;
  last_changed_at: string;
  simulated: boolean;
};

type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  provider?: string;
  citations?: Array<{ label: string; source: string }>;
};

const POLL_MS = 2000;

function findEquipmentByTag(sites: Site[], tag: string): Equipment | null {
  const target = tag.toUpperCase();
  for (const s of sites)
    for (const a of s.areas)
      for (const l of a.lines)
        for (const e of l.equipment) {
          if ((e.asset_tag ?? "").toUpperCase() === target) return e;
        }
  return null;
}

function formatValue(row: SignalRow): string {
  if (row.last_value_bool !== null) return row.last_value_bool ? "ON" : "OFF";
  if (row.last_value_numeric !== null) return row.last_value_numeric.toString();
  return row.last_value_text ?? "—";
}

function sinceLabel(iso: string): string {
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}

export default function ConveyorDemoPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: rawTag } = use(params);
  const tag = decodeURIComponent(rawTag);
  const session = useSession();
  const isAuthed = session.status === "authenticated";

  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // Bounce unauthed visitors to login — same pattern as /m/[assetTag].
  useEffect(() => {
    if (session.status !== "unauthenticated") return;
    if (typeof window === "undefined") return;
    const cb = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login?callbackUrl=${encodeURIComponent(cb)}`);
  }, [session.status]);

  // 1. Locate the equipment by tag from the demo asset tree.
  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/demo/customer/`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setErrorStatus(res.status);
          return null;
        }
        return res.json() as Promise<{ sites: Site[] }>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        const eq = findEquipmentByTag(data.sites, tag);
        if (!eq) setErrorStatus(404);
        else setEquipment(eq);
      })
      .catch(() => {
        if (!cancelled) setErrorStatus(500);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthed, tag]);

  // 2. Confirm a session for this asset — unblocks /api/mira/ask.
  useEffect(() => {
    if (!equipment) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/sessions/confirm/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset_id: equipment.id, channel: "tablet" }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { session: { id: string } } | null) => {
        if (!cancelled && data?.session?.id) setSessionId(data.session.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [equipment]);

  // 3. Poll /api/demo/signals/summary every 2 s for live cache snapshots.
  useEffect(() => {
    if (!equipment) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/demo/signals/summary/`);
        if (!res.ok) return;
        const data = (await res.json()) as { signals: SignalRow[] };
        if (cancelled) return;
        // Single-asset demo: include this asset's bound rows plus any
        // currently-unbound cache rows (asset_id null), so a freshly toggled
        // signal still shows up before binding catches up. Tighten to
        // strict `=== equipment.id` if a second demo asset is ever seeded.
        const mine = (data.signals ?? []).filter(
          (r) => r.asset_id === equipment.id || r.asset_id === null,
        );
        setSignals(mine);
      } catch {
        // Tolerate transient errors during a 90-s demo.
      }
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [equipment]);

  // Keep chat scrolled to bottom on new turns.
  useEffect(() => {
    chatBoxRef.current?.scrollTo({ top: chatBoxRef.current.scrollHeight });
  }, [chatHistory.length, asking]);

  const ask = useCallback(async () => {
    if (!sessionId || !question.trim() || asking) return;
    const userTurn: ChatTurn = { role: "user", text: question.trim() };
    setChatHistory((h) => [...h, userTurn]);
    const q = question.trim();
    setQuestion("");
    setAsking(true);
    try {
      const res = await fetch(`${API_BASE}/api/mira/ask/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, question: q }),
      });
      const data = (await res.json()) as {
        answer?: string;
        provider?: string;
        citations?: Array<{ label: string; source: string }>;
        error?: string;
      };
      const text = data.answer ?? data.error ?? "(no answer)";
      setChatHistory((h) => [
        ...h,
        {
          role: "assistant",
          text,
          provider: data.provider,
          citations: data.citations,
        },
      ]);
    } catch {
      setChatHistory((h) => [
        ...h,
        { role: "assistant", text: "Network error — retry the question." },
      ]);
    } finally {
      setAsking(false);
    }
  }, [sessionId, question, asking]);

  const headlineSignals = useMemo(() => signals.slice(0, 8), [signals]);

  if (session.status === "loading" || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[--background]">
        <Loader2 className="size-8 animate-spin text-[--foreground]/60" />
      </div>
    );
  }

  if (errorStatus) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-[--background] p-8 text-center">
        <AlertCircle className="size-10 text-[--destructive]" />
        <h1 className="text-lg font-semibold">Asset not available</h1>
        <p className="text-sm opacity-70">
          {errorStatus === 404
            ? `No asset with tag "${tag}" in the demo tenant.`
            : `Failed to load demo asset (HTTP ${errorStatus}).`}
        </p>
      </div>
    );
  }

  if (!equipment) return null;

  return (
    <div className="min-h-screen bg-[--background] p-4 lg:p-6">
      <header className="mb-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <Wrench className="size-5 text-[--foreground]/70" />
          <h1 className="text-xl font-semibold">{equipment.name}</h1>
          <span className="rounded bg-[--muted] px-2 py-0.5 text-xs opacity-80">
            {equipment.asset_tag ?? tag}
          </span>
        </div>
        {equipment.manufacturer || equipment.model ? (
          <p className="mt-1 text-xs opacity-70">
            {[equipment.manufacturer, equipment.model].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4" />
                Live signals
                {signals.length ? (
                  <span className="ml-auto text-xs opacity-60">
                    {signals.length} bound
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {headlineSignals.length === 0 ? (
                <p className="text-sm opacity-70">
                  Waiting for signal events. Use{" "}
                  <code className="text-xs">POST /api/demo/signals/toggle</code>{" "}
                  or the simulator to push a value.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {headlineSignals.map((s) => (
                    <li
                      key={s.plc_tag}
                      className="flex items-center justify-between rounded border border-[--border] px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {s.component_name ?? s.plc_tag}
                        </p>
                        <p className="truncate text-xs opacity-60">
                          {s.plc_tag} · {sinceLabel(s.last_changed_at)}
                        </p>
                      </div>
                      <span
                        className="ml-2 rounded bg-[--muted] px-2 py-1 font-mono text-xs"
                        data-testid={`signal-value-${s.plc_tag}`}
                      >
                        {formatValue(s)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Components</CardTitle>
            </CardHeader>
            <CardContent>
              {equipment.components.length === 0 ? (
                <p className="text-sm opacity-70">No components bound to this asset.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {equipment.components.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded border border-[--border] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="truncate text-xs opacity-60">
                          {c.component_kind ?? "component"}
                          {c.asset_tag ? ` · ${c.asset_tag}` : ""}
                        </p>
                      </div>
                      {c.plc_tag ? (
                        <code className="rounded bg-[--muted] px-2 py-1 font-mono text-xs">
                          {c.plc_tag}
                        </code>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="flex max-h-[80vh] flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" />
              Ask MIRA
              {!sessionId ? (
                <span className="ml-auto text-xs opacity-60">
                  confirming session…
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <div
              ref={chatBoxRef}
              className="flex-1 overflow-y-auto rounded border border-[--border] p-3 text-sm"
              data-testid="chat-history"
            >
              {chatHistory.length === 0 ? (
                <p className="opacity-60">
                  Try: <em>&quot;Is the photo eye seeing the box?&quot;</em>
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {chatHistory.map((t, i) => (
                    <li
                      key={i}
                      className={
                        t.role === "user"
                          ? "self-end max-w-[80%] rounded-lg bg-[--primary] px-3 py-2 text-[--primary-foreground]"
                          : "self-start max-w-[85%] rounded-lg bg-[--muted] px-3 py-2"
                      }
                    >
                      <p className="whitespace-pre-wrap">{t.text}</p>
                      {t.role === "assistant" && t.provider ? (
                        <p className="mt-1 text-[10px] opacity-60">
                          via {t.provider}
                          {t.citations?.length
                            ? ` · ${t.citations.length} citation${t.citations.length === 1 ? "" : "s"}`
                            : ""}
                        </p>
                      ) : null}
                    </li>
                  ))}
                  {asking ? (
                    <li className="self-start max-w-[85%] rounded-lg bg-[--muted] px-3 py-2 text-xs opacity-70">
                      <Loader2 className="mr-1 inline size-3 animate-spin" />
                      thinking…
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  sessionId
                    ? "Ask about the conveyor…"
                    : "Waiting for session confirmation…"
                }
                disabled={!sessionId || asking}
                data-testid="chat-input"
              />
              <Button
                type="submit"
                disabled={!sessionId || asking || !question.trim()}
                data-testid="chat-send"
              >
                <Send className="size-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
