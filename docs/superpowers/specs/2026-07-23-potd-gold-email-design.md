# Print of the Day Gold Email Design

## Goal

Turn the committed CV-101 `E-003_vfd_power.png` sheet into an auditable graded
gold-standard candidate and make the scheduled Print of the Day job deliver one
report email for every completed run.

## Scope

- Reuse `tools.print_of_day.run`, `printsense.print_of_day.*`,
  `tools/internet_print_test/mailer.py`, and the existing Resend delivery path.
- Add a human-authored rubric and approval record for E-003 based on the
  committed source print and pack evidence, not on any prior model output.
- Add a production scheduler wrapper modeled on the existing Drive Commander
  launchd job, using Doppler-managed `factorylm/prd` secrets.
- Leave all email tests hermetic; only the final acceptance command sends one
  live email.

## Architecture

The POTD runner keeps `--send` as the only real-email switch. `--dry-run` is an
explicit no-send mode and remains the default behavior when neither flag is
provided. Recipient resolution comes from `--recipient`, then `MAIL_RECIPIENTS`,
then existing legacy recipient environment names. The code must never embed or
print the actual recipient value outside the outbound email package internals.

Report delivery is separate from gold/promotion gating. A completed run sends a
review report even when the manifest is unapproved, degraded, or not a gold
candidate. A run that cannot produce artifacts writes a failure JSON report and
exits non-zero. Email delivery failure also exits non-zero so the scheduler is
visibly red.

Duplicate protection is scoped to `run_id`. Retrying the same run ID must not
send twice. A later intentional run of the same print gets a new run ID and may
send a new report.

## E-003 Ground Truth

The rubric source is the rendered E-003 sheet and committed CV-101 pack data.
Expected devices are `SUPPLY`, `CB1`, `Q1/MLC`, `VFD1`, `M1`, and `PE`. Expected
wires are `W300`, `W301`, `W303`, `W304`, `W305`, `W306`, `W310`, `W311`,
`W312`, `W315`, `W316`, and `W317`. Expected structure includes the 230 V
single-phase input, CB1 branch protection, Q1/MLC supply switching, VFD1 GS10
input/output, M1 three-phase motor output, PE bonding, and the explicit Modbus
normal run/stop note. Required unresolved items are CB1 rating, all conductor
gauges, exact GS10 model/frame, and RFI jumper position.

The approval record is auditable metadata: approver identity label, approval
date, source files, and the fact that approval applies to the rubric/print pair,
not to a prior model answer.

## Scheduler

The scheduled command is a launchd-friendly shell script:

```bash
doppler run --project factorylm --config prd -- \
  python3.12 -m tools.print_of_day.run \
    --send \
    --case potd-e003-vfd-power \
    --image machine-print-pack/examples/cv-101/prints/sheets/E-003_vfd_power.png \
    --rubric printsense/print_of_day/gold/e003_vfd_power/rubric.json \
    --approval printsense/print_of_day/gold/e003_vfd_power/approval.json \
    --source-url repo:machine-print-pack/examples/cv-101/prints/sheets/E-003_vfd_power.png \
    --out dogfood-output/print-of-day/latest
```

The wrapper retains each timestamped run directory and refreshes `latest`.

## Error Handling

- `--dry-run` and default mode never call `mailer.send`.
- Missing recipient or `RESEND_API_KEY` blocks a `--send` run and exits non-zero.
- Email delivery failure exits non-zero after artifacts are written.
- Duplicate same-`run_id` send exits non-zero before paid interpretation when
  possible.
- Degraded, failed-grade, or unapproved completed runs still send a report when
  email configuration is present.

## Testing

Hermetic tests monkeypatch provenance/readiness/interpreter/judge/mailer. They
cover dry-run no-send, real-run exactly-one send, failed or unapproved report
send, run-id dedupe, new-run send, missing email configuration failure, and the
scheduler invoking email-enabled mode. A rubric fixture test proves the E-003
rubric is independent and yields a gold-candidate manifest when the extraction
matches it.
