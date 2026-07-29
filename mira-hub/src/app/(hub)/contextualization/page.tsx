"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Plus, Upload, X } from "lucide-react";
import { API_BASE } from "@/lib/config";

interface Project {
  id: string;
  name: string;
  description: string | null;
  sourceCount: number;
  extractionCount: number;
  acceptedCount: number;
  createdAt: string;
}

interface ProjectRaw {
  id: string;
  name: string;
  description: string | null;
  source_count: number;
  extraction_count: number;
  accepted_count: number;
  created_at: string;
}

function rowToProject(r: ProjectRaw): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    sourceCount: Number(r.source_count ?? 0),
    extractionCount: Number(r.extraction_count ?? 0),
    acceptedCount: Number(r.accepted_count ?? 0),
    createdAt: r.created_at,
  };
}

export default function ContextualizationPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New project modal state
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Offline bundle import state. The bundle (multipart) creates a *project*, not a
  // review-queue batch, so success routes into the new project's signal review.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTargetId, setImportTargetId] = useState(""); // "" = new project

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contextualization`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProjects((data.projects ?? []).map(rowToProject));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchProjects();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchProjects]);

  async function createProject() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contextualization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // POST returns { project: { id, ... } } — read the nested id, not data.id
      // (the old data.id was undefined → routed to /contextualization/undefined →
      // the extractions API rejected it with "invalid id").
      const newId = data.project?.id;
      if (!newId) throw new Error("Create returned no project id");
      setShowModal(false);
      setNewName("");
      setNewDesc("");
      router.push(`/contextualization/${newId}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  const importBundle = useCallback(
    async (file: File, targetId?: string) => {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setImportError("Select a Factory Context Bundle (.zip) exported from the offline contextualizer.");
        return;
      }
      setImporting(true);
      setImportError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        // Empty target → new project; a project id → import into that existing project.
        if (targetId) fd.append("project_id", targetId);
        // Multipart — do NOT set Content-Type; the browser adds the boundary.
        const res = await fetch(`${API_BASE}/api/contextualization/import`, { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!data.projectId) throw new Error("Import returned no project id");
        setShowImportModal(false);
        router.push(`/contextualization/${data.projectId}`);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : "Bundle import failed");
      } finally {
        setImporting(false);
      }
    },
    [router],
  );

  return (
    <div
      className="p-6 max-w-5xl mx-auto relative"
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) importBundle(f);
      }}
    >
      {dragOver && (
        <div className="absolute inset-0 z-40 m-2 rounded-xl border-2 border-dashed border-blue-500 bg-blue-500/10 flex items-center justify-center pointer-events-none">
          <p className="text-blue-300 text-sm font-medium flex items-center gap-2">
            <Upload size={18} /> Drop a Factory Context Bundle (.zip) to import
          </p>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Contextualization Projects</h1>
          <p className="text-sm text-gray-400 mt-1">
            Import equipment sources, review the proposed UNS paths for extracted signals, and promote approved signals to the knowledge graph.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ""; // allow re-selecting the same file
              if (f) importBundle(f, importTargetId || undefined);
            }}
          />
          <button
            onClick={() => { setImportError(null); setImportTargetId(""); setShowImportModal(true); }}
            disabled={importing}
            title="Import a Factory Context Bundle (.zip) exported from the offline contextualizer"
            className="flex items-center gap-2 border border-gray-700 hover:border-gray-500 text-gray-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? "Importing…" : "Import bundle"}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>

      {importError && !showImportModal && (
        <div className="mb-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {importError}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12 justify-center">
          <Loader2 size={20} className="animate-spin" />
          Loading projects…
        </div>
      ) : error ? (
        <div className="text-red-400 py-12 text-center">{error}</div>
      ) : projects.length === 0 ? (
        <div className="border border-dashed border-gray-700 rounded-xl py-20 flex flex-col items-center gap-4 text-gray-500">
          <FileUp size={40} className="text-gray-600" />
          <p className="text-sm">No projects yet. Create one to import PLC sources, or drag an offline bundle (.zip) here.</p>
          <button
            onClick={() => setShowModal(true)}
            className="text-blue-400 hover:text-blue-300 text-sm underline underline-offset-2"
          >
            Create your first project
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/contextualization/${p.id}`)}
              className="w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-medium group-hover:text-blue-300 transition-colors truncate">
                    {p.name}
                  </h2>
                  {p.description && (
                    <p className="text-gray-400 text-sm mt-0.5 truncate">{p.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0 mt-0.5">
                  <span>
                    <span className="text-gray-300 font-medium">{p.sourceCount}</span> source{p.sourceCount !== 1 ? "s" : ""}
                  </span>
                  <span>
                    <span className="text-gray-300 font-medium">{p.extractionCount}</span> signal{p.extractionCount !== 1 ? "s" : ""}
                  </span>
                  <span>
                    <span className="text-green-400 font-medium">{p.acceptedCount}</span> accepted
                  </span>
                  <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Import bundle modal — pick target project (existing or new) */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">Import bundle</h2>
              <button onClick={() => { setShowImportModal(false); setImportError(null); }} className="text-gray-500 hover:text-gray-300">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Import into</label>
                <select
                  value={importTargetId}
                  onChange={(e) => setImportTargetId(e.target.value)}
                  disabled={importing}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">New project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1.5">
                  Add this bundle&apos;s signals to an existing project, or create a new one — so re-imports don&apos;t make duplicate projects.
                </p>
              </div>

              {importError && <p className="text-red-400 text-xs">{importError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setShowImportModal(false); setImportError(null); }}
                  disabled={importing}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {importing ? "Importing…" : "Choose .zip & import"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New project modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">New Import Project</h2>
              <button onClick={() => { setShowModal(false); setCreateError(null); }} className="text-gray-500 hover:text-gray-300">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Project name *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createProject()}
                  placeholder="e.g. Conveyor Line 1 — Q2 Export"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Description (optional)</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What PLC / export type is this?"
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {createError && (
                <p className="text-red-400 text-xs">{createError}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setShowModal(false); setCreateError(null); }}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={createProject}
                  disabled={creating || !newName.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : null}
                  {creating ? "Creating…" : "Create Project"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
