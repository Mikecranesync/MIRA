"""Florida Natural Demo — Juice Bottling Line (Line 01).

Canonical UNS path: ``enterprise.florida_natural_demo.plant1.juice_bottling.line01``
Display path:       ``FactoryLM/FloridaNaturalDemo/Plant1/JuiceBottling/Line01``

Process flow (left to right, accumulation/backup propagates upstream):
    Depalletizer01 → ConveyorZone01 → ConveyorZone02 → Rinser01 → Filler01
        → Capper01 → Labeler01 → CasePacker01 → Palletizer01

Utilities: AirSystem01, CIPSkid01.
"""

from __future__ import annotations

from simlab.baselines import (
    air_system_tags,
    bottle_filler_tags,
    capper_tags,
    case_packer_tags,
    cip_skid_tags,
    controller_clock_tags,
    conveyor_zone_tags,
    labeler_tags,
    palletizer_tags,
    pick_place_depalletizer_tags,
    rinser_tags,
)
from simlab.models import (
    AlarmDef,
    AssetModel,
    FactoryModel,
    FaultCode,
    LineModel,
    PlantModel,
    Severity,
)
from simlab.packml import PackMLState

LINE_ID = "line01"


# ---------------------------------------------------------------------------
# Depalletizer01
# ---------------------------------------------------------------------------

