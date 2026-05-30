# PLC Learning Guide Product — v1 PRD

**Status:** Approved 2026-05-17 — Phase 1 in progress
**Owner:** Mike
**Last updated:** 2026-05-17
**Parent doctrine:** `~/.claude/skills/plc-instruction-guide/SKILL.md` (the v0 baseline — global skill, no repo implementation yet)
**Scope-lock note:** OFF the locked MIRA marketplace objective (`~/.claude/CLAUDE.md`). Approved scope is **personal learning tool**. Customer-facing variants are sketched as Phase 2/3 only — they do **not** start until marketplace Units 9b/10 ship or the lock expires (2026-07-19).
**Mirrored from:** `~/.claude/plans/remember-where-we-were-glimmering-dongarra.md` (approved plan-mode artifact).

---

## 1. Context — why now

Mike is teaching himself CCW / Micro820 / Modbus RTU / GS11 VFD programming. He has a sharp learning style: he prefers a guided "simple first → pain → better pattern → walkthrough → variable map → test → troubleshoot → mental model" arc (the video transcript he pasted is the canonical example: user-defined function blocks in CCW).

The existing **`plc-instruction-guide` skill** (global, `~/.claude/skills/plc-instruction-guide/`) already encodes a strong visual + citation discipline (cheatsheet, `.bug`/`.why`/`.check` callouts, `pre.ladder`/`pre.wiring` blocks, four-source citation rule). What it does **not** yet enforce:

1. The **teaching-style arc** above. The skill currently optimizes for short reference walkthroughs. Mike wants long-form lessons that build a mental model first.
2. A **Variable Map table** (Name | Type | Direction | Scope | Purpose | Why it belongs here) that classifies every input/output/local/global so the reader learns *why* a variable is where it is, not just what it does.
3. A **CLI** in the MIRA repo that turns the skill into a repeatable pipeline — feed `{ST source, transcript or notes, manual page refs, prior bugs}` and get a draft HTML. Today everything is hand-typed.
4. An **on-demand clarification UI** Mike can open mid-read when a guide section confuses him. ("What does `.Done` mean here? Why is this variable global?") Today he has to leave the guide and ask in chat.
5. Reality check: **none of the skill's referenced infrastructure exists in this repo.** No `docs/instructions/`, no `scripts/build_instruction_pdfs.ps1`, no shipped `Conv_Simple_*.html`. The skill describes a phantom v1. v1 of this product is "make the skill's claims actually true on disk."

## 2. Scope

### ✅ IN scope (v1, Mike-only)

