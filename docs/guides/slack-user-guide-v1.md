# MIRA on Slack — User Guide v1 (Setup, Test & Training Run)

> A plain-language guide to installing Slack on your Mac and phone, connecting to
> MIRA, and running a short training session to learn what MIRA can do. No
> technical background needed. Written 2026-07-19.

---

## 0. How to use this guide

**On your own:** read top to bottom and do each step. Boxes marked **Do this** are
actions; boxes marked **You should see** tell you what a correct result looks like.

**With ChatGPT (or any AI assistant):** paste this whole document into the chat and
say:

> "Walk me through this guide one step at a time. Wait for me to say 'done' or
> paste what I see before moving to the next step. If something doesn't match the
> 'You should see' text, help me fix it before we continue."

That turns this into a hands-on, guided setup where the assistant checks your work
at each step.

**A few words this guide uses:**
- **Workspace** — the private Slack "home" for your company or team (like a company
  email domain, but for chat).
- **Channel** — a named group room inside a workspace (e.g. `#maintenance`).
- **DM (direct message)** — a private one-on-one chat, including a chat with MIRA.
- **Thread** — a set of replies attached to one message, kept together. MIRA uses
  threads to keep one conversation about one machine separate from another.
- **MIRA** — the maintenance assistant you're setting up. In your workspace it may
  appear under a name like **MIRA** or **FactoryLM**. Wherever this guide says
  "MIRA," use whatever name your workspace shows.

---

## 1. What MIRA on Slack can do

MIRA is a maintenance helper you talk to in plain English (or by sending a photo).
It answers from **your equipment's real manuals and records** and shows you where
each answer came from. If it doesn't have a trustworthy source, it tells you so
instead of guessing.

In Slack you can:

- **Ask a troubleshooting question** in words — MIRA answers and cites its sources.
- **Send a photo of a machine's nameplate/label** — MIRA identifies the equipment
  and lets you ask questions about it.
- **Send a photo of a wiring/electrical diagram** with a short note — MIRA reads the
  connections and saves them as a **draft** for a person to approve later.
- **Ask where a wire connects** — MIRA answers only from confirmed records; if the
  wiring isn't confirmed yet, it says so rather than guessing.
- **Keep asking follow-up questions** about the same machine in the same thread —
  MIRA remembers which machine you're on.
- **Upload a PDF manual** — MIRA adds it to what it can search and cite.
- **Use quick commands** (typed with a `/`) for equipment status, faults, work
  orders, and help.

What MIRA will **not** do: it will not run or control machines, and it will not make
up plant data. It's read-only help that points you to sources.

---

## 2. Before you start

You need:

1. **An invitation to your team's Slack workspace.** This is usually an email or a
   link from whoever runs your workspace (an "admin"). If you don't have one, ask
   your supervisor or IT for a Slack invite. **You cannot skip this** — Slack is
   private per company.
2. **A Mac** (for the desktop steps) and/or **a phone** (iPhone or Android).
3. A few test items for the training run in Part 6: one clear **photo of an
   equipment nameplate/label**, and optionally a **PDF of a manual**. Any real piece
   of equipment you maintain works.

If you don't have the invite yet, you can still install the Slack apps now (Parts 3
and 4) and join later.

---

## 3. Set up Slack on your Mac (desktop)

**Do this — install the app:**
1. Open your web browser and go to **`slack.com/downloads`** (or open the **App
   Store**, search **Slack**, and click **Get / Install**).
2. Download and open the installer, then follow the prompts to move Slack to your
   Applications.
3. Open **Slack** from Applications (or press **Cmd + Space**, type `Slack`, press
   Return).

**You should see:** a welcome screen asking you to sign in to a workspace.

**Do this — join your workspace:**
1. If you got an **email invite**, open it and click **Join** — it opens Slack and
   pre-fills your workspace. Follow the prompts to set your name and password.
