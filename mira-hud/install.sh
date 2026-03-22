#!/bin/bash
# ============================================================
# Charlie HUD — One-Time Install Script
# Run once after cloning or moving the project
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="CharlieHUD.app"
APP_SRC="$SCRIPT_DIR/$APP_NAME"
NODE_BIN="/opt/homebrew/bin/node"

# ── Colors ──────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║        CHARLIE HUD — INSTALLER           ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── Step 1: Verify Node.js ───────────────────────────────────
echo -e "${CYAN}[1/5]${RESET} Checking Node.js at $NODE_BIN..."
if [ ! -f "$NODE_BIN" ]; then
    echo -e "${RED}ERROR: Node.js not found at $NODE_BIN${RESET}"
    echo ""
    echo "Fix: Install Node.js via Homebrew:"
    echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    echo "  brew install node"
    exit 1
fi
NODE_VER=$("$NODE_BIN" --version)
echo -e "  ${GREEN}✓ Node.js $NODE_VER found${RESET}"

# ── Step 2: chmod the launcher ───────────────────────────────
echo -e "${CYAN}[2/5]${RESET} Setting launcher permissions..."
chmod +x "$APP_SRC/Contents/MacOS/CharlieHUD"
echo -e "  ${GREEN}✓ CharlieHUD launcher is executable${RESET}"

# ── Step 3: npm install if node_modules missing ──────────────
echo -e "${CYAN}[3/5]${RESET} Checking npm dependencies..."
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "  node_modules not found — running npm install..."
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
    cd "$SCRIPT_DIR" && npm install
    echo -e "  ${GREEN}✓ Dependencies installed${RESET}"
else
    echo -e "  ${GREEN}✓ node_modules already present${RESET}"
fi

# ── Step 4: Copy to Desktop ──────────────────────────────────
echo -e "${CYAN}[4/5]${RESET} Copying $APP_NAME to Desktop..."
DESKTOP_APP="$HOME/Desktop/$APP_NAME"
rm -rf "$DESKTOP_APP"
cp -r "$APP_SRC" "$DESKTOP_APP"
chmod +x "$DESKTOP_APP/Contents/MacOS/CharlieHUD"
echo -e "  ${GREEN}✓ CharlieHUD.app placed on Desktop${RESET}"

# ── Step 5: Offer to copy to /Applications ───────────────────
echo -e "${CYAN}[5/5]${RESET} Optional: Install to /Applications..."
INSTALL_APPS=$(osascript -e 'button returned of (display dialog "Also install Charlie HUD to /Applications?\n(Optional — Desktop icon is enough to launch)" buttons {"Skip", "Install to /Applications"} default button "Skip" with title "Charlie HUD Installer"' 2>/dev/null || echo "Skip")

if [ "$INSTALL_APPS" = "Install to /Applications" ]; then
    rm -rf "/Applications/$APP_NAME"
    cp -r "$APP_SRC" "/Applications/$APP_NAME"
    chmod +x "/Applications/$APP_NAME/Contents/MacOS/CharlieHUD"
    echo -e "  ${GREEN}✓ Installed to /Applications${RESET}"
else
    echo -e "  ${YELLOW}Skipped /Applications install${RESET}"
fi

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}║          INSTALL COMPLETE ✓              ║${RESET}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${CYAN}What's next:${RESET}"
echo "  1. Look for CharlieHUD on your Desktop"
echo "  2. Double-click CharlieHUD to launch"
echo "  3. Your browser will open to http://localhost:3000"
echo "  4. For help, open USER_GUIDE.html in your browser"
echo ""
echo -e "${YELLOW}Note:${RESET} If macOS says 'developer cannot be verified', go to:"
echo "  System Settings → Privacy & Security → Open Anyway"
echo ""

# ── Offer to launch now ──────────────────────────────────────
LAUNCH_NOW=$(osascript -e 'button returned of (display dialog "Install complete!\n\nLaunch Charlie HUD now?" buttons {"Not Now", "Launch Now"} default button "Launch Now" with title "Charlie HUD Installer")' 2>/dev/null || echo "Not Now")

if [ "$LAUNCH_NOW" = "Launch Now" ]; then
    echo "Launching Charlie HUD..."
    open "$DESKTOP_APP"
fi
