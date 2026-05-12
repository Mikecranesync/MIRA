# Installing MIRA Scan

## Three steps to scan your first nameplate

1. **Install from the marketplace.** Open monday.com, go to **Apps → Marketplace**, search "MIRA Scan," click **Install**, approve the requested scopes (`me:read`, `boards:read`, `boards:write`).
2. **Add the panel to a board.** Open any board with assets, click the item, click the **+** in the panel pane, choose **MIRA Scan**.
3. **Map your columns (optional).** If your board uses different column names than `make`/`model`/`serial`/`voltage`/`hp`/`rpm`/`hz`/`frame`, ask your monday admin to set the per-board mapping (see `admin-guide.md`).

## What you should see after install

A new **Scan plate** button on the item view, plus a **MIRA Scan** panel showing:
- The scan camera
- An asset card (populated after a scan)
- A chat box (active when MIRA recognizes the equipment)

## Phone camera tip

For best vision-extract accuracy: hold the phone parallel to the nameplate, fill the frame, avoid glare from overhead lights. Clean a finger over the plate first if it's greasy — the vision model handles dirty plates fine but very oily ones with reflections lower confidence.

## What to do if it doesn't work

- **No panel appears after install** → refresh the board page. Monday caches embed config aggressively.
- **"Authentication failed" or "reinstall_required"** → uninstall and reinstall the app. Your access token may have been revoked.
- **Scans return empty fields** → check phone camera permission in your browser. Some Android browsers (especially Samsung Internet) block camera access in iframes by default.
- **Anything else** → email support@factorylm.com with your monday account name and a screenshot. We respond within 24 hours business days.
