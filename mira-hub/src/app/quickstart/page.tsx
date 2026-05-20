"use client";

// /quickstart — public, no-auth landing page (ADR-0014: the Twilio moment).
// User picks a manufacturer + types a fault code or symptom, gets a cited,
// grounded answer from the 83K-chunk OEM corpus via mira-pipeline cascade.
// CTA at the bottom converts them into /signup. Mobile-first; works on a
// noisy plant-floor phone.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Factory, Send, Loader2, ChevronRight, BookOpen } from "lucide-react";

type Manufacturer = { name: string; count: number };
type Citation = { index: number; title: string; url: string | null; page: number | null };
type AskResponse = { answer: string; citations: Citation[]; provider: string | null };

export default function QuickstartPage() {
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [manufacturer, setManufacturer] = useState<string>("");
  const [question, setQuestion] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/quickstart/manufacturers")
      .then((r) => (r.ok ? r.json() : { manufacturers: [] }))
      .then((d: { manufacturers: Manufacturer[] }) => setManufacturers(d.manufacturers ?? []))
      .catch(() => setManufacturers([]));
  }, []);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/quickstart/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer: manufacturer || undefined, question }),
      });
      const data = (await res.json()) as AskResponse & { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Something went wrong");
      } else {
        setResult({
          answer: data.answer,
          citations: data.citations ?? [],
          provider: data.provider ?? null,
        });
      }
    } catch {
      setError("Network error — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#0F172A" }}>
      {/* Top bar */}
      <header className="border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}
            >
              <Factory className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white tracking-tight">MIRA Quickstart</span>
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
            style={{ color: "#94A3B8" }}
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-8 md:py-12">
        <h1
          className="text-3xl md:text-4xl font-bold tracking-tight mb-3"
          style={{ color: "white" }}
        >
          Ask MIRA — get a grounded answer in 60 seconds.
        </h1>
        <p
          className="text-base md:text-lg leading-relaxed mb-8"
          style={{ color: "#94A3B8" }}
        >
          Pick a manufacturer and describe a fault or symptom. MIRA cites the
          OEM manual chunk it pulled the answer from — no fabrication. No
          signup needed to try.
        </p>

        <form onSubmit={onAsk} className="space-y-4 mb-8" data-testid="quickstart-form">
          <div>
            <label
              htmlFor="manufacturer"
              className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: "#64748B" }}
            >
              Manufacturer (optional)
            </label>
            <select
              id="manufacturer"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm"
              style={{
                backgroundColor: "#1E293B",
                color: "white",
                border: "1px solid #334155",
              }}
              data-testid="quickstart-manufacturer"
            >
              <option value="">— Any manufacturer —</option>
              {manufacturers.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({m.count.toLocaleString()})
                </option>
              ))}
            </select>
            {manufacturers.length === 0 && (
              <p className="mt-1.5 text-[11px]" style={{ color: "#64748B" }}>
                Manufacturer index unavailable — you can still type a symptom below.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="question"
              className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: "#64748B" }}
            >
              Fault code or symptom
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. PowerFlex 525 fault F0004 on power-up, drive won't reset"
              rows={3}
              maxLength={1000}
              className="w-full rounded-lg px-3 py-2.5 text-sm resize-none"
              style={{
                backgroundColor: "#1E293B",
                color: "white",
                border: "1px solid #334155",
              }}
              data-testid="quickstart-question"
            />
          </div>

          <button
            type="submit"
            disabled={!question.trim() || loading}
            className="w-full md:w-auto rounded-lg px-5 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
            style={{
              background: "linear-gradient(135deg, #2563EB, #0891B2)",
              color: "white",
            }}
            data-testid="quickstart-submit"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Asking MIRA…
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Ask MIRA
              </>
            )}
          </button>
        </form>

        {/* Result */}
        {error && (
          <div
            className="rounded-xl p-4 mb-6 text-sm"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#FCA5A5",
            }}
            data-testid="quickstart-error"
          >
            {error}
          </div>
        )}

        {result && (
          <div
            className="rounded-xl p-5 mb-6"
            style={{
              backgroundColor: "#1E293B",
              border: "1px solid #334155",
            }}
            data-testid="quickstart-answer"
          >
            <div
              className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: "#E2E8F0" }}
            >
              {result.answer}
            </div>

            {result.citations.length > 0 && (
              <div
                className="mt-5 pt-4"
                style={{ borderTop: "1px solid #334155" }}
                data-testid="quickstart-citations"
              >
                <p
                  className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                  style={{ color: "#64748B" }}
                >
                  Sources
                </p>
                <ul className="space-y-1.5">
                  {result.citations.map((c) => (
                    <li
                      key={c.index}
                      className="flex items-start gap-2 text-xs"
                      style={{ color: "#94A3B8" }}
                    >
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-semibold flex-shrink-0"
                        style={{ backgroundColor: "#334155", color: "#E2E8F0" }}
                      >
                        {c.index}
                      </span>
                      <span className="leading-relaxed">
                        {c.url ? (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {c.title}
                          </a>
                        ) : (
                          c.title
                        )}
                        {c.page != null && (
                          <span style={{ color: "#64748B" }}> · p.{c.page}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.provider && (
              <p
                className="mt-3 text-[10px] uppercase tracking-wider"
                style={{ color: "#475569" }}
              >
                Answered by {result.provider}
              </p>
            )}
          </div>
        )}

        {/* CTA */}
        <div
          className="rounded-xl p-5 mt-8"
          style={{
            background: "linear-gradient(135deg, rgba(37, 99, 235, 0.15), rgba(8, 145, 178, 0.15))",
            border: "1px solid rgba(37, 99, 235, 0.3)",
          }}
        >
          <div className="flex items-start gap-3">
            <BookOpen className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "#60A5FA" }} />
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold mb-1" style={{ color: "white" }}>
                Want MIRA on your own equipment?
              </h2>
              <p className="text-sm leading-relaxed mb-3" style={{ color: "#CBD5E1" }}>
                Sign up to upload your own manuals, build your namespace, and
                save every answer to your asset history.
              </p>
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#2563EB", color: "white" }}
                data-testid="quickstart-signup-cta"
              >
                Try MIRA Free
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t py-6" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div
          className="max-w-3xl mx-auto px-5 text-xs text-center"
          style={{ color: "#475569" }}
        >
          MIRA grounds every answer in OEM manuals — no fabrication. If we
          can&apos;t cite a source, we say so.
        </div>
      </footer>
    </div>
  );
}
