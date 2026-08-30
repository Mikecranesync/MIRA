"""Bench discharge conveyor human-acceptance contract.

This module is deliberately headless and dry-run friendly. It models the PLC
state contract SimLab expects, but it does not write to a Micro820, GS10, VFD,
or any real output by default. The real bench PLC remains the motion and safety
authority.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BenchInputs:
    """Signals the bench PLC/adapter exposes to the discharge request contract."""

    simlab_discharge_request: bool = False
    simlab_discharge_heartbeat: bool = True
    green_start_pb: bool = False
    e_stop_ok: bool = True
    local_stop_active: bool = False
    vfd_comm_ok: bool = True
    drive_ready: bool = True
    active_fault: bool = False
    photoeye_blocked: bool = False
    photoeye_clear_30s: bool = True
    adapter_shutdown: bool = False


@dataclass(frozen=True)
class DischargeAcceptanceState:
    """Observable discharge conveyor request state for evidence/telemetry."""

    simlab_discharge_request: bool
    simlab_discharge_heartbeat: bool
    discharge_pending_acceptance: bool
    discharge_accepted: bool
    discharge_running: bool
    discharge_complete: bool
    discharge_rejected_or_faulted: bool
    discharge_accept_timeout: bool
    amber_led_flash: bool
    green_start_pb: bool
    photoeye_blocked: bool
    photoeye_clear_30s: bool
    bench_permissive_ok: bool
    motor_run_command: bool
    evidence_message: str


class DischargeAcceptanceController:
    """Small deterministic model of the required PLC acceptance state machine."""

    _IDLE = "idle"
    _PENDING = "pending"
    _RUNNING = "running"
    _COMPLETE = "complete"
    _FAULTED = "faulted"
    _TIMEOUT = "timeout"

    def __init__(self, accept_timeout_s: float = 30.0) -> None:
        self.accept_timeout_s = accept_timeout_s
        self._mode = self._IDLE
        self._pending_elapsed_s = 0.0
        self._blink_elapsed_s = 0.0
        self._prev_green_start_pb = False
        self._last_message = "Discharge conveyor idle."

    def step(self, inputs: BenchInputs, dt_s: float = 1.0) -> DischargeAcceptanceState:
        """Advance the dry-run acceptance model by ``dt_s`` seconds."""

        dt_s = max(0.0, dt_s)
        green_start_rising = inputs.green_start_pb and not self._prev_green_start_pb
        permissive_ok = self._bench_permissive_ok(inputs)

        if self._mode in {self._COMPLETE, self._FAULTED, self._TIMEOUT}:
            if not inputs.simlab_discharge_request:
                self._reset()
            return self._state(inputs, permissive_ok)

        if self._mode == self._IDLE:
            if inputs.simlab_discharge_request and not inputs.adapter_shutdown:
                self._mode = self._PENDING
                self._pending_elapsed_s = dt_s
                self._blink_elapsed_s = dt_s
                self._last_message = (
                    "Discharge conveyor request is pending local human acceptance. "
                    "Amber panel LED should be flashing. Press the green/start push "
                    "button to authorize the bench conveyor run."
                )
                if self._pending_elapsed_s >= self.accept_timeout_s:
                    self._mode = self._TIMEOUT
                    self._last_message = (
                        "Discharge conveyor acceptance timeout: request cleared, "
                        "motor stayed off, fresh request required."
                    )
            self._prev_green_start_pb = inputs.green_start_pb
            return self._state(inputs, permissive_ok)

        if self._mode == self._PENDING:
            if inputs.adapter_shutdown or not inputs.simlab_discharge_heartbeat:
                self._mode = self._FAULTED
                self._last_message = "Discharge conveyor request rejected: adapter shutdown or heartbeat lost."
            elif not inputs.simlab_discharge_request:
                self._mode = self._FAULTED
                self._last_message = "Discharge conveyor request rejected: request canceled before acceptance."
            else:
                self._pending_elapsed_s += dt_s
                self._blink_elapsed_s += dt_s
                if self._pending_elapsed_s >= self.accept_timeout_s:
                    self._mode = self._TIMEOUT
                    self._last_message = (
                        "Discharge conveyor acceptance timeout: request cleared, "
                        "motor stayed off, fresh request required."
                    )
                elif green_start_rising and permissive_ok:
                    self._mode = self._RUNNING
                    self._last_message = (
                        "Discharge conveyor accepted by green/start push button; "
                        "bench permissives are true and conveyor is running."
                    )
                elif green_start_rising:
                    self._last_message = (
                        "Green/start push button was pressed, but discharge conveyor "
                        "permissives are not true; waiting for safe acceptance."
                    )

            self._prev_green_start_pb = inputs.green_start_pb
            return self._state(inputs, permissive_ok)

        if self._mode == self._RUNNING:
            if inputs.photoeye_blocked:
                self._mode = self._COMPLETE
                self._last_message = (
                    "Discharge conveyor complete: conveyor stopped because the "
                    "photo eye blocked."
                )
            elif inputs.adapter_shutdown or not inputs.simlab_discharge_heartbeat:
                self._mode = self._FAULTED
                self._last_message = "Discharge conveyor stopped: adapter shutdown or heartbeat lost."
            elif not inputs.simlab_discharge_request:
                self._mode = self._FAULTED
                self._last_message = "Discharge conveyor stopped: lost request during accepted run."
            elif not permissive_ok:
                self._mode = self._FAULTED
                self._last_message = "Discharge conveyor stopped: bench permissive dropped."

            self._prev_green_start_pb = inputs.green_start_pb
            return self._state(inputs, permissive_ok)

        self._reset()
        self._prev_green_start_pb = inputs.green_start_pb
        return self._state(inputs, permissive_ok)

    @staticmethod
    def _bench_permissive_ok(inputs: BenchInputs) -> bool:
        return (
            inputs.e_stop_ok
            and not inputs.local_stop_active
            and inputs.vfd_comm_ok
            and inputs.drive_ready
            and not inputs.active_fault
            and not inputs.photoeye_blocked
            and inputs.photoeye_clear_30s
            and inputs.simlab_discharge_heartbeat
            and not inputs.adapter_shutdown
        )

    def _state(
        self,
        inputs: BenchInputs,
        permissive_ok: bool,
    ) -> DischargeAcceptanceState:
        pending = self._mode == self._PENDING
        running = self._mode == self._RUNNING
        return DischargeAcceptanceState(
            simlab_discharge_request=inputs.simlab_discharge_request,
            simlab_discharge_heartbeat=inputs.simlab_discharge_heartbeat,
            discharge_pending_acceptance=pending,
            discharge_accepted=running,
            discharge_running=running,
            discharge_complete=self._mode == self._COMPLETE,
            discharge_rejected_or_faulted=self._mode in {self._FAULTED, self._TIMEOUT},
            discharge_accept_timeout=self._mode == self._TIMEOUT,
            amber_led_flash=pending and self._amber_blink_on(),
            green_start_pb=inputs.green_start_pb,
            photoeye_blocked=inputs.photoeye_blocked,
            photoeye_clear_30s=inputs.photoeye_clear_30s,
            bench_permissive_ok=permissive_ok,
            motor_run_command=running,
            evidence_message=self._last_message,
        )

    def _amber_blink_on(self) -> bool:
        return int(self._blink_elapsed_s / 0.5) % 2 == 0

    def _reset(self) -> None:
        self._mode = self._IDLE
        self._pending_elapsed_s = 0.0
        self._blink_elapsed_s = 0.0
        self._last_message = "Discharge conveyor idle."


def live_request_writes(
    *,
    requested: bool,
    live_write_enabled: bool = False,
) -> dict[str, bool]:
    """Return optional live PLC writes for the high-level request bit only."""

    if not live_write_enabled:
        return {}
    return {"simlab_discharge_request": requested}
