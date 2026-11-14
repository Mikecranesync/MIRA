import { useEffect, useRef, type ReactNode } from "react";

/** A host supplies evidence already bound to its source document. Opening it is
 * not a verification action. The reader does not infer or manufacture anchors. */
export interface ReaderEvidence {
  readonly id: string;
  readonly title: string;
  readonly locator: string;
  readonly statement: string;
  readonly quote: string;
}

export function CitationMarker({ number, onOpen }: { number: number; onOpen: () => void }) {
  return <sup className="fl-citation-marker"><button type="button" onClick={onOpen}
    aria-label={`Review citation ${number}`}>{number}</button></sup>;
}

export function EvidenceReader({ evidence, index, onChange, onClose, renderPage }: {
  evidence: readonly ReaderEvidence[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
  renderPage: (evidence: ReaderEvidence) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const current = evidence[index];
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    close.current?.focus();
    return () => { element.close(); previous?.focus(); };
  }, []);
  if (!current) return null;
  return <dialog ref={dialog} className="fl-evidence-reader" aria-label="Citation evidence"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="fl-evidence-reader__header">
      <div><strong>{current.title}</strong><p>{current.locator}</p></div>
      <button ref={close} type="button" onClick={onClose}>Back to answer</button>
    </header>
    <div className="fl-evidence-reader__claim" aria-live="polite">
      <span>From the answer</span><p>{current.statement}</p>
    </div>
    <div className="fl-evidence-reader__page" key={current.id}>{renderPage(current)}</div>
    <footer className="fl-evidence-reader__navigation">
      <button type="button" disabled={index === 0} onClick={() => onChange(index - 1)}>← Previous highlight</button>
      <span role="status">{index + 1} of {evidence.length}</span>
      <button type="button" disabled={index === evidence.length - 1} onClick={() => onChange(index + 1)}>Next highlight →</button>
    </footer>
  </dialog>;
}
