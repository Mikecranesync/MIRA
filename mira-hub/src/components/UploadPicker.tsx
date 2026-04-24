"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { X, Upload as UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type PickResult = {
  provider: "google" | "dropbox";
  externalFileId?: string;
  externalDownloadUrl?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  externalCreatedAt: string | null;
};

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

export function UploadPicker({
  open,
  onClose,
  onLocalFile,
  onCloudPick,
}: {
  open: boolean;
  onClose: () => void;
  onLocalFile: (file: File) => void | Promise<void>;
  onCloudPick: (result: PickResult) => void | Promise<void>;
}) {
  const [googleReady, setGoogleReady] = useState(false);
  const [dropboxReady, setDropboxReady] = useState(false);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [dropboxAvailable, setDropboxAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch("/hub/api/picker/google/token")
      .then((r) => setGoogleAvailable(r.ok))
      .catch(() => setGoogleAvailable(false));
    fetch("/hub/api/picker/dropbox/key")
      .then((r) => setDropboxAvailable(r.ok))
      .catch(() => setDropboxAvailable(false));
  }, [open]);

  useEffect(() => {
    if (!googleReady || pickerLoaded) return;
    window.gapi?.load("picker", () => setPickerLoaded(true));
  }, [googleReady, pickerLoaded]);

  async function openGoogle() {
    setError(null);
    try {
      const tokenRes = await fetch("/hub/api/picker/google/token");
      if (!tokenRes.ok) throw new Error("Google not connected");
      const { accessToken, apiKey, appId } = await tokenRes.json();
      if (!window.google?.picker || !pickerLoaded) {
        throw new Error("Google Picker not loaded yet — try again in a moment");
      }
      const view = new window.google.picker.DocsView()
        .setMimeTypes("application/pdf")
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setCallback((data) => {
          if (data.action === window.google!.picker.Action.PICKED && data.docs?.[0]) {
            const doc = data.docs[0];
            void onCloudPick({
              provider: "google",
              externalFileId: doc.id,
              filename: doc.name,
              mimeType: doc.mimeType,
              sizeBytes: Number(doc.sizeBytes),
              externalCreatedAt: doc.lastEditedUtc
                ? new Date(Number(doc.lastEditedUtc)).toISOString()
                : null,
            });
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
        multiselect: false,
        extensions: [".pdf"],
        success: (files) => {
          const f = files[0];
          void onCloudPick({
            provider: "dropbox",
            externalDownloadUrl: f.link,
            filename: f.name,
            mimeType: "application/pdf",
            sizeBytes: f.bytes,
            externalCreatedAt: f.client_modified ?? null,
          });
          onClose();
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function fetchAppKey(): Promise<string> {
    const res = await fetch("/hub/api/picker/dropbox/key");
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

  return (
    <>
      <Script src="https://apis.google.com/js/api.js" strategy="lazyOnload" onLoad={() => setGoogleReady(true)} />
      {dropboxKey && (
        <Script
          id="dropboxjs"
          src="https://www.dropbox.com/static/api/2/dropins.js"
          strategy="lazyOnload"
          data-app-key={dropboxKey}
          onLoad={() => setDropboxReady(true)}
        />
      )}

      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-5"
          style={{ backgroundColor: "var(--surface-0)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Add to Knowledge
            </h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--surface-1)]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <label
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-8 cursor-pointer transition-colors hover:bg-[var(--surface-1)]"
            style={{ borderColor: "var(--border)" }}
          >
            <UploadIcon className="w-6 h-6" style={{ color: "var(--foreground-muted)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
              Drop a PDF here or click to browse
            </span>
            <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
              Up to 20 MB
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  await onLocalFile(f);
                  onClose();
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
            <Button
              variant="secondary"
              size="sm"
              disabled={!googleAvailable || !pickerLoaded}
              onClick={openGoogle}
              title={!googleAvailable ? "Connect Google Workspace in Channels first" : undefined}
            >
              📁 From Google Drive
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!dropboxAvailable || !dropboxReady}
              onClick={openDropbox}
              title={!dropboxAvailable ? "Connect Dropbox in Channels first" : undefined}
            >
              📦 From Dropbox
            </Button>
          </div>

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
