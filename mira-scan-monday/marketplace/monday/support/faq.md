# MIRA Scan — FAQ

## Does MIRA work on grease-stained / scratched / faded nameplates?

Yes — within reason. The vision model is GPT-4o, which is robust to dirt, scratches, and partial occlusion. We see ~85% extraction accuracy on lightly soiled plates and ~60% on heavily corroded ones. If a field comes back empty or with low confidence, the panel lets you edit it inline before saving to monday.

## What happens if MIRA gets a value wrong?

You see the extracted fields in an editable card before they're written to monday.com. Fix anything wrong, then click **Save to monday item**. We never write to your board without an explicit save click — there is no "auto-fill on detection."

## Which equipment does MIRA recognize for the chat feature?

Today MIRA's knowledge base covers thousands of OEM manuals across Yaskawa, Allen-Bradley, Siemens, ABB, Beckhoff, Schneider, AutomationDirect, Rockwell, Omron, Mitsubishi, and others — the long tail keeps growing as customers scan equipment we haven't seen yet.

When MIRA doesn't recognize the make/model, the panel's "Manual not found" upsell automatically searches the open web for the OEM PDF, validates it (Content-Type check + magic-byte sniff), and queues it for ingest. The next scan of the same equipment usually returns a cited chat answer within 10-30 minutes.

## Does MIRA send my data to OpenAI?

Yes — for vision extraction only. The phone-captured image bytes are sent to OpenAI's Vision API to extract structured fields. The image is not stored on OpenAI's side beyond their standard 30-day retention for abuse monitoring (per OpenAI's API data-use policy).

The chat feature does **not** use OpenAI. It uses MIRA's own LLM cascade (Groq → Cerebras → Gemini, all free-tier with no training-on-input).

See `privacy.md` for the full data flow inventory.

## Is MIRA Scan SOC 2 compliant?

Not directly — we're a small team, not yet SOC-2 audited. We rely on inherited compliance from our infrastructure providers:
- monday.com (SOC 2 Type II)
- AWS (where NeonDB hosts our data, SOC 2 Type II)
- OpenAI (SOC 2 Type II)
- Groq, Cerebras, Google Cloud (chat cascade, all SOC 2)

If your organization requires direct SOC 2 from MIRA, talk to us about an enterprise pilot — we'll provide a security questionnaire response and a DPA. Email contact@factorylm.com.

## How accurate is the AI extraction?

Aggregate accuracy across our test corpus (300+ real industrial nameplates):

| Field | Accuracy |
|---|---|
| Make | 96% |
| Model | 91% |
| Serial | 78% (often partly occluded by mounting hardware) |
| Voltage | 94% |
| HP | 92% |
| RPM | 89% |
| Frame | 81% |

We surface a `confidence` score on every extraction — fields below 0.75 are highlighted yellow in the asset card so you know where to double-check before saving.
