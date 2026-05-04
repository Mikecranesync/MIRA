## Why
Factory AI's Predict claims its differentiation is vibration analysis: FFT spectra with peak detection classified by order (1X = imbalance, 2X = misalignment, BPFO/BPFI = bearings, gear mesh). This is pure-software; we can match with zero sensor purchase.

## Source
- https://docs.f7i.ai/docs/api/fft-data
- https://docs.f7i.ai/docs/predict/user-guides/analyse-data
- `docs/competitors/factory-ai-leapfrog-plan.md` #6

## Acceptance criteria
- [ ] Python service (extend `mira-ingest` or new `mira-vibe`) exposes `POST /api/v1/fft` accepting raw time-domain samples + sampling rate + optional bearing geometry, RPM
- [ ] Uses scipy.fft; returns `{spectrum: {frequencies, amplitudes}, peaks: [{frequency, amplitude, order, label}], rpm}`
- [ ] Standard bearing formulas implemented (BPFO, BPFI, BSF, FTF) parametric on bearing geometry (n_balls, ball_dia, pitch_dia, contact_angle)
- [ ] Label peaks: 1X/2X/3X harmonics → imbalance/misalignment/looseness; bearing-freq matches → BPFO/BPFI/BSF/FTF; gear-mesh matches
- [ ] Hub consumes results at `(hub)/alerts/[id]/spectrum` — renders chart with labeled peaks
- [ ] Reference worksheet `docs/playbooks/fft-interpretation.md` with waveform → failure-mode mapping

## Files
- New: `mira-vibe/` (or inline in mira-ingest)
- `mira-hub/src/app/api/sensors/[id]/fft/route.ts` (proxy to vibe service)
- `mira-hub/src/app/(hub)/alerts/[id]/spectrum/page.tsx`
