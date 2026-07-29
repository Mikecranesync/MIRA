#!/usr/bin/env python3
"""EXPERIMENTAL CCW automation for Conv_Simple_1.9 — drives the last two steps
(Build, then optionally Download) so they aren't manual clicks.

READ THIS FIRST
---------------
* Build and Download are the PLC's physical compile + transmit. They cannot be
  *eliminated* — this script only *performs* them for you via CCW's GUI.
* This is UNTESTED GUI automation (pywinauto/UIA against CCW's window tree, which
  varies by CCW version). It is best-effort and DEGRADES GRACEFULLY: if it can't
  positively identify a control, it does NOT blind-click — it leaves CCW open and
  tells you to finish by hand. It never guesses at the controller.
* It is SAFE BY DEFAULT: it will NOT download to the live PLC unless you pass
  --download-to-live-plc AND answer the confirmation. Default = open + (optionally)
  Build only.
* The reliable path remains: open Conv_Simple_1.9 and click Build -> Download
  yourself (see _V1.9_APPLY/INSTALL_ConvSimple_v1.9.md). Use this only if you want
  to try shaving those clicks and you're watching it run.

Usage (PLC laptop):
    python plc/ccw_autoflash_1_9.py                       # open CCW with the project, report only
    python plc/ccw_autoflash_1_9.py --build               # also attempt Build
    python plc/ccw_autoflash_1_9.py --build --download-to-live-plc   # attempt Build then Download (asks first)
"""
from __future__ import annotations
import argparse, sys, time
from pathlib import Path

SLN = Path(r"C:/Users/hharp/Documents/CCW/MIRA_PLC/Conv_Simple_1.9/Conv_Simple_1.9.ccwsln")
CCW = Path(r"C:/Program Files (x86)/Rockwell Automation/CCW/CCW.Shell.exe")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true", help="attempt the Build command")
    ap.add_argument("--download-to-live-plc", action="store_true",
                    help="attempt Download to the controller (asks for confirmation)")
    ap.add_argument("--timeout", type=int, default=120, help="seconds to wait for CCW window")
    args = ap.parse_args()

    if not SLN.is_file(): sys.exit(f"ERROR: {SLN} not found — run BUILD_CONV_SIMPLE_1.9.cmd first.")
    if not CCW.is_file(): sys.exit(f"ERROR: CCW not found at {CCW}")
    try:
        from pywinauto.application import Application
        from pywinauto import timings
    except Exception:
        sys.exit("ERROR: pywinauto required (pip install pywinauto). The manual path needs no install.")

    print("Launching CCW with Conv_Simple_1.9 …")
    print("  (watch it — this is experimental; if anything looks off, take over in CCW.)")
    app = Application(backend="uia").start(f'"{CCW}" "{SLN}"', wait_for_idle=False)

    # wait for the main CCW window
    main_win = None
    deadline = time.time() + args.timeout
    while time.time() < deadline:
        try:
            for w in app.windows():
                t = w.window_text() or ""
                if "Connected Components Workbench" in t or "Conv_Simple_1.9" in t:
                    main_win = w; break
        except Exception:
            pass
        if main_win: break
        time.sleep(2)
    if not main_win:
        print("Could not confirm the CCW window opened. It may still be loading — "
              "finish in CCW by hand (Build, then Download).")
        return
    print("CCW window detected. Project should be open.")

    def find_menu_item(*names):
        """Locate a top-level menu item by visible name; return the control or None.
        Never clicks anything it can't positively identify."""
        try:
            mb = main_win.descendants(control_type="MenuBar")
            for bar in mb:
                for it in bar.descendants(control_type="MenuItem"):
                    label = (it.window_text() or "").strip().lower().replace("&", "")
                    if any(label == n or label.startswith(n) for n in names):
                        return it
        except Exception:
            pass
        return None

    if args.build:
        print("Attempting Build …")
        item = find_menu_item("build", "device")  # CCW build lives under a top menu
        if not item:
            print("  Could not positively find the Build menu — NOT guessing. "
                  "Click Build in CCW manually, then Download.")
        else:
            try:
                item.click_input()
                time.sleep(1)
                # look for a Build sub-item
                sub = None
                for it in main_win.descendants(control_type="MenuItem"):
                    lbl = (it.window_text() or "").strip().lower().replace("&", "")
                    if lbl.startswith("build"):
                        sub = it; break
                if sub: sub.click_input(); print("  Build invoked. Watch the CCW output for errors.")
                else:   print("  Opened the menu but couldn't find a Build item — finish by hand.")
            except Exception as e:
                print(f"  Build automation failed ({e}); finish by hand in CCW.")

    if args.download_to_live_plc:
        ans = input("\n*** Download to the LIVE Micro820 now? This writes to the controller. [type YES] ")
        if ans.strip() != "YES":
            print("  Skipped download. Do it in CCW when ready.")
        else:
            print("  Attempting Download — keep your hand near the e-stop.")
            item = find_menu_item("device", "download")
            if not item:
                print("  Could not positively find the Download command — NOT guessing. "
                      "Use Device -> Download in CCW manually.")
            else:
                try:
                    item.click_input(); time.sleep(1)
                    sub = None
                    for it in main_win.descendants(control_type="MenuItem"):
                        lbl = (it.window_text() or "").strip().lower().replace("&", "")
                        if lbl.startswith("download"):
                            sub = it; break
                    if sub: sub.click_input(); print("  Download invoked — follow CCW's prompts (connection path, mode).")
                    else:   print("  Couldn't find a Download item — finish by hand.")
                except Exception as e:
                    print(f"  Download automation failed ({e}); finish by hand in CCW.")

    print("\nDone driving CCW. Verify the result in CCW; the manual steps in the "
          "INSTALL card are always the reliable fallback.")

if __name__ == "__main__":
    main()
