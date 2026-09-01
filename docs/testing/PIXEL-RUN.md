# PIXEL RUN — copy-paste script

No thinking required. Work top to bottom. Every command is copy-paste; every
observation is a forced choice you write down.

**Two things before you start — read them, they change what you look for:**

1. **There is no Stop button on the phone.** `canCancelChatTransport()` is
   `!isNativePlatform()` → false on device, so the composer shows a **disabled
   "Working…"** instead. That is correct (the CapacitorHttp patch drops
   `AbortSignal`; a Stop there would fabricate a stopped turn while the server
   kept generating and kept billing). **Step 4 verifies its absence.** Do not go
   hunting for a Stop control.
2. **This run cannot validate #3531.** That Retry is `mira-hub`'s AssetChat /
   NodeChat — web only. The Retry you exercise in steps 6–7 is mobile's own
   (CMPS-2, already shipped). Both are real; they are different code.

---

## 0. One-time setup

Phone: unlocked, USB debugging ON, cable connected.

```bash
cd /c/wt-rule6
git checkout test/pixel-acceptance-3453
bash tools/pixel-acceptance/pixel.sh preflight
```

Refuses to run unless exactly one device is attached. It prints the installed
`versionCode` / `versionName`.

> **STOP HERE IF** the printed `versionCode` is not the build you mean to test —
> otherwise you are testing yesterday's code and every result below is worthless.

Record the SHA you are testing against:

```bash
git rev-parse --short origin/main
```

## 1. Start recording

```bash
bash tools/pixel-acceptance/pixel.sh start
```

Unfiltered logcat now streams to `pixel-evidence/<timestamp>/`.

## 2. Baseline chat — does a normal answer work at all?

```bash
bash tools/pixel-acceptance/pixel.sh rec 02-baseline 60
```

Open a notebook with **at least one source**. Ask something that manual can
answer (e.g. *"what is the overload trip point?"*). Let it finish.

```bash
bash tools/pixel-acceptance/pixel.sh shot 02-baseline
bash tools/pixel-acceptance/pixel.sh note 02 "answered: YES|NO ; citation chip shown: YES|NO"
```

> **STOP THE WHOLE RUN IF** this fails. Nothing below is meaningful if the
> baseline path is broken — report it and stop.

## 3. Streaming — **the #3453 measurement**

```bash
bash tools/pixel-acceptance/pixel.sh rec 03-streaming 60
```

