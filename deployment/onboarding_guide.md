# MIRA — Getting Started Guide

**For maintenance technicians and team leads**

---

## What is MIRA?

MIRA is your maintenance assistant. Text it a question about your equipment, and it helps you figure out what's wrong — step by step. Send it a photo, and it identifies the hardware and walks you through diagnosis.

MIRA doesn't just give you an answer. It asks the right questions so you find the answer yourself. That's how you build real troubleshooting skill.

Everything runs on a computer at your site. Your questions, photos, and equipment data never leave the building.

---

## How to Start Using MIRA

### Step 1: Open Telegram

If you don't have Telegram, download it from the App Store or Google Play. It's free.

### Step 2: Find the MIRA bot

Your site administrator will give you the bot's name or a link. Tap the link or search for the bot name in Telegram.

### Step 3: Send your first message

Type something like:

> My VFD is showing a fault

MIRA will ask you a follow-up question with numbered options. Pick the one that matches your situation by typing the number or tapping it.

### Step 4: Follow the conversation

MIRA will guide you through 3-5 questions. Answer each one honestly — there are no wrong answers. After a few exchanges, you'll arrive at the probable cause together.

---

## What You Can Do

### Ask a text question

Just type your question naturally:

- "Conveyor belt keeps stopping"
- "Motor is running hot"
- "What does fault code F-42 mean?"
- "Pump pressure is dropping"

### Send a photo

Take a photo of the equipment or control panel. MIRA will identify the hardware and start asking questions about what you're seeing.

You can also add a caption to your photo:

> [photo of VFD display] "What does this error mean?"

### Use quick commands

| Command | What it does |
|---------|-------------|
| `/equipment` | Shows all monitored equipment and their current status |
| `/faults` | Lists all active faults right now |
| `/status` | AI summary of overall system health |
| `/reset` | Starts a fresh conversation (clears previous context) |
| `/help` | Shows available commands |

---

## What MIRA Knows

### Right now

MIRA has general knowledge about common industrial equipment: motors, drives, relays, PLCs, conveyors, pumps, compressors. It can help with most standard troubleshooting scenarios.

### After your team adds manuals

When your site administrator uploads your specific equipment manuals (operation guides, wiring diagrams, fault code references), MIRA gets smarter about YOUR equipment. The more manuals you add, the better it gets.

### What it doesn't know (yet)

- Your equipment's full maintenance history (this builds over time as you use it)
- Proprietary software issues
- Problems that require manufacturer-specific diagnostic tools

---

## Tips for Best Results

1. **Be specific.** "Motor is hot" is okay. "Motor on conveyor line 3 is reading 185F" is better.

2. **Answer MIRA's questions directly.** If it asks about LED status, look at the LEDs and tell it exactly what you see.

3. **Send photos when you can.** A photo of a fault display, wiring, or the equipment itself gives MIRA much more to work with.

4. **Use `/reset` between different problems.** MIRA remembers your current conversation. If you switch to a completely different issue, reset first so it doesn't mix up context.

5. **Trust the process.** MIRA asks questions in a specific order to narrow down the cause. Even if you think you already know the answer, the questions help confirm it.

---

## Safety

If MIRA sees something dangerous — exposed wiring, arc flash risk, signs of electrical fire — it will skip the questions and tell you to stop immediately. Follow that instruction. De-energize first, diagnose second.

---

## Privacy

- All your conversations stay on the computer at your site
- No data is sent to the cloud
- Your photos are processed locally and not stored after analysis
- Your site administrator can see usage patterns but not your specific conversations

---

## FAQ

**Q: Can I use MIRA from home?**
A: Only if your site has remote access set up (VPN or Tailscale). Ask your administrator.

**Q: What if MIRA gives wrong advice?**
A: MIRA is an assistant, not a replacement for your judgment. If something doesn't seem right, trust your experience. You can always reset and try a different approach.

**Q: Does MIRA learn from my conversations?**
A: Not automatically. Your administrator may periodically review anonymized conversation patterns to improve MIRA's knowledge base. No personal information is included.

**Q: Can I use MIRA for non-maintenance questions?**
A: MIRA is trained specifically for industrial maintenance. It won't be very helpful for general questions.

**Q: What if MIRA stops responding?**
A: Wait 30 seconds and try again. If it still doesn't respond, tell your administrator — the service may need a restart.

---

*MIRA — Maintenance Intelligence & Remote Assistant*
*Your equipment. Your questions. Your answers.*