2. If you got a **workspace URL** (looks like `yourcompany.slack.com`), click **Sign
   in to an existing workspace** in the app, type that address, and follow the
   prompts.
3. When asked, allow Slack to send **notifications** (so you get replies from MIRA).

**You should see:** the workspace open, with a list of channels on the left and your
name at the top.

**Tip:** keep Slack in your Dock — right-click the Slack icon → **Options** → **Keep
in Dock**.

---

## 4. Set up Slack on your phone

**Do this:**
1. Open the **App Store** (iPhone) or **Google Play Store** (Android).
2. Search for **Slack** and install it.
3. Open Slack and tap **Sign In**.
4. Sign in the same way as on your Mac:
   - Tap **I'll sign in manually** and enter your **workspace URL**
     (`yourcompany.slack.com`), **or**
   - Open your **email invite on the phone** and tap **Join**.
5. Allow **notifications** when asked, so MIRA's replies reach you on the floor.

**You should see:** the same workspace and channels you saw on your Mac. Slack keeps
both devices in sync automatically — a conversation you start on your phone is there
on your Mac, and vice versa.

**Which device for what:**
- **Phone** — best on the plant floor: snap a nameplate photo and send it right
  there.
- **Mac** — best for reading long answers, uploading PDFs, and typing.

---

## 5. Find MIRA and start a conversation

There are two ways to talk to MIRA. Try both.

### A) Direct message (private, just you and MIRA)
**Do this:**
1. In Slack, find the search or **+** near the top, or the **Direct Messages**
   section on the left.
2. Type **MIRA** (or your workspace's name for it).
3. If MIRA appears, open it and you have a private chat. Send **`hello`**.

**You should see:** a friendly reply from MIRA. If nothing happens, MIRA may not be
installed for direct messages yet — use option B, or ask your admin to enable it.

### B) In a channel (shared with your team)
**Do this:**
1. Open a channel your team uses (e.g. `#maintenance`), or create one: click **+** →
   **Create a channel** → name it `#mira-test`.
2. Invite MIRA into the channel: type **`/invite @MIRA`** and press Return (pick MIRA
   from the list Slack suggests). If your workspace names it differently, invite that
   name.
3. To get MIRA's attention in a channel, start your message with **`@MIRA`**, e.g.
   **`@MIRA hello`**.

**You should see:** MIRA reply in the channel.

> **Why @mention in channels?** In a shared channel MIRA only responds when you
> mention it, so it doesn't interrupt normal team chat. In a **DM** you don't need
> the @mention — just talk.

---

## 6. The training run

Do these in order. Each test says what to **Do**, what you **should see**, and what
it **teaches**. Use the scorecard in Part 10 to check them off. If a test doesn't
match, that's useful information — note it.

> Do the photo tests **from your phone** (easiest to snap a picture). Do the PDF test
> from your **Mac**. Keep each machine's questions in **one thread** (reply to MIRA's
> message rather than starting a new message) so MIRA keeps the context.

### T1 — Say hello
**Do:** Send `hello` (DM) or `@MIRA hello` (channel).
**You should see:** A short greeting.
**Teaches:** MIRA is connected and listening.

