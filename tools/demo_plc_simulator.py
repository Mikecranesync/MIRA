"""Demo PLC simulator — software-only Modbus TCP server for the garage conveyor.

Stands in for the Micro820 PLC when no physical hardware is connected. Pairs
with ``tools/demo_plc_poller.py`` so that the rest of the stack
(mira-relay, NeonDB, dashboards) can be smoke-tested end-to-end without
the actual PLC + Factory IO.

The simulator drives coils 0-6 and holding registers 100-105 to match the
canonical address map (see CLAUDE.md "PLC / Factory IO — Modbus Address
Map"). It owns its own register state and mutates it on a schedule:

- ``sensor_1`` (coil 4) toggles every 5s
- ``conveyor_speed`` (HR104) and ``motor_speed`` (HR100) ramp 0→100→0
- ``motor_current`` (HR101) follows motor_speed * 0.1
- ``temperature`` (HR102) idles at 25.0°C and creeps up under load
- ``fault_alarm`` (coil 2) + ``error_code`` (HR105) trigger every ~60s
  for ~5s, then clear

This is a **simulator**, not a controller. It does not enforce any real
safety logic — never connect it to a real motor or valve. Default port is
5020 to avoid the privileged port 502 (use ``--port 502`` if you have
root/sudo).

CLI
===
    python -m tools.demo_plc_simulator --host 127.0.0.1 --port 5020
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import random
import signal
import sys

try:
    from pymodbus.datastore import (
        ModbusSequentialDataBlock,
        ModbusServerContext,
        ModbusSlaveContext,
    )
    from pymodbus.server import StartAsyncTcpServer
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "pymodbus is required: pip install pymodbus>=3.0"
    ) from exc

logger = logging.getLogger("mira-plc-simulator")


# Coils and registers we expose (must match poller's ADDRESS_MAP).
COIL_COUNT = 16
HR_BASE = 100
HR_COUNT = 16


# Coil indices
C_MOTOR_RUNNING = 0
C_MOTOR_STOPPED = 1
C_FAULT_ALARM = 2
C_CONVEYOR_RUNNING = 3
C_SENSOR_1 = 4
C_SENSOR_2 = 5
C_E_STOP = 6

# Holding register indices (absolute Modbus addresses)
HR_MOTOR_SPEED = 100
HR_MOTOR_CURRENT = 101  # scale ÷10
HR_TEMPERATURE = 102    # scale ÷10
HR_PRESSURE = 103
HR_CONVEYOR_SPEED = 104
HR_ERROR_CODE = 105

# pymodbus 3.x: slave id (unit) the server responds on
SLAVE_ID = 1


# ---------------------------------------------------------------------------
# Simulator state machine
# ---------------------------------------------------------------------------


class ConveyorSim:
    """Drives the Modbus context to simulate plausible conveyor behaviour."""

    def __init__(self, slave: ModbusSlaveContext) -> None:
        self.slave = slave
        self._tick = 0
        self._speed_target = 0   # 0-100
        self._speed_actual = 0   # ramps toward target
        self._direction = 1
        self._temperature_x10 = 250  # 25.0°C
        self._fault_ticks_left = 0
        self._stop = asyncio.Event()
        self._rng = random.Random(42)

    def request_stop(self) -> None:
        self._stop.set()

    async def run(self, tick_hz: float = 2.0) -> None:
        """Tick the simulation at ``tick_hz`` Hz."""
        period = 1.0 / tick_hz
        # Prime initial state
        self._write_coil(C_MOTOR_RUNNING, True)
        self._write_coil(C_MOTOR_STOPPED, False)
        self._write_coil(C_CONVEYOR_RUNNING, True)
        self._write_coil(C_E_STOP, False)
        self._write_hr(HR_PRESSURE, 80)

        while not self._stop.is_set():
            self._tick += 1
            self._step()
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=period)
            except asyncio.TimeoutError:
                pass

    def _step(self) -> None:
        # sensor_1 toggles every 5s (10 ticks at 2Hz)
        if self._tick % 10 == 0:
            cur = self._read_coil(C_SENSOR_1)
            self._write_coil(C_SENSOR_1, not cur)

        # sensor_2 toggles every 7s offset
        if self._tick % 14 == 7:
            cur = self._read_coil(C_SENSOR_2)
            self._write_coil(C_SENSOR_2, not cur)

        # Ramp motor_speed 0→100→0
        if self._tick % 6 == 0:
            self._speed_target += self._direction * 10
            if self._speed_target >= 100:
                self._speed_target = 100
                self._direction = -1
            elif self._speed_target <= 0:
                self._speed_target = 0
                self._direction = 1

        # Smooth actual speed toward target (1 unit / tick)
        if self._speed_actual < self._speed_target:
            self._speed_actual += 1
        elif self._speed_actual > self._speed_target:
            self._speed_actual -= 1

        self._write_hr(HR_MOTOR_SPEED, self._speed_actual)
        self._write_hr(HR_CONVEYOR_SPEED, self._speed_actual)
        # motor_current ~= speed * 0.1A, stored ÷10 (raw = speed)
        self._write_hr(HR_MOTOR_CURRENT, self._speed_actual)

        # Temperature creeps with load, decays without
        if self._speed_actual > 60:
            self._temperature_x10 = min(self._temperature_x10 + 2, 850)
        else:
            self._temperature_x10 = max(self._temperature_x10 - 1, 250)
        self._write_hr(HR_TEMPERATURE, self._temperature_x10)

        # Occasional fault: ~every 60s of sim time (120 ticks), lasts ~5s
        if self._fault_ticks_left > 0:
            self._fault_ticks_left -= 1
            if self._fault_ticks_left == 0:
                self._clear_fault()
        else:
            if self._tick > 0 and self._tick % 120 == 0:
                # 50% chance to actually fire
                if self._rng.random() < 0.5:
                    self._raise_fault()

    def _raise_fault(self) -> None:
        # error_code map: 1=overload 2=sensor 3=comms 4=overheat 5=low_press 6=jam 7=estop
        code = self._rng.choice([1, 2, 4, 6])
        self._write_coil(C_FAULT_ALARM, True)
        self._write_hr(HR_ERROR_CODE, code)
        self._fault_ticks_left = 10  # ~5s at 2Hz
        logger.info("Simulator raised fault code=%d", code)

    def _clear_fault(self) -> None:
        self._write_coil(C_FAULT_ALARM, False)
        self._write_hr(HR_ERROR_CODE, 0)
        logger.info("Simulator cleared fault")

    # -- low-level helpers --------------------------------------------------
    # pymodbus function codes (per the Modbus protocol):
    #   1 = read coils, 3 = read holding registers,
    #   5 = write single coil, 6 = write single holding register
    # The setValues/getValues calls below mutate the simulator's OWN state.
    # The poller never invokes these — it is a separate process and only
    # issues read calls.

    def _write_coil(self, address: int, value: bool) -> None:
        self.slave.setValues(1, address, [bool(value)])

    def _read_coil(self, address: int) -> bool:
        return bool(self.slave.getValues(1, address, 1)[0])

    def _write_hr(self, address: int, value: int) -> None:
        self.slave.setValues(3, address, [int(value) & 0xFFFF])


# ---------------------------------------------------------------------------
# Server bootstrap
# ---------------------------------------------------------------------------


def _build_context() -> tuple[ModbusServerContext, ModbusSlaveContext]:
    # Allocate enough room for the addresses we use.
    # Block 1 (coils): 0..15
    # Block 3 (holding): 0..115 (covers HR 100-105 with headroom)
    co_block = ModbusSequentialDataBlock(0, [False] * COIL_COUNT)
    hr_block = ModbusSequentialDataBlock(0, [0] * (HR_BASE + HR_COUNT))
    slave = ModbusSlaveContext(
        co=co_block,  # discrete outputs / coils
        hr=hr_block,  # holding registers
    )
    server_ctx = ModbusServerContext(slaves={SLAVE_ID: slave}, single=False)
    return server_ctx, slave


async def _amain(args: argparse.Namespace) -> int:
    context, slave = _build_context()
    sim = ConveyorSim(slave)

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _on_signal() -> None:
        logger.info("Shutdown signal received")
        sim.request_stop()
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_signal)
        except NotImplementedError:
            pass

    server_task = asyncio.create_task(
        StartAsyncTcpServer(
            context=context,
            address=(args.host, args.port),
        ),
        name="modbus-server",
    )
    sim_task = asyncio.create_task(sim.run(args.tick_hz), name="sim-loop")
    logger.info(
        "Demo PLC simulator listening on %s:%d (slave id=%d, tick=%.1f Hz)",
        args.host, args.port, SLAVE_ID, args.tick_hz,
    )

    await stop_event.wait()

    sim_task.cancel()
    server_task.cancel()
    for t in (sim_task, server_task):
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass
    logger.info("Simulator stopped")
    return 0


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Software simulator for the demo conveyor PLC.",
    )
    p.add_argument("--host", default=os.getenv("DEMO_SIM_HOST", "127.0.0.1"))
    p.add_argument(
        "--port", type=int,
        default=int(os.getenv("DEMO_SIM_PORT", "5020")),
        help="Modbus TCP port (default 5020; use 502 with sudo for production parity)",
    )
    p.add_argument("--tick-hz", type=float, default=2.0)
    p.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "INFO"))
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    try:
        return asyncio.run(_amain(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
