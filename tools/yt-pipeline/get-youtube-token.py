"""One-time helper: get a fresh YouTube OAuth refresh_token.

Reads the YouTube OAuth client_id and client_secret from Doppler
(`factorylm/prd`), starts a local HTTP server, opens the user's default
browser to the Google consent screen, and prints the resulting
refresh_token to stdout.

Usage (on Bravo, signed into the macOS user whose default browser is
already logged into the YouTube channel you want to publish to):

    doppler run --project factorylm --config prd -- \\
        python3.12 tools/yt-pipeline/get-youtube-token.py

After it prints `REFRESH_TOKEN=…`, paste that into:

    doppler secrets set YOUTUBE_REFRESH_TOKEN_ISH="<the token>" \\
        --project factorylm --config prd --no-interactive

Or hand it to your assistant and have them set it.

Requires google-auth-oauthlib (already present in this environment).
"""

from __future__ import annotations

import os
import sys

from google_auth_oauthlib.flow import InstalledAppFlow

# Scope to request — only the YouTube upload permission, nothing else.
# This is the same scope tools/yt-pipeline/uploader.py needs.
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def main() -> int:
    client_id = os.environ.get("YOUTUBE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()

    if not client_id or not client_secret:
        print(
            "ERROR: YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not set.\n"
            "Run this script via `doppler run --project factorylm --config prd -- ...`.",
            file=sys.stderr,
        )
        return 2

    # InstalledAppFlow handles the entire OAuth dance: it spins up a tiny
    # local HTTP server on a random port, builds the Google consent URL with
    # access_type=offline + prompt=consent (so we ALWAYS get a refresh_token,
    # even on re-auth), opens it in your default browser, captures the redirect
    # back, and exchanges the code for tokens.
    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)

    print("Opening browser for Google consent...", file=sys.stderr)
    print("Sign in as the YouTube account that should host the uploaded videos.", file=sys.stderr)
    print("", file=sys.stderr)

    creds = flow.run_local_server(
        port=0,
        prompt="consent",
        access_type="offline",
        open_browser=True,
        authorization_prompt_message=(
            "If the browser did not open, copy this URL:\n  {url}"
        ),
        success_message=(
            "Authorization complete. You can close this tab and return to the terminal."
        ),
    )

    if not creds.refresh_token:
        print(
            "ERROR: no refresh_token returned. This usually means Google reused\n"
            "an existing grant. Revoke the app at\n"
            "  https://myaccount.google.com/permissions\n"
            "(look for the OAuth client that matches your YOUTUBE_CLIENT_ID),\n"
            "then re-run this script.",
            file=sys.stderr,
        )
        return 3

    # Print ONE line to stdout that's easy to grep / pipe.
    print(f"REFRESH_TOKEN={creds.refresh_token}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
