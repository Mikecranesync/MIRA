"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { Loader2, Paperclip, X, FolderOpen, Package, Smartphone } from "lucide-react";
import { API_BASE, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";

/**
 * Inline create form for a child namespace node.
 *
 * Spec: docs/superpowers/specs/2026-05-21-namespace-tree-inline-create-goal-prompt.md
 *
 * The card is rendered directly under the parent row (TreeNode handles the
 * indent). All UI is mobile-first — tap targets ≥44px, no hover-dependent
 * affordances.
 *
 * Flow (Save):
 *   1. Local validate (name, type).
 *   2. POST /api/namespace/node {parentId, kind, name}.
 *   3. If a file was attached, upload it with the new node's unsPath.
 *   4. Notify parent (refetch tree, close card).
 *
 * Three attach sources: Google Drive, Dropbox, Upload-from-device. Picking
 * a file does NOT upload; the upload runs after node creation so the file
 * binds to the node's uns_path.
 */

export type Picked =
  | { kind: "local"; file: File }
  | {
      kind: "cloud";
      provider: "google" | "dropbox";
      externalFileId?: string;
      externalDownloadUrl?: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      externalCreatedAt: string | null;
    };

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "site", label: "Site" },
  { value: "area", label: "Area" },
  { value: "line", label: "Line" },
  { value: "equipment", label: "Equipment" },
  { value: "component", label: "Component" },
  { value: "namespace", label: "Namespace (group/folder)" },
  { value: "__custom__", label: "Custom…" },
];

const NAME_LIMIT = 200;

declare global {
  interface Window {
    gapi?: {
      load: (api: string, cb: () => void) => void;
    };
    google?: {
      picker: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new () => GoogleDocsView;
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: string };
      };
    };
    Dropbox?: {
      choose: (opts: {
        success: (
          files: Array<{
            link: string;
            name: string;
            bytes: number;
            icon: string;
            client_modified?: string;
          }>,
        ) => void;
        cancel?: () => void;
        linkType: "direct" | "preview";
        multiselect: boolean;
        extensions: string[];
      }) => void;
    };
  }
}

interface GoogleDocsView {
  setMimeTypes: (types: string) => GoogleDocsView;
  setIncludeFolders: (include: boolean) => GoogleDocsView;
  setSelectFolderEnabled: (enabled: boolean) => GoogleDocsView;
}

interface GooglePickerBuilder {
  addView: (view: GoogleDocsView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (id: string) => GooglePickerBuilder;
  enableFeature: (feat: string) => GooglePickerBuilder;
  setCallback: (
    cb: (data: {
      action: string;
      docs?: Array<{
        id: string;
        name: string;
        mimeType: string;
        sizeBytes: number;
        lastEditedUtc?: number;
      }>;
    }) => void,
  ) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

const ACCEPTED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
].join(",");

const DROPBOX_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const MAX_BYTES = MAX_UPLOAD_BYTES;

function mimeFromExt(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".heic")) return "image/heic";
  if (n.endsWith(".heif")) return "image/heif";
  return "application/octet-stream";
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || ""
  );
}

interface ExistingNameMap {
  /** Map of parent unsPath → set of immediate child slugs already used. */
  childSlugsByParent: Map<string, Set<string>>;
}

