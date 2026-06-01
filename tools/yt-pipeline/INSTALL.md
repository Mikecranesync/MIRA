# YouTube Content Pipeline — Installation

Install the autonomous YouTube content pipeline as a daily launchd job on the Bravo node.

## Prerequisites

Before running the installer, ensure:

1. **Doppler CLI** installed: `brew install doppler`
2. **python3.12** available: `brew install python@3.12` (ensure `/opt/homebrew/bin` is in `PATH`)
3. **ffmpeg** installed: `brew install ffmpeg`
4. **Repo path** matches the plist: `/Users/bravonode/Mira` (adjust the plist if you've moved the repo)
5. **Doppler logged in**: `doppler login`

## Secret Setup

The pipeline requires four secrets in the `factorylm/prd` Doppler config:
- `GROQ_API_KEY` — already present
- `YOUTUBE_CLIENT_ID` — already present
- `YOUTUBE_CLIENT_SECRET` — already present
- `YOUTUBE_REFRESH_TOKEN_ISH` — **currently only in `factorylm/dev`, must be promoted**

### Promote the YouTube refresh token to production

```bash
doppler secrets get YOUTUBE_REFRESH_TOKEN_ISH --project factorylm --config dev --plain | \
  doppler secrets set YOUTUBE_REFRESH_TOKEN_ISH --project factorylm --config prd
```

The installer will check for all four secrets and fail clearly if any are missing.

## Installation

From the repo root:

```bash
./tools/yt-pipeline/install.sh
```

The script will:
1. Check all prerequisites
2. Copy the plist to `~/Library/LaunchAgents/`
3. Load the job with `-w` (persist across reboots)
4. Verify the job is running
5. Print the next scheduled run time and log paths

## Uninstallation

```bash
./tools/yt-pipeline/install.sh uninstall
```

Unloads the job and removes the plist.

## Testing Before Installation

To test the pipeline before scheduling it:

```bash
cd tools/yt-pipeline && doppler run --project factorylm --config prd -- \
  python3.12 -m tools.yt_pipeline.main --dry-run
```

The dry-run uses only `GROQ_API_KEY` (no B-roll, no upload) and outputs the planned content to stdout.

## Logs

After installation, the pipeline runs daily at **2:00 AM**.

View logs:
```bash
tail -f /tmp/yt-pipeline-stdout.log    # Standard output
tail -f /tmp/yt-pipeline-stderr.log    # Errors and run details
```

Check the job status:
```bash
launchctl list | grep yt-pipeline
```

## Pause and Resume

The pipeline respects a pause sentinel at `/tmp/yt-pipeline/PAUSED`.

Pause the next run:
```bash
touch /tmp/yt-pipeline/PAUSED
```

Resume:
```bash
rm /tmp/yt-pipeline/PAUSED
```

(The installer creates the `/tmp/yt-pipeline/` directory on first run if it doesn't exist.)

## Troubleshooting

If the installer fails:
1. Check all preflight items: `doppler`, `python3.12`, `ffmpeg` installed?
2. Is Doppler logged in? `doppler me`
3. Are the secrets present? Check with `doppler secrets get <NAME> --project factorylm --config prd`
4. Is the repo at `/Users/bravonode/Mira`? If not, edit the plist's `WorkingDirectory` key.

If the scheduled job doesn't run:
1. Check status: `launchctl list com.factorylm.yt-pipeline`
2. Tail the logs: `tail -f /tmp/yt-pipeline-stderr.log`
3. Check for the pause sentinel: `ls /tmp/yt-pipeline/PAUSED`
4. Reload manually: `launchctl unload -w ~/Library/LaunchAgents/com.factorylm.yt-pipeline.plist && launchctl load -w ~/Library/LaunchAgents/com.factorylm.yt-pipeline.plist`
