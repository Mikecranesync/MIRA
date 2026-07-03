"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight,
  Folder, FolderOpen,
  Cog, Factory, FileText, FileImage, FileSpreadsheet, Layers,
  RefreshCw, FolderPlus, Upload, ChevronsDownUp, ChevronsUpDown,
  Trash2, Pencil, Bot, ShieldCheck, Shield,
} from "lucide-react";
import { API_BASE } from "@/lib/config";
import { NodeChat } from "@/components/namespace/NodeChat";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NamespaceNode {
  id: string;
  name: string;
  kind: string;
  unsPath: string | null;
  filesCount: number;
  status: string | null;
  counts: {
    children: number;
    proposalsPending: number;
    proposalsVerified: number;
  };
  children: NamespaceNode[];
}

interface FileRecord {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  source: "direct" | "upload";
  created_at: string;
  /** Human vouched for this document — retained forever, delete refused. */
  verified: boolean;
  /** Chunked into knowledge_entries (citable by Ask MIRA). */
  indexed: boolean;
}

type EditingState = { nodeId: string; value: string } | null;
type NewFolderState = { parentId: string | null; value: string } | null;
type UploadState = { nodeId: string; state: "uploading" | "done" | "error"; message?: string } | null;

// ── Constants ─────────────────────────────────────────────────────────────────

const EQUIPMENT_KINDS = new Set(["asset", "equipment", "component"]);

function KindIcon({ kind, open, className }: { kind: string; open: boolean; className?: string }) {
  if (kind === "site" || kind === "plant") return <Factory className={className} />;
  if (kind === "asset" || kind === "equipment" || kind === "component") return <Cog className={className} />;
  if (kind === "document") return <FileText className={className} />;
  return open ? <FolderOpen className={className} /> : <Folder className={className} />;
}

