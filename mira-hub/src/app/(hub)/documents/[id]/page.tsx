"use client";

// ARPK Phase 1d — real document detail. `[id]` is the document's doc_id
// (hub_uploads.id) for the caller's own v2 uploads. Resolved from the same
// /api/documents rollup the list uses; the primary action is the doc-scoped
// Chat deep link. Replaces the DOCS mock (whose "Ask MIRA" was a Telegram
// deep link) — no mock data, no Telegram.

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, FileText, Bot, ShieldCheck } from "lucide-react";
import { API_BASE } from "@/lib/config";
import { docChatHref, isDocChattable } from "@/lib/doc-chat-link";

interface DocumentRow {
  source_url: string;
  title: string;
  manufacturer: string | null;
  model_number: string | null;
  equipment_type: string | null;
  chunk_count: number;
  last_indexed: string | null;
  verified: boolean;
  doc_id: string | null;
  node_id: string | null;
  filename: string | null;
  pages: number | null;
  mine: boolean;
}

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("documents");
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/documents/?limit=200`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { documents?: DocumentRow[] };
        const found = (body.documents ?? []).find((d) => d.doc_id === id) ?? null;
        if (!cancelled) setDoc(found);
      } catch {
        /* leave doc null — renders not-found below */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <Link href="/documents" className="inline-flex items-center gap-1 text-xs mb-2" style={{ color: "var(--brand-blue)" }}>
            <ArrowLeft className="w-3.5 h-3.5" />{t("title")}
          </Link>
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: "var(--surface-1)" }}
            >
              <FileText className="w-5 h-5" style={{ color: "var(--foreground-muted)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold leading-snug break-words" style={{ color: "var(--foreground)" }}>
                {doc?.title ?? (loading ? "…" : "Document not found")}
              </h1>
              {doc && (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {doc.mine && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
                    >
                      private
                    </span>
                  )}
                  {doc.verified && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "var(--surface-1)", color: "var(--ok, #16A34A)" }}
                    >
                      <ShieldCheck className="w-3 h-3" /> verified
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 max-w-2xl space-y-4">
        {loading ? (
          <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>Loading…</p>
        ) : !doc ? (
          <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
            This document isn&apos;t in your library (or the link is stale). Head back to{" "}
            <Link href="/documents" style={{ color: "var(--brand-blue)" }}>
              Documents
            </Link>{" "}
            to browse what&apos;s available.
          </p>
        ) : (
          <>
            <div className="card p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {doc.manufacturer && (
                  <>
                    <dt style={{ color: "var(--foreground-subtle)" }}>Manufacturer</dt>
                    <dd style={{ color: "var(--foreground)" }}>{doc.manufacturer}</dd>
                  </>
                )}
                {doc.model_number && (
                  <>
                    <dt style={{ color: "var(--foreground-subtle)" }}>Model</dt>
                    <dd style={{ color: "var(--foreground)" }}>{doc.model_number}</dd>
                  </>
                )}
                {doc.pages != null && (
                  <>
                    <dt style={{ color: "var(--foreground-subtle)" }}>Pages</dt>
                    <dd style={{ color: "var(--foreground)" }}>{doc.pages}</dd>
                  </>
                )}
                <dt style={{ color: "var(--foreground-subtle)" }}>Indexed chunks</dt>
                <dd style={{ color: "var(--foreground)" }}>{doc.chunk_count}</dd>
                {doc.last_indexed && (
                  <>
                    <dt style={{ color: "var(--foreground-subtle)" }}>Last indexed</dt>
                    <dd style={{ color: "var(--foreground)" }}>
                      {new Date(doc.last_indexed).toLocaleString()}
                    </dd>
                  </>
                )}
              </dl>
            </div>

            {isDocChattable(doc) && (
              <Link
                href={docChatHref(doc)}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors"
                style={{ borderColor: "var(--accent, var(--brand-blue))", color: "var(--accent, var(--brand-blue))" }}
                data-testid="doc-chat-action"
              >
                <Bot className="w-4 h-4" /> Chat with this document
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
