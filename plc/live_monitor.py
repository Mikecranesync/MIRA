#!/usr/bin/env python3
r"""
live_monitor.py -- MIRA PLC Live Dashboard
Real-time Modbus TCP monitor for Micro820 + GS10 VFD conveyor system.

Usage:
    python plc/live_monitor.py                    # default PLC at 169.254.32.93
    python plc/live_monitor.py --host 192.168.1.100
    python plc/live_monitor.py --host 192.168.1.100 --poll 1.0

Keyboard:
    Q = Quit
    F = FWD run (write cmd=18, GS10 FWD+RUN)
    R = REV run (write cmd=20, GS10 REV+RUN)
    S = STOP (write cmd=1, GS10 STOP)
    X = Fault reset (write cmd=7)
    + = Speed up (+200)
    - = Speed down (-200)
    0 = Zero speed
"""

import argparse
import sys
import time
import threading

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    from pymodbus.client.sync import ModbusTcpClient

from rich.console import Console
from rich.live import Live
from rich.table import Table
from rich.panel import Panel
from rich.layout import Layout
from rich.text import Text
from rich import box

# -- Modbus addresses (zero-indexed) -----------------------------------------
# Coils: C1-C22 → address 0-21
COIL_BASE = 0
COIL_COUNT = 22

# Holding registers: HR400101-HR400117 → address 100-116
HR_BASE = 100
HR_COUNT = 17

# VFD command write target: conveyor_speed_cmd is at HR400113 → address 112
HR_SPEED_CMD = 112

# VFD cmd_word is at HR400115 → address 114
HR_VFD_CMD = 114

# -- Coil index map (offset from COIL_BASE) ----------------------------------
C_MOTOR_RUNNING = 0
C_CONVEYOR_RUNNING = 1
C_FAULT_ALARM = 2
C_VFD_COMM_OK = 3
C_SYSTEM_READY = 4
C_ESTOP_ACTIVE = 5
C_DIR_FWD = 6
C_DIR_REV = 7
C_HEARTBEAT = 8
C_ESTOP_WIRING = 9
C_DIR_FAULT = 10
C_DI_00 = 11   # SelectorFWD
C_DI_01 = 12   # SelectorREV
C_DI_02 = 13   # EStopNC
C_DI_03 = 14   # EStopNO
C_DI_04 = 15   # PBRun
C_DO_00 = 16   # LightGreen
C_DO_01 = 17   # LightRed
C_DO_02 = 18   # ContactorQ1
C_DO_03 = 19   # PBRunLED
C_VFD_POLL_ACTIVE = 20
C_VFD_FAULT_RESET = 21

# -- HR index map (offset from HR_BASE) --------------------------------------
HR_MOTOR_SPEED = 0      # 100
HR_MOTOR_CURRENT = 1    # 101
HR_TEMPERATURE = 2      # 102
HR_PRESSURE = 3         # 103
HR_CONVEYOR_SPEED = 4   # 104
HR_ERROR_CODE = 5       # 105
HR_VFD_FREQ = 6         # 106
HR_VFD_CURRENT = 7      # 107
HR_VFD_VOLTAGE = 8      # 108
HR_VFD_DC_BUS = 9       # 109
HR_ITEM_COUNT = 10      # 110
HR_UPTIME = 11          # 111
HR_SPEED_CMD_IDX = 12   # 112
HR_CONV_STATE = 13      # 113
HR_VFD_CMD_WORD = 14    # 114
HR_VFD_FREQ_SP = 15     # 115
HR_VFD_POLL_STEP = 16   # 116

# -- Lookup tables ------------------------------------------------------------
STATE_NAMES = {0: "IDLE", 1: "STARTING", 2: "RUNNING", 3: "STOPPING", 4: "FAULT"}
STATE_COLORS = {0: "white", 1: "yellow", 2: "green", 3: "yellow", 4: "red bold"}
ERROR_NAMES = {0: "none", 6: "E-STOP", 7: "WIRING", 8: "DIR FAULT", 9: "VFD COMM"}
CMD_NAMES = {1: "STOP", 18: "FWD+RUN", 20: "REV+RUN", 7: "RESET"}


def bool_dot(val, true_color="green", false_color="dim"):
    if val:
        return Text("*", style=true_color)
    return Text(".", style=false_color)


def bool_text(val, true_color="green", false_color="dim"):
    if val:
        return Text("TRUE ", style=true_color)
    return Text("FALSE", style=false_color)


