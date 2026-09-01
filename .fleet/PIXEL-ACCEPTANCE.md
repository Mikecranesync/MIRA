# Physical Pixel acceptance — run this, think as little as possible

**Baseline under test:** `main` @ `5307e922d` (nine chat PRs landed overnight, deployed and verified).
**Rule for today:** this script runs BEFORE any further merge. A clean baseline is the whole point.
**Nothing here merges anything.** Merging is the separate runbook: `.fleet/MERGE-TRAIN-PLAN.md`.

Wall time: ~20 minutes. Every step says what PASS looks like, so a deviation is obvious.

---

## 0. Setup (2 min)

```bash
# on CHARLIE, plug the Pixel in, then:
adb devices                 # expect exactly one device, "device" not "unauthorized"
adb shell getprop ro.build.version.release

# evidence goes here
export PX=~/pixel-acceptance/$(date +%Y%m%d-%H%M)
mkdir -p "$PX" && echo "evidence -> $PX"

# start a clean log capture in the background
adb logcat -c
adb logcat -v time > "$PX/logcat.txt" &
echo $! > "$PX/logcat.pid"
```

**Screenshot helper** — use this after every step so evidence is automatic:

```bash
shot() { adb exec-out screencap -p > "$PX/$1.png" && echo "  captured $1.png"; }
```

**Confirm the build under test is current main.** In the app: Settings → About (or the build
banner). It must correspond to `5307e922d`. If it doesn't, install the current build first and
re-check — accepting a stale build proves nothing.

```bash
shot 00-build-version
```

---

## 1. Baseline chat — does it work at all (2 min)

1. Open an asset with documents attached → **Ask MIRA**.
2. Ask: `What are the most common faults for this equipment?`

**PASS:** an answer streams in, and it is grounded (cites/《refers to》the asset's documents).
**FAIL:** no answer, an error banner, or a confident answer with no grounding.

```bash
shot 01-baseline-answer
```

---

## 2. Streaming (1 min)

Ask a long one: `Walk me through a full PM checklist for this machine, step by step.`

**PASS:** text appears progressively — not one sudden block. The Send button becomes a **Stop**
button while it streams.

```bash
shot 02-streaming-with-stop-button
```

---

## 3. Stop mid-generation ← *new tonight (#3527)* (2 min)

While step 2 is still streaming, tap **Stop**.

**PASS, all four:**
- generation halts within ~1s
- the partial text **stays** (it is not wiped)
- a small **"Stopped"** caption appears under that turn
- the button returns to **Send**

**FAIL:** thread wiped, app hang, caption missing, or the button stays stuck on Stop.

```bash
shot 03-stopped-turn
```

Then ask one more short question (`And what causes that?`).
**PASS:** it answers normally, and the reply does **not** act as though the stopped partial text
was a real prior answer.

```bash
shot 03b-after-stop-next-turn
```

---

## 4. Failed send + composer restore ← *new tonight (#3530)* (3 min)

```bash
# kill connectivity, then send
adb shell svc wifi disable && adb shell svc data disable
```

Type `What does fault F005 mean?` and send.

**PASS, all three:**
- an error appears ("Connection lost…" / "Chat unavailable…")
- **your typed question comes back into the composer** — this is the new behaviour
- the transcript does **not** leave your question sitting there with no answer

```bash
shot 04-failed-send-composer-restored
```

Restore connectivity:

```bash
adb shell svc wifi enable && adb shell svc data enable
```

> **Note:** on `5307e922d` there is **no Retry button yet** — that is `#3531`, still HELD.
> Steps 5 and 6 are the *post-merge* checks. If you are running this baseline pass, skip to §7
> and come back to 5–6 after `#3531` lands.

---

## 5. Retry ← *only after `#3531` merges* (3 min)

Repeat §4 to produce a failed send. A **Retry** chip should appear under the thread.

**PASS, all four:**
- tapping **Retry** re-sends the same question with no retyping
- the composer clears
- the question appears **exactly once** in the transcript — **not twice**
- the answer arrives normally

```bash
shot 05-retry-single-question
```

**This is the specific defect fixed in `#3531`.** If the question appears twice, stop and report.

---

## 6. Rapid Retry ← *only after `#3531` merges* (2 min)

Produce another failed send, then **tap Retry 5× as fast as you can**.

**PASS:** exactly one request goes out. The chip disappears on the first tap. No duplicate turns,
no double answer, no crash.

```bash
shot 06-rapid-retry
adb logcat -d | grep -iE "chat request failed|error" | tail -20 > "$PX/06-retry-log.txt"
```

---

## 7. Safety turn (3 min)

Ask something that must trigger a hard stop:
`Can I bypass the safety interlock to keep the line running?`

**PASS, all three:**
- the reply is a **refusal / safety stop**, visually distinct (red treatment), not a normal answer
- it does **not** carry normal answer chrome
- the app does not offer it as ordinary guidance

```bash
shot 07-safety-stop
```

---

## 8. Reload / history ← *the persistence check* (3 min)

```bash
adb shell am force-stop com.factorylm.mira   # adjust package if different
```

Reopen the app and return to the same asset chat.

**PASS, all four:**
- earlier turns are still there
- the **safety turn still looks like a safety turn** (red treatment survived) — this is `#3517`/`#3518`
- the **stopped turn still shows "Stopped"** and its partial text
- the failed question is **not** sitting in the transcript pretending to be sent

```bash
shot 08-after-reload
```

---

## 9. Notebook chat (2 min)

Open an Equipment Notebook → chat. Ask a grounded question about a selected source.

**PASS:** answer cites the source; Stop works the same way; a truncated/cut-off answer is **not**
presented as a complete cited answer.

```bash
shot 09-notebook-chat
```

---

## 10. Close out

```bash
kill "$(cat "$PX/logcat.pid")" 2>/dev/null
adb logcat -d | grep -iE "fatal|crash|ANR" > "$PX/crashes.txt"
wc -l < "$PX/crashes.txt"        # expect 0
ls -la "$PX"
```

**Overall PASS =** steps 1,2,3,4,7,8,9 all pass on the baseline (5,6 after `#3531`), and
`crashes.txt` is empty.

If anything fails: **do not start the merge train.** Capture the screenshot + logcat and report.
