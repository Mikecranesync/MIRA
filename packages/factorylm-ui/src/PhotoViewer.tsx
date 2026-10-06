import { useRef, type MouseEvent } from "react";

/**
 * A thumbnail that opens the full photo in the app, like any chat app does.
 *
 * Platform first (`.claude/rules/commodity-before-custom.md`): the viewer is a
 * native `<dialog>` — the browser owns focus trapping, Escape and the backdrop,
 * and the browser renders the image. No gesture code. The thumbnail stays a
 * real link, so a modifier/middle click still opens a new tab, and a browser
 * without `showModal` simply follows the link (the #4285 behaviour).
 */
export function PhotoThumb({ src, alt, className }: { readonly src: string; readonly alt: string; readonly className: string }) {
  const dialog = useRef<HTMLDialogElement>(null);

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const d = dialog.current;
    if (!d || typeof d.showModal !== "function") return;
    event.preventDefault();
    d.showModal();
  };
  const close = () => dialog.current?.close();

  return <>
    <a className={className} href={src} target="_blank" rel="noopener noreferrer" aria-label="Open the full-size photo" onClick={open}>
      <img src={src} alt={alt} loading="lazy" decoding="async" />
    </a>
    <dialog
      ref={dialog}
      className="fl-photo-viewer"
      aria-label="Photo"
      // A click on the backdrop lands on the <dialog> itself, not its content.
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="fl-photo-viewer__bar">
        <a className="fl-photo-viewer__open" href={src} target="_blank" rel="noopener noreferrer">Open full size</a>
        <button type="button" className="fl-photo-viewer__close" onClick={close}>Close</button>
      </div>
      <img className="fl-photo-viewer__img" src={src} alt={alt} />
    </dialog>
  </>;
}