def alarm_text(val, label=""):
    if val:
        return Text(f"TRUE  {label}", style="red bold")
    return Text(f"FALSE", style="green")


class PLCMonitor:
    def __init__(self, host, port, poll_interval):
        self.host = host
        self.port = port
        self.poll_interval = poll_interval
        self.client = None
        self.connected = False
        self.coils = [False] * COIL_COUNT
        self.regs = [0] * HR_COUNT
        self.poll_count = 0
        self.errors = 0
        self.last_error = ""
        self.last_heartbeat = False
        self.heartbeat_ok = False
        self.speed_setpoint = 0
        self.running = True
        self.last_command = ""

    def connect(self):
        try:
            self.client = ModbusTcpClient(self.host, port=self.port, timeout=2)
            self.connected = self.client.connect()
            if self.connected:
                self.last_error = ""
            else:
                self.last_error = "Connection refused"
        except Exception as e:
            self.connected = False
            self.last_error = str(e)[:60]

    def poll(self):
        if not self.connected:
            self.connect()
            if not self.connected:
                return

        try:
            # Read coils
            result = self.client.read_coils(address=COIL_BASE, count=COIL_COUNT)
            if not result.isError():
                self.coils = list(result.bits[:COIL_COUNT])
                # Check heartbeat toggle
                hb = self.coils[C_HEARTBEAT]
                self.heartbeat_ok = (hb != self.last_heartbeat)
                self.last_heartbeat = hb
            else:
                self.errors += 1
                self.last_error = f"Coil read error: {result}"

            # Read holding registers
            result = self.client.read_holding_registers(address=HR_BASE, count=HR_COUNT)
            if not result.isError():
                self.regs = list(result.registers[:HR_COUNT])
            else:
                self.errors += 1
                self.last_error = f"HR read error: {result}"

            self.poll_count += 1

        except Exception as e:
            self.errors += 1
            self.last_error = str(e)[:60]
            self.connected = False

    def write_vfd_cmd(self, cmd):
        if not self.connected:
            self.last_command = "Not connected"
            return
        try:
            self.client.write_register(address=HR_VFD_CMD, value=cmd)
            name = CMD_NAMES.get(cmd, str(cmd))
            self.last_command = f"Sent VFD cmd={cmd} ({name})"
        except Exception as e:
            self.last_command = f"Write error: {e}"

    def write_speed(self, speed):
        speed = max(0, min(4095, speed))
        self.speed_setpoint = speed
        if not self.connected:
            self.last_command = "Not connected"
            return
        try:
            self.client.write_register(address=HR_SPEED_CMD, value=speed)
            self.last_command = f"Set speed={speed}"
        except Exception as e:
            self.last_command = f"Write error: {e}"

    def build_display(self):
        c = self.coils
        r = self.regs

        conv_state = r[HR_CONV_STATE]
        state_name = STATE_NAMES.get(conv_state, f"?{conv_state}")
        state_color = STATE_COLORS.get(conv_state, "white")
        error_code = r[HR_ERROR_CODE]
        error_name = ERROR_NAMES.get(error_code, f"?{error_code}")
        vfd_cmd = r[HR_VFD_CMD_WORD]
        cmd_name = CMD_NAMES.get(vfd_cmd, f"?{vfd_cmd}")
        uptime = r[HR_UPTIME]
        uptime_str = f"{uptime // 3600}h {(uptime % 3600) // 60}m {uptime % 60}s"

        # -- Header -----------------------------------------------------------
        hb_char = Text("*", style="green bold") if self.heartbeat_ok else Text(".", style="red")
        conn_str = Text("ONLINE ", style="green bold") if self.connected else Text("OFFLINE", style="red bold")

        header = Text()
        header.append("  MIRA PLC  ")
        header.append(conn_str)
        header.append(f"  Uptime: {uptime_str}  HB: ")
        header.append(hb_char)
        header.append(f"  Polls: {self.poll_count}  Errs: {self.errors}")
        if self.last_command:
            header.append(f"\n  Last cmd: {self.last_command}")
        if self.last_error and not self.connected:
            header.append(f"\n  ")
            header.append(Text(self.last_error, style="red"))

        # -- State Machine table ----------------------------------------------
        t_state = Table(title="STATE MACHINE", box=box.SIMPLE, show_header=False,
                        title_style="bold cyan", padding=(0, 1), expand=True)
        t_state.add_column("Tag", style="white", width=18)
        t_state.add_column("Value", width=22)

        state_text = Text(f"{conv_state} ({state_name})", style=state_color)
        t_state.add_row("conv_state", state_text)

        err_style = "red bold" if error_code > 0 else "green"
        t_state.add_row("error_code", Text(f"{error_code} ({error_name})", style=err_style))

        t_state.add_row("motor_running", bool_text(c[C_MOTOR_RUNNING], "green bold"))
        t_state.add_row("conveyor_running", bool_text(c[C_CONVEYOR_RUNNING], "green bold"))
        t_state.add_row("system_ready", bool_text(c[C_SYSTEM_READY], "green bold"))
        t_state.add_row("vfd_cmd_word", Text(f"{vfd_cmd} ({cmd_name})", style="cyan"))
        t_state.add_row("motor_speed", Text(str(r[HR_MOTOR_SPEED]), style="cyan"))
        t_state.add_row("item_count", Text(str(r[HR_ITEM_COUNT]), style="cyan"))

        # -- VFD Drive table --------------------------------------------------
        t_vfd = Table(title="VFD DRIVE (GS10)", box=box.SIMPLE, show_header=False,
                      title_style="bold cyan", padding=(0, 1), expand=True)
        t_vfd.add_column("Tag", style="white", width=14)
        t_vfd.add_column("Value", width=18)

        freq = r[HR_VFD_FREQ] / 10.0
        amps = r[HR_VFD_CURRENT] / 10.0
        volts = r[HR_VFD_VOLTAGE] / 10.0
        dcbus = r[HR_VFD_DC_BUS] / 10.0
        freq_sp = r[HR_VFD_FREQ_SP] / 10.0

        freq_style = "green bold" if freq > 0 else "dim"
        t_vfd.add_row("Frequency", Text(f"{freq:.1f} Hz", style=freq_style))
        t_vfd.add_row("Current", Text(f"{amps:.1f} A", style="yellow" if amps > 0 else "dim"))
        t_vfd.add_row("Voltage", Text(f"{volts:.1f} V", style="cyan"))
        t_vfd.add_row("DC Bus", Text(f"{dcbus:.1f} V", style="cyan"))
        t_vfd.add_row("Freq Setpoint", Text(f"{freq_sp:.1f} Hz", style="cyan"))
        t_vfd.add_row("vfd_comm_ok", bool_text(c[C_VFD_COMM_OK], "green bold", "red bold"))
        t_vfd.add_row("poll_active", bool_text(c[C_VFD_POLL_ACTIVE], "green bold", "red bold"))
        t_vfd.add_row("poll_step", Text(f"{r[HR_VFD_POLL_STEP]} (1-4 cycle)", style="cyan"))
        t_vfd.add_row("fault_reset", bool_text(c[C_VFD_FAULT_RESET], "yellow", "dim"))
        t_vfd.add_row("Speed Cmd", Text(f"{r[HR_SPEED_CMD_IDX]} / 4095", style="cyan"))

        # -- Safety table -----------------------------------------------------
        t_safety = Table(title="SAFETY", box=box.SIMPLE, show_header=False,
                         title_style="bold red", padding=(0, 1), expand=True)
        t_safety.add_column("Tag", style="white", width=18)
        t_safety.add_column("Value", width=22)

        t_safety.add_row("e_stop_active", alarm_text(c[C_ESTOP_ACTIVE], "!! PRESSED"))
        t_safety.add_row("estop_wiring", alarm_text(c[C_ESTOP_WIRING], "!! XOR FAIL"))
        t_safety.add_row("fault_alarm", alarm_text(c[C_FAULT_ALARM], "!! LATCHED"))
        t_safety.add_row("dir_fault", alarm_text(c[C_DIR_FAULT], "!! BOTH CLOSED"))
        # Contactor: TRUE = good (energized)
        q1 = c[C_DO_02]
        t_safety.add_row("ContactorQ1", bool_text(q1, "green bold", "red bold"))

        # -- Operator table ---------------------------------------------------
        t_oper = Table(title="OPERATOR", box=box.SIMPLE, show_header=False,
                       title_style="bold yellow", padding=(0, 1), expand=True)
        t_oper.add_column("Tag", style="white", width=14)
        t_oper.add_column("Value", width=18)

        t_oper.add_row("dir_fwd", bool_text(c[C_DIR_FWD]))
        t_oper.add_row("dir_rev", bool_text(c[C_DIR_REV]))
        t_oper.add_row("dir_off",
                        bool_text(not c[C_DIR_FWD] and not c[C_DIR_REV] and not c[C_DIR_FAULT]))
        t_oper.add_row("conveyor_speed", Text(str(r[HR_CONVEYOR_SPEED]), style="cyan"))

        # -- Raw I/O ----------------------------------------------------------
        di_labels = ["FWD", "REV", "NC ", "NO ", "RUN", "S1 ", "S2 "]
        do_labels = ["GRN", "RED", "Q1 ", "PBL"]

        io_text = Text("  DI: ")
        for i, lbl in enumerate(di_labels):
            idx = C_DI_00 + i
            val = c[idx] if idx < len(c) else False
            io_text.append(f"{lbl}=")
            io_text.append("1" if val else "0", style="green bold" if val else "dim")
            io_text.append(" ")

        io_text.append("\n  DO: ")
        for i, lbl in enumerate(do_labels):
            idx = C_DO_00 + i
            val = c[idx] if idx < len(c) else False
            io_text.append(f"{lbl}=")
            io_text.append("1" if val else "0", style="green bold" if val else "dim")
            io_text.append(" ")

        # -- Compose layout ---------------------------------------------------
        layout = Layout()
        layout.split_column(
            Layout(Panel(header, title="MIRA PLC LIVE MONITOR", border_style="blue bold",
                         subtitle=f"{self.host}:{self.port}"), name="header", size=5 if self.last_command or self.last_error else 4),
            Layout(name="top", size=12),
            Layout(name="mid", size=9),
            Layout(Panel(io_text, title="RAW I/O", border_style="dim"), name="io", size=5),
            Layout(Panel(
                Text("  [Q]uit  [F]wd Run  [R]ev Run  [S]top  [X] Reset  [+/-] Speed  [0] Zero",
                     style="bold"),
                border_style="blue"), name="footer", size=3),
        )
        layout["top"].split_row(
            Layout(Panel(t_state, border_style="cyan")),
            Layout(Panel(t_vfd, border_style="cyan")),
        )
        layout["mid"].split_row(
            Layout(Panel(t_safety, border_style="red")),
            Layout(Panel(t_oper, border_style="yellow")),
        )
        return layout


