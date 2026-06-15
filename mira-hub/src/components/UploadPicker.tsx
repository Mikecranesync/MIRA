"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { X, Upload as UploadIcon, Search, Loader2, FolderOpen, Package, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE, MAX_UPLOAD_MB } from "@/lib/config";

export type PickResult = {
  provider: "google" | "dropbox";
  externalFileId?: string;
  externalDownloadUrl?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  externalCreatedAt: string | null;
};

type Asset = { id: number | string; tag: string; name: string };

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
        success: (files: Array<{
          link: string;
          name: string;
          bytes: number;
          icon: string;
          client_modified?: string;
        }>) => void;
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
  setCallback: (cb: (data: {
    action: string;
    docs?: Array<{
      id: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
      lastEditedUtc?: number;
    }>;
  }) => void) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

// Include both MIME types and extensions — Android file pickers vary in which they respect
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

export function UploadPicker({
  open,
  onClose,
  onLocalFiles,
  onCloudPicks,
  defaultAssetTag = null,
  hideAssetPicker = false,
}: {
  open: boolean;
  onClose: () => void;
  onLocalFiles: (files: File[], assetTag: string | null) => void | Promise<void>;
  onCloudPicks: (results: PickResult[], assetTag: string | null) => void | Promise<void>;
  defaultAssetTag?: string | null;
  hideAssetPicker?: boolean;
}) {
  const [googleReady, setGoogleReady] = useState(false);
  const [dropboxReady, setDropboxReady] = useState(false);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [pickerLoadFailed, setPickerLoadFailed] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [dropboxAvailable, setDropboxAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<string | null>(defaultAssetTag);
  const [isDragOver, setIsDragOver] = useState(false);

  // Re-sync when the consumer opens the picker for a different asset.
  useEffect(() => {
    if (open) setSelectedAsset(defaultAssetTag);
  }, [open, defaultAssetTag]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch(`${API_BASE}/api/picker/google/token/`)
      .then((r) => setGoogleAvailable(r.ok))
      .catch(() => setGoogleAvailable(false));
    fetch(`${API_BASE}/api/picker/dropbox/key/`)
      .then((r) => setDropboxAvailable(r.ok))
      .catch(() => setDropboxAvailable(false));
    fetch(`${API_BASE}/api/assets/`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Asset[] | unknown) => {
        if (Array.isArray(data)) setAssets(data as Asset[]);
      })
      .catch(() => setAssets([]));
  }, [open]);

  useEffect(() => {
    if (!googleReady || pickerLoaded) return;
    window.gapi?.load("picker", () => setPickerLoaded(true));
  }, [googleReady, pickerLoaded]);

  // Fail-open: if the modal has been open for 10s and at least one cloud
  // picker SDK still hasn't loaded, stop showing an infinite spinner — Mike
  // saw the Loading… state never resolve on mobile at the expo (2026-05-17).
  // Refs (not deps) so the timer doesn't reset every time gapi/dropboxjs
  // partially load.
  const pickerLoadedRef = useRef(false);
  const dropboxReadyRef = useRef(false);
  useEffect(() => { pickerLoadedRef.current = pickerLoaded; }, [pickerLoaded]);
  useEffect(() => { dropboxReadyRef.current = dropboxReady; }, [dropboxReady]);

  useEffect(() => {
    if (!open) return;
    setPickerLoadFailed(false);
    const t = setTimeout(() => {
      // Surface a failure for whichever provider is "available" but still
      // hasn't loaded — the other button reverts to its label regardless.
      const googleStuck = googleAvailable && !pickerLoadedRef.current;
      const dropboxStuck = dropboxAvailable && !dropboxReadyRef.current;
      if (googleStuck || dropboxStuck) setPickerLoadFailed(true);
    }, 10_000);
    return () => clearTimeout(t);
  }, [open, googleAvailable, dropboxAvailable]);

  const filteredAssets = useMemo(() => {
    if (assets.length === 0) return [];
    const q = assetSearch.toLowerCase().trim();
    if (!q) return assets.slice(0, 8);
    return assets
      .filter(
        (a) =>
          a.tag.toLowerCase().includes(q) ||
          (a.name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [assets, assetSearch]);

  async function openGoogle() {
    setError(null);
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
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .setCallback((data) => {
          if (data.action === window.google!.picker.Action.PICKED && data.docs && data.docs.length > 0) {
            const results: PickResult[] = data.docs.map((doc) => ({
              provider: "google",
              externalFileId: doc.id,
              filename: doc.name,
              mimeType: doc.mimeType,
              sizeBytes: Number(doc.sizeBytes),
              externalCreatedAt: doc.lastEditedUtc
                ? new Date(Number(doc.lastEditedUtc)).toISOString()
                : null,
            }));
            void onCloudPicks(results, selectedAsset);
            onClose();
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function openDropbox() {
    setError(null);
    try {
      if (!window.Dropbox) throw new Error("Dropbox Chooser not loaded yet");
      window.Dropbox.choose({
        linkType: "direct",
        multiselect: true,
        extensions: DROPBOX_EXTENSIONS,
        success: (files) => {
          const results: PickResult[] = files.map((f) => ({
            provider: "dropbox",
            externalDownloadUrl: f.link,
            filename: f.name,
            mimeType: mimeFromExt(f.name),
            sizeBytes: f.bytes,
            externalCreatedAt: f.client_modified ?? null,
          }));
          void onCloudPicks(results, selectedAsset);
          onClose();
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function fetchAppKey(): Promise<string> {
    const res = await fetch(`${API_BASE}/api/picker/dropbox/key/`);
    if (!res.ok) return "";
    const { appKey } = await res.json();
    return appKey as string;
  }

  const [dropboxKey, setDropboxKey] = useState("");
  useEffect(() => {
    if (!open || dropboxKey) return;
    void fetchAppKey().then(setDropboxKey);
  }, [open, dropboxKey]);

  if (!open) return null;

  const selectedLabel =
    selectedAsset != null
      ? assets.find((a) => a.tag === selectedAsset)?.tag ?? selectedAsset
      : null;

  return (
    <>
      {/* afterInteractive (not lazyOnload) — on slow mobile networks lazyOnload
          may never fire, leaving the picker stuck on "Loading…". */}
      <Script
        src="https://apis.google.com/js/api.js"
        strategy="afterInteractive"
        onLoad={() => setGoogleReady(true)}
        onError={() => setPickerLoadFailed(true)}
      />
      {dropboxKey && (
        <Script
          id="dropboxjs"
          src="https://www.dropbox.com/static/api/2/dropins.js"
          strategy="afterInteractive"
          data-app-key={dropboxKey}
          onLoad={() => setDropboxReady(true)}
          onError={() => setPickerLoadFailed(true)}
        />
      )}

      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-4 sm:p-5 max-h-[92vh] overflow-y-auto"
          style={{
            backgroundColor: "var(--surface-0)",
            border: "1px solid var(--border)",
            // Respect the iOS home-indicator safe area when the modal is
            // bottom-aligned on a phone.
            paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Add to Knowledge
            </h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--surface-1)]">
              <X className="w-4 h-4" />
            </button>
          </div>

          {!hideAssetPicker && assets.length > 0 && (
            <div className="mb-3">
              <label className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
                Link to asset (optional)
              </label>
              <div className="relative mt-1">
                <Search
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                  style={{ color: "var(--foreground-subtle)" }}
                />
                <input
                  type="text"
                  placeholder={selectedLabel ? `Linked: ${selectedLabel}` : "Search assets or leave blank…"}
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border"
                  style={{
                    backgroundColor: "var(--surface-1)",
                    borderColor: "var(--border)",
                    color: "var(--foreground)",
                  }}
                />
              </div>
              {assetSearch && filteredAssets.length > 0 && (
                <div
                  className="mt-1 max-h-36 overflow-y-auto rounded-lg border"
                  style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border)" }}
                >
                  {filteredAssets.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        setSelectedAsset(a.tag);
                        setAssetSearch("");
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--surface-2)] transition-colors"
                      style={{ color: "var(--foreground)" }}
                    >
                      <span className="font-medium">{a.tag}</span>
                      {a.name && (
                        <span className="ml-2" style={{ color: "var(--foreground-muted)" }}>
                          {a.name}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {selectedAsset && (
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="mt-1 text-[10px] underline"
                  style={{ color: "var(--foreground-subtle)" }}
                >
                  Clear link
                </button>
              )}
            </div>
          )}

          <label
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-8 cursor-pointer transition-colors hover:bg-[var(--surface-1)]"
            style={{
              borderColor: uploading || isDragOver ? "var(--brand-blue)" : "var(--border)",
              backgroundColor: isDragOver ? "var(--surface-1)" : undefined,
              opacity: uploading ? 0.8 : 1,
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDragOver(false);
              const files = Array.from(e.dataTransfer.files);
              if (!files.length || uploading) return;
              setUploading(true);
              setError(null);
              try {
                await onLocalFiles(files, selectedAsset);
                onClose();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setUploading(false);
              }
            }}
          >
            {uploading ? (
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--brand-blue)" }} />
            ) : (
              <UploadIcon className="w-6 h-6" style={{ color: "var(--foreground-muted)" }} />
            )}
            <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
              {uploading ? "Uploading…" : "Drop PDFs or photos here — or click to browse"}
            </span>
            <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
              PDF, JPEG, PNG, WebP, HEIC · Up to {MAX_UPLOAD_MB} MB each
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_MIME}
              multiple
              disabled={uploading}
              className="sr-only"
              onChange={async (e) => {
                const list = e.target.files;
                if (!list || list.length === 0) return;
                const files = Array.from(list);
                setUploading(true);
                setError(null);
                try {
                  await onLocalFiles(files, selectedAsset);
                  onClose();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setUploading(false);
                  // Reset so re-selecting the same file fires onChange again
                  e.target.value = "";
                }
              }}
            />
          </label>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px" style={{ backgroundColor: "var(--border)" }} />
            <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
              or pick from a connected source
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: "var(--border)" }} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {googleAvailable ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={!pickerLoaded || uploading}
                onClick={openGoogle}
                title={
                  pickerLoadFailed && !pickerLoaded
                    ? "Picker SDK didn't load — try local upload above"
                    : undefined
                }
                className="gap-1.5"
              >
                {!pickerLoaded && pickerLoadFailed ? (
                  <><AlertTriangle className="w-3.5 h-3.5" /> Unavailable</>
                ) : !pickerLoaded ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</>
                ) : (
                  <><FolderOpen className="w-3.5 h-3.5" /> Google Drive</>
                )}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { window.location.href = "/hub/api/auth/google"; }}
                title="Sign in with Google to pick files from Drive"
                data-testid="connect-google-drive"
                className="gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5" /> Connect Google Drive
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={!dropboxAvailable || !dropboxReady || uploading}
              onClick={openDropbox}
              title={
                !dropboxAvailable
                  ? "Connect Dropbox in Channels to enable"
                  : pickerLoadFailed && !dropboxReady
                    ? "Picker SDK didn't load — try local upload above"
                    : undefined
              }
              className="gap-1.5"
            >
              {dropboxAvailable && !dropboxReady && pickerLoadFailed ? (
                <><AlertTriangle className="w-3.5 h-3.5" /> Unavailable</>
              ) : dropboxAvailable && !dropboxReady ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</>
              ) : (
                <><Package className="w-3.5 h-3.5" /> Dropbox</>
              )}
            </Button>
          </div>

          {pickerLoadFailed && (googleAvailable || dropboxAvailable) && (
            <p
              className="text-[11px] mt-2 text-center"
              style={{ color: "var(--foreground-muted)" }}
            >
              Couldn&apos;t load cloud picker. Use the local upload above, or check your
              connection and reopen.
            </p>
          )}

          {!googleAvailable && !dropboxAvailable && (
            <p className="text-[11px] mt-2 text-center" style={{ color: "var(--foreground-subtle)" }}>
              Or manage all integrations in{" "}
              <Link
                href="/channels"
                className="font-medium underline-offset-2 hover:underline"
                style={{ color: "var(--brand-blue)" }}
              >
                Channels
              </Link>
              .
            </p>
          )}

          {error && (
            <p className="text-xs mt-3" style={{ color: "#DC2626" }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
