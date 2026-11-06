import type { JobRecord } from "@/capabilities/work-packet/job-record";
import { CompletionBlock, JobNotesSection, StepRecordControls } from "./JobRecordView";
import { LivingSheetPrint } from "./LivingSheetPrint";
import { practicePacket, practiceView, type Practice } from "./cv101-walkthrough-model";

export function CV101PracticeInspection({ practice, onCreate, onRecord, onFinish }: {
  practice: Practice | null; onCreate: () => void; onRecord: (r: JobRecord) => void; onFinish: () => void;
}) {
  const packet = practicePacket();
  const view = practice ? practiceView(practice) : null;
  return <section data-testid="cv101-inspection">
    <p><strong>Synthetic documentation review.</strong> No physical inspection, measurements, equipment operation or Atlas order. Use practice notes only; do not enter private workplace information.</p>
    {!practice ? <button className="cv101-primary" onClick={onCreate}>Create practice inspection</button> : <>
      <p className="cv101-muted">Local practice job {practice.jobId} · change #{view!.seq} · {view!.finished ? "finished in practice" : "in progress"}</p>
      {!view!.finished && <>
        {packet.steps.map((s, index) => <div className="cv101-card" key={s.n}><h3>Step {s.n}</h3><p>{s.text.value}</p><StepRecordControls index={index} struck={false} text={s.text.value} record={practice.record} by="Demo technician" onChange={onRecord} /></div>)}
        <JobNotesSection record={practice.record} by="Demo technician" steps={packet.steps.length} onChange={onRecord} />
        <p className="cv101-muted">A note can state that live evidence is unavailable. Do not claim a repair or a physical condition you did not observe. Completing this practice is not closeout QC or reusable approval.</p>
        <button className="cv101-primary" disabled={!!view!.openSteps || !practice.record.notes.length} onClick={onFinish}>Finish practice, keeping unknowns open</button>
      </>}
      <CompletionBlock packet={packet} record={practice.record} />
      <details className="cv101-card" open={!!view!.finished}><summary>Living Sheet preview — same event history</summary>
        <div className="cv101-document"><LivingSheetPrint view={view!} seq={view!.seq} printedAt={practice.events.at(-1)!.recordedAt} preview /></div>
      </details>
    </>}
  </section>;
}
