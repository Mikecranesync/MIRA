from simlab.discharge_acceptance import (
    BenchInputs,
    DischargeAcceptanceController,
    live_request_writes,
)


def test_request_enters_pending_without_starting_motor() -> None:
    controller = DischargeAcceptanceController()

    state = controller.step(BenchInputs(simlab_discharge_request=True), dt_s=0.25)

    assert state.discharge_pending_acceptance is True
    assert state.discharge_accepted is False
    assert state.discharge_running is False
    assert state.motor_run_command is False
    assert state.amber_led_flash is True
    assert "pending local human acceptance" in state.evidence_message


def test_green_start_rising_edge_accepts_and_runs_only_with_permissives() -> None:
    controller = DischargeAcceptanceController()
    controller.step(BenchInputs(simlab_discharge_request=True), dt_s=0.25)
    held_low = controller.step(
        BenchInputs(simlab_discharge_request=True, green_start_pb=False),
        dt_s=0.25,
    )

    accepted = controller.step(
        BenchInputs(simlab_discharge_request=True, green_start_pb=True),
        dt_s=0.25,
    )

    assert held_low.discharge_running is False
    assert accepted.discharge_pending_acceptance is False
    assert accepted.discharge_accepted is True
    assert accepted.discharge_running is True
    assert accepted.motor_run_command is True
    assert accepted.bench_permissive_ok is True
    assert "accepted by green/start push button" in accepted.evidence_message


def test_acceptance_does_not_run_when_photoeye_is_already_blocked() -> None:
    controller = DischargeAcceptanceController()
    controller.step(
        BenchInputs(simlab_discharge_request=True, photoeye_blocked=True),
        dt_s=0.25,
    )

    state = controller.step(
        BenchInputs(
            simlab_discharge_request=True,
            green_start_pb=True,
            photoeye_blocked=True,
        ),
        dt_s=0.25,
    )

    assert state.discharge_pending_acceptance is True
    assert state.discharge_running is False
    assert state.motor_run_command is False
    assert state.bench_permissive_ok is False


def test_running_discharge_stops_and_completes_when_photoeye_blocks() -> None:
    controller = DischargeAcceptanceController()
    controller.step(BenchInputs(simlab_discharge_request=True), dt_s=0.25)
    controller.step(
        BenchInputs(simlab_discharge_request=True, green_start_pb=True),
        dt_s=0.25,
    )

    state = controller.step(
        BenchInputs(simlab_discharge_request=True, green_start_pb=False, photoeye_blocked=True),
        dt_s=0.25,
    )

    assert state.discharge_running is False
    assert state.motor_run_command is False
    assert state.discharge_complete is True
    assert state.photoeye_blocked is True
    assert "photo eye blocked" in state.evidence_message


def test_acceptance_timeout_clears_pending_and_never_runs_motor() -> None:
    controller = DischargeAcceptanceController(accept_timeout_s=1.0)
    controller.step(BenchInputs(simlab_discharge_request=True), dt_s=0.5)

    state = controller.step(BenchInputs(simlab_discharge_request=True), dt_s=0.6)

    assert state.discharge_pending_acceptance is False
    assert state.discharge_accept_timeout is True
    assert state.discharge_rejected_or_faulted is True
    assert state.discharge_running is False
    assert state.motor_run_command is False


def test_request_must_drop_before_retry_after_timeout() -> None:
    controller = DischargeAcceptanceController(accept_timeout_s=1.0)
    controller.step(BenchInputs(simlab_discharge_request=True), dt_s=1.1)

    still_high = controller.step(BenchInputs(simlab_discharge_request=True), dt_s=0.1)
    dropped = controller.step(BenchInputs(simlab_discharge_request=False), dt_s=0.1)
    fresh = controller.step(BenchInputs(simlab_discharge_request=True), dt_s=0.1)

    assert still_high.discharge_pending_acceptance is False
    assert still_high.discharge_accept_timeout is True
    assert dropped.discharge_accept_timeout is False
    assert fresh.discharge_pending_acceptance is True


def test_lost_request_or_shutdown_drops_running_state() -> None:
    controller = DischargeAcceptanceController()
    controller.step(BenchInputs(simlab_discharge_request=True), dt_s=0.25)
    controller.step(
        BenchInputs(simlab_discharge_request=True, green_start_pb=True),
        dt_s=0.25,
    )

    state = controller.step(BenchInputs(simlab_discharge_request=False), dt_s=0.25)

    assert state.discharge_running is False
    assert state.motor_run_command is False
    assert state.discharge_rejected_or_faulted is True
    assert "lost request" in state.evidence_message


def test_live_request_writes_are_disabled_by_default() -> None:
    assert live_request_writes(requested=True) == {}
    assert live_request_writes(requested=True, live_write_enabled=False) == {}
    assert live_request_writes(requested=True, live_write_enabled=True) == {
        "simlab_discharge_request": True
    }