- Extend the global skill (`~/.claude/skills/plc-instruction-guide/`) with a new teaching-pattern reference + a teaching-style HTML template. Existing CSS + visual vocabulary preserved byte-for-byte.
- Create the missing repo infrastructure: `docs/instructions/` directory, `scripts/build_instruction_pdfs.ps1` + `.sh` (Chrome headless renderer matching what the skill already documents), `docs/instructions/.gitkeep`.
- New Python CLI at `tools/plc-guide-gen/` (uv-managed, ruff-clean, Python 3.12) with four subcommands: `draft`, `build`, `validate`, `list`.
- Drafting uses the existing MIRA cloud LLM cascade (Groq → Cerebras → Gemini per PRD §4 — **no Anthropic**, never reintroduce). Reuse the `shared/inference/router.py` pattern; do not invent a parallel client.
- Citation validator: every number in the rendered HTML must be inside a `.pageref` span, a `.cheatsheet` row with a Source column, or a code block. Validator returns line-numbered violations.
- Local-only Hono/Bun UI at `tools/plc-guide-gen/ui/` (matches mira-web stack), single page, served on `localhost:3300`. Paste a snippet or question → get a grounded explanation using the same cascade. **Not a PDF generator UI** — the CLI owns PDF generation; the UI owns "wait, what does this mean?" lookups.
- Two seed guides produced via the CLI to dogfood the pipeline: `Conv_Simple_UDFB_Intro.html` (worked from the video transcript + Mike's `Micro820_v4.1.8_Program.st`) and `Conv_Simple_GS11_Modbus_Polling.html` (worked from `plc/GS10_Integration_Guide.md` + `plc/RESUME_VFD_COMMISSIONING.md`).

### ❌ OUT of scope (v1)

- Multi-tenancy, auth, Doppler integration, billing. Mike runs this on his Windows box. Provider keys live in a local `.env` excluded from git.
- Customer-facing surface in `mira-web` / `mira-hub`. That's Phase 2 and requires the marketplace lock to lift first.
- Standalone domain / Stripe / public marketing. That's Phase 3 and requires v1+v2 customer validation.
- Real-time CCW integration (parsing live `.ccwsln` solution files, round-tripping to CCW). Treat CCW as a read-only source.
- Video generation. Pasting a transcript is fine; producing video from a guide is out.
- Replacing the existing skill's CSS or callout classes. Inheritance is the whole point.

## 3. Architecture

```
~/.claude/skills/plc-instruction-guide/   (extended in place)
  SKILL.md                       process + bundled-resources list
  assets/template.html           short-form (existing, untouched)
  assets/teaching-template.html  long-form lesson (NEW)
  references/teaching-pattern.md the 14-section arc (NEW)
  references/variable-map.md     the Variable Map table spec (NEW)
  references/section-patterns.md existing, light xref edit

MIRA/tools/plc-guide-gen/   (NEW Python CLI, uv project)
  pyproject.toml          Python 3.12, ruff, httpx, click
  plc_guide/cli.py        draft | build | validate | list
  plc_guide/llm.py        thin wrapper around the cascade
  plc_guide/template.py   fills assets/teaching-template.html
  plc_guide/validate.py   citation discipline enforcer
  .env.template           GROQ_API_KEY / CEREBRAS_API_KEY / etc.

MIRA/docs/instructions/   (NEW directory)
  Conv_Simple_UDFB_Intro.html  + .pdf (seed guide #1)
  Conv_Simple_GS11_Modbus_Polling.html + .pdf (seed guide #2)

MIRA/scripts/build_instruction_pdfs.ps1 (+ .sh)   (NEW)
  Walks docs/instructions/*.html → Chrome headless → sibling .pdf
  Supports -Filter, -OpenAfter (matches skill's documented usage)

MIRA/tools/plc-guide-gen/ui/   (NEW Hono/Bun mini-app)
  localhost:3300, single page, "ask while reading"
  Hits the same cascade via /api/explain
```

**Provider order (cascade):** Groq → Cerebras → Gemini. Sanitize input via the same regex set as `InferenceRouter.sanitize_context` (IP/MAC/serial). No Anthropic ever.

## 4. Phases

| Phase | Outcome | Acceptance |
|---|---|---|
| **P1 — Repo infrastructure** | `docs/instructions/` + `scripts/build_instruction_pdfs.ps1` + `.sh` exist; the skill's claimed workflow runs end-to-end on a hand-written HTML | `pwsh scripts/build_instruction_pdfs.ps1 -Filter "*.html"` exits 0 and produces ≥1 non-zero PDF in `docs/instructions/`. Build script handles missing-Chrome with a clear error. |
| **P2 — Skill extension** | New `teaching-pattern.md` + `variable-map.md` + `teaching-template.html` added to the global skill; SKILL.md "Bundled resources" list updated | Read-back of SKILL.md shows the three new entries. The teaching template renders cleanly when run through P1's build script with placeholder content. |
| **P3 — CLI scaffold** | `plc-guide draft\|build\|validate\|list` work against a stub LLM (returns canned text) | `uv run plc-guide draft --topic test --output docs/instructions/Stub.html` produces a non-zero HTML. `plc-guide validate` flags an unsourced number with file:line. |
| **P4 — LLM wiring** | CLI hits the real Groq → Cerebras → Gemini cascade | `plc-guide draft --st plc/Micro820_v4.1.8_Program.st --topic udfb-intro` produces a draft HTML where every cheatsheet row has a Source cell and at least 20 `.pageref` spans appear in the body. |
| **P5 — Seed guide #1** | `Conv_Simple_UDFB_Intro.html` shipped end-to-end via the CLI, polished by Mike, rendered to PDF | Mike reads the PDF on his phone and confirms the teaching arc is intact: 60-sec mental model → simple version → why it hurts → UDFB pattern → CCW walkthrough → Variable Map → code walkthrough → scan cycle → test → troubleshoot → mental model → next step. |
| **P6 — Clarification UI** | Hono/Bun app at `tools/plc-guide-gen/ui/` serves a single page on `localhost:3300` | `bun dev` starts; pasting a CCW question returns a coherent answer in <8 sec with at least one source-doc citation when applicable. |
| **P7 — Seed guide #2** | `Conv_Simple_GS11_Modbus_Polling.html` shipped; CLI proven on a second real topic | Same acceptance as P5. Plus: `plc-guide validate` passes on both seed guides. |

Estimated effort: P1+P2 same day (≈2h). P3+P4 one day. P5 one evening of polish. P6 ≈3h. P7 one evening. Total ≈3–4 calendar days of focused work, none of which displaces marketplace-objective hours if Mike does this off-clock.

## 5. Verification (end-to-end)

1. Clone fresh, `cd MIRA`, `uv sync` in `tools/plc-guide-gen/`.
2. Set `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY` in `tools/plc-guide-gen/.env`.
3. Run `uv run plc-guide draft --st ../../plc/Micro820_v4.1.8_Program.st --topic "user-defined function blocks" --output ../../docs/instructions/Conv_Simple_UDFB_Intro.html`.
4. Run `pwsh ../../scripts/build_instruction_pdfs.ps1 -Filter "Conv_Simple_UDFB_Intro.html"`. Confirm sibling `.pdf` ≥30 KB.
5. Run `uv run plc-guide validate ../../docs/instructions/Conv_Simple_UDFB_Intro.html`. Exit 0.
6. Open `Conv_Simple_UDFB_Intro.pdf` in any viewer. Confirm: cheatsheet on page 1, `.bug` block if superseding, 60-sec mental model as section 1, Variable Map table present, every parameter / register / pin cited.
7. `cd tools/plc-guide-gen/ui && bun dev`. Visit `http://localhost:3300`. Paste *"What is `.Done` on `MSG_MODBUS`?"* — get an answer that explains it and points at `plc/GS10_Integration_Guide.md` or the GS10 manual.

## 6. Critical files to be created or modified

**Created:**
- `~/.claude/skills/plc-instruction-guide/references/teaching-pattern.md`
- `~/.claude/skills/plc-instruction-guide/references/variable-map.md`
- `~/.claude/skills/plc-instruction-guide/assets/teaching-template.html`
- `MIRA/scripts/build_instruction_pdfs.ps1`
- `MIRA/scripts/build_instruction_pdfs.sh`
- `MIRA/docs/instructions/.gitkeep`
- `MIRA/tools/plc-guide-gen/pyproject.toml` + `plc_guide/{cli,llm,template,validate}.py` + `.env.template`
- `MIRA/tools/plc-guide-gen/ui/{package.json, src/index.ts, src/views/index.html}`
- `MIRA/docs/instructions/Conv_Simple_UDFB_Intro.html` + `.pdf` (seed)
- `MIRA/docs/instructions/Conv_Simple_GS11_Modbus_Polling.html` + `.pdf` (seed)

**Modified:**
- `~/.claude/skills/plc-instruction-guide/SKILL.md` — append the three new bundled resources to the list (no rewrite)
- `~/.claude/skills/plc-instruction-guide/references/section-patterns.md` — add a one-line xref to `teaching-pattern.md` at the top
- `MIRA/CLAUDE.md` — single line under "Pointers" pointing at this ideation doc

## 7. Reuse — do not reinvent

- **LLM cascade pattern** — model on `mira-bots/shared/inference/router.py`. Same provider order, same sanitizer, same fallback semantics. Do not write a new HTTP client.
- **Chrome-headless invocation** — match the contract already documented in `~/.claude/skills/plc-instruction-guide/references/build-pdf.md` (flags, output naming, `-Filter`, `-OpenAfter`). The skill describes the script as if it exists; honor that description so the skill doesn't need editing.
- **Citation discipline rules** — verbatim from `~/.claude/skills/plc-instruction-guide/references/citation-discipline.md`. The validator implements those four legitimate source types as a regex sweep over the rendered HTML.
- **Visual vocabulary** — `assets/template.html` CSS stays byte-for-byte. The teaching template is a longer skeleton built from the same `<style>` block.

## 8. Future phases (sketch only — do not start until v1 is in Mike's daily use for ≥2 weeks)

- **Phase 2 — MIRA-integrated**: surface "Generate training guide" inside `mira-hub` for a logged-in customer's UNS asset. Auto-pulls the asset's PLC tag map, work-order history, and any uploaded manuals. Blocks on: marketplace launch shipping (Units 9b/10), Doppler/auth/billing plumbing for the new surface, and explicit user demand from a marketplace customer.
- **Phase 3 — Standalone SaaS**: separate domain (`factorylm-learn.com`), Stripe checkout, BYO PLC project upload. Blocks on: ≥3 non-Mike customers in Phase 2, validated willingness to pay, and explicit decision to fork a second product line.

Both phases inherit the v1 CLI + skill verbatim — they're new front doors, not new engines. That's the design constraint that makes v1 cheap to build: every later surface routes back to `tools/plc-guide-gen/`.

## 9. Known issues / open questions

- **CCW solution files (`.ccwsln`) are XML but undocumented.** P4 may need to fall back to parsing only the `.st` exports, which is what `plc/Micro820_v4.1.8_Program.st` already is. If a future guide needs ladder-rung structure, revisit.
- **Video transcript ingestion.** v1 accepts a transcript as a `--transcript path.txt` flag. Pulling from YouTube needs the `youtube-transcript` skill already in the repo's skill list — wire it as a `plc-guide draft --transcript-url <url>` enhancement if needed; otherwise Mike pastes.
- **Cascade rate limits.** Groq free tier is generous; Cerebras tighter; Gemini key is currently blocked in Doppler (per root CLAUDE.md "Gotchas"). v1 uses local env keys, not Doppler — but if Mike's personal Groq key gets throttled mid-draft the cascade should degrade gracefully.
- **Citation enforcer false positives.** A number inside prose like "ladder rung 3" or "step 1" should not trigger. The validator needs a small whitelist (`rung N`, `step N`, `phase N`, `page N` where N is small). Start strict, relax based on first 10 real-guide validations.

## 10. Change log

- 2026-05-17 — Initial PRD approved. v1 = Mike-only (sharpened skill + Python CLI + local Hono/Bun clarification UI). Phases 2/3 sketched but gated on v1+marketplace. P1 in progress.
