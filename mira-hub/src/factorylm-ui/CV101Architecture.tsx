import { useId } from "react";
export function CV101Architecture() {
  const id = useId();
  return <figure className="cv101-map" data-testid="cv101-architecture">
    <svg viewBox="0 0 480 275" role="img" aria-labelledby={id} style={{ width: "100%", maxWidth: 720 }}>
      <title id={id}>CV-101 historical topology: Micro820 to GS10 over RS-485; drive to motor; PE-101 to PLC DI05. Current physical relationships are unverified.</title>
      <g fill="var(--fl-surface)" stroke="var(--fl-line-strong)">
        <rect x="10" y="10" width="190" height="76" rx="8" /><rect x="280" y="10" width="190" height="76" rx="8" />
        <rect x="10" y="176" width="190" height="76" rx="8" /><rect x="280" y="176" width="190" height="76" rx="8" />
      </g>
      <g fill="var(--fl-ink)" fontSize="17" fontFamily="var(--fl-font)">
        <text x="25" y="40">Micro820 PLC</text><text x="295" y="40">GS10 drive</text>
        <text x="25" y="205">PE-101 photoeye</text><text x="295" y="205">Motor / gearbox</text>
      </g>
      <g fill="var(--fl-muted)" fontSize="14" fontFamily="var(--fl-font)">
        <text x="25" y="64">2080-LC20-20QBB</text><text x="295" y="64">Exact unit unresolved</text>
        <text x="25" y="230">Identity / polarity unknown</text><text x="295" y="230">Nameplate transcription</text>
        <text x="210" y="28">RS-485</text><text x="315" y="132">3-phase</text><text x="30" y="132">DI05</text>
      </g>
      <g fill="none" stroke="var(--fl-muted)" strokeWidth="2" strokeDasharray="5 4">
        <path d="M200 50 H275 M266 44 L275 50 L266 56" />
        <path d="M375 86 V170 M369 161 L375 170 L381 161" />
        <path d="M105 176 V92 M99 101 L105 92 L111 101" />
      </g>
    </svg>
    <figcaption>Historical and reported connections, shown dashed. Current physical relationships are <strong>unverified</strong>.</figcaption>
    <ol className="cv101-flow" aria-label="Existing software architecture">
      { ["Existing reader / Ignition", "Authenticated relay", "Postgres evidence + asset graph", "Confirmed notebook + Living Sheet", "MIRA answer / illustrated guide"].map(item => <li key={item}>{item}</li>) }
    </ol>
    <p className="cv101-muted">The path exists in code. This diagram does not assert that every connection is live, deployed, approved or proven for this job. Atlas remains a separate authorized work-order integration.</p>
  </figure>;
}
