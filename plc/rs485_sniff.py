#!/usr/bin/env python3
"""
rs485_sniff.py -- Passive RS-485 bus sniffer for Modbus RTU diagnostics.

Tap a USB-to-RS485 adapter onto the same bus (SG+/SG-/SGND) as the PLC and the
GS10 VFD, then run this. It prints every byte received for `--seconds` seconds,
grouped by inter-frame gap, so you can see whether:

  - The PLC is transmitting at all  (any bytes printed = yes)
  - The VFD is replying              (alternating master/slave frames = yes)
  - Frame structure looks sensible   (FC03/FC06 starts with `01 03` / `01 06`)
  - Exception replies                (slave frames starting with `01 83` / `01 86`)

A good FC03 read query from master=PLC, slave=1, addr=0x2103, qty=4 looks like:
    01 03 21 03 00 04 4E F6
A good FC03 reply from slave=1, byte-count=8, then 8 data bytes + CRC looks like:
    01 03 08 .. .. .. .. .. .. .. .. CC CC
An exception reply (e.g. illegal address) from slave=1:
    01 83 02 C0 F1     (02 = exception code, here Illegal Data Address)

Usage:
    python plc/rs485_sniff.py /dev/tty.usbserial-XXXX
    python plc/rs485_sniff.py /dev/tty.usbserial-XXXX --seconds 30 --baud 9600 --stopbits 2

Dependencies: pyserial  (pip install pyserial)
"""

from __future__ import annotations

import argparse
import sys
import time

try:
    import serial
except ImportError:
    sys.exit("pyserial not installed -- run: pip install pyserial")


def main() -> int:
    parser = argparse.ArgumentParser(description="Passive RS-485 Modbus RTU sniffer")
    parser.add_argument("port", help="Serial device, e.g. /dev/tty.usbserial-XXXX or COM5")
    parser.add_argument("--baud", type=int, default=9600, help="Baud rate (default 9600)")
    parser.add_argument("--stopbits", type=int, default=2, choices=[1, 2], help="Stop bits (default 2 for GS10)")
    parser.add_argument(
        "--parity",
        default="N",
        choices=["N", "E", "O"],
        help="Parity (default N for GS10 P09.04=13)",
    )
    parser.add_argument("--seconds", type=float, default=10.0, help="Capture window (default 10 s)")
    parser.add_argument(
        "--gap-ms",
        type=float,
        default=4.0,
        help="Inter-frame gap in ms to treat as a frame boundary (default 4 ms = ~3.5 chars @ 9600)",
    )
    args = parser.parse_args()

    stopbits_map = {1: serial.STOPBITS_ONE, 2: serial.STOPBITS_TWO}
    parity_map = {"N": serial.PARITY_NONE, "E": serial.PARITY_EVEN, "O": serial.PARITY_ODD}

    print(
        f"Sniffing {args.port} @ {args.baud} 8{args.parity}{args.stopbits} for {args.seconds:.0f}s ..."
    )
    print("(no bytes printed = bus is silent; Ctrl-C to stop early)\n")

    s = serial.Serial(
        port=args.port,
        baudrate=args.baud,
        bytesize=serial.EIGHTBITS,
        parity=parity_map[args.parity],
        stopbits=stopbits_map[args.stopbits],
        timeout=args.gap_ms / 1000.0,
    )

    end = time.time() + args.seconds
    frames = 0
    bytes_total = 0
    try:
        while time.time() < end:
            chunk = s.read(256)
            if not chunk:
                continue
            frames += 1
            bytes_total += len(chunk)
            hex_str = " ".join(f"{b:02X}" for b in chunk)
            ts = time.strftime("%H:%M:%S")
            tag = classify_frame(chunk)
            print(f"  [{ts}] {tag:14s}  {hex_str}")
    except KeyboardInterrupt:
        print("\nInterrupted.")
    finally:
        s.close()

    print(f"\nDone. {frames} frame(s), {bytes_total} byte(s) total.")
    if frames == 0:
        print("** Bus was silent. **")
        print("   - PLC may not be transmitting (Channel mismatch, serial port driver not loaded)")
        print("   - Or you have the wrong serial device path -- try `ls /dev/tty.*` first")
    return 0


def classify_frame(chunk: bytes) -> str:
    """Best-effort tag for a captured chunk. Cosmetic only."""
    if len(chunk) < 2:
        return "fragment"
    slave, fc = chunk[0], chunk[1]
    if fc & 0x80:
        return f"slv{slave}EXC"
    if fc in (1, 2, 3, 4):
        # Could be master query (8 bytes typical) or slave reply
        if len(chunk) == 8:
            return f"mst->{slave} FC{fc}"
        return f"slv{slave} FC{fc}"
    if fc in (5, 6, 15, 16):
        return f"->{slave} FC{fc}"
    return f"slv{slave}?FC{fc:02X}"


if __name__ == "__main__":
    sys.exit(main())