def _depalletizer01() -> AssetModel:
    return AssetModel(
        asset_id="depalletizer01",
        asset_type="pick_place_depalletizer",
        display_name="Depalletizer 01",
        baseline="pick_place_depalletizer",
        tags=pick_place_depalletizer_tags(),
        fault_codes=[
            FaultCode(
                code="D001",
                label="Vacuum Loss",
                description="Vacuum head pressure below minimum during pick cycle.",
                severity=Severity.FAULT,
                likely_cause="Worn suction cups, air leak in vacuum hose, or low plant air.",
                recommended_action="Inspect suction cups; check vacuum generator and plant-air supply.",
            ),
            FaultCode(
                code="D002",
                label="Pallet Not Present",
                description="No pallet detected at infeed station when cycle commanded.",
                severity=Severity.WARN,
                likely_cause="Fork truck did not stage a pallet, or pallet sensor misaligned.",
                recommended_action="Stage pallet; verify photoeye alignment.",
            ),
            FaultCode(
                code="D003",
                label="Outfeed Jam",
                description="Bottle jam on outfeed conveyor; depalletizer stopped.",
                severity=Severity.FAULT,
                likely_cause="Downstream conveyor blocked or slow.",
                recommended_action="Clear jam downstream; verify conveyor speed.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="D-LOW-VAC",
                severity=Severity.WARN,
                message="Depalletizer01: vacuum pressure low — check plant air.",
                source_tag="vacuum_pressure",
                predicate=lambda v: v < 18.0,
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# ConveyorZone01
# ---------------------------------------------------------------------------

def _conveyor_zone01() -> AssetModel:
    return AssetModel(
        asset_id="conveyorzone01",
        asset_type="belt_conveyor",
        display_name="Conveyor Zone 01",
        baseline="belt_conveyor",
        tags=conveyor_zone_tags(),
        fault_codes=[
            FaultCode(
                code="C001",
                label="Motor Overload",
                description="Conveyor drive motor thermal overload tripped.",
                severity=Severity.FAULT,
                likely_cause="Jam, excessive belt tension, or motor winding fault.",
                recommended_action="Clear jam; check belt tension; reset OL relay; verify motor.",
            ),
            FaultCode(
                code="C002",
                label="Belt Blocked",
                description="Zone blocked condition — upstream product accumulating.",
                severity=Severity.WARN,
                likely_cause="Downstream machine is stopped or slow.",
                recommended_action="Check downstream machine status.",
            ),
            FaultCode(
                code="C003",
                label="Photoeye Dirty",
                description="Zone photoeye emitter/receiver contaminated.",
                severity=Severity.WARN,
                likely_cause="Spray, condensation, or product splash on lens.",
                recommended_action="Clean photoeye lens; verify alignment.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="C1-BLOCKED",
                severity=Severity.WARN,
                message="ConveyorZone01: zone blocked — downstream backup.",
                source_tag="blocked",
                predicate=lambda v: v is True,
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# ConveyorZone02
# ---------------------------------------------------------------------------

def _conveyor_zone02() -> AssetModel:
    return AssetModel(
        asset_id="conveyorzone02",
        asset_type="belt_conveyor",
        display_name="Conveyor Zone 02",
        baseline="belt_conveyor",
        tags=conveyor_zone_tags(),
        fault_codes=[
            FaultCode(
                code="C001",
                label="Motor Overload",
                description="Conveyor drive motor thermal overload tripped.",
                severity=Severity.FAULT,
                likely_cause="Jam, excessive belt tension, or motor winding fault.",
                recommended_action="Clear jam; check belt tension; reset OL relay; verify motor.",
            ),
            FaultCode(
                code="C002",
                label="Belt Blocked",
                description="Zone blocked condition — upstream product accumulating.",
                severity=Severity.WARN,
                likely_cause="Downstream machine is stopped or slow.",
                recommended_action="Check downstream machine status.",
            ),
            FaultCode(
                code="C003",
                label="Photoeye Dirty",
                description="Zone photoeye emitter/receiver contaminated.",
                severity=Severity.WARN,
                likely_cause="Spray, condensation, or product splash on lens.",
                recommended_action="Clean photoeye lens; verify alignment.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="C2-BLOCKED",
                severity=Severity.WARN,
                message="ConveyorZone02: zone blocked — downstream backup.",
                source_tag="blocked",
                predicate=lambda v: v is True,
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# Rinser01
# ---------------------------------------------------------------------------

def _rinser01() -> AssetModel:
    return AssetModel(
        asset_id="rinser01",
        asset_type="bottle_rinser",
        display_name="Rinser 01",
        baseline="bottle_rinser",
        tags=rinser_tags(),
        fault_codes=[
            FaultCode(
                code="R001",
                label="Low Water Pressure",
                description="Rinse water supply pressure below minimum setpoint.",
                severity=Severity.FAULT,
                likely_cause="PRV setting drift, partial valve closure, or plant water low.",
                recommended_action="Check plant water supply; inspect PRV; open isolation valve.",
            ),
            FaultCode(
                code="R002",
                label="Rinse Valve Fault",
                description="Rinse water valve did not reach commanded position.",
                severity=Severity.FAULT,
                likely_cause="Solenoid failure, mechanical obstruction, or loss of air.",
                recommended_action="Check valve actuator; verify air supply to solenoid.",
            ),
            FaultCode(
                code="R003",
                label="Inverter Overload",
                description="Bottle inverter chain motor overload.",
                severity=Severity.FAULT,
                likely_cause="Jam in inverter section.",
                recommended_action="Clear jam; reset overload.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="R-LOW-PRESS",
                severity=Severity.WARN,
                message="Rinser01: rinse water pressure low.",
                source_tag="water_pressure",
                predicate=lambda v: v < 35.0,
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# Filler01
# ---------------------------------------------------------------------------

def _filler01() -> AssetModel:
    return AssetModel(
        asset_id="filler01",
        asset_type="rotary_filler",
        display_name="Filler 01",
        baseline="bottle_filler",
        # Flagship asset carries a controller clock (REALTIME) so the relay can
        # timestamp events from the PLC clock rather than server-receive time.
        tags={**bottle_filler_tags(), **controller_clock_tags()},
        fault_codes=[
            FaultCode(
                code="F010",
                label="Low Bowl Pressure",
                description="Filler bowl air pressure below minimum required for consistent fill.",
                severity=Severity.FAULT,
                likely_cause=(
                    "Air regulator set too low, air supply blocked, regulator diaphragm worn, "
                    "or plant compressed-air supply problem."
                ),
                recommended_action=(
                    "Check compressed-air header pressure at AirSystem01. "
                    "Inspect and adjust filler bowl pressure regulator. "
                    "Verify fill-valve air supply manifold. "
                    "Inspect nozzle for clogging."
                ),
            ),
            FaultCode(
                code="F011",
                label="Nozzle No-Flow",
                description="One or more fill nozzles failed to open during fill cycle.",
                severity=Severity.FAULT,
                likely_cause="Clogged nozzle, actuator solenoid failed, or blocked air supply.",
                recommended_action="Identify faulted nozzle; flush or replace; check solenoid.",
            ),
            FaultCode(
                code="F012",
                label="Overfill Out-of-Range",
                description="Mean fill level exceeds target by more than the dead-band.",
                severity=Severity.WARN,
                likely_cause="Bowl pressure too high or fill-valve timing drift.",
                recommended_action="Reduce bowl pressure; re-calibrate fill-valve timing.",
            ),
            FaultCode(
                code="F013",
                label="VFD Fault",
                description="Filler carousel VFD fault — machine stopped.",
                severity=Severity.FAULT,
                likely_cause="Overcurrent, overvoltage, or thermal overload on VFD.",
                recommended_action="Read VFD fault code; check motor leads and cooling.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="F-UNDERFILL",
                severity=Severity.FAULT,
                message="Filler01: underfill rejects elevated — check bowl pressure and nozzles.",
                source_tag="underfill_reject_count",
                predicate=lambda v: v > 5,
                fault_code="F010",
            ),
            AlarmDef(
                code="F-LOW-BOWL",
                severity=Severity.WARN,
                message="Filler01: filler bowl pressure below normal range.",
                source_tag="filler_bowl_pressure",
                predicate=lambda v: v < 8.0,
                fault_code="F010",
            ),
            AlarmDef(
                code="F-LOW-TANK",
                severity=Severity.WARN,
                message="Filler01: product tank level low.",
                source_tag="tank_level_percent",
                predicate=lambda v: v < 20.0,
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# Capper01
# ---------------------------------------------------------------------------

def _capper01() -> AssetModel:
    return AssetModel(
        asset_id="capper01",
        asset_type="capper",
        display_name="Capper 01",
        baseline="capper",
        tags=capper_tags(),
        fault_codes=[
            FaultCode(
                code="CA001",
                label="Torque Out of Range",
                description="Applied cap torque outside acceptable band.",
                severity=Severity.FAULT,
                likely_cause="Chuck wear, torque-clutch slippage, or lubrication issue.",
                recommended_action="Inspect capping chuck; check and adjust clutch torque setting.",
            ),
            FaultCode(
                code="CA002",
                label="Cap Chute Empty",
                description="Cap chute feed sensor indicates no caps remaining.",
                severity=Severity.FAULT,
                likely_cause="Cap supply not loaded or cap chute jammed.",
                recommended_action="Reload cap supply; clear any jam in chute.",
            ),
            FaultCode(
                code="CA003",
                label="Infeed Jam",
                description="Cap or bottle jam detected at capper infeed.",
                severity=Severity.FAULT,
                likely_cause="Misoriented bottle, foreign object, or upstream surge.",
                recommended_action="Clear jam; inspect infeed starwheel.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="CA-JAM",
                severity=Severity.FAULT,
                message="Capper01: jam detected — clear infeed.",
                source_tag="jam_detected",
                predicate=lambda v: v is True,
            ),
            AlarmDef(
                code="CA-TORQUE",
                severity=Severity.WARN,
                message="Capper01: cap torque variance high — check chuck.",
                source_tag="cap_torque_variance",
                predicate=lambda v: v > 1.5,
                fault_code="CA001",
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# Labeler01
# ---------------------------------------------------------------------------

def _labeler01() -> AssetModel:
    return AssetModel(
        asset_id="labeler01",
        asset_type="labeler",
        display_name="Labeler 01",
        baseline="labeler",
        tags=labeler_tags(),
        fault_codes=[
            FaultCode(
                code="L001",
                label="Registration Error",
                description="Label placement error outside tolerance window.",
                severity=Severity.FAULT,
                likely_cause=(
                    "Web tension drift, worn roller bearing, label roll splice, "
                    "or registration sensor contamination."
                ),
                recommended_action=(
                    "Inspect web tension rollers; clean registration sensor; "
                    "check label roll splice; recalibrate registration offset."
                ),
            ),
            FaultCode(
                code="L002",
                label="Label Roll Low",
                description="Label roll nearing end — operator change required.",
                severity=Severity.WARN,
                likely_cause="Normal consumption.",
                recommended_action="Splice or install new label roll.",
            ),
            FaultCode(
                code="L003",
                label="Glue Temperature Low",
                description="Hot-melt glue below minimum application temperature.",
                severity=Severity.FAULT,
                likely_cause="Glue heater failure or setpoint too low.",
                recommended_action="Check glue heater; verify temperature setpoint.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="L-REG-DRIFT",
                severity=Severity.WARN,
                message="Labeler01: registration error drifting — check web tension.",
                source_tag="registration_error_mm",
                predicate=lambda v: abs(v) > 1.5,
                fault_code="L001",
            ),
            AlarmDef(
                code="L-ROLL-LOW",
                severity=Severity.WARN,
                message="Labeler01: label roll below 20% — prepare splice.",
                source_tag="label_roll_percent",
                predicate=lambda v: v < 20.0,
                fault_code="L002",
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# CasePacker01
# ---------------------------------------------------------------------------

def _casepacker01() -> AssetModel:
    return AssetModel(
        asset_id="casepacker01",
        asset_type="case_packer",
        display_name="Case Packer 01",
        baseline="case_packer",
        tags=case_packer_tags(),
        fault_codes=[
            FaultCode(
                code="CP001",
                label="Infeed Jam",
                description="Bottle jam detected on case packer infeed accumulation table.",
                severity=Severity.FAULT,
                likely_cause="Downstream backup (palletizer), misoriented bottle, or surge.",
                recommended_action="Clear jam; check downstream palletizer status.",
            ),
            FaultCode(
                code="CP002",
                label="Case Former Fault",
                description="Case blank did not form correctly.",
                severity=Severity.FAULT,
                likely_cause="Blank magazine empty, folding-plate jam, or glue issue.",
                recommended_action="Reload blank magazine; inspect folding plates and glue system.",
            ),
            FaultCode(
                code="CP003",
                label="Glue Temperature Low",
                description="Case sealer glue below application temperature.",
                severity=Severity.FAULT,
                likely_cause="Glue heater fault or setpoint drift.",
                recommended_action="Check case-sealer glue heater; verify temperature setpoint.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="CP-JAM",
                severity=Severity.FAULT,
                message="CasePacker01: infeed jam detected — clear and restart.",
                source_tag="jam_detected",
                predicate=lambda v: v is True,
                fault_code="CP001",
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# Palletizer01
# ---------------------------------------------------------------------------

def _palletizer01() -> AssetModel:
    return AssetModel(
        asset_id="palletizer01",
        asset_type="palletizer",
        display_name="Palletizer 01",
        baseline="palletizer",
        tags=palletizer_tags(),
        fault_codes=[
            FaultCode(
                code="PA001",
                label="Robot E-Stop",
                description="Robot cell e-stop triggered — production halted.",
                severity=Severity.CRITICAL,
                likely_cause="Safety zone intrusion or hardware e-stop pressed.",
                recommended_action="Clear safety zone; acknowledge e-stop; restart robot.",
            ),
            FaultCode(
                code="PA002",
                label="Pallet Not Present",
                description="No pallet at build station when layer transfer commanded.",
                severity=Severity.FAULT,
                likely_cause="Fork truck has not staged a pallet.",
                recommended_action="Stage empty pallet at build station.",
            ),
            FaultCode(
                code="PA003",
                label="Infeed Jam",
                description="Case jam on palletizer infeed conveyor.",
                severity=Severity.FAULT,
                likely_cause="Misaligned case, tall stack, or foreign object.",
                recommended_action="Clear case jam; inspect infeed guides.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="PA-JAM",
                severity=Severity.FAULT,
                message="Palletizer01: infeed jam — line backup imminent.",
                source_tag="jam_detected",
                predicate=lambda v: v is True,
                fault_code="PA003",
            ),
            AlarmDef(
                code="PA-NO-PALLET",
                severity=Severity.WARN,
                message="Palletizer01: no pallet at build station.",
                source_tag="pallet_present",
                predicate=lambda v: v is False,
                fault_code="PA002",
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# AirSystem01 (utility)
# ---------------------------------------------------------------------------

def _airsystem01() -> AssetModel:
    return AssetModel(
        asset_id="airsystem01",
        asset_type="air_system",
        display_name="Air System 01",
        baseline="air_system",
        tags=air_system_tags(),
        fault_codes=[
            FaultCode(
                code="AS001",
                label="Low Header Pressure",
                description="Plant compressed-air header pressure dropped below minimum.",
                severity=Severity.CRITICAL,
                likely_cause=(
                    "Compressor offline, air leak in distribution, excess demand, "
                    "or isolation valve partially closed."
                ),
                recommended_action=(
                    "Check compressor run status. "
                    "Walk the distribution headers for audible leaks. "
                    "Verify all isolation valves are fully open. "
                    "Check demand load across the line."
                ),
            ),
            FaultCode(
                code="AS002",
                label="Dryer Fault",
                description="Refrigerated air dryer fault — moisture in supply possible.",
                severity=Severity.FAULT,
                likely_cause="Dryer refrigerant low, compressor failure on dryer, or ambient temp too high.",
                recommended_action="Check dryer fault display; call refrigeration technician.",
            ),
            FaultCode(
                code="AS003",
                label="Compressor Offline",
                description="Lead compressor has stopped unexpectedly.",
                severity=Severity.CRITICAL,
                likely_cause="Motor trip, thermal overload, or unloader failure.",
                recommended_action="Check compressor control panel; reset if safe; call maintenance.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="AS-LOW-PRESS",
                severity=Severity.CRITICAL,
                message="AirSystem01: plant air header pressure LOW — check compressor.",
                source_tag="low_air_alarm",
                predicate=lambda v: v is True,
                fault_code="AS001",
            ),
            AlarmDef(
                code="AS-DRYER",
                severity=Severity.FAULT,
                message="AirSystem01: air dryer fault — moisture risk.",
                source_tag="dryer_fault",
                predicate=lambda v: v is True,
                fault_code="AS002",
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        # Utilities don't have PackML; default is fine but unused
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# CIPSkid01 (utility)
# ---------------------------------------------------------------------------

def _cipskid01() -> AssetModel:
    return AssetModel(
        asset_id="cipskid01",
        asset_type="cip_skid",
        display_name="CIP Skid 01",
        baseline="cip_skid",
        tags=cip_skid_tags(),
        fault_codes=[
            FaultCode(
                code="CI001",
                label="Valve Fault",
                description="CIP circuit valve did not reach commanded position.",
                severity=Severity.FAULT,
                likely_cause="Actuator failure, air supply loss, or positioner fault.",
                recommended_action="Check valve actuator; verify compressed-air supply; inspect positioner.",
            ),
            FaultCode(
                code="CI002",
                label="Supply Temp Low",
                description="CIP supply solution temperature below minimum for phase.",
                severity=Severity.FAULT,
                likely_cause="Heater fault or inadequate steam/hot-water supply.",
                recommended_action="Check CIP heater; verify steam supply.",
            ),
            FaultCode(
                code="CI003",
                label="Conductivity Out of Range",
                description="Return conductivity outside expected band for current cycle step.",
                severity=Severity.WARN,
                likely_cause="Chemical concentration wrong or sensor fouling.",
                recommended_action="Check chemical dosing; clean or replace conductivity sensor.",
            ),
        ],
        alarms=[
            AlarmDef(
                code="CI-VALVE",
                severity=Severity.FAULT,
                message="CIPSkid01: valve position fault.",
                source_tag="valve_fault",
                predicate=lambda v: v is True,
                fault_code="CI001",
            ),
        ],
        docs=[
            "operator_quick_guide.md",
            "troubleshooting.md",
            "fault_code_table.md",
            "pm_checklist.md",
            "plc_tag_description_sheet.md",
            "spare_parts_notes.md",
            "electrical_io_notes.md",
        ],
        packml_default=PackMLState.IDLE,
    )


# ---------------------------------------------------------------------------
# Public build functions
# ---------------------------------------------------------------------------

def build_line() -> LineModel:
    """Build and return the Florida Natural Demo juice bottling line (Line 01).

    Process assets are ordered left-to-right (infeed → outfeed).
    Utility assets (AirSystem01, CIPSkid01) are listed separately.
    """
    return LineModel(
        line_id=LINE_ID,
        display_name="Line 01",
        assets=[
            _depalletizer01(),
            _conveyor_zone01(),
            _conveyor_zone02(),
            _rinser01(),
            _filler01(),
            _capper01(),
            _labeler01(),
            _casepacker01(),
            _palletizer01(),
        ],
        utilities=[
            _airsystem01(),
            _cipskid01(),
        ],
    )


def build_factory() -> FactoryModel:
    """Build and return the full FactoryModel wrapping the juice bottling plant."""
    line = build_line()
    plant = PlantModel(
        plant_id="plant1",
        display_name="Plant 1",
        lines=[line],
    )
    return FactoryModel(
        site_id="florida_natural_demo",
        site_display="Florida Natural Demo",
        factory_display="FactoryLM",
        plants=[plant],
    )
