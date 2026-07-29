"use client";

/**
 * PLC program import wizard — `/plc-import`.
 *
 * Upload an offline PLC program export (Rockwell L5X or a vendor tag CSV), preview the parser's
 * read-only maintenance report + proposed ISA-95 UNS paths, then create reviewable `tag_mapping` /
 * `kg_entity` proposals in the namespace review queue. Nothing is auto-verified and nothing is ever
 * written to a PLC — this is the deploy-surface for the offline mira-plc-parser chain.
 *
 * API : POST /api/connectors/plc/import   (preview, then again with commit=true)
 *       → mira-ingest /ingest/plc-parse → mira-plc-parser (report@1 + uns_candidates)
 * Queue: /knowledge/suggestions  (the proposals a human approves)
 */

import { useCallback, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileWarning,
  Loader2,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { API_BASE, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";
import {
  viewFromImportResponse,
  proposalsCreated,
  confidenceTone,
  type PlcImportView,
  type PlcParsedView,
  type PlcConfidence,
} from "@/lib/plc-import-view";

const PREFIX_FIELDS = [
  { key: "enterprise", label: "Enterprise", placeholder: "enterprise" },
  { key: "site", label: "Site", placeholder: "site1" },
  { key: "area", label: "Area", placeholder: "area1" },
  { key: "line", label: "Line", placeholder: "(controller name)" },
] as const;

const MAX_ROWS = 50;

const TONE_BADGE: Record<"high" | "medium" | "low", string> = {
  high: "bg-green-50 text-green-700 ring-1 ring-green-200",
  medium: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  low: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

export default function PlcImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [prefix, setPrefix] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | "analyze" | "commit">(null);
  const [view, setView] = useState<PlcImportView | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const buildForm = useCallback(
    (f: File, commit: boolean) => {
      const form = new FormData();
      form.append("file", f, f.name);
      for (const { key } of PREFIX_FIELDS) {
        const v = (prefix[key] ?? "").trim();
        if (v) form.append(key, v);
      }
      if (commit) form.append("commit", "true");
      return form;
    },
    [prefix],
  );

  const post = useCallback(async (form: FormData) => {
    const res = await fetch(`${API_BASE}/api/connectors/plc/import/`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }, []);

  const onAnalyze = useCallback(async () => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      flash(`That file is larger than ${MAX_UPLOAD_MB} MB. Export a smaller program or a tag CSV.`);
      return;
    }
    setBusy("analyze");
    setCommitted(null);
    try {
      const { status, body } = await post(buildForm(file, false));
      setView(viewFromImportResponse(status, body));
    } catch (e) {
      setView({ kind: "unsupported", reason: `Couldn't reach the parser: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }, [file, buildForm, post, flash]);

  const onCommit = useCallback(async () => {
    if (!file) return;
    setBusy("commit");
    try {
      const { status, body } = await post(buildForm(file, true));
      const n = proposalsCreated(body);
      if (status >= 200 && status < 300 && n !== null) {
        setCommitted(n);
        flash(`Created ${n} proposal${n === 1 ? "" : "s"} in the review queue.`);
      } else {
        flash("Couldn't create proposals — re-analyze and try again.");
      }
    } catch (e) {
      flash(`Commit failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [file, buildForm, post, flash]);

  const onPickFile = useCallback((f: File | null) => {
    setFile(f);
    setView(null);
    setCommitted(null);
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-6" data-testid="plc-import-page">
      <header className="mb-6 flex items-start gap-3">
        <div className="rounded-lg bg-blue-50 p-2 text-blue-600 ring-1 ring-blue-100">
          <Cpu className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">PLC Import</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Upload an offline PLC program export (Rockwell <span className="font-mono">.L5X</span> or a
            vendor tag <span className="font-mono">.CSV</span>). MIRA parses it read-only, proposes an
            ISA-95 UNS path for every tag, and queues them for your review.{" "}
            <span className="text-slate-400">No data is written to any PLC.</span>
          </p>
        </div>
      </header>

      {/* ── Upload form ───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="plc-import-form">
        <label
          htmlFor="plc-file"
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition hover:border-blue-400 hover:bg-blue-50/40"
        >
          <Upload className="h-6 w-6 text-slate-400" />
          <span className="mt-2 text-sm font-medium text-slate-700">
            {file ? file.name : "Choose an L5X or tag-CSV export"}
          </span>
          <span className="mt-1 text-xs text-slate-400">
            {file ? `${(file.size / 1024).toFixed(0)} KB` : `Up to ${MAX_UPLOAD_MB} MB · read-only`}
          </span>
          <input
            id="plc-file"
            ref={fileInputRef}
            type="file"
            accept=".l5x,.xml,.csv,.st,.scl,.exp,.acd,.txt"
            className="sr-only"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            UNS prefix (optional — the export only knows the lower levels)
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PREFIX_FIELDS.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label htmlFor={`pfx-${key}`} className="mb-1 block text-xs text-slate-500">
                  {label}
                </label>
                <input
                  id={`pfx-${key}`}
                  type="text"
                  placeholder={placeholder}
                  value={prefix[key] ?? ""}
                  onChange={(e) => setPrefix((p) => ({ ...p, [key]: e.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={!file || busy !== null}
            onClick={onAnalyze}
            data-testid="plc-analyze"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "analyze" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
            Analyze
          </button>
          {file && (
            <button
              type="button"
              onClick={() => onPickFile(null)}
              className="text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {/* ── Result ───────────────────────────────────────────────────── */}
      {view && (
        <div className="mt-6" data-testid="plc-import-result">
          {view.kind === "export_needed" && <ExportNeeded fmt={view.fmt} guidance={view.guidance} />}
          {view.kind === "unsupported" && <Unsupported reason={view.reason} />}
          {view.kind === "parsed" && (
            <ParsedResult
              view={view}
              committed={committed}
              committing={busy === "commit"}
              onCommit={onCommit}
            />
          )}
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-4 right-4 z-50 rounded-md bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
          data-testid="plc-import-toast"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function ExportNeeded({ fmt, guidance }: { fmt: string; guidance: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4" data-testid="plc-export-needed">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
        <FileWarning className="h-4 w-4" /> This is a closed project file ({fmt})
      </div>
      <p className="mt-2 text-sm text-amber-800">{guidance}</p>
    </div>
  );
}

function Unsupported({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600" data-testid="plc-unsupported">
      {reason}
    </div>
  );
}

function ParsedResult({
  view,
  committed,
  committing,
  onCommit,
}: {
  view: PlcParsedView;
  committed: number | null;
  committing: boolean;
  onCommit: () => void;
}) {
  const stats: Array<[string, number]> = [
    ["Tags", view.counts.tags],
    ["UNS paths", view.counts.unsCandidates],
    ["Assets", view.counts.assetCandidates],
    ["VFD signals", view.counts.vfdSignalCandidates],
    ["Faults", view.counts.faultCandidates],
    ["Review", view.counts.reviewRequired],
  ];
  const shown = view.candidates.slice(0, MAX_ROWS);
  const overflow = view.candidates.length - shown.length;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-lg font-semibold text-slate-900">{view.controller}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{view.vendor}</span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            {view.fmt} · {view.detectionConfidence}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {stats.map(([label, n]) => (
            <div key={label} className="rounded-md bg-slate-50 px-3 py-2 text-center">
              <div className="text-lg font-semibold text-slate-900">{n}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* safety review banner */}
      {view.reviewRequired.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" data-testid="plc-review-required">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <ShieldAlert className="h-4 w-4" /> {view.reviewRequired.length} signal(s) need human review
          </div>
          <ul className="mt-1.5 space-y-0.5 text-sm text-red-700">
            {view.reviewRequired.slice(0, 6).map((r) => (
              <li key={r.name}>
                <span className="font-mono text-xs">{r.name}</span> — {r.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* proposed UNS paths */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          Proposed UNS paths ({view.candidates.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="plc-candidates-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 font-medium">Tag</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Proposed UNS path</th>
                <th className="px-4 py-2 font-medium">Signal</th>
                <th className="px-4 py-2 font-medium">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.tag} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{c.tag}</td>
                  <td className="px-4 py-2 text-slate-500">{c.dataType || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{c.path}</td>
                  <td className="px-4 py-2 text-slate-600">{c.signal}</td>
                  <td className="px-4 py-2">
                    <ConfBadge confidence={c.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {overflow > 0 && (
          <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">+ {overflow} more</div>
        )}
      </div>

      {view.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-400">
          {view.warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      )}

      {/* commit / success */}
      {committed === null ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={committing || view.candidates.length === 0}
            onClick={onCommit}
            data-testid="plc-commit"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Create {view.candidates.length} proposal{view.candidates.length === 1 ? "" : "s"}
          </button>
          <span className="text-xs text-slate-400">Nothing is verified until you approve it in the queue.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4" data-testid="plc-committed">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="text-sm font-medium text-green-800">
            Created {committed} proposal{committed === 1 ? "" : "s"}.
          </span>
          <a
            href={`${API_BASE}/knowledge/suggestions`}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-green-700"
            data-testid="plc-review-link"
          >
            Review in queue <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}

function ConfBadge({ confidence }: { confidence: PlcConfidence }) {
  const tone = confidenceTone(confidence);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_BADGE[tone]}`}>
      {String(confidence)}
    </span>
  );
}
