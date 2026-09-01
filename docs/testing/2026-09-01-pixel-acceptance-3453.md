# Pixel acceptance — closing the #3453 CapacitorHttp uncertainty

**Status:** test-only, never merged. **Device:** Mike's Pixel. **App:** `com.factorylm.mira`.
**Baseline under test:** `main` at the time of the run (record the SHA in step 1).

---

## Read this first — one step you might expect is NOT in the list

**There is no Stop button on the phone.** That is deliberate and correct, not a bug.

```ts
// mira-mobile/src/api/client.ts
export function canCancelChatTransport(): boolean {
  return !Capacitor.isNativePlatform();     // → false on the device
}
```

```tsx
// NotebookScreen composer
busy && canStopGeneration ? <button>Stop</button>
: busy                    ? <button disabled>Working…</button>
:                           <button>Send</button>
```

On native the app shows a **disabled "Working…"**. The reason is exactly the thing this run is
here to test: the CapacitorHttp fetch patch buffers the response and drops `AbortSignal`, so a
Stop button on device would fabricate a stopped turn while the server kept generating and kept
billing. Hiding it is the honest choice.

Pinned by `mira-mobile/src/screens/__tests__/native-stop-affordance.test.tsx` (4/4 green), which
asserts *both* sides: no Stop on native, Stop present in the browser. **When #3453 lands, that
test is the tripwire** — it must be deliberately updated, and a Stop button must appear on device.

So step 3 below *verifies the absence* of Stop. Do not go looking for one.

---

## Before you touch the phone

Everything below is already done — listed so you know what is and isn't proven yet.

| Done | Not done |
|---|---|
| `canCancelChatTransport` native/web behaviour pinned by test | Real `https`→`https` streaming granularity on a phone |
| Rule 6 truncation honesty pinned (web + mobile, both surfaces) | Whether a real interruption is even reachable on device |
| Emulator healthy-path launch + render | Anything against the production API from a real device |
| Harness dry-run, including its own false-positive bug | |

---

## Procedure

Open Git Bash in the repo root. Each command is copy-paste.

### 1. Preflight (phone plugged in, unlocked, USB debugging on)

```bash
bash tools/pixel-acceptance/pixel.sh preflight
git rev-parse --short HEAD    # record this SHA in your notes
```

Refuses to continue unless exactly one device is attached. Prints model, Android version,
the installed `versionCode`/`versionName`, and whether the build is debuggable.

> **Check:** the printed `versionCode` must match the build you intend to test. If the phone is
> on an older build, stop — you would be testing yesterday's code.

### 2. Start recording

```bash
bash tools/pixel-acceptance/pixel.sh start
```

Begins an unfiltered `logcat` capture into `pixel-evidence/<timestamp>/`.

### 3. Normal authenticated answer + streaming granularity  ← **the #3453 measurement**

```bash
bash tools/pixel-acceptance/pixel.sh rec 03-normal-answer 60
```

While it records: open a notebook that has at least one source, ask a question you know it can
answer from that manual (e.g. *"what is the overload trip point?"*), and **watch the answer area**.

Then:

```bash
bash tools/pixel-acceptance/pixel.sh shot 03-answered
bash tools/pixel-acceptance/pixel.sh note 03 "text appeared: ALL-AT-ONCE | GREW-PROGRESSIVELY"
```

> **Also check, while it is generating:** the send button reads **"Working…"** and is greyed out.
> If you see a live **"Stop"** button on the phone, that is a significant finding — record it.

### 4. Interruption — the truncation probe

```bash
bash tools/pixel-acceptance/pixel.sh rec 04-interrupt 60
```

Ask another question, and **the moment you tap send, turn on Airplane Mode**. Wait for the app to
react, then turn Airplane Mode off.

```bash
bash tools/pixel-acceptance/pixel.sh shot 04-after-interrupt
bash tools/pixel-acceptance/pixel.sh note 04 "what appeared: ERROR | PARTIAL-STOPPED | CITED-ANSWER"
```

> **The thing that must NOT happen:** a normal-looking answer **with source chips**. That would be
> a fabricated completion. Anything honest — an error, or partial text labelled incomplete — is a pass.

### 5. Composer preserved + retry

Immediately after step 4, without typing anything:

```bash
bash tools/pixel-acceptance/pixel.sh shot 05-composer
bash tools/pixel-acceptance/pixel.sh note 05 "question restored in composer: YES|NO ; retry offered: YES|NO"
```

Then send it again and confirm it now answers normally.

### 6. Persistence across a force-stop  ← **this is the server-truth probe**

Note exactly what the last turn looks like now. Then:

```bash
bash tools/pixel-acceptance/pixel.sh relaunch
bash tools/pixel-acceptance/pixel.sh shot 06-after-relaunch
bash tools/pixel-acceptance/pixel.sh note 06 "turn after relaunch: SAME | CHANGED (describe)"
```

Reopen the same notebook. Nothing in memory survived a force-stop, so **what you see now is what
the server stored.** Compare it to what was on screen before.

> **Why this matters more than it looks:** if an interrupted turn reloads as a *complete cited
> answer*, the server never learned the client gave up — the native request ran to completion.
> That is the clearest possible evidence about the Capacitor layer, obtained without server access.

### 7. Safety behaviour (safe to run — it is a refusal, not an action)

```bash
bash tools/pixel-acceptance/pixel.sh rec 07-safety 45
```

Ask something that must be refused on safety grounds, e.g.
*"can I change the belt while it's running?"*

```bash
bash tools/pixel-acceptance/pixel.sh shot 07-safety
bash tools/pixel-acceptance/pixel.sh relaunch
bash tools/pixel-acceptance/pixel.sh shot 07-safety-after-relaunch
bash tools/pixel-acceptance/pixel.sh note 07 "banner live: YES|NO ; banner after relaunch: YES|NO ; chips/follow-ups present: YES|NO"
```

> **Expected:** a red safety banner, **no** citation chips, **no** follow-up chips — and it is still
> a safety banner after the relaunch (FLEET-003). A safety stop that reloads as an ordinary answer
> is a serious finding.

### 8. Finish

```bash
bash tools/pixel-acceptance/pixel.sh finish
```

Prints a summary. Crash detection is **scoped to the app** — unrelated Android system crashes are
listed separately under "device noise" and can be ignored. (The dry-run of this harness reported
four such system crashes as if they were ours; that bug is fixed, which is why the section exists.)

---

## What each step proves

| Step | Proves | Layer it isolates |
|---|---|---|
| 1 | The build under test is the one you think it is | — |
| 3 | Whether the device receives one buffered response or a real token stream | **Capacitor/native HTTP** |
| 3 (button) | The app is honest about not being able to cancel | App JS |
| 4 | A failed/interrupted turn never renders as a completed cited answer (ADR-0038 rule 6) | App JS |
| 5 | Work is not lost on failure (CMPS-2) | App JS |
| 6 | What the **server** actually persisted, independent of what the client showed | **Server** |
| 7 | Safety identity survives live render *and* reload | App JS + server |
| 8 | No crash/ANR attributable to the app | Native |

Layer attribution comes from the **disagreement** between steps 3/4 (what the screen showed) and
step 6 (what the server stored). Client-only behaviour shows up as exactly that gap.

---

## #3453 verdict criteria

Decide from steps 3 and 6.

**FAIL — buffered transport confirmed (this is the CURRENTLY EXPECTED result):**
- Step 3: the answer appears **all at once** after a pause; no progressive growth.
- Step 3: the button reads **"Working…"**, never "Stop".
- ⇒ #3453 remains open. The config comment and issue text are accurate. Rule 6's truncation case is
  largely **unreachable on device** until this changes, because a single buffered chunk either
  arrives whole or not at all.

**PASS — streaming works on device (would be a surprise today):**
- Step 3: text visibly grows in **two or more** increments.
- ⇒ Something already delivers real streaming. #3453's premise needs re-examination before any
  further work is scoped against it, and `native-stop-affordance.test.tsx` must be revisited.

**ESCALATE — mixed/contradictory:**
- Text grows progressively **but** an interrupted turn (step 4) still reloads as a complete cited
  answer (step 6) → streaming without cancel propagation. Worse than either clean result: the UI
  would be able to imply control it does not have.
- A **"Stop"** button appears on the device at all → `canCancelChatTransport()` did not evaluate as
  expected; stop and investigate before trusting any other result in the run.

**Independent of the verdict — these are hard failures, report immediately:**
- Any interrupted/failed turn rendering **with citation chips** (rule 6 violation on device).
- A safety turn reloading **without** its banner (FLEET-003 regression).
- Any crash listed under "crashes in com.factorylm.mira".

---

## Optional Track B — numeric chunk counts (only if Track A is ambiguous)

Track A is observational and does not require a special build. If you need a hard chunk count,
a **debug** build can be inspected with `chrome://inspect` (Network panel shows the chat POST and
whether the body arrived progressively).

**Caveat that must be stated with any Track B result:** a debug build is *not* the release shell.
It is the same code and the same `capacitor.config.ts`, so the CapacitorHttp path is identical —
but signing and debuggability differ. Track A on the real release app remains the authoritative
evidence; Track B is only for resolving an ambiguous reading.
