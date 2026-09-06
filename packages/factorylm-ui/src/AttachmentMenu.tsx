import { CameraIcon, DocumentIcon, GalleryIcon, QRIcon } from "./icons";

export interface AttachmentMenuProps {
  /** The host runs on a device with a camera / scanner (mobile profile). */
  readonly native: boolean;
  /** An adapter operation is in flight; every action is disabled meanwhile. */
  readonly busy: boolean;
  readonly onPhoto: () => void;
  readonly onFile: () => void;
  readonly onCamera: () => void;
  readonly onScan: () => void;
}

/**
 * The attachment chooser. Presentation only: the Composer owns the adapter
 * calls, the pending-attachment list, failures and the busy flag, and renders
 * this inside the shared `Overlay` for the `attachment-menu` layer — a bottom
 * sheet on the mobile profile, an anchored popover on the web profile.
 */
export function AttachmentMenu({ native, busy, onPhoto, onFile, onCamera, onScan }: AttachmentMenuProps) {
  return <div className="fl-attachment-menu" role="dialog" aria-modal="true" aria-label="Attachment menu">
    <p className="fl-attachment-menu__title">Add to message</p>
    <div className="fl-attachment-menu__items">
      <button type="button" className="fl-attachment-menu__item" disabled={busy} onClick={onPhoto}>
        <GalleryIcon className="fl-attachment-menu__icon" /><span>Photo</span>
      </button>
      <button type="button" className="fl-attachment-menu__item" disabled={busy} onClick={onFile}>
        <DocumentIcon className="fl-attachment-menu__icon" /><span>File</span>
      </button>
      <button
        type="button"
        className="fl-attachment-menu__item"
        disabled={!native || busy}
        title={native ? "Capture a photo with the device camera" : "Camera requires a native device"}
        onClick={onCamera}
      >
        <CameraIcon className="fl-attachment-menu__icon" /><span>Camera</span>
      </button>
      <button
        type="button"
        className="fl-attachment-menu__item"
        disabled={!native || busy}
        title={native ? "Scan a machine QR code" : "Scanning requires a native device"}
        onClick={onScan}
      >
        <QRIcon className="fl-attachment-menu__icon" /><span>Scan machine</span>
      </button>
    </div>
  </div>;
}
