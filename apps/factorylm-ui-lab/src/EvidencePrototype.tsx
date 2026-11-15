import { createShellState, getFixture, PROFILES, shellReducer } from "@factorylm/interaction";
import { CitationMarker, EvidenceReader, FactoryLMShell, type ReaderEvidence } from "@factorylm/ui";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getDocumentProxy } from "unpdf";
import { createLabAdapter } from "./fake-adapter";
import { SAMPLE_PDF_BASE64 } from "./evidence-sample-pdf";
import "@factorylm/ui/evidence-reader.css";
import "./evidence-prototype.css";

type SampleEvidence = ReaderEvidence & { page: number; rect: readonly [number, number, number, number] };
// Rectangles in PDF points, bottom-left origin. Bound only to the authored PDF
// below, not supplied by a model or guessed from matching words.
export const SAMPLE_EVIDENCE: readonly SampleEvidence[] = [
  { id: "identity", title: "Sample drive manual", locator: "Revision A · PDF page 1 of 2", page: 1,
    statement: "The sample manual places the model and serial number on the equipment label.",
    quote: "The equipment label records the model and serial number.", rect: [46, 611, 410, 632] },
  { id: "revision", title: "Sample drive manual", locator: "Revision A · PDF page 1 of 2", page: 1,
    statement: "It also calls for checking the document revision against the equipment model.",
    quote: "Check the document revision against the equipment model.", rect: [46, 451, 413, 472] },
  { id: "record", title: "Sample drive manual", locator: "Revision A · PDF page 2 of 2", page: 2,
    statement: "Its observation table keeps the source page with the note.",
    quote: "Source reference          Keep the page with the note.", rect: [46, 546, 385, 567] },
];

const bytes = () => Uint8Array.from(atob(SAMPLE_PDF_BASE64), (c) => c.charCodeAt(0));

function SamplePdfPage({ evidence }: { evidence: SampleEvidence }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let cancelled = false;
    const docPromise = getDocumentProxy(bytes(), { isEvalSupported: false, useSystemFonts: true });
    void (async () => {
      const doc = await docPromise;
      if (cancelled) return;
      const page = await doc.getPage(evidence.page);
      if (cancelled || !canvas.current) return;
      const viewport = page.getViewport({ scale: 2 });
      const target = canvas.current;
      target.width = viewport.width;
      target.height = viewport.height;
      const context = target.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      await page.render({ canvas: target, canvasContext: context, viewport }).promise;
      if (!cancelled) setReady(true);
    })().catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; void docPromise.then((doc) => doc.destroy()).catch(() => {}); };
  }, [evidence.page]);
  useEffect(() => {
    if (ready) highlight.current?.scrollIntoView({ block: "center", inline: "center" });
  }, [ready, evidence.id, zoom]);
  const [x1, y1, x2, y2] = evidence.rect;
  return <>
    <div className="evidence-sample__tools">
      <span>Sample document · not equipment guidance</span>
      <button type="button" onClick={() => setZoom(zoom === 1 ? 1.5 : 1)}>{zoom === 1 ? "Enlarge page" : "Fit page"}</button>
    </div>
    {error ? <p role="alert">The PDF could not be rendered. Return to the answer and try again.</p> : null}
    {!ready && !error ? <p role="status">Opening source page…</p> : null}
    <div className="evidence-sample__paper" style={{ width: `${zoom * 100}%` }}>
      <canvas ref={canvas} aria-label={`Original sample PDF page ${evidence.page}`} />
      {ready ? <div ref={highlight} className="evidence-sample__highlight" data-highlight={evidence.id}
        style={{ left: `${x1 / 612 * 100}%`, top: `${(792 - y2) / 792 * 100}%`, width: `${(x2 - x1) / 612 * 100}%`, height: `${(y2 - y1) / 792 * 100}%` }}
        role="img" aria-label={`Cited passage: ${evidence.quote}`} /> : null}
    </div>
    <p className="evidence-sample__quote">Cited passage: “{evidence.quote.trim()}”</p>
  </>;
}

export function EvidencePrototype() {
  const [index, setIndex] = useState<number | null>(null);
  const [state, dispatch] = useReducer(shellReducer, undefined, () => {
    const fixture = getFixture("grounded-answer");
    const first = fixture.thread.turns[0];
    return { ...createShellState({ ...fixture, thread: { ...fixture.thread, title: "Drive walk · evidence preview",
      turns: [{ ...first, parts: [{ type: "text", text: "Evidence reader sample" }] }] } }, PROFILES.hub), navigationVisible: false };
  });
  const adapter = useMemo(() => createLabAdapter(() => ({ machineIds: [] })), []);
  const dark = state.theme === "dark";
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  // Keep browser/tablet Back inside the prototype when the reader is open.
  useEffect(() => {
    const back = () => setIndex(null);
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const open = (n: number) => { if (index === null) window.history.pushState({ evidencePreview: true }, ""); setIndex(n); };
  const close = () => { setIndex(null); if (window.history.state?.evidencePreview) window.history.back(); };
  return <>
    <div className="evidence-prototype__notice">Interactive prototype · sample PDF · no live AI or equipment connection
      <button type="button" onClick={() => dispatch({ type: "set-theme", theme: dark ? "light" : "dark" })}>{dark ? "Light" : "Dark"} appearance</button>
    </div>
    <FactoryLMShell state={state} dispatch={dispatch} adapter={adapter} hooks={{ renderText: () => <div className="evidence-prototype__answer">
      <p className="evidence-prototype__eyebrow">SOURCE-LINKED ANSWER</p>
      <h2>See what supports the answer.</h2>
      <p>Tap a raised number to inspect the original page. Move between highlights without losing your place.</p>
      {SAMPLE_EVIDENCE.map((item, n) => <p key={item.id}>{item.statement}<CitationMarker number={n + 1} onOpen={() => open(n)} /></p>)}
      <button className="evidence-prototype__review" type="button" onClick={() => open(0)}>Review evidence <span>3 passages · 2 pages</span></button>
      <p className="evidence-prototype__fine">These citations point to an authored sample document. This preview tests reading and navigation, not AI answer accuracy.</p>
    </div> }} />
    {index !== null ? <EvidenceReader evidence={SAMPLE_EVIDENCE} index={index} onChange={setIndex} onClose={close}
      renderPage={(item) => <SamplePdfPage evidence={SAMPLE_EVIDENCE.find((e) => e.id === item.id)!} />} /> : null}
  </>;
}
