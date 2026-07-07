# Ask the GS10 drive pack — from home (read-only)

The smallest verified path to ask MIRA useful GS10 questions and get answers
**grounded in the promoted `durapulse_gs10` drive pack**, with citations, no
generic hallucination, no hardware. It reuses the exact runtime pack machinery
(`load_pack` + `build_cards` + the GS10 fault-intel reader) — it just lets a
**text question** reach it, which the live-telemetry path can't do on its own.

## The command

Run from the `mira-bots/` directory:

```bash
cd mira-bots
python -m shared.drive_packs.ask --pack durapulse_gs10 \
    --question "For a GS10 drive, what does CE10 mean and what should I check first?"
```

Add `--json` for a machine-readable result (`pack_id`, `schema_version`,
`answer_source`, `matched`, `fallback_used`, `live_telemetry`, `citations`).

## Questions that work today (pack-supported)

| Question | Resolves to |
|---|---|
| `For a GS10 drive, what does CE10 mean?` | fault **CE10** = RS-485 Modbus timeout + causes + first checks + P09.03 |
| `Give me a technician-safe first-check procedure for GS10 CE10.` | CE10 VIEW-ONLY first checks |
| `Where is GS10 P09.03 documented?` | parameter **P09.03** [COM1 Time-out Detection], cited to manual p.**4-188** |
| `What GS10 parameter controls communication timeout?` | P09.03 (matched by intent) |

The pack currently covers faults **CE1–CE4, CE10, EF, GFF, Lvd, oL** and
parameter **P09.03**. Ask about one of those.

## What you'll see

- `answer_source: drive_pack` — the answer came from the pack, not a generic LLM.
- `fallback_used: false` — it never invents a generic VFD answer. An unmatched
  question gets an honest "the pack is loaded but doesn't document that — I won't
  guess" (it also lists what it *does* cover).
- `live_telemetry: false` — **static manual-pack intelligence only.** It reads
  the pack, not the drive; no live values.
- `read_only: true` — parameter answers show VIEW-ONLY keypad steps and warn
  against changing settings. **No drive writes exist.**
- `CITATIONS:` — the pack's own manual references (e.g. `p.4-188` for P09.03;
  the CE10 comm-fault section reference).

## Limitations (honest)

- **Static, not live.** This does not read your GS10's DC bus / output frequency
  / run command / comm status. Those need the live Modbus/Ignition telemetry path
  (the `live_snapshot` → `build_drive_diagnostic` path), which is a separate,
  already-existing surface that requires a live connection.
- **Local command, not yet a from-anywhere URL.** This is the "acceptable today"
  proof that the GS10 JSON powers a grounded answer. Exposing it as a live
  Hub/Telegram/API surface (so you can ask from a phone with no laptop) is the
  **one remaining deployment step** — see the follow-up note below.
- **Citations are section-level for the CE codes.** GS10 labels manual pages by
  chapter-section ("4-188"), and the CE-fault meanings cite the RS-485 comm
  section rather than a single page number — honest, not a fabricated page.

## Remaining step to make it reachable from a phone (follow-up)

`answer_question(pack_id, question)` in `shared/drive_packs/ask.py` is the
reusable core. Wiring it behind an existing surface (a Hub read-only route, a
Telegram `/drive gs10 CE10` command, or the pipeline's Ignition chat path) makes
it reachable from home without a laptop. That is a deliberate, separate change
(new surface + deploy + verify) and is **not** done here — this PR proves the
pack answer path works and keeps the change small and safe.