function statusColor(status: string | null): string {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s === "active" || s === "operational" || s === "running") return "bg-green-500";
  if (s === "warning" || s === "degraded") return "bg-yellow-400";
  if (s === "fault" || s === "down" || s === "failed") return "bg-red-500";
  return "bg-gray-400";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NamespacePage() {
  const [tree, setTree] = useState<NamespaceNode[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NamespaceNode | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [fileDropTargetId, setFileDropTargetId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [newFolder, setNewFolder] = useState<NewFolderState>(null);
  const [uploadState, setUploadState] = useState<UploadState>(null);
  const [nodeFiles, setNodeFiles] = useState<Record<string, FileRecord[]>>({});
  const [ctxMenu, setCtxMenu] = useState<{ node: NamespaceNode; x: number; y: number } | null>(null);
  const [pendingChat, setPendingChat] = useState(false);
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refreshTree = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/namespace/tree/`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { nodes: NamespaceNode[]; total: number };
      setTree(data.nodes);
      setTotal(data.total);
      setError(null);
      // Update selected node data from fresh tree.
      setSelected((prev) => {
        if (!prev) return prev;
        return findNode(data.nodes, prev.id) ?? prev;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshTree();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshTree]);

  // Expand first two levels by default once tree loads.
  useEffect(() => {
    if (tree.length > 0 && expandedIds.size === 0) {
      const ids = new Set<string>();
      for (const root of tree) {
        ids.add(root.id);
        for (const child of root.children) ids.add(child.id);
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpandedIds(ids);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.length > 0]);

  const loadFiles = useCallback(async (nodeId: string) => {
    if (nodeFiles[nodeId]) return;
    try {
      const res = await fetch(`${API_BASE}/api/namespace/node/${nodeId}/files/`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { files: FileRecord[] };
      setNodeFiles((prev) => ({ ...prev, [nodeId]: data.files }));
    } catch { /* non-fatal */ }
  }, [nodeFiles]);

  const handleSelect = useCallback((node: NamespaceNode) => {
    setSelected(node);
    void loadFiles(node.id);
  }, [loadFiles]);

  // #1900 deep-link: `/namespace?node=<id|inbox>&chat=1` selects a node (used by
  // the post-upload "Ask MIRA about this manual" CTA — lands the user straight on
  // the Inbox node that holds their just-uploaded manual) and optionally opens its
  // Ask MIRA panel. Read once, after the tree has loaded so the target exists.
  useEffect(() => {
    if (deepLinkApplied || loading || tree.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeepLinkApplied(true);
    const params = new URLSearchParams(window.location.search);
    const nodeParam = params.get("node");
    if (!nodeParam) return;
    const chain =
      nodeParam === "inbox"
        ? findChain(tree, (n) => n.unsPath === "inbox")
        : findChain(tree, (n) => n.id === nodeParam);
    if (!chain || chain.length === 0) return;
    const target = chain[chain.length - 1];
    setExpandedIds((prev) => new Set([...prev, ...chain.map((n) => n.id)]));
    setSelected(target);
    void loadFiles(target.id);
    if (params.get("chat") === "1") setPendingChat(true);
  }, [deepLinkApplied, loading, tree, loadFiles]);

  // ── Node drag-and-drop (reparent) ──────────────────────────────────────────

  async function handleNodeDrop(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    showToast("Moving…");
    try {
      const res = await fetch(`${API_BASE}/api/namespace/node/${sourceId}/`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newParentId: targetId, reason: "drag-and-drop" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshTree();
      showToast("Moved");
    } catch (e) {
      showToast(`Move failed: ${(e as Error).message}`);
    } finally {
      setDraggingId(null);
      setDropTargetId(null);
    }
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  async function commitRename(nodeId: string, newName: string) {
    setEditing(null);
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`${API_BASE}/api/namespace/node/${nodeId}/`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newName: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshTree();
    } catch (e) {
      showToast(`Rename failed: ${(e as Error).message}`);
    }
  }

  // ── Create folder ──────────────────────────────────────────────────────────

  async function commitNewFolder(parentId: string | null, name: string) {
    setNewFolder(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`${API_BASE}/api/namespace/node/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: parentId ?? undefined, name: trimmed, kind: "area" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (parentId) {
        setExpandedIds((prev) => new Set([...prev, parentId]));
      }
      await refreshTree();
    } catch (e) {
      showToast(`Create failed: ${(e as Error).message}`);
    }
  }

  // ── Delete node ────────────────────────────────────────────────────────────

  async function handleDeleteNode(nodeId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/namespace/node/${nodeId}/`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSelected((prev) => (prev?.id === nodeId ? null : prev));
      await refreshTree();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`);
    }
  }

  // ── File upload ────────────────────────────────────────────────────────────

  async function uploadFiles(nodeId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadState({ nodeId, state: "uploading" });
    try {
      const warnings: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${API_BASE}/api/namespace/node/${nodeId}/files/`, {
          method: "POST",
          body: fd,
        });
        const body = await res.json().catch(() => ({})) as { error?: string; warning?: string };
        if (!res.ok) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        // Filed but not indexed (e.g. an image-only PDF): the original is kept
        // in the cabinet — tell the user why Ask MIRA won't cite it.
        if (body.warning) warnings.push(`${file.name}: ${body.warning}`);
      }
      setUploadState({ nodeId, state: "done" });
      // Invalidate file cache so next view reload refetches.
      setNodeFiles((prev) => { const n = { ...prev }; delete n[nodeId]; return n; });
      if (selected?.id === nodeId) void loadFiles(nodeId);
      await refreshTree();
      showToast(warnings.length > 0
        ? `Filed, but not indexed — ${warnings[0]}`
        : `${files.length} file${files.length === 1 ? "" : "s"} uploaded`);
      setTimeout(() => setUploadState(null), 2000);
    } catch (e) {
      // #1899: keep the failure VISIBLE — a durable error row in the Files
      // panel (below), not just a 2s toast that the user can miss while the
      // panel still reads "No files attached" (i.e. "nothing happened").
      const message = (e as Error).message;
      setUploadState({ nodeId, state: "error", message });
      showToast(`Upload failed: ${message}`);
    }
  }

  // ── File delete ────────────────────────────────────────────────────────────

  async function handleDeleteFile(fileId: string, nodeId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/namespace/files/${fileId}/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNodeFiles((prev) => ({
        ...prev,
        [nodeId]: (prev[nodeId] ?? []).filter((f) => f.id !== fileId),
      }));
      await refreshTree();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`);
    }
  }

  // ── File verify (kept forever) ─────────────────────────────────────────────

  async function handleVerifyFile(fileId: string, nodeId: string, verified: boolean) {
    try {
      const res = await fetch(`${API_BASE}/api/namespace/files/${fileId}/verify/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verified }),
      });
      if (res.status === 403) {
        showToast("Only workspace admins can verify documents");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setNodeFiles((prev) => ({
        ...prev,
        [nodeId]: (prev[nodeId] ?? []).map((f) => (f.id === fileId ? { ...f, verified } : f)),
      }));
      showToast(verified ? "Verified — this document is now kept forever" : "Verification removed");
    } catch (e) {
      showToast(`Verify failed: ${(e as Error).message}`);
    }
  }

  // ── Tree expand/collapse ───────────────────────────────────────────────────

  function expandAll() {
    const ids = new Set<string>();
    const walk = (nodes: NamespaceNode[]) => {
      for (const n of nodes) { ids.add(n.id); walk(n.children); }
    };
    walk(tree);
    setExpandedIds(ids);
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  // ── Derived counts for status bar ──────────────────────────────────────────

  const { folderCount, fileCount } = useMemo(() => {
    const files = selected ? (nodeFiles[selected.id] ?? []).length : 0;
    const folders = selected?.counts.children ?? 0;
    return { folderCount: folders, fileCount: files };
  }, [selected, nodeFiles]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col" data-testid="namespace-page">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-gray-400 bg-[#d4d0c8] p-1">
        <ToolbarButton
          icon={<FolderPlus className="h-3.5 w-3.5" />}
          label="New Folder"
          testId="toolbar-new-folder"
          // #1917: keep New Folder disabled until the initial tree load resolves.
          // `loading` starts true (so the SSR HTML renders the button disabled)
          // and only flips false inside a post-hydration effect — so a click on a
          // fresh empty namespace can't land before React wires up onClick and get
          // silently dropped (the input never appeared). Native disabled blocks the
          // early click; Playwright's .click() auto-waits for "enabled", so the
          // first interaction always happens once the page is truly interactive.
          disabled={loading}
          title={loading ? "Loading namespace…" : "Create a new folder"}
          onClick={() => setNewFolder({ parentId: selected?.id ?? null, value: "" })}
        />
        <ToolbarButton
          icon={<Upload className="h-3.5 w-3.5" />}
          label="Upload"
          testId="toolbar-upload"
          disabled={!selected}
          title={selected
            ? `Upload files into "${selected.name}"`
            : "Select a folder first, then upload files into it"}
          onClick={() => {
            if (!selected) return;
            fileInputRef.current?.click();
          }}
        />
        <div className="mx-1 h-5 w-px bg-gray-500" />
        <ToolbarButton
          icon={<ChevronsUpDown className="h-3.5 w-3.5" />}
          label="Expand All"
          onClick={expandAll}
        />
        <ToolbarButton
          icon={<ChevronsDownUp className="h-3.5 w-3.5" />}
          label="Collapse All"
          onClick={collapseAll}
        />
        <div className="ml-auto">
          <ToolbarButton
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Refresh"
            onClick={() => void refreshTree()}
          />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="namespace-file-input"
        onChange={(e) => {
          if (selected) void uploadFiles(selected.id, e.target.files);
          e.target.value = "";
        }}
      />

      {/* Split pane */}
      <div className="flex min-h-0 flex-1">
        {/* Tree panel */}
        <div
          className="w-[280px] shrink-0 overflow-auto border-r border-gray-400 bg-[#f0f0f0] font-mono text-[13px]"
          data-testid="namespace-tree-panel"
        >
          {loading ? (
            <div className="p-3 text-xs text-gray-500">Loading…</div>
          ) : error ? (
            <div className="p-3 text-xs text-red-600">{error}</div>
          ) : (
            <div className="p-1">
              {/* Root-level new folder input */}
              {newFolder && newFolder.parentId === null && (
                <NewFolderRow
                  value={newFolder.value}
                  onChange={(v) => setNewFolder({ parentId: null, value: v })}
                  onCommit={(v) => void commitNewFolder(null, v)}
                  onCancel={() => setNewFolder(null)}
                />
              )}
              {tree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selected?.id ?? null}
                  expandedIds={expandedIds}
                  draggingId={draggingId}
                  dropTargetId={dropTargetId}
                  fileDropTargetId={fileDropTargetId}
                  editing={editing}
                  newFolder={newFolder}
                  uploadState={uploadState}
                  onSelect={handleSelect}
                  onExpand={(id, open) => setExpandedIds((prev) => {
                    const s = new Set(prev);
                    if (open) s.add(id); else s.delete(id);
                    return s;
                  })}
                  onDragStart={setDraggingId}
                  onDragOver={setDropTargetId}
                  onNodeDrop={handleNodeDrop}
                  onFileDragOver={setFileDropTargetId}
                  onFileDrop={(nodeId, files) => void uploadFiles(nodeId, files)}
                  onEditStart={(nodeId, name) => setEditing({ nodeId, value: name })}
                  onEditChange={(v) => setEditing((prev) => prev ? { ...prev, value: v } : prev)}
                  onEditCommit={(nodeId, v) => void commitRename(nodeId, v)}
                  onEditCancel={() => setEditing(null)}
                  onDelete={handleDeleteNode}
                  onNewFolder={(parentId) => {
                    setNewFolder({ parentId, value: "" });
                    setExpandedIds((prev) => new Set([...prev, parentId]));
                  }}
                  onNewFolderChange={(v) => setNewFolder((prev) => prev ? { ...prev, value: v } : prev)}
                  onNewFolderCommit={(parentId, v) => void commitNewFolder(parentId, v)}
                  onNewFolderCancel={() => setNewFolder(null)}
                  onUpload={(nodeId) => {
                    fileInputRef.current?.click();
                    handleSelect(findNode(tree, nodeId) ?? selected!);
                  }}
                  onContextMenu={(ctxNode, x, y) => setCtxMenu({ node: ctxNode, x, y })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Content panel */}
        <div
          className="flex min-w-0 flex-1 flex-col bg-white font-mono text-[13px]"
          data-testid="namespace-content-panel"
          onDragOver={(e) => {
            if (selected && e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (selected && e.dataTransfer.files.length > 0) {
              void uploadFiles(selected.id, e.dataTransfer.files);
            }
          }}
        >
          {selected ? (
            <ContentPanel
              node={selected}
              files={nodeFiles[selected.id]}
              uploadState={uploadState}
              openChat={pendingChat}
              onChatOpened={() => setPendingChat(false)}
              onSelect={handleSelect}
              onDeleteFile={(fileId) => handleDeleteFile(fileId, selected.id)}
              onVerifyFile={(fileId, verified) => handleVerifyFile(fileId, selected.id, verified)}
              onUpload={() => fileInputRef.current?.click()}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              {loading ? null : tree.length === 0 ? (
                <EmptyState onNewFolder={() => setNewFolder({ parentId: null, value: "" })} />
              ) : (
                "Select a folder to view its contents and upload files"
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-gray-400 bg-[#d4d0c8] px-2 py-0.5 text-[11px]">
        <span>
          {selected
            ? `${folderCount + fileCount} object${folderCount + fileCount === 1 ? "" : "s"} (${folderCount} folder${folderCount === 1 ? "" : "s"}, ${fileCount} file${fileCount === 1 ? "" : "s"})`
            : `${total} entities total`}
        </span>
        <span className="truncate pl-4 text-gray-600">{selected?.unsPath ?? ""}</span>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded bg-slate-900 px-4 py-2 text-sm text-white shadow-lg" data-testid="namespace-toast">
          {toast}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenuOverlay
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          showCreate={!ctxMenu.node.id.startsWith("synthetic:")}
          onNewFolder={() => {
            setCtxMenu(null);
            setNewFolder({ parentId: ctxMenu.node.id, value: "" });
            setExpandedIds((prev) => new Set([...prev, ctxMenu.node.id]));
          }}
          onRename={() => {
            setCtxMenu(null);
            setEditing({ nodeId: ctxMenu.node.id, value: ctxMenu.node.name });
          }}
          onUpload={() => {
            setCtxMenu(null);
            handleSelect(ctxMenu.node);
            fileInputRef.current?.click();
          }}
          onDelete={() => {
            const id = ctxMenu.node.id;
            setCtxMenu(null);
            void handleDeleteNode(id);
          }}
        />
      )}
    </div>
  );
}

// ── TreeNode ──────────────────────────────────────────────────────────────────

function TreeNode({
  node, depth, selectedId, expandedIds,
  draggingId, dropTargetId, fileDropTargetId,
  editing, newFolder, uploadState,
  onSelect, onExpand,
  onDragStart, onDragOver, onNodeDrop,
  onFileDragOver, onFileDrop,
  onEditStart, onEditChange, onEditCommit, onEditCancel,
  onDelete, onNewFolder, onNewFolderChange, onNewFolderCommit, onNewFolderCancel,
  onUpload, onContextMenu,
}: {
  node: NamespaceNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  draggingId: string | null;
  dropTargetId: string | null;
  fileDropTargetId: string | null;
  editing: EditingState;
  newFolder: NewFolderState;
  uploadState: UploadState;
  onSelect: (n: NamespaceNode) => void;
  onExpand: (id: string, open: boolean) => void;
  onDragStart: (id: string | null) => void;
  onDragOver: (id: string | null) => void;
  onNodeDrop: (sourceId: string, targetId: string) => void;
  onFileDragOver: (id: string | null) => void;
  onFileDrop: (nodeId: string, files: FileList) => void;
  onEditStart: (nodeId: string, name: string) => void;
  onEditChange: (v: string) => void;
  onEditCommit: (nodeId: string, v: string) => void;
  onEditCancel: () => void;
  onDelete: (nodeId: string) => void;
  onNewFolder: (parentId: string) => void;
  onNewFolderChange: (v: string) => void;
  onNewFolderCommit: (parentId: string, v: string) => void;
  onNewFolderCancel: () => void;
  onUpload: (nodeId: string) => void;
  onContextMenu: (node: NamespaceNode, x: number, y: number) => void;
}) {
  const open = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0 || (newFolder?.parentId === node.id);
  const isSelected = node.id === selectedId;
  const isDragging = draggingId === node.id;
  const isNodeDropTarget = dropTargetId === node.id && draggingId !== node.id;
  const isFileDropTarget = fileDropTargetId === node.id;
  const isEditing = editing?.nodeId === node.id;
  const isUploading = uploadState?.nodeId === node.id && uploadState.state === "uploading";

  const indent = depth * 14 + 6;
  const dotColor = statusColor(node.status);

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          onDragStart(node.id);
        }}
        onDragEnd={() => { onDragStart(null); onDragOver(null); }}
        onDragOver={(e) => {
          if (draggingId && draggingId !== node.id) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onDragOver(node.id);
          } else if (!draggingId && e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            onFileDragOver(node.id);
          }
        }}
        onDragLeave={() => { onDragOver(null); onFileDragOver(null); }}
        onDrop={(e) => {
          e.preventDefault();
          if (draggingId) {
            onNodeDrop(draggingId, node.id);
          } else if (e.dataTransfer.files.length > 0) {
            onFileDrop(node.id, e.dataTransfer.files);
            onFileDragOver(null);
          }
        }}
        className={[
          "flex h-7 cursor-pointer select-none items-center gap-1",
          isSelected ? "bg-[#000080] text-white" : "hover:bg-[#c8c8c8]",
          isDragging ? "opacity-40" : "",
          isNodeDropTarget ? "bg-blue-200 outline-2 outline-dashed outline-blue-500" : "",
          isFileDropTarget && !isSelected ? "bg-[#c0c0ff] outline-2 outline-dashed outline-blue-600" : "",
        ].filter(Boolean).join(" ")}
        style={{ paddingLeft: `${indent}px` }}
        data-testid="namespace-node"
        data-node-id={node.id}
        onClick={() => {
          onSelect(node);
          if (hasChildren || node.children.length > 0) onExpand(node.id, !open);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEditStart(node.id, node.name);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(node, e.clientX, e.clientY);
        }}
      >
        <button
          type="button"
          className="flex h-4 w-4 items-center justify-center"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onExpand(node.id, !open); }}
        >
          {hasChildren
            ? open
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />
            : null}
        </button>

        <KindIcon
          kind={node.kind}
          open={open}
          className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-white" : "text-gray-600"}`}
        />

        {isEditing ? (
          <input
            autoFocus
            className="ml-1 h-5 flex-1 rounded border border-blue-400 bg-white px-1 text-[12px] text-black"
            value={editing.value}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditCommit(node.id, editing.value);
              if (e.key === "Escape") onEditCancel();
              e.stopPropagation();
            }}
            onBlur={() => onEditCommit(node.id, editing.value)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={`ml-0.5 truncate ${isSelected ? "text-white" : "text-gray-900"}`}>
            {node.name}
          </span>
        )}

        {dotColor && (
          <span className={`ml-1 h-2 w-2 shrink-0 rounded-full ${dotColor}`} title={node.status ?? ""} />
        )}
        {node.filesCount > 0 && (
          <span className={`ml-0.5 text-[11px] ${isSelected ? "text-blue-200" : "text-gray-400"}`}>
            ({node.filesCount})
          </span>
        )}
        {isUploading && (
          <span className="ml-1 text-[10px] text-blue-400">↑</span>
        )}
      </div>

      {open && (
        <div>
          {newFolder?.parentId === node.id && (
            <NewFolderRow
              indent={indent + 14}
              value={newFolder.value}
              onChange={onNewFolderChange}
              onCommit={(v) => onNewFolderCommit(node.id, v)}
              onCancel={onNewFolderCancel}
            />
          )}
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              draggingId={draggingId}
              dropTargetId={dropTargetId}
              fileDropTargetId={fileDropTargetId}
              editing={editing}
              newFolder={newFolder}
              uploadState={uploadState}
              onSelect={onSelect}
              onExpand={onExpand}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onNodeDrop={onNodeDrop}
              onFileDragOver={onFileDragOver}
              onFileDrop={onFileDrop}
              onEditStart={onEditStart}
              onEditChange={onEditChange}
              onEditCommit={onEditCommit}
              onEditCancel={onEditCancel}
              onDelete={onDelete}
              onNewFolder={onNewFolder}
              onNewFolderChange={onNewFolderChange}
              onNewFolderCommit={onNewFolderCommit}
              onNewFolderCancel={onNewFolderCancel}
              onUpload={onUpload}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ContentPanel ──────────────────────────────────────────────────────────────

function ContentPanel({
  node, files, uploadState, openChat, onChatOpened,
  onSelect, onDeleteFile, onVerifyFile, onUpload,
}: {
  node: NamespaceNode;
  files: FileRecord[] | undefined;
  uploadState: UploadState;
  openChat: boolean;
  onChatOpened: () => void;
  onSelect: (n: NamespaceNode) => void;
  onDeleteFile: (fileId: string) => void;
  onVerifyFile: (fileId: string, verified: boolean) => void;
  onUpload: () => void;
}) {
  const breadcrumbs = useMemo(() => {
    if (!node.unsPath) return [{ label: node.name, path: null }];
    return node.unsPath.split(".").map((seg, i, arr) => ({
      label: seg,
      path: arr.slice(0, i + 1).join("."),
    }));
  }, [node]);

  const isEquipment = EQUIPMENT_KINDS.has(node.kind);
  const [activeTab, setActiveTab] = useState<"children" | "files" | "proposals" | "details" | "workorders">("children");
  // folder=brain: "Ask MIRA" is available at every node — the answer is grounded in
  // the docs attached to this node and everything beneath it (subtree retrieval).
  const [showChat, setShowChat] = useState(false);

  // #1900: a deep-link (`?chat=1`) auto-opens Ask MIRA after upload. Fire once per
  // signal so the user can still close it; the parent resets `openChat` immediately.
  useEffect(() => {
    if (openChat) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowChat(true);
      onChatOpened();
    }
  }, [openChat, onChatOpened]);

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-1.5 text-[12px] text-gray-600">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path ?? crumb.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-gray-400" />}
              <span className={i === breadcrumbs.length - 1 ? "font-semibold text-gray-900" : "cursor-default"}>
                {crumb.label}
              </span>
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowChat((v) => !v)}
          data-testid="namespace-ask-mira"
          className={[
            "flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
            showChat
              ? "bg-[#0000c0] text-white"
              : "border border-[#0000c0] text-[#0000c0] hover:bg-[#e8e8f8]",
          ].join(" ")}
        >
          <Bot className="h-3 w-3" />
          {showChat ? "Close MIRA" : "Ask MIRA"}
        </button>
      </div>

      {/* Tabs for equipment nodes */}
      {isEquipment && !showChat && (
        <div className="flex gap-0 border-b border-gray-200 bg-[#f8f8f8] px-2 pt-1">
          {(["children", "files", "proposals", "details", "workorders"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                "px-3 py-1 text-[12px] capitalize border-t border-l border-r rounded-t",
                activeTab === tab
                  ? "bg-white border-gray-300 text-gray-900 font-medium -mb-px"
                  : "border-transparent text-gray-500 hover:text-gray-800",
              ].join(" ")}
            >
              {tab === "workorders" ? "Work Orders" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      )}

      {showChat ? (
        <div className="min-h-0 flex-1">
          <NodeChat key={node.id} nodeId={node.id} nodeName={node.name} unsPath={node.unsPath} />
        </div>
      ) : (
      <div className="flex-1 overflow-auto p-3">
        {/* Children section (always shown for non-equipment, or when on children tab) */}
        {(!isEquipment || activeTab === "children") && (
          <ChildrenSection node={node} onSelect={onSelect} />
        )}

        {/* Files section */}
        {(!isEquipment || activeTab === "files") && (
          <FilesSection
            nodeId={node.id}
            files={files}
            uploadState={uploadState}
            onDeleteFile={onDeleteFile}
            onVerifyFile={onVerifyFile}
            onUpload={onUpload}
          />
        )}

        {/* Proposals stub */}
        {isEquipment && activeTab === "proposals" && (
          <div className="text-sm text-gray-500 pt-4">
            {node.counts.proposalsPending + node.counts.proposalsVerified === 0
              ? "No proposals for this node."
              : `${node.counts.proposalsPending} pending · ${node.counts.proposalsVerified} verified`}
          </div>
        )}

        {/* Details tab */}
        {isEquipment && activeTab === "details" && (
          <DetailsSection node={node} />
        )}

        {/* Work Orders stub */}
        {isEquipment && activeTab === "workorders" && (
          <div className="text-sm text-gray-500 pt-4">Work order view coming soon.</div>
        )}
      </div>
      )}
    </div>
  );
}

function ChildrenSection({ node, onSelect }: {
  node: NamespaceNode;
  onSelect: (n: NamespaceNode) => void;
}) {
  if (node.children.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">Folders</div>
      <div className="flex flex-wrap gap-3">
        {node.children.map((child) => (
          <button
            key={child.id}
            type="button"
            onDoubleClick={() => onSelect(child)}
            onClick={() => onSelect(child)}
            className="flex w-24 flex-col items-center gap-1 rounded p-2 text-center hover:bg-[#e8e8f8] active:bg-[#c0c0ff]"
          >
            <KindIcon kind={child.kind} open={false} className="h-8 w-8 text-[#0000c0]" />
            <span className="text-[11px] leading-tight text-gray-800 break-words w-full">{child.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function isPicture(f: FileRecord): boolean {
  return f.source === "direct" && f.mime_type.startsWith("image/");
}

function FileTypeIcon({ mime, className }: { mime: string; className?: string }) {
  if (mime.startsWith("image/")) return <FileImage className={className} />;
  if (mime === "text/csv" || mime.includes("spreadsheet") || mime.includes("ms-excel")) {
    return <FileSpreadsheet className={className} />;
  }
  return <FileText className={className} />;
}

/** Green shield chip on verified rows — the filing cabinet's "kept forever" mark. */
function VerifiedBadge() {
  return (
    <span
      className="ml-1 inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700"
      title="Verified — this document is retained forever"
      data-testid="file-verified-badge"
    >
      <ShieldCheck className="h-3 w-3" />
      verified
    </span>
  );
}

/** Verify / un-verify toggle. The server gates on namespace.admin (403 → toast). */
function VerifyToggle({ file, onVerifyFile }: {
  file: FileRecord;
  onVerifyFile: (fileId: string, verified: boolean) => void;
}) {
  return (
    <button
      type="button"
      data-testid="file-verify-toggle"
      title={file.verified
        ? "Un-verify (removes the keep-forever protection)"
        : "Verify — keep this document forever"}
      className={file.verified
        ? "text-emerald-600 hover:text-emerald-800"
        : "hidden group-hover:inline text-gray-400 hover:text-emerald-600"}
      onClick={() => onVerifyFile(file.id, !file.verified)}
    >
      {file.verified ? <ShieldCheck className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
    </button>
  );
}

function FilesSection({ nodeId, files, uploadState, onDeleteFile, onVerifyFile, onUpload }: {
  nodeId: string;
  files: FileRecord[] | undefined;
  uploadState: UploadState;
  onDeleteFile: (fileId: string) => void;
  onVerifyFile: (fileId: string, verified: boolean) => void;
  onUpload: () => void;
}) {
  const isUploading = uploadState?.nodeId === nodeId && uploadState.state === "uploading";
  const isError = uploadState?.nodeId === nodeId && uploadState.state === "error";

  if (files === undefined && !isUploading && !isError) return null;

  const pictures = (files ?? []).filter(isPicture);
  const documents = (files ?? []).filter((f) => !isPicture(f));

  return (
    <div>
      {isUploading && (
        <div className="mb-2 text-xs text-blue-500 animate-pulse">Uploading…</div>
      )}
      {isError && (
        // #1899: durable failure row so a 500 never looks like "nothing happened".
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          <span className="font-medium">Upload failed.</span>{" "}
          {uploadState?.message ?? "Please try again."}{" "}
          <button type="button" onClick={onUpload} className="underline hover:opacity-80">
            Retry
          </button>
        </div>
      )}
      {files === undefined || files.length === 0 ? (
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">Files</div>
          <div className="text-xs text-gray-400">
            No files attached.{" "}
            <button type="button" onClick={onUpload} className="text-blue-500 hover:underline">
              Upload one
            </button>{" "}
            or drag a file onto this folder.
          </div>
        </div>
      ) : (
        <>
          {/* Pictures — thumbnail grid; raster images render inline (click to view). */}
          {pictures.length > 0 && (
            <div className="mb-4" data-testid="pictures-grid">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">Pictures</div>
              <div className="flex flex-wrap gap-3">
                {pictures.map((f) => (
                  <div key={f.id} className="group w-28">
                    <a
                      href={`${API_BASE}/api/namespace/files/${f.id}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`${f.filename} — ${formatBytes(f.size_bytes)}`}
                      className="block h-24 w-28 overflow-hidden rounded border border-gray-300 bg-[#f8f8f8] hover:border-[#0000c0]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${API_BASE}/api/namespace/files/${f.id}`}
                        alt={f.filename}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </a>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-gray-700" title={f.filename}>
                        {f.filename}
                      </span>
                      <VerifyToggle file={f} onVerifyFile={onVerifyFile} />
                      {!f.verified && (
                        <button
                          type="button"
                          title="Remove file"
                          className="hidden group-hover:inline text-red-400 hover:text-red-600"
                          onClick={() => onDeleteFile(f.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Documents & other files */}
          {documents.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">
                {pictures.length > 0 ? "Documents & Files" : "Files"}
              </div>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-[11px] text-gray-400">
                    <th className="pb-1 pr-4 font-normal">Name</th>
                    <th className="pb-1 pr-4 font-normal">Size</th>
                    <th className="pb-1 pr-4 font-normal">Date</th>
                    <th className="pb-1 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((f) => (
                    <tr key={f.id} className="group hover:bg-[#e8e8f8]">
                      <td className="py-0.5 pr-4">
                        {f.source === "upload" ? (
                          // #1900: a legacy indexed PDF (chunked into knowledge_entries,
                          // citable by Ask MIRA) with no parked original to download —
                          // read-only "indexed" entry rather than a broken link.
                          <span className="flex items-center gap-1.5 text-gray-800">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            {f.filename}
                            <span className="ml-1 rounded bg-green-100 px-1 text-[10px] text-green-700">
                              indexed
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <a
                              href={`${API_BASE}/api/namespace/files/${f.id}`}
                              className="flex min-w-0 items-center gap-1.5 text-blue-700 hover:underline"
                              download={f.filename}
                            >
                              <FileTypeIcon mime={f.mime_type} className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                              <span className="truncate">{f.filename}</span>
                            </a>
                            {f.indexed && (
                              <span
                                className="rounded bg-green-100 px-1 text-[10px] text-green-700"
                                title="Chunked into the knowledge base — Ask MIRA can cite it"
                              >
                                indexed
                              </span>
                            )}
                            {f.verified && <VerifiedBadge />}
                          </span>
                        )}
                      </td>
                      <td className="py-0.5 pr-4 text-gray-500">{formatBytes(f.size_bytes)}</td>
                      <td className="py-0.5 pr-4 text-gray-400">{formatDate(f.created_at)}</td>
                      <td className="py-0.5 text-right">
                        {f.source === "direct" && (
                          <span className="inline-flex items-center gap-1.5">
                            <VerifyToggle file={f} onVerifyFile={onVerifyFile} />
                            {!f.verified && (
                              <button
                                type="button"
                                title="Remove file"
                                className="hidden group-hover:inline text-red-400 hover:text-red-600"
                                onClick={() => onDeleteFile(f.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailsSection({ node }: { node: NamespaceNode }) {
  return (
    <dl className="space-y-2 pt-2 text-[13px]">
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-gray-400">Kind</dt>
        <dd className="text-gray-900">{node.kind}</dd>
      </div>
      {node.unsPath && (
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-gray-400">UNS path</dt>
          <dd className="break-all font-mono text-[11px] text-gray-700">{node.unsPath}</dd>
        </div>
      )}
      {node.status && (
        <div className="flex items-center gap-2">
          <dt className="w-28 shrink-0 text-gray-400">Status</dt>
          <dd className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${statusColor(node.status)}`} />
            <span className="text-gray-900">{node.status}</span>
          </dd>
        </div>
      )}
    </dl>
  );
}

// ── Small components ──────────────────────────────────────────────────────────

function ToolbarButton({
  icon, label, onClick, disabled, testId, title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  title?: string;
}) {
  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      title={title}
      aria-label={title ? `${label} — ${title}` : label}
      className="flex items-center gap-1 border border-gray-500 bg-[#d4d0c8] px-2 py-0.5 text-[12px] hover:bg-[#e8e8e8] disabled:cursor-not-allowed disabled:opacity-40 active:border-inset"
    >
      {icon}
      {label}
    </button>
  );
  // A disabled <button> swallows pointer events in Chrome, so its own `title`
  // tooltip never shows — leaving the user staring at a greyed button with no
  // explanation (#2182). Wrap it in a span that carries the tooltip so the
  // "why is this disabled / what to do next" hint is reachable on hover.
  return disabled && title
    ? <span title={title} className="inline-flex">{button}</span>
    : button;
}

function CtxMenuItem({
  icon, label, onSelect, className = "",
}: {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-[#000080] hover:text-white ${className}`}
      onMouseDown={(e) => { e.preventDefault(); onSelect(); }}
    >
      {icon}
      {label}
    </button>
  );
}

function ContextMenuOverlay({
  x, y, onClose,
  onNewFolder, onRename, onUpload, onDelete, showCreate = true,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onUpload: () => void;
  onDelete: () => void;
  showCreate?: boolean;
}) {
  useEffect(() => {
    const handler = () => onClose();
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("click", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  return (
    <div
      className="fixed z-50 min-w-[160px] rounded border border-gray-300 bg-white py-1 shadow-lg text-[13px]"
      style={{ top: y, left: x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {showCreate && <CtxMenuItem icon={<FolderPlus className="h-3.5 w-3.5" />} label="New Folder" onSelect={onNewFolder} />}
      <CtxMenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Rename" onSelect={onRename} />
      <CtxMenuItem icon={<Upload className="h-3.5 w-3.5" />} label="Upload Files" onSelect={onUpload} />
      <div className="my-1 h-px bg-gray-200" />
      <CtxMenuItem
        icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
        label="Delete"
        className="text-red-600"
        onSelect={onDelete}
      />
    </div>
  );
}

function NewFolderRow({
  indent = 6, value, onChange, onCommit, onCancel,
}: {
  indent?: number;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex h-7 items-center gap-1" style={{ paddingLeft: `${indent}px` }}>
      <span className="h-4 w-4" />
      <Folder className="h-3.5 w-3.5 text-gray-400" />
      <input
        autoFocus
        data-testid="new-folder-input"
        className="h-5 flex-1 rounded border border-blue-400 bg-white px-1 text-[12px] text-black"
        placeholder="Folder name…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(value);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => { if (value.trim()) onCommit(value); else onCancel(); }}
      />
    </div>
  );
}

function EmptyState({ onNewFolder }: { onNewFolder: () => void }) {
  return (
    <div className="text-center" data-testid="namespace-empty">
      <Layers className="mx-auto h-10 w-10 text-gray-200" />
      <p className="mt-3 text-sm text-gray-500">Your namespace is empty.</p>
      <p className="mt-1 text-xs text-gray-400">Create a first folder, then select it to upload manuals and files.</p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onNewFolder}
          className="inline-flex items-center gap-1 rounded border border-gray-500 bg-[#d4d0c8] px-3 py-1 text-[12px] text-gray-900 hover:bg-[#e8e8e8] active:border-inset"
          data-testid="namespace-empty-new-folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          New Folder
        </button>
        <Link
          href="/documents"
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1 text-[12px] text-gray-700 hover:bg-gray-50"
          data-testid="namespace-empty-upload-documents"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload manual
        </Link>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findNode(nodes: NamespaceNode[], id: string): NamespaceNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Return the root→match chain (inclusive) for the first node matching `pred`, so
 *  the caller can expand every ancestor and select the target. Used by the #1900
 *  deep-link. */
function findChain(
  nodes: NamespaceNode[],
  pred: (n: NamespaceNode) => boolean,
  trail: NamespaceNode[] = [],
): NamespaceNode[] | null {
  for (const n of nodes) {
    const next = [...trail, n];
    if (pred(n)) return next;
    const deeper = findChain(n.children, pred, next);
    if (deeper) return deeper;
  }
  return null;
}