export function CreateChildCard({
  parentId,
  parentName,
  parentPath,
  existingSiblings,
  onCreated,
  onCancel,
  depth,
}: {
  parentId: string;
  parentName: string;
  parentPath: string;
  /** Immediate child slugs under this parent (for client-side duplicate check). */
  existingSiblings: string[];
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
  /** Tree depth — used for indent. */
  depth: number;
}) {
  const [kind, setKind] = useState<string>("");
  const [customKind, setCustomKind] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    kind?: string;
    file?: string;
    submit?: string;
  }>({});

  const [googleReady, setGoogleReady] = useState(false);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [dropboxReady, setDropboxReady] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [dropboxAvailable, setDropboxAvailable] = useState(false);
  const [dropboxKey, setDropboxKey] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/picker/google/token/`)
      .then((r) => setGoogleAvailable(r.ok))
      .catch(() => setGoogleAvailable(false));
    fetch(`${API_BASE}/api/picker/dropbox/key/`)
      .then(async (r) => {
        if (!r.ok) return setDropboxAvailable(false);
        try {
          const { appKey } = (await r.json()) as { appKey?: string };
          if (appKey) {
            setDropboxKey(appKey);
            setDropboxAvailable(true);
          } else {
            setDropboxAvailable(false);
          }
        } catch {
          setDropboxAvailable(false);
        }
      })
      .catch(() => setDropboxAvailable(false));
  }, []);

  useEffect(() => {
    if (!googleReady || pickerLoaded) return;
    window.gapi?.load("picker", () => setPickerLoaded(true));
  }, [googleReady, pickerLoaded]);

  const slug = useMemo(() => slugify(name), [name]);
  const previewPath = useMemo(() => {
    if (!slug) return parentPath ? `${parentPath}.…` : "…";
    return parentPath ? `${parentPath}.${slug}` : slug;
  }, [parentPath, slug]);

  const effectiveKind = kind === "__custom__" ? slugify(customKind) : kind;
  const siblingSet = useMemo(() => new Set(existingSiblings), [existingSiblings]);
  const clientDuplicate = slug.length > 0 && siblingSet.has(slug);

  function validate(): boolean {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!kind) next.kind = "Pick a type.";
    if (kind === "__custom__" && !effectiveKind) {
      next.kind = "Type name is required.";
    }
    if (slug.length === 0 && name.trim().length > 0) {
      next.name = "Name must contain at least one letter or number.";
    }
    if (clientDuplicate) {
      next.name = `A subsystem named "${name.trim()}" already exists here.`;
    }
    if (picked?.kind === "local" && picked.file.size > MAX_BYTES) {
      next.file = `File is too big. Limit is ${MAX_UPLOAD_MB} MB.`;
    }
    if (picked?.kind === "cloud" && picked.sizeBytes > MAX_BYTES) {
      next.file = `File is too big. Limit is ${MAX_UPLOAD_MB} MB.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    setErrors({});
    if (!validate()) return;
    setSaving(true);
    try {
      const createRes = await fetch(`${API_BASE}/api/namespace/node/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentId,
          kind: effectiveKind,
          name: name.trim(),
        }),
      });
      if (createRes.status === 409) {
        const body = (await createRes.json().catch(() => ({}))) as { message?: string };
        setErrors({ name: body.message ?? "Duplicate name." });
        setSaving(false);
        return;
      }
      if (createRes.status === 404) {
        setErrors({ submit: "This parent no longer exists. Refresh the tree." });
        setSaving(false);
        return;
      }
      if (!createRes.ok) {
        const body = (await createRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${createRes.status}`);
      }
      const created = (await createRes.json()) as { unsPath: string };

      if (picked) {
        const uploadOk = await uploadAttached(picked, created.unsPath);
        if (!uploadOk) {
          setErrors({ file: "Upload failed — node was created without a file." });
          setSaving(false);
          await onCreated();
          return;
        }
      }

      await onCreated();
    } catch (e) {
      setErrors({ submit: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function uploadAttached(p: Picked, unsPath: string): Promise<boolean> {
    try {
      if (p.kind === "local") {
        const form = new FormData();
        form.append("file", p.file);
        form.append("unsPath", unsPath);
        const res = await fetch(`${API_BASE}/api/uploads/local/`, {
          method: "POST",
          body: form,
        });
        return res.ok;
      } else {
        const res = await fetch(`${API_BASE}/api/uploads/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: p.provider,
            externalFileId: p.externalFileId,
            externalDownloadUrl: p.externalDownloadUrl,
            filename: p.filename,
            mimeType: p.mimeType,
            sizeBytes: p.sizeBytes,
            externalCreatedAt: p.externalCreatedAt ?? undefined,
            unsPath,
          }),
        });
        return res.ok;
      }
    } catch {
      return false;
    }
  }

  async function openGoogle() {
    try {
      const tokenRes = await fetch(`${API_BASE}/api/picker/google/token/`);
      if (!tokenRes.ok) throw new Error("Google not connected");
      const { accessToken, apiKey, appId } = await tokenRes.json();
      if (!window.google?.picker || !pickerLoaded) {
        throw new Error("Google Picker not loaded yet — try again in a moment");
      }
      const view = new window.google.picker.DocsView()
        .setMimeTypes("application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif")
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setCallback((data) => {
          if (
            data.action === window.google!.picker.Action.PICKED &&
            data.docs &&
            data.docs.length > 0
          ) {
            const doc = data.docs[0];
            setPicked({
              kind: "cloud",
              provider: "google",
              externalFileId: doc.id,
              filename: doc.name,
              mimeType: doc.mimeType,
              sizeBytes: Number(doc.sizeBytes),
              externalCreatedAt: doc.lastEditedUtc
                ? new Date(Number(doc.lastEditedUtc)).toISOString()
                : null,
            });
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setErrors({ file: (e as Error).message });
    }
  }

  function openDropbox() {
    try {
      if (!window.Dropbox) throw new Error("Dropbox Chooser not loaded yet");
      window.Dropbox.choose({
        linkType: "direct",
        multiselect: false,
        extensions: DROPBOX_EXTENSIONS,
        success: (files) => {
          if (files.length === 0) return;
          const f = files[0];
          setPicked({
            kind: "cloud",
            provider: "dropbox",
            externalDownloadUrl: f.link,
            filename: f.name,
            mimeType: mimeFromExt(f.name),
            sizeBytes: f.bytes,
            externalCreatedAt: f.client_modified ?? null,
          });
        },
      });
    } catch (e) {
      setErrors({ file: (e as Error).message });
    }
  }

  const formId = `create-child-${parentId}`;
  const saveDisabled =
    saving ||
    !name.trim() ||
    !kind ||
    clientDuplicate ||
    (kind === "__custom__" && !effectiveKind);

  return (
    <>
      <Script
        src="https://apis.google.com/js/api.js"
        strategy="afterInteractive"
        onLoad={() => setGoogleReady(true)}
      />
      {dropboxKey && (
        <Script
          id="dropboxjs"
          src="https://www.dropbox.com/static/api/2/dropins.js"
          strategy="afterInteractive"
          data-app-key={dropboxKey}
          onLoad={() => setDropboxReady(true)}
        />
      )}

      <div
        className="my-1 rounded-lg border border-slate-300 bg-white p-3 shadow-sm"
        style={{ marginLeft: `${depth * 16 + 24}px` }}
        data-testid="create-child-card"
        data-parent-id={parentId}
        role="form"
        aria-label={`Add child under ${parentName}`}
      >
        <div className="mb-2 text-xs font-medium text-slate-500">
          Add child of <span className="font-semibold text-slate-800">{parentName}</span>
        </div>

        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${formId}-kind`}>
              Type
            </label>
            <select
              id={`${formId}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              data-testid="create-child-kind"
              style={{ minHeight: "44px" }}
            >
              <option value="" disabled>
                Pick one…
              </option>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {kind === "__custom__" && (
              <input
                type="text"
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value)}
                placeholder="Custom type (lowercase, e.g. 'pump_skid')"
                className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                data-testid="create-child-custom-kind"
                style={{ minHeight: "44px" }}
              />
            )}
            {errors.kind && (
              <p className="mt-1 text-xs text-red-600" data-testid="create-child-error-kind">
                {errors.kind}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${formId}-name`}>
              Name
            </label>
            <input
              id={`${formId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Plant A, Line 3, Compressor C-401"
              maxLength={NAME_LIMIT}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              data-testid="create-child-name"
              style={{ minHeight: "44px" }}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-600" data-testid="create-child-error-name">
                {errors.name}
              </p>
            )}
          </div>

          <div className="rounded bg-slate-100 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Path preview</div>
            <code className="block break-all text-xs text-slate-700" data-testid="create-child-path-preview">
              {previewPath}
            </code>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Attach file (optional)</div>
            {picked == null ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {googleAvailable ? (
                  <button
                    type="button"
                    onClick={openGoogle}
                    disabled={!pickerLoaded}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="create-child-pick-google"
                    style={{ minHeight: "44px" }}
                  >
                    {pickerLoaded ? (
                      <>
                        <FolderOpen className="h-4 w-4" /> Google Drive
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = `${API_BASE}/api/auth/google`;
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    data-testid="create-child-connect-google"
                    style={{ minHeight: "44px" }}
                  >
                    <FolderOpen className="h-4 w-4" /> Connect Google
                  </button>
                )}
                <button
                  type="button"
                  onClick={openDropbox}
                  disabled={!dropboxAvailable || !dropboxReady}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="create-child-pick-dropbox"
                  style={{ minHeight: "44px" }}
                >
                  <Package className="h-4 w-4" /> Dropbox
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  data-testid="create-child-pick-local"
                  style={{ minHeight: "44px" }}
                >
                  <Smartphone className="h-4 w-4" /> From device
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_MIME}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setPicked({ kind: "local", file: f });
                    e.target.value = "";
                  }}
                  data-testid="create-child-file-input"
                />
              </div>
            ) : (
              <div
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                data-testid="create-child-picked"
              >
                <span className="flex items-center gap-2 truncate text-slate-700">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {picked.kind === "local" ? picked.file.name : picked.filename}
                  </span>
                  <span className="text-slate-400">
                    (
                    {(
                      (picked.kind === "local" ? picked.file.size : picked.sizeBytes) /
                      (1024 * 1024)
                    ).toFixed(1)}{" "}
                    MB)
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="ml-2 rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                  aria-label="Remove attached file"
                  data-testid="create-child-remove-file"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {errors.file && (
              <p className="mt-1 text-xs text-red-600" data-testid="create-child-error-file">
                {errors.file}
              </p>
            )}
          </div>

          {errors.submit && (
            <p className="text-xs text-red-600" data-testid="create-child-error-submit">
              {errors.submit}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveDisabled}
              className="flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="create-child-save"
              style={{ minHeight: "44px", minWidth: "88px" }}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving
                </>
              ) : (
                "Save"
              )}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="create-child-cancel"
              style={{ minHeight: "44px", minWidth: "72px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