### T2 — Ask for help
**Do:** Send `/mira-help` (type the `/`, Slack will show matching commands).
**You should see:** A list of the commands MIRA supports.
**Teaches:** The quick commands available in *your* workspace. (Your list may be a
subset of Part 8 — that's normal; different workspaces enable different commands.)

### T3 — Ask a general maintenance question
**Do:** Ask something educational, e.g. `What is a VFD?` or `What does a proximity
sensor do?`
**You should see:** A clear plain-English answer.
**Teaches:** MIRA answers general questions without needing to know your specific
machine.

### T4 — Ask about a specific machine (the confirm step)
**Do:** Ask something machine-specific, e.g. `Why would conveyor 3 keep faulting?`
**You should see:** MIRA first **confirms which machine/area you mean** before giving
troubleshooting steps — it may ask you to confirm the asset.
**Teaches:** MIRA won't troubleshoot the wrong machine. It nails down *where* you are
first. Confirm (or correct) it, then continue.

### T5 — Send a nameplate photo
**Do:** From your phone, take a clear photo of an equipment **nameplate/label** (the
metal or sticker plate with make/model). Send it to MIRA (drag into the DM, or tap
the **+ / paperclip** and choose the photo).
**You should see:** MIRA identifies the equipment (e.g. "Identified: <make> <model>")
and invites you to ask about it. This usually comes back quickly.
**Teaches:** MIRA can recognize equipment from a photo and pull up what it knows.

### T6 — Ask a follow-up in the same thread
**Do:** **Reply in the thread** on MIRA's T5 answer (don't start a new message). Ask
something about that machine, e.g. `What does fault code CE10 mean?` (use a code
that's relevant to your equipment).
**You should see:** MIRA answers **about the machine from T5**, with sources, without
you re-stating which machine you mean.
**Teaches:** Within a thread, MIRA remembers the machine you're working on — so you
can keep asking follow-ups naturally.

### T7 — Show that threads are separate
**Do:** Start a **brand-new message** (not a reply) and ask the same follow-up as T6.
**You should see:** MIRA does **not** assume the earlier machine — it treats this as a
fresh conversation.
**Teaches:** Each thread is its own conversation. Two technicians can work on two
different machines in the same channel without mixing up.

### T8 — Ask a wiring question (honesty test)
**Do:** Ask where a wire lands, e.g. `Where does wire W200 land on conveyor 101?`
(use a real tag if you have one).
**You should see:** If the wiring is confirmed in MIRA's records, you get the answer
with a source. If it isn't confirmed, MIRA **tells you it has no confirmed record**
rather than guessing.
**Teaches:** For wiring, MIRA only answers from confirmed information. "I don't have a
confirmed record" is a correct, trustworthy answer — not a failure.

### T9 — Add a wiring diagram (optional, if you have one)
**Do:** From your phone, photograph a wiring/electrical print. Send it with a short
note that includes the machine and the word "wiring," e.g.
`CV-101 add this wiring`.
**You should see:** MIRA reads the connections and replies that it has **saved them
as a draft/proposed** for someone to review and approve. It will tell you how many it
captured.
**Teaches:** MIRA can capture wiring into records, but never treats it as confirmed
until a person approves it.

### T10 — Upload a manual (PDF)
**Do:** From your **Mac**, drag a **PDF manual** into the chat with MIRA (or use the
**paperclip → upload**).
**You should see:** MIRA acknowledges it's processing the document. After a short
while, its answers can cite that manual.
**Teaches:** You can grow what MIRA knows by giving it documents.

### T11 — Quick status commands (if enabled)
**Do:** Try `/mira-faults` (active faults) and `/mira-equipment` (equipment status).
**You should see:** A quick list, or a note that no data is available / the command
isn't enabled in your workspace.
**Teaches:** Some answers are instant lookups, no typing a question needed.

### T12 — Start fresh
**Do:** Send `/mira-reset`.
**You should see:** MIRA confirms the conversation is cleared.
**Teaches:** How to wipe context and start clean if a conversation gets confused.

---

## 7. Everyday tips

- **Keep one machine per thread.** Reply inside a thread to keep MIRA on the same
  machine; start a new message to switch machines.
- **Photos beat typing on the floor.** A clear nameplate photo is often the fastest
  way to get MIRA on the right equipment.
- **Trust the "I don't know."** When MIRA says it has no confirmed source, that's the
  feature working — it protects you from acting on a guess. If you *know* the answer,
  you or an admin can add the document or approve the record so MIRA can cite it next
  time.
- **Look for the sources.** Good answers name where they came from (a manual, a
  record). If there's no source, treat the answer as general knowledge, not
  machine-specific fact.
- **Phone and Mac stay in sync.** Start on one, finish on the other.
- **Safety phrases get special handling.** If you mention an immediate hazard (for
  example arc flash or lockout/tagout), MIRA prioritizes a safety response over normal
  troubleshooting. Always follow your site's safety procedures — MIRA is guidance, not
  authorization.

---

## 8. Command quick reference

Type these with the leading `/`. Slack shows matching commands as you type. **Your
workspace may enable only some of these** — `/mira-help` shows the real list.

| Command | What it does |
|---|---|
| `/mira <your question>` | Ask MIRA a question via a command (instead of a plain message) |
| `/mira-help` | Show the commands available to you |
| `/mira-equipment [id]` | Show live status for a piece of equipment |
| `/mira-faults` | Show current active faults |
| `/mira-status` | Get a short summary of the current situation |
| `/work-order <description>` | Start a maintenance work order |
| `/asset <tag>` | Look up a machine's history / details |
| `/mira-reset` | Clear the current conversation and start fresh |

In a **DM**, you can skip commands and just talk. In a **channel**, start with
`@MIRA` to get its attention.

---

## 9. Troubleshooting

| Problem | Try this |
|---|---|
| Can't sign in to Slack | Make sure you're using the exact **workspace URL** from your invite (`yourcompany.slack.com`). Use "Forgot password" if needed, or ask your admin to re-send the invite. |
| Can't find MIRA to DM | It may not be enabled for direct messages. Use a **channel** and `/invite @MIRA`, or ask your admin to enable MIRA. |
| MIRA doesn't reply in a channel | You must start the message with **`@MIRA`** in channels. In a DM, no mention is needed. |
| A `/command` isn't recognized | That command may not be enabled in your workspace. Run `/mira-help` to see what *is* available. |
| Photo didn't get identified | Retake it: fill the frame with the **nameplate/label**, good light, in focus, straight-on. Then resend. |
| MIRA says it has no record | That's expected when the info isn't confirmed. Add the manual (T10) or ask an admin to approve the record. |
| No notifications on phone | Phone **Settings → Slack → Notifications → Allow**, and check Slack's own **Preferences → Notifications**. |
| Everything's confused | Send `/mira-reset` and start a fresh thread. |

If a step here doesn't match what you see, note exactly what you did and what
appeared, and share it with your admin (or paste it to the AI assistant helping you)
— the wording of the difference is the fastest way to fix it.

---

## 10. Your test-run scorecard

Fill this in as you go. "Pass" = it matched the **You should see** text. "Note" =
anything surprising.

| # | Test | Pass? (Y/N) | Note |
|---|------|-------------|------|
| T1 | Say hello | | |
| T2 | `/mira-help` | | |
| T3 | General question | | |
| T4 | Machine-specific (confirm step) | | |
| T5 | Nameplate photo | | |
| T6 | Follow-up in same thread | | |
| T7 | New thread is separate | | |
| T8 | Wiring question (honesty) | | |
| T9 | Wiring diagram → draft (optional) | | |
| T10 | Upload a PDF manual | | |
| T11 | Status commands (if enabled) | | |
| T12 | `/mira-reset` | | |

**Overall:** ____ / 12 passed. Anything you couldn't do because it wasn't enabled in
your workspace → list it here and ask your admin: ____________________.

---

## Appendix — one-paragraph summary you can paste to an assistant

> "I'm setting up Slack on my Mac and phone to use a maintenance assistant called
> MIRA. I have (or am waiting on) an invite to my company's Slack workspace. Please
> walk me through installing Slack, joining the workspace, finding MIRA (direct
> message and via a channel with @MIRA), and then running the 12 training tests in
> this guide one at a time — checking my result against the 'You should see' text
> before moving on."

---

*MIRA on Slack — User Guide v1 · 2026-07-19 · Generic edition (works for any MIRA
Slack workspace). Update the workspace name/URL and command list to match yours as
v1.1.*
