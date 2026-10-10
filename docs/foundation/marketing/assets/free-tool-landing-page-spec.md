# Landing page spec: Free Manual Check
*URL: factorylm.com/manual-check. Built by Foreman as a website PR; live only after Mike approves. Runs by hand (Mike checks every answer) until the P0 gate passes.*

## Goal
Get a maintenance person to send one real manual and up to 3 real questions, so they see a cited answer on their own equipment. One conversion: form submitted.

## Page copy (final)
**Headline:** Send us one manual. Ask three questions. Get the answers with the page.
**Subhead:** Upload a manual for one of your machines, any brand, and the questions your techs actually ask. Within one business day, we email back the answers, each pointing to the manual page it came from. If your manual doesn't cover a question, we'll tell you. Free, no sales call.

**How it works (3 steps):**
1. Upload one manual (PDF, up to [size limit Foreman sets]).
2. Type up to 3 questions in plain English, the way your tech would ask them.
3. Get a short PDF back within one business day: each answer, the manual name, and the page.

**What you'll get back (example block):** a real screenshot of the Micro810 answer citing page 57. Caption: "From our own test on a Rockwell Micro810 manual."

**Fine print (visible, plain):**
- Your manual is used only to answer your questions. We don't publish it or share it, and we'll delete it on request.
- A person at FactoryLM checks every answer before it's sent.
- Tip: ask full questions ("What does fault F0004 mean on the G120 and how do I clear it?") rather than just the code.
- Not for lockout, arc-flash or confined-space procedures. Follow your site's procedures for those.

## Form fields
| Field | Required | Notes |
|---|---|---|
| Name | yes | |
| Work email | yes | |
| Plant / company | yes | |
| Role | yes | dropdown: Maintenance manager · Lead tech / tech · Reliability/controls engineer · Other |
| Maintenance crew size | no | 1 · 2–5 · 6–15 · 16+ (used to spot the beachhead) |
| Machine / model the manual covers | yes | |
| Manual upload (PDF) | yes | |
| Questions 1–3 | Q1 required | text boxes |
| "OK to use my (anonymized) question in a FactoryLM post?" | no | unchecked by default |

**After submit:** "Got it. Mike will email you within one business day." No auto-reply marketing sequence.

## Back end (by hand for now)
- The form emails Mike and stores the PDF in a private location (Foreman's choice; never public).
- Mike creates **one fresh Hub notebook per request**, asks each question as a full sentence, opens every cited page, and marks each answer: ✔ correct with page · "not in your manual" · ✖ missed.
- Marketing Lead drafts the reply PDF; Mike reviews and sends it from his mailbox.
- Each request is logged in HubSpot free (source, role, crew size, result).

## Measure
Requests per week · % from beachhead (crew 2–15) · % answers marked correct · replies that become a pilot conversation.

## Don't
- No downtime stats, logos or "trusted by" lines.
- No promise of fault-code lookup until the short-code fix ships.
- No self-serve MIRA chat on this page until all three P0 fixes pass.
