# MIRA Demo Pack

Tools for recording a 90-second screen demo of MIRA diagnosing an industrial fault.

## Quick Start

```bash
# 1. Seed demo data (equipment + faults into SQLite)
python demo/seed_demo_data.py

# 2. Dry run — see the message sequence without connecting
python demo/demo_conversation.py --dry-run

# 3. Start your screen recorder, then run live
python demo/demo_conversation.py --delay 10
```

## Files

| File | Purpose |
|------|---------|
| `seed_demo_data.py` | Populate equipment_status + faults tables with realistic demo data |
| `demo_conversation.py` | Automated Telegram conversation driver for screen recording |
| `scenario.md` | Full demo script with timing marks and narration cues |

## Session Setup

`demo_conversation.py` uses Telethon (the same library used by `telegram_test_runner`).
You need a personal Telegram account session — **not** the bot token.

```bash
# One-time setup: create a Telethon session
python mira-bots/telegram_test_runner/session_setup.py

# Set environment variables before running
export TELETHON_API_ID=12345678
export TELETHON_API_HASH=abcdef1234567890abcdef1234567890
export TELETHON_SESSION=/path/to/session_file
```

Get your API credentials at https://my.telegram.org under "API development tools".

## What Gets Seeded

**Equipment (3 records):**
- `CONV-001` — Main Conveyor Line A — **faulted**
- `VFD-GS10-003` — GS10 Variable Frequency Drive — running
- `MTR-STRT-007` — Motor Starter Panel 7 — running

**Active faults (5):**
- CONV-001 / OC1 — Overcurrent (critical)
- CONV-001 / THERM-OL — Thermal overload (warning)
- VFD-GS10-003 / PH-IMB — Phase imbalance (warning)
- MTR-STRT-007 / COMM-LOSS — Modbus timeout (warning)
- CONV-001 / ENC-DFT — Encoder drift (info)

**Historical faults (10):** Spread over past 30 days with resolution notes.

The seed script is idempotent — safe to re-run, deletes and re-inserts demo rows only.

## Demo Conversation Flow

```
/reset
  → (3s pause)
"I'm having trouble with the main conveyor. The motor keeps tripping."
  → MIRA: equipment identified, first diagnostic question
"1"
  → MIRA: second question
"2"
  → MIRA: third question
"1"
  → MIRA: diagnosis with root cause + fix steps
/equipment CONV-001
  → MIRA: live equipment status from MCP
```

## Options

```
--dry-run        Print message sequence, no Telegram connection
--delay N        Seconds to pause after each bot reply (default: 8)
--bot @username  Target bot (default: @FactoryLMDiagnose_bot)
--session PATH   Telethon session file path
```
