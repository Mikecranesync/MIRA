"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CitationMarker, EvidenceReader } from "@factorylm/ui";
import { AnswerMarkdown } from "@/components/equipment/notebook-markdown";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { AnswerWithSafety } from "./answer-with-safety";
import { citationReadingOrder } from "./citation-reading-order";
import { DocumentPageViewer } from "./DocumentPageViewer";
import { createLayerBack } from "./layer-back-history";

export function CitedAnswer({ text, citations, onFallback }: {
  text: string; citations: EvidenceCitation[]; onFallback: (citation: EvidenceCitation) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const entries = useMemo(() => citationReadingOrder(text, citations).filter(({ citation }) => citation.fileId && !citation.originFileId), [text, citations]);
  const evidence = entries.map(({ citation: c, statement }) => ({ id: c.citationId, title: c.sourceTitle, locator: c.page ? `Page ${c.page}` : "Page not supplied", statement, quote: c.quote ?? "" }));
  const index = entries.findIndex(entry => entry.citation.citationId === selected);
  const isOpen = index >= 0;
  useEffect(() => {
    if (!isOpen) return;
    const back = createLayerBack({ history: window.history, currentUrl: () => window.location.href,
      onPopState: listener => { window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); },
      raiseBack: () => setSelected(null),
    });
    back.sync(isOpen);
    return () => { back.sync(false); back.dispose(); };
  }, [isOpen]);
  const open = useCallback((c: EvidenceCitation) => entries.some(entry => entry.citation.citationId === c.citationId) ? setSelected(c.citationId) : onFallback(c), [entries, onFallback]);
  // Keep markdown components mounted while navigating the reader, so its
  // invoking citation remains a valid focus-return target.
  const answer = useMemo(() => <AnswerWithSafety text={text} markdown={content => <AnswerMarkdown content={content} citations={citations}
      renderCitation={c => <CitationMarker number={Number(c.citationId)} onOpen={() => open(c)} />} />} />, [text, citations, open]);
  return <>
    {answer}
    {entries.length ? <button type="button" className="fl-evidence-review" onClick={() => setSelected(entries[0].citation.citationId)}>Review evidence</button> : null}
    {isOpen ? <EvidenceReader evidence={evidence} index={index} onChange={next => setSelected(entries[next].citation.citationId)} onClose={() => setSelected(null)}
      renderPage={entry => {
        const c = entries.find(item => item.citation.citationId === entry.id)!.citation;
        return <DocumentPageViewer key={entry.id} evidence={{ fileId: c.fileId!, page: c.page, quote: c.quote }} />;
      }} /> : null}
  </>;
}
