"""Evidence-loop driver for the Emre Kalem arm — one joint at a time.

Moves a SINGLE joint through a sequence of angles over the Uno controller's
serial protocol, capturing a still after every settled move and a continuous
video of the whole sweep, and writes an angle<->image correlation log.

Safety rails (do not remove):
  - Command whitelist: only ``status`` and ``set <joint> <angle>`` are ever
    sent. ``home``/``detach``/``demo`` are unreachable from this tool.
  - Host-side clamp mirroring the firmware limits table — belt and braces on
    top of the sketch's own clampInt().
  - Every move is followed by a ``status`` read; if any NON-target joint
    changed, the run aborts immediately (the "locked joints" invariant).
  - The Uno resets on serial open (DTR) and re-attaches all servos at the
    home pose; the boot banner is detected and logged so a reset is never
    silent.

Usage:
  py -3 arm_evidence_loop.py --port COM3 --joint gripper \
      --angles 70,60,50,40,35,45,55,65,75,85,95,105,110,70 \
      --camera 0 --outdir evidence/2026-08-06-gripper
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import serial

# Mirror of the sketch's jointMin/jointMax (emre_kalem_arm_uno_controller.ino).
LIMITS = {
    "base": (10, 170),
    "arm_a": (45, 135),
    "arm_b": (30, 150),
    "wrist_a": (25, 155),
    "wrist_b": (10, 170),
    "gripper": (35, 110),
}
MOVE_DELAY_MS = 20  # sketch default ms/degree for moveJointTo
STATUS_RE = re.compile(r"^\s{2}(\w+) = (\d+)\s+limits (\d+)-(\d+)\s+home (\d+)")


def read_serial(ser: serial.Serial, seconds: float) -> str:
    end = time.time() + seconds
    chunks = []
    while time.time() < end:
        data = ser.read(4096)
        if data:
            chunks.append(data.decode(errors="replace"))
        else:
            time.sleep(0.05)
    return "".join(chunks)


def get_status(ser: serial.Serial) -> dict[str, int]:
    ser.write(b"status\n")
    text = read_serial(ser, 1.5)
    joints = {}
    for line in text.splitlines():
        m = STATUS_RE.match(line)
        if m:
            joints[m.group(1)] = int(m.group(2))
    return joints


def capture_still(cap: cv2.VideoCapture, path: Path) -> bool:
    frame = None
    for _ in range(4):  # drain buffered frames so the still is current
        ok, frame = cap.read()
    if frame is None:
        return False
    cv2.imwrite(str(path), frame)
    return True


def frame_diff_score(a_path: Path, b_path: Path) -> float:
    a = cv2.imread(str(a_path), cv2.IMREAD_GRAYSCALE)
    b = cv2.imread(str(b_path), cv2.IMREAD_GRAYSCALE)
    if a is None or b is None or a.shape != b.shape:
        return -1.0
    return float(cv2.absdiff(a, b).mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM3")
    ap.add_argument("--joint", required=True, choices=sorted(LIMITS))
    ap.add_argument("--angles", required=True, help="comma-separated logical angles")
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--settle-extra", type=float, default=1.2, help="seconds after ramp")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    lo, hi = LIMITS[args.joint]
    angles = []
    for tok in args.angles.split(","):
        a = int(tok)
        clamped = max(lo, min(hi, a))
        if clamped != a:
            print(f"CLAMP: {a} -> {clamped} (limits {lo}-{hi})")
        angles.append(clamped)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        print(f"DRY RUN: would move {args.joint} through {angles} on {args.port}")
        return 0

    cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print(f"FATAL: camera {args.camera} unavailable")
        return 2
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
    video_path = outdir / f"{args.joint}_sweep.avi"
    video = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"MJPG"), 15, (w, h))

    def record_for(seconds: float):
        end = time.time() + seconds
        while time.time() < end:
            ok, frame = cap.read()
            if ok:
                video.write(frame)

    ser = serial.Serial()
    ser.port = args.port
    ser.baudrate = 115200
    ser.timeout = 0.2
    ser.dtr = False  # try to suppress the auto-reset; not guaranteed on CP210x
    ser.rts = False
    ser.open()
    banner = read_serial(ser, 3.0)
    if "Emre Kalem arm" in banner:
        print("NOTE: Uno RESET on connect — servos re-attached at HOME pose.")
    else:
        print("No boot banner — sketch was already running (no reset).")

    joints0 = get_status(ser)
    if not joints0:
        print("FATAL: no parseable status from the controller. Is the sketch uploaded?")
        ser.close()
        return 3
    print(f"Baseline pose: {joints0}")
    locked = {j: v for j, v in joints0.items() if j != args.joint}

    log_path = outdir / "correlation.csv"
    new_log = not log_path.exists()
    log = open(log_path, "a", newline="", encoding="utf-8")
    writer = csv.writer(log)
    if new_log:
        writer.writerow(
            ["utc", "joint", "commanded", "reported", "image", "diff_vs_prev", "locked_ok"]
        )

    baseline_img = outdir / f"{args.joint}_baseline_{joints0[args.joint]}.jpg"
    capture_still(cap, baseline_img)
    prev_img = baseline_img
    print(f"Baseline still: {baseline_img.name}")

    rc = 0
    for target in angles:
        current = get_status(ser).get(args.joint, joints0[args.joint])
        ramp_s = abs(target - current) * MOVE_DELAY_MS / 1000.0
        cmd = f"set {args.joint} {target}\n"
        print(f"-> {cmd.strip()}  (ramp ~{ramp_s:.1f}s)")
        ser.write(cmd.encode())
        record_for(ramp_s + args.settle_extra)  # video rolls through the move

        joints = get_status(ser)
        reported = joints.get(args.joint, -1)
        lock_ok = all(joints.get(j) == v for j, v in locked.items())
        img = outdir / f"{args.joint}_{target:03d}.jpg"
        capture_still(cap, img)
        diff = frame_diff_score(prev_img, img)
        stamp = datetime.now(timezone.utc).isoformat()
        writer.writerow([stamp, args.joint, target, reported, img.name, f"{diff:.2f}", lock_ok])
        log.flush()
        print(f"   reported={reported} locked_ok={lock_ok} diff={diff:.2f} -> {img.name}")
        prev_img = img
        if not lock_ok:
            print("ABORT: a locked joint moved! Stopping immediately.")
            rc = 4
            break

    log.close()
    video.release()
    cap.release()
    ser.close()
    print(f"Video: {video_path}")
    print(f"Log:   {log_path}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
