"use client";

// Visual Focus Workspace (PR V2) — the interactive workspace for one session:
// upload evidence, view it in the shared VisualWorkspace viewer (PR V1),
// draw regions, persist them to region_of_interest, edit labels.
//
// Persistence model: the viewer is uncontrolled — saved regions are seeded via
// `initialAnnotations` and the component is remounted (key) after every save
// so the seeded set reflects the ledger. Unsaved annotations are the ones with
// client `r<N>` ids (server rows carry UUID ids). The ledger is append-only
// (no region DELETE in migration 063) — undoing a saved region only removes it
// from the local view until remount; that is the ledger semantic, not a bug.

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/config";
import VisualWorkspace from "@/components/visual/VisualWorkspace";
import type { Annotation, DrawTool, Geometry } from "@/lib/visual";

interface SessionRow {
  session_id: string;
  title: string | null;
  status: string;
}

interface EvidenceRow {
  evidence_id: string;
  source_type: string;
  content_mime: string | null;
  width: number | null;
  height: number | null;
  has_content: boolean;
  created_at: string;
}

interface RegionRow {
  region_id: string;
  evidence_id: string;
  geometry: Geometry | null;
  geometry_error: string | null;
  label: string | null;
  origin: string;
  created_at: string;
}

const CLIENT_ID_RE = /^r\d+$/;

function regionToAnnotation(r: RegionRow): Annotation | null {
  if (!r.geometry) return null;
  let tool: DrawTool;
  if (r.geometry.type === "point") tool = "point";
  else if (r.geometry.type === "rect") tool = "box";
  else return null; // other primitives exist in the contract but V1 tools can't render them
  return { id: r.region_id, tool, geometry: r.geometry };
}

