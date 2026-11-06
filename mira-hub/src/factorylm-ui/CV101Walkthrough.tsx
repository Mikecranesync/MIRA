"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createShellState, getFixture, PROFILES, type SourceReference } from "@factorylm/interaction";
import { SourceViewer } from "@factorylm/ui/SourceViewer";
import { CV101Architecture } from "./CV101Architecture";
import { CV101PracticeInspection } from "./CV101PracticeInspection";
import { LivingSheetPrint } from "./LivingSheetPrint";
import { CV101_COMPONENTS, CV101_EVIDENCE as E, CV101_WORKFLOWS, emptyLesson, finishPractice, newPractice, persistPractice, readPractice, practiceStatus, practiceView, updatePracticeRecord, type LessonProgress, type Practice, type PracticeStorageProvider, type WalkthroughStatus } from "./cv101-walkthrough-model";

const CSS = `
.cv101-dialog{border:1px solid var(--fl-line);border-radius:var(--fl-radius-card);padding:0;margin:auto;width:calc(100% - 32px);max-width:1160px;height:calc(100% - 32px);max-height:100%;background:var(--fl-surface);color:var(--fl-ink)}
.cv101-dialog::backdrop{background:var(--fl-scrim)}
.cv101{font-family:var(--fl-font);font-size:var(--fl-fs);line-height:1.5;overflow:auto;height:100%;position:relative;box-sizing:border-box;color:var(--fl-ink);background:var(--fl-surface)}
.cv101 *{box-sizing:border-box}.cv101 h1{font-size:var(--fl-fs-2xl,28px);line-height:1.2;margin:0}.cv101 h2{font-size:var(--fl-fs-lg,20px);margin:0 0 var(--fl-gap)}.cv101 h3{font-size:var(--fl-fs);margin:0 0 var(--fl-gap)}
.cv101 p{margin:var(--fl-gap) 0}.cv101 a{color:var(--fl-accent);overflow-wrap:anywhere}.cv101 button,.cv101 summary,.cv101 a.cv101-button{min-height:44px;font:inherit;cursor:pointer}.cv101 button{border:1px solid var(--fl-line-strong);border-radius:var(--fl-radius-sm);background:var(--fl-surface);color:var(--fl-ink);padding:var(--fl-gap) var(--fl-pad)}
.cv101 button:disabled{cursor:default;opacity:.6}.cv101 button:focus-visible,.cv101 a:focus-visible,.cv101 summary:focus-visible{outline:2px solid var(--fl-accent);outline-offset:3px}
.cv101 .cv101-primary{background:var(--fl-accent);color:var(--fl-surface);border-color:var(--fl-accent)}
.cv101-head{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--fl-gap);padding:var(--fl-pad);border-bottom:1px solid var(--fl-line)}
.cv101-kicker,.cv101-muted{font-size:var(--fl-fs-sm);color:var(--fl-muted)}.cv101-kicker{margin:0 0 var(--fl-gap)!important;font-weight:600}.cv101-head button{flex-shrink:0}
.cv101-banner{margin:var(--fl-pad);padding:var(--fl-pad);border:1px solid var(--fl-warn);border-radius:var(--fl-radius-sm);background:var(--fl-warn-bg);color:var(--fl-ink)}
.cv101-banner[data-testid=cv101-demo-banner]{position:sticky;top:0;z-index:3}
.cv101-banner-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--fl-gap)}.cv101-banner-head .cv101-actions{margin:0;flex-shrink:0}
.cv101-tabs{display:flex;flex-wrap:wrap;gap:var(--fl-gap);padding:0 var(--fl-pad) var(--fl-pad);border-bottom:1px solid var(--fl-line)}
.cv101 [aria-pressed=true]{border-color:var(--fl-accent);background:var(--fl-accent-tint);color:var(--fl-accent-ink)}
.cv101-layout{display:grid;grid-template-columns:265px minmax(0,1fr)}.cv101-nav{padding:var(--fl-pad);border-right:1px solid var(--fl-line);display:flex;flex-direction:column;gap:var(--fl-gap)}
.cv101-nav button{text-align:left;display:flex;align-items:flex-start;gap:var(--fl-gap);width:100%;font-size:var(--fl-fs-sm)}.cv101-nav b{font-variant-numeric:tabular-nums}.cv101-nav .cv101-status{margin-top:var(--fl-gap)}
.cv101-main{padding:var(--fl-pad);min-width:0}.cv101-main>ol{padding-left:24px}.cv101-main li{margin-bottom:var(--fl-gap)}
.cv101-card{border:1px solid var(--fl-line);border-radius:var(--fl-radius-card);padding:var(--fl-pad);margin:var(--fl-gap) 0;overflow-wrap:anywhere}
.cv101-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--fl-gap)}.cv101-grid>.cv101-card{margin:0}
.cv101-status{display:inline-block;font-size:var(--fl-fs-xs);font-weight:600;padding:2px 8px;border-radius:var(--fl-radius-pill);border:1px solid var(--fl-line);white-space:normal}
.cv101-status[data-status=PASS]{color:var(--fl-ok);background:var(--fl-ok-bg)}.cv101-status[data-status=FAIL]{color:var(--fl-fault);background:var(--fl-fault-bg)}.cv101-status[data-status=BLOCKED]{color:var(--fl-warn);background:var(--fl-warn-bg)}
.cv101-result{border-left:3px solid var(--fl-line-strong)}.cv101-result dl{margin:0}.cv101-result dt{font-weight:600}.cv101-result dd{margin:0 0 var(--fl-gap)}
.cv101-actions{display:flex;flex-wrap:wrap;gap:var(--fl-gap);align-items:center;margin-top:var(--fl-pad)}.cv101-actions button{flex:0 1 auto}
.cv101-map{margin:0}.cv101-flow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:var(--fl-gap);padding:0;list-style-position:inside;font-size:var(--fl-fs-sm)}.cv101-flow li{border:1px solid var(--fl-line);padding:var(--fl-gap);border-radius:var(--fl-radius-sm)}
.cv101-table-wrap{overflow-x:auto}.cv101 table{width:100%;border-collapse:collapse;font-size:var(--fl-fs-sm)}.cv101 th,.cv101 td{text-align:left;padding:var(--fl-gap);border-bottom:1px solid var(--fl-line);vertical-align:top}.cv101 code{font-family:var(--fl-mono);font-size:var(--fl-fs-sm);overflow-wrap:anywhere}
.cv101-document{padding:var(--fl-pad);border:1px solid var(--fl-line);margin-top:var(--fl-gap);overflow-wrap:anywhere}.cv101-document .ls-print-frame{width:100%;table-layout:fixed}.cv101-document .ls-print-frame td{padding:0}.cv101-document [style*="200pt"]{max-width:100%}
.cv101-source-layer{position:absolute;inset:0;background:var(--fl-surface);z-index:4;padding:var(--fl-pad);overflow:auto}.cv101-source-layer .fl-source-viewer{position:relative;inset:auto;width:100%;max-width:none;height:auto;padding:var(--fl-pad)}
@media(max-width:700px){.cv101-dialog{width:100%;height:100%;border-radius:0}.cv101-layout{grid-template-columns:minmax(0,1fr)}.cv101-nav{border-right:0;border-bottom:1px solid var(--fl-line);display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.cv101-nav button{padding:var(--fl-gap);font-size:var(--fl-fs-xs)}.cv101-grid{grid-template-columns:minmax(0,1fr)}.cv101-flow{grid-template-columns:minmax(0,1fr)}.cv101-head{flex-wrap:wrap}.cv101-head button{margin-left:auto}}
`;
const Badge = ({ status, children }: { status: WalkthroughStatus; children: ReactNode }) => <span className="cv101-status" data-status={status}>{children}</span>;
const Evidence = ({ href, children = "Open evidence" }: { href: string; children?: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

const browserStorage: PracticeStorageProvider = () => localStorage;
export function CV101WalkthroughContent({ viewerScope, onClose, onSourceChange, storage = browserStorage }: { viewerScope: string; onClose: () => void; onSourceChange?: (closeSource: (() => boolean) | null) => void; storage?: PracticeStorageProvider }) {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"walkthrough" | "live" | "case">("walkthrough");
  const [lesson, setLesson] = useState(emptyLesson);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [source, setSource] = useState<SourceReference | null>(null);
  const [session, setSession] = useState(1);
  const sourceOpener = useRef<HTMLElement | null>(null);
  const sourceLayer = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const steps = useRef<HTMLElement>(null);
  const bringIntoView = (target: { current: HTMLElement | null }) => requestAnimationFrame(() => {
    const element = target.current;
    if (!element) return;
    const banner = element.closest(".cv101")?.querySelector<HTMLElement>("[data-testid=cv101-demo-banner]");
    element.style.scrollMarginTop = `${(banner?.getBoundingClientRect().height ?? 0) + 16}px`;
    element.scrollIntoView({ block: "start" });
  });
  const chooseStep = (index: number) => { setStep(index); bringIntoView(main); };
  const sourceRef = useRef(source);
  useEffect(() => { sourceRef.current = source; if (source) sourceLayer.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [source]);
  const closeSource = useCallback(() => { if (!sourceRef.current) return false; setSource(null); requestAnimationFrame(() => sourceOpener.current?.focus()); return true; }, []);
  useEffect(() => { onSourceChange?.(closeSource); return () => onSourceChange?.(null); }, [onSourceChange, closeSource]);
  const save = (next: Practice) => {
    setPractice(next);
    const result = persistPractice(storage, next);
    setSaved(result.status === "saved");
    setStorageError(result.status === "saved" ? null : "Practice could not be saved in this browser. The visible draft is in memory only; reload/recall is not proven. Allow local storage or use another browser, then retry.");
  };
  const progress = (patch: Partial<LessonProgress>) => {
    const next = { ...lesson, ...patch }; setLesson(next);
    if (practice) save({ ...practice, lesson: next });
  };
  const openManual = (citation: boolean) => {
    sourceOpener.current = document.activeElement as HTMLElement;
    setSource({ id: "cv101-oem-reference", kind: "oem_documentation", title: "Micro820 Installation Instructions — OEM reference", locator: "2080-IN009 · page 6 · lists the Micro820 user manual 2080-UM005. Applicable historical reference; no asset attachment or retrieval proven here.", href: E.manual });
    progress(citation ? { citation: true } : { manual: true });
  };
  const restore = () => {
      setLesson(current => ({ ...current, recalled: false }));
      const result = readPractice(storage, viewerScope);
      if (result.status !== "ready") {
        setStorageError(result.status === "unavailable" ? "Browser storage is unavailable. No saved job was loaded; real jobs and live acceptance are unchanged." : result.status === "missing" ? "No saved practice job was found for this viewer in this browser. Complete and save workflow 5 first." : "The saved practice record is unreadable or belongs to another viewer. It was not used as evidence. Start a new practice inspection to continue.");
        setSaved(false); return;
      }
      const loaded = result.practice;
      const nextLesson = { ...loaded.lesson, recalled: !!practiceView(loaded).finished };
      setPractice({ ...loaded, lesson: nextLesson }); setLesson(nextLesson); setSaved(true); setStorageError(null);
  };
  const act = (work: () => Practice) => { try { save(work()); } catch (e) { setStorageError(e instanceof Error ? e.message : "Practice update failed."); } };
  const current = CV101_WORKFLOWS[step];
  const statusFor = (index: number): WalkthroughStatus => storageError && (index === 5 || (index === 4 && practice)) ? "FAIL" : practiceStatus(index, practice, lesson);
  const status = statusFor(step);
  const results = [
    lesson.discovered ? "Selected DEMO-CV101, a synthetic local learning model. No real account, tenant or asset was selected." : "No practice asset selected yet.",
    `Acknowledged reading ${lesson.components.length}/4 component records. OEM reference ${lesson.manual ? "opened in source viewer" : "not opened"}. Historical unknowns remain visible.`,
    lesson.telemetry ? "Replayed three synthetic DI05 samples. No PLC read or live connection occurred; the historical production receipt remains stale." : "No synthetic samples replayed. The dated source receipt is available below.",
    lesson.question ? `Prepared example displayed; citation ${lesson.citation ? "opened in the existing source viewer" : "not opened"}. No provider/retrieval call occurred.` : "No prepared question played. Live answering is blocked.",
    practice ? `Practice job ${practice.jobId}: ${practiceView(practice).finished ? "finished" : "in progress"}, ${practiceView(practice).seq} events. ${saved ? "Saved only in this browser for this viewer." : "Not saved; memory only."} Physical work and closeout approval are not recorded.` : "No practice inspection created.",
    lesson.recalled && practice ? `Retrieved ${practice.jobId}, change #${practiceView(practice).seq}, from this browser's saved practice record. This is not server persistence or a new authenticated technician session.` : "No completed practice job retrieved in this session.",
  ];
  return <div className="cv101" data-testid="cv101-walkthrough">
    <style>{CSS}</style>
    <div inert={source ? true : undefined}>
      <header className="cv101-head"><div><p className="cv101-kicker">FactoryLM / MIRA · Home conveyor case study</p><h1>Meet CV-101</h1><p className="cv101-muted">Six workflows, from machine identity to maintenance memory.</p></div></header>
      <div className="cv101-banner" data-testid="cv101-demo-banner"><div className="cv101-banner-head"><strong>SYNTHETIC PRACTICE · No live connection.</strong><div className="cv101-actions"><button aria-label="Show all workflows" onClick={() => { setTab("walkthrough"); bringIntoView(steps); }}>Steps</button><button aria-label="Close walkthrough" onClick={onClose}>Close</button></div></div>Historical source cards, a prepared answer and local practice records. No equipment, MIRA-provider or Atlas calls. Practice is separate from live acceptance.</div>
      <nav className="cv101-tabs" aria-label="CV-101 views"><button aria-pressed={tab === "walkthrough"} onClick={() => setTab("walkthrough")}>Walkthrough</button><button aria-pressed={tab === "live"} onClick={() => setTab("live")}>Live evidence</button><button aria-pressed={tab === "case"} onClick={() => setTab("case")}>Case study</button></nav>
      {tab === "walkthrough" ? <div className="cv101-layout">
        <nav className="cv101-nav" ref={steps} aria-label="Six CV-101 workflows">{CV101_WORKFLOWS.map((w, i) => <button key={w.title} aria-current={step === i ? "step" : undefined} aria-pressed={step === i} onClick={() => chooseStep(i)}><b>{i + 1}</b><span>{w.title}<br /><Badge status={statusFor(i)}>{statusFor(i)} · practice</Badge></span></button>)}</nav>
        <main className="cv101-main" ref={main} data-testid={`cv101-workflow-${step + 1}`}>
          <p className="cv101-kicker">Workflow {step + 1} of 6 · practice session {session}</p><h2>{current.title}</h2>
          <ol>{current.instructions.map(text => <li key={text}>{text}</li>)}</ol>
          <section className="cv101-card cv101-result"><dl><dt>Expected result</dt><dd>{current.expected}</dd><dt>Actual practice result <Badge status={status}>{status} · practice</Badge></dt><dd aria-live="polite">{results[step]}</dd><dt>Evidence</dt><dd><Evidence href={current.evidence} /></dd></dl></section>
          <details className="cv101-card"><summary>Live acceptance: <Badge status={current.live.status}>{current.live.status}</Badge> · dated November 6 evidence</summary><p>{current.live.actual}</p><p>No practice action changes this result. Open Live evidence for all checks.</p></details>
          {storageError && <p role="alert" className="cv101-banner">{storageError}</p>}
          {step === 0 && <><div className="cv101-card"><h3>CV-101 · home conveyor</h3><p>Historical records describe a Micro820-controlled conveyor with a GS10 drive, gearmotor and photoeye. Current device identities and topology need reconciliation.</p><p className="cv101-muted">Practice asset: <code>DEMO-CV101</code> · synthetic context, not the garage CMMS UUID.</p><button className="cv101-primary" onClick={() => progress({ discovered: true })}>Select CV-101 practice asset</button></div><p>Real product entry: sign in normally → navigation → Projects → the confirmed project&apos;s machine link. A similar display name is insufficient; verify the owner&apos;s asset binding.</p></>}
          {step === 1 && <><CV101Architecture /><div className="cv101-grid">{CV101_COMPONENTS.map(c => <section className="cv101-card" key={c.id}><h3>{c.name}</h3><p><strong>{c.model}</strong></p><p className="cv101-muted">{c.state}</p><p>{c.detail}</p><div className="cv101-actions"><button onClick={() => progress({ components: [...new Set([...lesson.components, c.id])] })}>{lesson.components.includes(c.id) ? "Marked read" : "Mark record read"}: {c.name}</button><Evidence href={c.source}>Original evidence</Evidence></div></section>)}</div><div className="cv101-card"><h3>Applicable OEM references</h3><p>Micro820: 2080-IN009 installation instructions and 2080-UM005 user manual. GS10: the official family manual. These references do not prove current asset attachments or source versions.</p><button onClick={() => openManual(false)}>Open Micro820 manual reference</button> · <Evidence href="https://cdn.automationdirect.com/static/manuals/gs10m/gs10usermanual.html">GS10 OEM manual</Evidence></div></>}
          {step === 2 && <><div className="cv101-card"><h3>Actual historical cloud receipt</h3><p>Inspected {E.asOf}. Source group <code>plc_bridge / cv101-bench-modbus</code>: 721 rows / 721 source timestamps. Newest observation: <strong>2026-11-05 22:25:02.165 UTC</strong>; receipt: 22:25:02.706139 UTC. Over 12 hours old at inspection.</p><p>Tenant, per-tag values and quality were not returned by that grouped query. Ignition&apos;s newest receipt was also over 11 hours old. Last-change timestamps alone do not prove replay or a current acquisition.</p><Evidence href={E.receipt}>Read the actual receipt</Evidence></div><button className="cv101-primary" onClick={() => progress({ telemetry: true })}>Replay synthetic DI05 samples</button>{lesson.telemetry && <div className="cv101-card"><h3>Synthetic samples — not measured</h3><div className="cv101-table-wrap"><table><thead><tr><th>Example acquisition UTC</th><th>DI05 raw</th><th>Source / quality</th></tr></thead><tbody>{["false", "true", "false"].map((value, i) => <tr key={i}><td>12:00:0{i}.000</td><td>{value}</td><td>walkthrough fixture / synthetic</td></tr>)}</tbody></table></div><p>No blocked/clear polarity or motor motion is inferred. This replay cannot satisfy live freshness.</p></div>}</>}
          {step === 3 && <><div className="cv101-card"><h3>Prepared technical question</h3><p>Which user manual applies to the Micro820 controller?</p><button className="cv101-primary" onClick={() => progress({ question: true, citation: false })}>Play prepared question</button></div>{lesson.question && <section className="cv101-card" data-testid="cv101-prepared-answer"><h3>Prepared answer — no MIRA inference call</h3><p>The Micro820 controller user manual is publication <strong>2080-UM005</strong>, referenced in the installation instructions <strong>2080-IN009, page 6</strong>. This identifies a family reference; the installed unit, applicable revision and current asset attachment still need verification.</p><button onClick={() => openManual(true)}>Open supporting manual citation</button><p className="cv101-muted">This teaches source navigation. It does not establish live retrieval, source ingestion or a served MIRA answer.</p></section>}</>}
          {step === 4 && <CV101PracticeInspection practice={practice} onCreate={() => { const p = newPractice(viewerScope, new Date().toISOString(), `demo-cv101-${crypto.randomUUID()}`); save({ ...p, lesson }); }} onRecord={r => practice && act(() => updatePracticeRecord(practice, r, new Date().toISOString()))} onFinish={() => practice && act(() => finishPractice(practice, new Date().toISOString()))} />}
          {step === 5 && <><div className="cv101-actions"><button onClick={() => { setPractice(null); setLesson(emptyLesson()); setSaved(false); setStorageError(null); setSession(n => n + 1); }}>Start a new practice session</button><button className="cv101-primary" onClick={restore}>Retrieve saved practice job</button></div><p className="cv101-muted">This does not sign out, change a tenant or restart a server. You can also reload this tab, reopen CV-101 walkthrough and choose workflow 6.</p>{lesson.recalled && practice && <div data-testid="cv101-recalled-job" className="cv101-card"><h3>Asset Memory practice recall</h3><p>Retrieved a synthetic documentation review, finished by {practiceView(practice).finished?.by} at {practiceView(practice).finished?.at}.</p><p>{practiceView(practice).finished?.summary}</p><ul>{[...practiceView(practice).notes, ...practiceView(practice).questions].map(n => <li key={n.id}>{n.text} — {n.by}, {n.at}</li>)}</ul><p>Same browser / same viewer scope · job <code>{practice.jobId}</code> · change #{practiceView(practice).seq}. No server or second-technician proof.</p><Evidence href={E.inventory}>Original historical/source inventory</Evidence><div className="cv101-document"><LivingRecall practice={practice} /></div></div>}</>}
          <div className="cv101-actions"><button disabled={step === 0} onClick={() => chooseStep(step - 1)}>Previous workflow</button><button disabled={step === 5} onClick={() => chooseStep(step + 1)}>Next workflow</button></div>
        </main>
      </div> : <main className="cv101-main" ref={main}>{tab === "live" ? <><h2>Live acceptance remains separate</h2><p>Saved audit as of {E.asOf}. No live tests run in this walkthrough. Owner authentication, reader identity and fresh telemetry have not been established.</p>{CV101_WORKFLOWS.map(w => <section className="cv101-card" key={w.title}><h3>{w.title} <Badge status={w.live.status}>{w.live.status}</Badge></h3><p>{w.live.actual}</p><Evidence href={w.evidence} /></section>)}<OwnerActions /></> : <CaseStudy />}</main>}
    </div>
    {source && <div className="cv101-source-layer" ref={sourceLayer}><p><strong>Prepared example / OEM reference.</strong> No asset-attached retrieval is claimed.</p><SourceViewer state={{ ...createShellState(getFixture("general-ask"), PROFILES.hub), selectedSource: source }} dispatch={action => { if (action.type === "select-source" && action.sourceId === null) closeSource(); }} /></div>}
  </div>;
}

function LivingRecall({ practice }: { practice: Practice }) {
  const view = practiceView(practice);
  return <LivingSheetPrint view={view} seq={view.seq} printedAt={practice.events.at(-1)!.recordedAt} preview />;
}
function OwnerActions() {
  return <section className="cv101-card"><h3>Human actions needed for the real journey</h3><ol><li>Sign in normally to the existing garage-owner workspace. Do not send credentials.</li><li>Have the PLC-laptop owner identify the current existing reader and provide fresh source/quality evidence. Do not start a competing poller or change configuration.</li><li>Reconcile installed component identities and applicable original manual links before recording a real inspection.</li></ol><p>No equipment starts, PLC/drive commands, configuration changes or Atlas writes are part of this guide. Live testing stops at an unestablished prerequisite.</p><Evidence href={E.procedure}>Full real-equipment acceptance checklist</Evidence></section>;
}
function CaseStudy() {
  return <article data-testid="cv101-case-study"><p className="cv101-kicker">CV-101 case study · evidence, not a release claim</p><h2>From scattered records to a machine history</h2><p>Mike&apos;s home conveyor is a real source of photographs, technician records and historical cloud telemetry. The first complete live Asset Memory journey is still unproven.</p><CV101Architecture /><h3>What is actually verified</h3><div className="cv101-grid"><section className="cv101-card"><h3>Cloud identity</h3><p>The November 6 inspection found the garage CMMS asset and verified Postgres graph bridge. A second tenant has the same display name. Exact notebook association remains unresolved.</p><Evidence href={E.receipt} /></section><section className="cv101-card"><h3>Historical ingestion</h3><p>Existing cloud history contains a distinct-timestamp PLC-bridge source group. Its newest observation was over 12 hours old. This is evidence of persisted history, not present equipment state.</p><Evidence href={E.receipt} /></section><section className="cv101-card"><h3>Tested software draft</h3><p>Saved-job evidence projection, imported reports, closeout batching and configured evidence links have regression/integration evidence in draft #5241. Its review converged with one tracked low issue; it is not merged or deployed.</p><Evidence href={E.software} /></section><section className="cv101-card"><h3>What practice demonstrates</h3><p>This guide exercises local selection, evidence inspection, a synthetic sample replay, a prepared citation, existing work-record controls and same-browser event replay. It proves no live provider answer, physical repair, server persistence or human acceptance.</p></section></div><h3>What remains unknown</h3><p>Current unit identifiers/topology, photoeye make/polarity, serial settings, fresh drive/PLC values, original manual attachments, a real completed CV-101 job, cross-session owner recall and Atlas association.</p><OwnerActions /><p><Evidence href={E.acceptance}>Full evidence and PASS / FAIL / BLOCKED / NOT TESTED matrix</Evidence></p></article>;
}

export function CV101Walkthrough({ viewerScope, onClose, storage }: { viewerScope: string; onClose: () => void; storage?: PracticeStorageProvider }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeSource = useRef<(() => boolean) | null>(null);
  useEffect(() => { const d = dialog.current; d?.showModal(); return () => { if (d?.open) d.close(); }; }, []);
  return <dialog ref={dialog} className="cv101-dialog" aria-label="CV-101 first-user walkthrough" onCancel={event => { if (closeSource.current?.()) event.preventDefault(); }} onClose={() => {
    // Shell Back closes the native dialog directly, bypassing cancel. Consume
    // that close at the nested source layer before releasing this walkthrough.
    const d = dialog.current;
    if (d && !d.open && closeSource.current?.()) { d.showModal(); return; }
    onClose();
  }}><CV101WalkthroughContent key={viewerScope} viewerScope={viewerScope} onClose={onClose} storage={storage} onSourceChange={callback => { closeSource.current = callback; }} /></dialog>;
}
