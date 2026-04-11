# Reddit → Telegram Troubleshooting Pipeline

Scrapes high-upvote troubleshooting questions from Reddit via **Apify**,
filters them by keyword and upvote threshold, then forwards them to a
Telegram channel or chat via **Telethon**.

---

## File layout

```
tools/reddit_tg_pipeline/
├── main.py                  ← CLI orchestrator
├── apify_reddit_scraper.py  ← Apify actor runner + CSV export
├── telethon_forwarder.py    ← Telethon message sender
├── run_charlie.sh           ← Shell wrapper for Charlie node (Doppler + uv)
└── README.md
```

---

## Setup

### 1. Install dependencies

```bash
cd /path/to/mira
uv sync
# or: uv pip install -r tools/requirements.txt
```

### 2. Get credentials

| Secret | Where |
|--------|-------|
| `APIFY_API_KEY` | [Apify Console → Integrations](https://console.apify.com/account/integrations) |
| `TELEGRAM_API_ID` | [my.telegram.org/apps](https://my.telegram.org/apps) |
| `TELEGRAM_API_HASH` | same as above |
| `TELEGRAM_TARGET` | `@channelname`, numeric chat ID, or phone number |

### 3. Store in Doppler

```bash
doppler secrets set APIFY_API_KEY apify_api_xxx
doppler secrets set TELEGRAM_API_ID 12345678
doppler secrets set TELEGRAM_API_HASH abcdef123...
doppler secrets set TELEGRAM_TARGET @mira_questions
doppler secrets set MIN_UPVOTES 10
doppler secrets set MAX_ITEMS_PER_SUB 100
```

### 4. First run (Telethon auth)

The first run will prompt you to authenticate with your Telegram account
(enter phone number + OTP code). After that, a `.session` file is saved
locally and future runs are non-interactive.

```bash
./run_charlie.sh --dry-run   # verify everything works first
```

---

## Usage

```bash
# Normal run: scrape + forward to Telegram
./run_charlie.sh

# Dry run — prints messages, nothing sent
./run_charlie.sh --dry-run

# Scrape only, save CSV, skip Telegram
./run_charlie.sh --scrape-only

# Forward from an existing CSV (skip scraping)
cd tools/reddit_tg_pipeline
python main.py --from-csv reddit_questions_20260405_120000.csv

# Top 20 posts only
./run_charlie.sh --limit 20

# Override upvote threshold for this run
cd tools/reddit_tg_pipeline
python main.py --min-upvotes 50
```

---

## Subreddits scraped

Defined in `apify_reddit_scraper.py → SUBREDDITS` list. Current defaults:

- r/techsupport
- r/fixit
- r/AskElectricians
- r/DIY
- r/HomeImprovement
- r/MechanicAdvice
- r/electricians
- r/PLC
- r/HVAC
- r/plumbing

Edit the list freely to target any public subreddit.

---

## Filter logic

A post passes if **both** conditions are true:

1. `upvotes >= MIN_UPVOTES` (default 10)
2. Title or body matches at least one of the [troubleshooting keyword regex patterns](apify_reddit_scraper.py)

---

## CSV output

Each run writes a timestamped CSV with these columns:

| Column | Description |
|--------|-------------|
| `subreddit` | r/name |
| `post_id` | Reddit post ID |
| `title` | Post title |
| `body` | First 500 chars of self-text |
| `upvotes` | Score at scrape time |
| `upvote_ratio` | e.g. 0.95 |
| `num_comments` | Comment count |
| `author` | u/username |
| `url` | Full Reddit URL |
| `created_at` | Post creation timestamp |
| `scraped_at` | UTC ISO timestamp of scrape |

---

## Telegram message format

```
🔧 r/techsupport · 3/47

**Why does my PC keep restarting randomly?**

It happens every few hours with no warning. No BSOD, just an instant reboot.

👍 142 upvotes  |  💬 38 comments  |  👤 u/some_user
🔗 View on Reddit
```

---

## Scheduling on Charlie (cron)

```cron
# Every day at 8am Eastern (UTC-4 in summer)
0 12 * * * /path/to/mira/tools/reddit_tg_pipeline/run_charlie.sh >> /var/log/reddit_tg.log 2>&1
```

---

## Apify Actor used

**`silentflow/reddit-scraper`** — no Reddit API key required, supports
hot/new/top sort, NSFW filtering, full metadata including upvotes and comment counts.