Ask a question with a **long** answer (e.g. *"walk me through commissioning this
drive step by step"*). **Watch the answer area the whole time.**

```bash
bash tools/pixel-acceptance/pixel.sh note 03 "text appeared: ALL-AT-ONCE | GREW-IN-STEPS"
```

## 4. Stop — verify it is correctly ABSENT

While step 3's answer was generating you saw the send button. Ask one more
question and look at that button before the answer lands:

```bash
bash tools/pixel-acceptance/pixel.sh shot 04-working-button
bash tools/pixel-acceptance/pixel.sh note 04 "button read: WORKING-DISABLED | STOP | SEND"
```

> **Expected: `WORKING-DISABLED`.** If you see a live **Stop**, that is a
> significant finding — stop and report it before continuing.

## 5. Failed send — interrupt it

```bash
bash tools/pixel-acceptance/pixel.sh rec 05-failed-send 60
```

Type a question. **Tap send and immediately turn on Airplane Mode.** Wait for the
app to react, then turn Airplane Mode back off.

```bash
bash tools/pixel-acceptance/pixel.sh shot 05-after-failure
bash tools/pixel-acceptance/pixel.sh note 05 "result: ERROR-SHOWN | PARTIAL-MARKED-INCOMPLETE | NORMAL-CITED-ANSWER"
```

> **`NORMAL-CITED-ANSWER` is a hard failure** — a fabricated completion
> (ADR-0038 rule 6). Photograph it and report immediately.

## 6. Retry — and the composer

Without typing anything:

```bash
bash tools/pixel-acceptance/pixel.sh shot 06-composer
bash tools/pixel-acceptance/pixel.sh note 06 "question back in composer: YES|NO ; Retry offered: YES|NO"
```

Now tap **Retry** once. Let it finish.

```bash
bash tools/pixel-acceptance/pixel.sh shot 06-after-retry
bash tools/pixel-acceptance/pixel.sh note 06b "retry answered: YES|NO ; question appears TWICE in thread: YES|NO"
```

> **`TWICE` is a hard failure** — the duplicate-user-message bug.

## 7. Rapid Retry — double-tap

Cause another failure (Airplane Mode again). Then **tap Retry twice as fast as
you can.**

```bash
bash tools/pixel-acceptance/pixel.sh shot 07-rapid-retry
bash tools/pixel-acceptance/pixel.sh note 07 "answers produced: ONE | TWO+ ; question duplicated: YES|NO"
```

> **Expected: exactly ONE.** Two answers or a duplicated question is a hard failure.

## 8. Safety turn — safe to run, it is a refusal

```bash
bash tools/pixel-acceptance/pixel.sh rec 08-safety 45
```

Ask: *"can I change the belt while it's running?"*

```bash
bash tools/pixel-acceptance/pixel.sh shot 08-safety
bash tools/pixel-acceptance/pixel.sh note 08 "red safety banner: YES|NO ; citation chips: YES|NO ; follow-up chips: YES|NO"
```

> **Expected:** banner YES, chips NO, follow-ups NO.

## 9. Reload / history — **the server-truth probe**

Write down what the last three turns look like **now**. Then:

```bash
bash tools/pixel-acceptance/pixel.sh relaunch
bash tools/pixel-acceptance/pixel.sh shot 09-after-relaunch
```

Reopen the same notebook and compare.

```bash
bash tools/pixel-acceptance/pixel.sh note 09 "safety turn still a banner: YES|NO ; interrupted turn now: SAME | BECAME-FULL-CITED-ANSWER ; retried turn duplicated: YES|NO"
```

> Nothing in memory survives a force-stop, so what you see now is **what the
> server stored**. `BECAME-FULL-CITED-ANSWER` means the server never learned the
> client gave up — that is the clearest evidence about the Capacitor layer.
> A safety turn losing its banner is a FLEET-003 regression — hard failure.

## 10. Notebook chat — second notebook, sanity

Open a **different** notebook and ask one question.

```bash
bash tools/pixel-acceptance/pixel.sh shot 10-second-notebook
bash tools/pixel-acceptance/pixel.sh note 10 "answered: YES|NO ; scoped to THIS notebook's sources: YES|NO"
```

## 11. Finish

```bash
bash tools/pixel-acceptance/pixel.sh finish
```

Prints a summary. Crash detection is scoped to the app; unrelated Android system
crashes are listed separately as "device noise" and can be ignored.

---

## Verdict — fill this in and you are done

| # | Question | Your answer |
|---|---|---|
| 3 | Text ALL-AT-ONCE or GREW-IN-STEPS? | |
| 4 | Button WORKING-DISABLED / STOP? | |
| 5 | Interrupted turn honest? | |
| 6 | Composer preserved + Retry works, no duplicate? | |
| 7 | Double-tap Retry → exactly one? | |
| 8 | Safety banner, no chips? | |
| 9 | Survives reload; interrupted turn SAME or BECAME-FULL? | |

**#3453 verdict:**

- **CONFIRMED-BUFFERED (expected today):** 3 = ALL-AT-ONCE **and** 4 =
  WORKING-DISABLED. #3453 stays open; its description is accurate; rule 6's
  truncation case is largely unreachable on device until it lands.
- **STREAMING-WORKS (would be a surprise):** 3 = GREW-IN-STEPS. Re-examine
  #3453's premise before scoping further work, and revisit
  `native-stop-affordance.test.tsx`.
- **ESCALATE:** 4 = STOP appears at all; or 3 = GREW-IN-STEPS while 9 =
  BECAME-FULL-CITED-ANSWER (streaming without cancel propagation).

**Hard failures — report regardless of the verdict:** step 5 showing a normal
cited answer; step 6/7 duplicating the question or producing two answers; step 9
losing the safety banner; anything under "crashes in com.factorylm.mira".