def key_listener(monitor):
    """Non-blocking keyboard listener (Windows msvcrt)."""
    import msvcrt
    while monitor.running:
        if msvcrt.kbhit():
            ch = msvcrt.getch()
            try:
                key = ch.decode("utf-8", errors="ignore").lower()
            except Exception:
                key = ""
            if key == "q":
                monitor.running = False
            elif key == "f":
                monitor.write_vfd_cmd(18)  # GS10 FWD+RUN
            elif key == "r":
                monitor.write_vfd_cmd(20)  # GS10 REV+RUN
            elif key == "s":
                monitor.write_vfd_cmd(1)   # GS10 STOP
            elif key == "x":
                monitor.write_vfd_cmd(7)   # Fault reset
            elif key == "+":
                monitor.write_speed(monitor.speed_setpoint + 200)
            elif key == "-":
                monitor.write_speed(monitor.speed_setpoint - 200)
            elif key == "0":
                monitor.write_speed(0)
        time.sleep(0.05)


def main():
    parser = argparse.ArgumentParser(description="MIRA PLC Live Monitor")
    parser.add_argument("--host", default="169.254.32.93", help="PLC IP address")
    parser.add_argument("--port", type=int, default=502, help="Modbus TCP port")
    parser.add_argument("--poll", type=float, default=0.5, help="Poll interval (seconds)")
    args = parser.parse_args()

    console = Console()
    monitor = PLCMonitor(args.host, args.port, args.poll)

    console.print(f"[bold blue]MIRA PLC Monitor[/] connecting to {args.host}:{args.port}...")
    monitor.connect()

    # Start keyboard listener thread
    key_thread = threading.Thread(target=key_listener, args=(monitor,), daemon=True)
    key_thread.start()

    try:
        with Live(monitor.build_display(), console=console, refresh_per_second=4,
                  screen=True) as live:
            while monitor.running:
                monitor.poll()
                live.update(monitor.build_display())
                time.sleep(monitor.poll_interval)
    except KeyboardInterrupt:
        pass
    finally:
        monitor.running = False
        if monitor.client:
            monitor.client.close()
        console.print("[bold]Monitor stopped.[/]")


if __name__ == "__main__":
    main()
