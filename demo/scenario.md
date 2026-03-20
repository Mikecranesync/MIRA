# MIRA Demo Scenario — 90 Second Walkthrough

## Setup (before recording)

1. Run `python demo/seed_demo_data.py`
2. Ensure MIRA stack is running (`bash install/up.sh`)
3. Open Telegram on phone, navigate to @FactoryLMDiagnose_bot
4. Clear any previous conversation state with `/reset`
5. Confirm bot responds to `/start` before you hit record

---

## Demo Script

### [0:00] Open — Show the Problem

- Show phone with Telegram open, bot chat visible
- Narrate: "Factory technicians spend 40% of their time diagnosing problems. What if you could just ask your factory what's wrong?"

### [0:10] Send Photo

- Take or send a photo of industrial equipment — a contactor, VFD nameplate, or motor starter panel works best
- Narrate: "I snap a photo of the equipment that's giving me trouble."
- Wait for MIRA response — it will identify the equipment type and ask a first diagnostic question

### [0:25] First Diagnostic Question

- MIRA asks: "What symptoms are you observing?" with numbered options
- Select the option matching an overcurrent or tripping fault (typically option 1 or 2)
- Narrate: "MIRA identifies the equipment and asks a smart question — not a guess, a question."

### [0:35] Second Question

- MIRA narrows down the fault category — asks about specific operating conditions (e.g., does it trip immediately on start, or after running a while?)
- Answer with the relevant option number
- Narrate: "It's guiding me like an expert tech would."

### [0:45] Third Question

- MIRA asks one more clarifying question (e.g., has the ambient temperature been higher than normal?)
- Answer with the relevant option
- Narrate: "Three questions. That's all it takes."

### [0:55] Diagnosis Delivered

- MIRA provides a diagnosis with confidence level, root cause, and step-by-step fix instructions
- Pause to let the audience read the response
- Narrate: "Root cause identified. Fix steps right here, on the phone, in the field."

### [1:10] Equipment Status Check

- Type `/equipment CONV-001`
- Wait for MIRA to return live status data from the MCP endpoint
- Show: equipment name, status (faulted), current draw, temperature reading, active fault count
- Narrate: "And I can pull live equipment telemetry any time — right from the chat."

### [1:20] Close

- Narrate: "That's MIRA — AI-powered equipment diagnosis, delivered through the apps your team already uses. No new software, no training, no downtime."

---

## Key Points to Hit

- Real AI inference on every response — not scripted or canned
- Photo-based equipment identification works on any nameplate
- Guided Socratic method — MIRA asks smart questions, doesn't guess
- Live equipment telemetry via `/equipment` command
- Works in Telegram today; Slack, Teams, and WhatsApp coming in Config 2
- Target: under 10 seconds per bot response on Claude backend

---

## Timing Reference

| Mark  | Action                          | Expected Bot Response Time |
|-------|---------------------------------|----------------------------|
| 0:10  | Send photo                      | 5–9s (vision + LLM)        |
| 0:25  | Send option number "1"          | 3–6s                       |
| 0:35  | Send option number              | 3–6s                       |
| 0:45  | Send option number              | 3–6s                       |
| 0:55  | Diagnosis arrives               | —                          |
| 1:10  | `/equipment CONV-001`           | 1–3s (DB lookup)           |

---

## Troubleshooting

**Bot not responding:** Check `docker compose logs mira-bot-telegram -f` on CHARLIE.

**Slow responses:** Confirm `INFERENCE_BACKEND=claude` is set in Doppler. Local Qwen is ~3x slower.

**Wrong equipment identified:** Use a clear, well-lit photo of the nameplate only. Avoid shadows.

**`/equipment` returns empty:** Run `python demo/seed_demo_data.py` to ensure demo data is loaded.

**GSD state stuck:** Send `/reset` to clear conversation state and start fresh.
