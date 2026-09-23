# Answer with hazard flags, not refusals

**Date:** 2026-09-22 · **Status:** ANALYSIS — no code changed
**Trigger:** "why would a contactor chatter instead of pulling in cleanly" returned a
pure ⛔ SAFETY STOP on staging. A qualified tech asking why a contactor chatters got
LOTO boilerplate and no answer.
**Owner decision requested:** Mike

## The principle

A maintenance technician who asks why a contactor chatters is going to open that
panel either way. Refusing does not remove the hazard — it removes the information
and sends them in less informed. The product law already says this:

> Guardrails prevent dangerous or unsupported specificity; they must not
> unnecessarily suppress useful general reasoning.

**Target behaviour: always answer. Flag the hazard in a short banner, keep the
isolation conditions inline, never substitute a sermon for the answer.**

## The good news — the pattern already exists and is half-built

#3763 made the energized-electrical class a **directive**, not a stop: the answer
streams, framed by `ELECTRICAL_HAZARD_DIRECTIVE`, and the turn persists
`{kind:"safety_notice"}`. **#3917 (open)** makes mobile render exactly that as a
**non-terminal warning** from `hazardEntries`.

So the banner-plus-answer path exists end to end for ONE hazard class. This work
generalizes it to the rest. It is mostly deletion of a branch, not new machinery.

## The three places that refuse

### 1. Input gate — `matchSafetyStop()` (`safety-classifier.ts`), called at `route.ts:1032`

| tier | today | change to |
|---|---|---|
| `SAFETY_PHRASES_IMMEDIATE` (27 phrases) | terminal `SAFETY_STOP`, **no provider call** | hazard banner + answer |
| `ENERGIZED_ELECTRICAL_HAZARD` | **directive + answer** ✅ | unchanged — this is the model |
| `SAFETY_PHRASES` (27) + `EDUCATIONAL_QUESTION_RE` carve-out | `SAFETY_STOP` unless the regex says it's educational | hazard banner + answer; the carve-out becomes unnecessary |

The educational carve-out is a symptom: it exists because the gate was too blunt.
Once every class answers, the regex that tries to guess "is this a real question"
can go.

### 2. Output judge — `semanticSafetyCheck()` (`route.ts:2650-2666`) ← **this is what killed the contactor turn**

```ts
if (sv.verdict === "unsafe") { outputRejected = …; answerText = SAFETY_STOP; }
else if (sv.verdict !== "safe") { outputRejected = …; answerText = SEMANTIC_UNVERIFIED_FALLBACK; }
```

The model **generated a correct answer and it was thrown away**. Worse, the second
branch fails closed when the judge merely *failed* — a timeout or a vendor blip
discards a good answer. A broken judge is not evidence of a dangerous answer.

Change: keep `answerText`. Use the verdict to attach a banner and a
`safety_notice` entry. Fail **open** on unverified.

### 3. `SAFETY_STOP` constant itself

Ten lines of LOTO procedure that replace the answer. Becomes a short banner:

```
⚠ ENERGIZED / ARC-FLASH — qualified person, arc-rated PPE, live-work permit.
```

One or two lines naming the *specific* hazard, then the answer. Per class:
LOTO · arc flash · confined space · hot work · stored pressure · chemical · fall ·
rotating machinery.

## Concrete change list

| # | File | Change | Size |
|---|---|---|---|
| 1 | `src/lib/safety-classifier.ts` | `HAZARD_BANNERS: Record<hazardClass, string>`; keep detection, retire `SAFETY_STOP` as an answer | M |
| 2 | `…/chat/route.ts:1247-1252` | `safetyTrigger` selects a banner instead of short-circuiting; drop the no-provider-call branch | M |
| 3 | `…/chat/route.ts:2650-2666` | judge attaches a banner, never replaces `answerText`; unverified fails **open** | S |
| 4 | `…/chat/route.ts:1352` | emit `safety_notice` for every class (today: energized only) | S |
| 5 | `mira-contract.ts` `MIRA_CORE` | strengthen ENERGY STATE: isolation conditions inline, per step | S |
| 6 | `.claude/rules/mira-industrial-safety.md` | rewrite: owns hazard **flagging**, not STOP+escalate | M |
| 7 | `chat-answer-gate.test.ts` + friends | invert: assert answer-survives-with-banner, not answer-replaced | **L** |

Item 7 is the bulk. A dozen-plus tests assert the refusal, by design — they are the
guard that stops this from being loosened by accident, so each one gets rewritten
deliberately rather than deleted.

## What I would keep, and why it is short

- **Detection.** It is what picks the banner. Nothing is thrown away.
- **Inline isolation conditions.** "With the drive isolated, locked out and the DC
  bus verified at 0 V, check continuity across 07-08" is more useful than a
  preamble, and the contract already enforces it.
- **The evidence rules.** Unrelated to this. A refusal to invent P042's default is
  an accuracy guardrail, not a safety one — do not let this change touch it.

One line, not a lecture: the only case I would still treat differently is a request
to **permanently defeat** a protective device (jumper an E-stop, disable an
arc-flash relay so a line keeps running). I would still answer it — a tech
diagnosing a faulty interlock needs that — but name plainly that it removes a
protection and should not be left that way. That is a sentence in the answer, not a
refusal. Your call if you want even that dropped.

## Risk

Real, and worth stating once: this makes MIRA answer questions it currently refuses,
on equipment that can kill. The mitigation is that the answers get *better* hazard
framing than the refusal did — a banner naming the specific hazard plus isolation
conditions inline beats a generic wall the tech scrolls past. The failure mode being
removed is a tech getting nothing and guessing.

## Effort

~1 focused session. Items 1-5 are half a day; item 7 is the rest. Ships behind the
existing `MIRA_PERSONA_CONTRACT` flag or its own — staging-provable the same way,
and #3917 should land first so the client renders the banners it will start
receiving.