export default function VisualSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);

  const [session, setSession] = useState<SessionRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  // Regions are stored WITH the evidence id they belong to, so a slow
  // response for evidence A can never seed the viewer while evidence B is
  // selected (out-of-order guard), and switching evidence immediately clears
  // the previous seed.
  const [regionsFor, setRegionsFor] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  // Client annotation ids already persisted this mount — the duplicate guard
  // for partial-save retries against the append-only ledger.
  const [savedClientIds, setSavedClientIds] = useState<Set<string>>(new Set());
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [viewerEpoch, setViewerEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => evidence.find((e) => e.evidence_id === selectedId) ?? null,
    [evidence, selectedId],
  );

  const loadSession = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/visual/sessions/${sessionId}/`, {
      cache: "no-store",
    });
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    if (res.ok) {
      const body = (await res.json()) as { session: SessionRow };
      setSession(body.session);
    }
  }, [sessionId]);

  const loadEvidence = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/visual/sessions/${sessionId}/evidence/`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as { evidence: EvidenceRow[] };
    const items = (body.evidence ?? []).filter((e) => e.has_content);
    setEvidence(items);
    setSelectedId((cur) => cur ?? items[0]?.evidence_id ?? null);
  }, [sessionId]);

  const loadRegions = useCallback(async (evidenceId: string) => {
    const res = await fetch(`${API_BASE}/api/visual/evidence/${evidenceId}/regions/`, {
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) {
      setError("Could not refresh regions — reload the page before saving again.");
      return false;
    }
    const body = (await res.json()) as { regions: RegionRow[] };
    // Out-of-order guard: only apply if this evidence is still the one shown.
    if (selectedIdRef.current === evidenceId) {
      setRegionsFor(evidenceId);
      setRegions(body.regions ?? []);
      setSavedClientIds(new Set());
      setViewerEpoch((n) => n + 1); // remount the viewer with the fresh seed
    }
    return true;
  }, []);

  useEffect(() => {
    void loadSession();
    void loadEvidence();
  }, [loadSession, loadEvidence]);

  useEffect(() => {
    // Clear the previous evidence's seed immediately — never render evidence
    // A's regions over evidence B while the fetch is in flight.
    setRegionsFor(null);
    setRegions([]);
    setSavedClientIds(new Set());
    setViewerEpoch((n) => n + 1);
    if (selectedId) void loadRegions(selectedId);
  }, [selectedId, loadRegions]);

  const handleAnnotationsChange = useCallback((next: Annotation[]) => {
    setAnnotations(next);
  }, []);

  const unsaved = useMemo(
    () => annotations.filter((a) => CLIENT_ID_RE.test(a.id) && !savedClientIds.has(a.id)),
    [annotations, savedClientIds],
  );

  async function uploadFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/visual/sessions/${sessionId}/evidence/`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { evidence: EvidenceRow };
      await loadEvidence();
      setSelectedId(body.evidence.evidence_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function saveRegions() {
    if (!selectedId || unsaved.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const a of unsaved) {
        const res = await fetch(`${API_BASE}/api/visual/evidence/${selectedId}/regions/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ geometry: a.geometry }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        // Mark THIS annotation persisted the moment its POST succeeds — a
        // later failure (or a failed list refresh) must never let a retry
        // re-POST it into the append-only ledger.
        setSavedClientIds((prev) => new Set(prev).add(a.id));
      }
      await loadRegions(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveLabel(regionId: string, label: string) {
    setError(null);
    const res = await fetch(`${API_BASE}/api/visual/regions/${regionId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() === "" ? null : label }),
    });
    if (res.ok) {
      const body = (await res.json()) as { region: RegionRow };
      setRegions((prev) =>
        prev.map((r) => (r.region_id === body.region.region_id ? body.region : r)),
      );
    } else {
      setError("Label update failed.");
    }
  }

  const seededAnnotations = useMemo(
    () =>
      regionsFor === selectedId
        ? regions.map(regionToAnnotation).filter((a): a is Annotation => a !== null)
        : [],
    [regions, regionsFor, selectedId],
  );

  if (notFound) {
    return (
      <div style={{ padding: "2rem", color: "var(--foreground-muted)" }}>
        Session not found.
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.25rem" }}>
        {session?.title || "Visual session"}
      </h1>
      <p style={{ color: "var(--foreground-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
        Upload a print or equipment photo, then draw regions on it. Point and box
        regions persist to the shared visual ledger.
      </p>

      {error && (
        <p role="alert" style={{ color: "var(--status-red)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {/* Evidence rail */}
        <div style={{ flex: "0 0 220px", minWidth: 200 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: "100%",
              background: "var(--brand-blue)",
              color: "var(--surface-0)",
              border: "none",
              borderRadius: 6,
              padding: "0.5rem",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
              marginBottom: "0.75rem",
            }}
          >
            Upload evidence
          </button>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {evidence.map((e) => (
              <li key={e.evidence_id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(e.evidence_id)}
                  aria-pressed={e.evidence_id === selectedId}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background:
                      e.evidence_id === selectedId ? "var(--surface-2)" : "var(--surface-1)",
                    border:
                      e.evidence_id === selectedId
                        ? "1px solid var(--brand-blue)"
                        : "1px solid var(--border-default)",
                    borderRadius: 6,
                    padding: "0.5rem",
                    marginBottom: "0.375rem",
                    fontSize: "0.8125rem",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{e.source_type}</div>
                  <div style={{ color: "var(--foreground-subtle)", fontSize: "0.6875rem" }}>
                    {e.width}×{e.height} · {new Date(e.created_at).toLocaleDateString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Viewer */}
        <div style={{ flex: "1 1 480px", minWidth: 320 }}>
          {selected && selected.width && selected.height ? (
            <>
              <VisualWorkspace
                key={`${selected.evidence_id}:${viewerEpoch}`}
                imageSrc={`${API_BASE}/api/visual/evidence/${selected.evidence_id}/view/`}
                imageWidth={selected.width}
                imageHeight={selected.height}
                initialAnnotations={seededAnnotations}
                onAnnotationsChange={handleAnnotationsChange}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  marginTop: "0.5rem",
                }}
              >
                <button
                  type="button"
                  onClick={() => void saveRegions()}
                  disabled={busy || unsaved.length === 0}
                  style={{
                    background:
                      unsaved.length > 0 ? "var(--brand-blue)" : "var(--surface-2)",
                    color:
                      unsaved.length > 0 ? "var(--surface-0)" : "var(--foreground-subtle)",
                    border: "none",
                    borderRadius: 6,
                    padding: "0.5rem 1rem",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    cursor: busy || unsaved.length === 0 ? "default" : "pointer",
                  }}
                >
                  Save {unsaved.length > 0 ? `${unsaved.length} region${unsaved.length === 1 ? "" : "s"}` : "regions"}
                </button>
                <span style={{ color: "var(--foreground-subtle)", fontSize: "0.75rem" }}>
                  {regions.length} saved · {unsaved.length} unsaved
                </span>
              </div>
            </>
          ) : (
            <div
              style={{
                border: "1px dashed var(--border-default)",
                borderRadius: 8,
                height: 480,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--foreground-muted)",
              }}
            >
              Upload an image to start annotating.
            </div>
          )}
        </div>

        {/* Region list */}
        <div style={{ flex: "0 0 260px", minWidth: 220 }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Saved regions
          </h2>
          {regions.length === 0 ? (
            <p style={{ color: "var(--foreground-subtle)", fontSize: "0.8125rem" }}>
              None yet — draw on the image and save.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {regions.map((r) => (
                <li
                  key={r.region_id}
                  style={{
                    background: "var(--surface-1)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 6,
                    padding: "0.5rem",
                    marginBottom: "0.375rem",
                  }}
                >
                  <div
                    style={{
                      color: "var(--foreground-subtle)",
                      fontSize: "0.6875rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {r.geometry?.type ?? "unreadable"} · {r.origin}
                  </div>
                  <input
                    type="text"
                    defaultValue={r.label ?? ""}
                    placeholder="Label (e.g. K17 seal-in contact)"
                    aria-label={`Label for region ${r.region_id.slice(0, 8)}`}
                    onBlur={(e) => {
                      if ((r.label ?? "") !== e.target.value) {
                        void saveLabel(r.region_id, e.target.value);
                      }
                    }}
                    style={{
                      width: "100%",
                      background: "var(--surface-0)",
                      border: "1px solid var(--border-default)",
                      borderRadius: 4,
                      padding: "0.25rem 0.375rem",
                      fontSize: "0.8125rem",
                      color: "inherit",
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
