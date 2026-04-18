"""
generator.py — Codebase-aware 20-case generator.
Parses live engine.py to find coverage gaps, outputs YAML cases.
"""
import ast
import time
from pathlib import Path

import yaml


def parse_engine_keywords(engine_path: str) -> dict:
    """Return {print_kws, intent_kws, fault_cats} parsed from engine.py."""
    text = Path(engine_path).read_text()
    tree = ast.parse(text)
    result = {"print_kws": set(), "intent_kws": set(), "fault_cats": set()}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    name = target.id
                    if name == "PRINT_KEYWORDS" and isinstance(node.value, (ast.Set, ast.Dict)):
                        elts = node.value.keys if isinstance(node.value, ast.Dict) else node.value.elts
                        result["print_kws"] = {ast.literal_eval(e) for e in elts if isinstance(e, ast.Constant)}
                    elif name == "INTENT_KEYWORDS" and isinstance(node.value, (ast.Set, ast.Dict)):
                        elts = node.value.keys if isinstance(node.value, ast.Dict) else node.value.elts
                        result["intent_kws"] = {ast.literal_eval(e) for e in elts if isinstance(e, ast.Constant)}
    # Fault categories: scan _infer_fault_category strings
    for node in ast.walk(tree):
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Constant):
            val = str(node.value.value)
            if val.isupper() and "_" in val:
                result["fault_cats"].add(val)
    return result


def get_covered_categories(manifest_path: str) -> set:
    """Load test_manifest_100.yaml and collect all fault_category values."""
    data = yaml.safe_load(Path(manifest_path).read_text())
    cats = set()
    for case in data.get("cases", []):
        cat = case.get("expected", {}).get("fault_category")
        if cat:
            cats.add(cat)
    return cats


def find_gaps(covered: set, available: set) -> list:
    return [c for c in sorted(available) if c not in covered]


def generate_cases(
    manifest_100_path: str,
    engine_path: str,
    ingest_main_path: str,
) -> list[dict]:
    """Return the 20 generated test cases."""
    cases = [
        # ── ELECTRICAL_DRAWING (5) ───────────────────────────────────────────
        {
            "name": "elec_drawing_ladder_101",
            "image": "telegram_test_runner/test-assets/sample_tags/ab_micro820_tag.jpg",
            "caption": "Can you read this ladder logic diagram and tell me what rung 15 does?",
            "scenario": "Electrical drawing — ladder logic interpretation",
            "expected": {
                "fault_category": "ELECTRICAL_DRAWING",
                "must_identify_device": False,
                "must_give_fault_cause": False,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["Allen-Bradley", "Micro820"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": [],
            "next_step_keywords": ["rung", "coil", "contact", "read", "logic"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "drawing",
            "must_give_fault_cause": False,
        },
        {
            "name": "elec_drawing_oneline_102",
            "image": "telegram_test_runner/test-assets/sample_tags/generic_cabinet_tag.jpg",
            "caption": "This is a one-line diagram, help me find the main breaker path",
            "scenario": "Electrical drawing — one-line diagram reading",
            "expected": {
                "fault_category": "ELECTRICAL_DRAWING",
                "must_identify_device": False,
                "must_give_fault_cause": False,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": [],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": [],
            "next_step_keywords": ["breaker", "panel", "main", "path", "circuit"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "drawing",
            "must_give_fault_cause": False,
        },
        {
            "name": "elec_drawing_pid_103",
            "image": "telegram_test_runner/test-assets/sample_tags/gs10_vfd_tag.jpg",
            "caption": "What does this P&ID show for the pump isolation valves?",
            "scenario": "Electrical drawing — P&ID pump isolation",
            "expected": {
                "fault_category": "ELECTRICAL_DRAWING",
                "must_identify_device": False,
                "must_give_fault_cause": False,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["AutomationDirect", "GS10"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": [],
            "next_step_keywords": ["valve", "isolation", "pump", "flow", "check"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "drawing",
            "must_give_fault_cause": False,
        },
        {
            "name": "elec_drawing_wiring_104",
            "image": "telegram_test_runner/test-assets/sample_tags/cropped_tight_tag.jpg",
            "caption": "Wiring diagram for motor circuit, which wire is the overload output?",
            "scenario": "Electrical drawing — wiring diagram overload",
            "expected": {
                "fault_category": "ELECTRICAL_DRAWING",
                "must_identify_device": False,
                "must_give_fault_cause": False,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": [],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": [],
            "next_step_keywords": ["overload", "wire", "output", "terminal", "motor"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "drawing",
            "must_give_fault_cause": False,
        },
        {
            "name": "elec_drawing_schematic_105",
            "image": "telegram_test_runner/test-assets/sample_tags/bad_glare_tag.jpg",
            "caption": "I have a schematic here, can you identify the control transformer?",
            "scenario": "Electrical drawing — schematic control transformer (adversarial/glare)",
            "expected": {
                "fault_category": "ELECTRICAL_DRAWING",
                "must_identify_device": False,
                "must_give_fault_cause": False,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": [],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": [],
            "next_step_keywords": ["transformer", "control", "schematic", "identify", "read"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": True,
            "scenario_type": "drawing",
            "must_give_fault_cause": False,
        },
        # ── HYDRAULIC_FAULT (5) ──────────────────────────────────────────────
        {
            "name": "hydraulic_pressure_drop_106",
            "image": "telegram_test_runner/test-assets/sample_tags/gs10_vfd_tag.jpg",
            "caption": "Hydraulic system lost pressure on this pump drive circuit",
            "scenario": "Hydraulic — pressure drop on pump drive",
            "expected": {
                "fault_category": "HYDRAULIC_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["AutomationDirect", "GS10"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["pressure", "pump", "leak", "seal", "relief"],
            "next_step_keywords": ["check", "inspect", "measure", "test", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "hydraulic_cylinder_drift_107",
            "image": "telegram_test_runner/test-assets/sample_tags/ab_micro820_tag.jpg",
            "caption": "Cylinder drifting down slowly when idle, seals look ok",
            "scenario": "Hydraulic — cylinder drift",
            "expected": {
                "fault_category": "HYDRAULIC_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["Allen-Bradley", "Micro820"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["cylinder", "drift", "valve", "seal", "bypass"],
            "next_step_keywords": ["check", "inspect", "replace", "test", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "hydraulic_pump_cavitation_108",
            "image": "telegram_test_runner/test-assets/sample_tags/gs10_vfd_tag.jpg",
            "caption": "Hydraulic pump making whining noise, foamy oil in reservoir",
            "scenario": "Hydraulic — pump cavitation",
            "expected": {
                "fault_category": "HYDRAULIC_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["AutomationDirect", "GS10"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["cavitation", "foam", "air", "suction", "inlet"],
            "next_step_keywords": ["check", "inspect", "bleed", "fill", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "hydraulic_valve_stuck_109",
            "image": "telegram_test_runner/test-assets/sample_tags/generic_cabinet_tag.jpg",
            "caption": "Directional control valve not shifting, solenoid coil voltage good",
            "scenario": "Hydraulic — directional valve stuck",
            "expected": {
                "fault_category": "HYDRAULIC_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": [],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["valve", "solenoid", "spool", "contamination", "coil"],
            "next_step_keywords": ["check", "clean", "replace", "inspect", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "hydraulic_relief_valve_110",
            "image": "telegram_test_runner/test-assets/sample_tags/ab_micro820_tag.jpg",
            "caption": "Relief valve continuously bypassing, system can't build pressure",
            "scenario": "Hydraulic — relief valve bypassing",
            "expected": {
                "fault_category": "HYDRAULIC_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["Allen-Bradley", "Micro820"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["relief", "bypass", "pressure", "setting", "spring"],
            "next_step_keywords": ["adjust", "check", "replace", "set", "inspect"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        # ── PROCESS_EQUIPMENT (5) ────────────────────────────────────────────
        {
            "name": "process_pump_cavitation_111",
            "image": "telegram_test_runner/test-assets/sample_tags/gs10_vfd_tag.jpg",
            "caption": "Centrifugal pump cavitating, inlet pressure too low",
            "scenario": "Process — centrifugal pump cavitation",
            "expected": {
                "fault_category": "PROCESS_EQUIPMENT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["AutomationDirect", "GS10"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["cavitation", "inlet", "pressure", "suction", "npsh"],
            "next_step_keywords": ["check", "increase", "inspect", "measure", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "process_compressor_fault_112",
            "image": "telegram_test_runner/test-assets/sample_tags/generic_cabinet_tag.jpg",
            "caption": "Air compressor not reaching cutout pressure, runs continuously",
            "scenario": "Process — compressor not cutting out",
            "expected": {
                "fault_category": "PROCESS_EQUIPMENT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": [],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["compressor", "pressure", "valve", "switch", "leak"],
            "next_step_keywords": ["check", "inspect", "test", "replace", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "process_fan_vibration_113",
            "image": "telegram_test_runner/test-assets/sample_tags/gs10_vfd_tag.jpg",
            "caption": "Supply fan vibrating badly since new belt installed last week",
            "scenario": "Process — fan vibration after belt change",
            "expected": {
                "fault_category": "PROCESS_EQUIPMENT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["AutomationDirect", "GS10"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["belt", "vibration", "alignment", "tension", "bearing"],
            "next_step_keywords": ["check", "align", "tension", "inspect", "replace"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "process_heat_exchanger_114",
            "image": "telegram_test_runner/test-assets/sample_tags/ab_micro820_tag.jpg",
            "caption": "Heat exchanger outlet temp too high, flow rate confirmed normal",
            "scenario": "Process — heat exchanger high outlet temp",
            "expected": {
                "fault_category": "PROCESS_EQUIPMENT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["Allen-Bradley", "Micro820"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["fouling", "scaling", "transfer", "temperature", "flow"],
            "next_step_keywords": ["inspect", "clean", "check", "measure", "flush"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "process_valve_actuator_115",
            "image": "telegram_test_runner/test-assets/sample_tags/generic_cabinet_tag.jpg",
            "caption": "Pneumatic valve actuator not stroking full travel, supply air 80 PSI",
            "scenario": "Process — pneumatic actuator short stroke",
            "expected": {
                "fault_category": "PROCESS_EQUIPMENT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": [],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["actuator", "pneumatic", "stroke", "spring", "seal"],
            "next_step_keywords": ["check", "inspect", "adjust", "replace", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        # ── SAFETY_FAULT (5) ─────────────────────────────────────────────────
        {
            "name": "safety_estop_wiring_116",
            "image": "telegram_test_runner/test-assets/sample_tags/ab_micro820_tag.jpg",
            "caption": "E-stop circuit not resetting after button released, safety relay faulted",
            "scenario": "Safety — E-stop won't reset",
            "expected": {
                "fault_category": "SAFETY_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["Allen-Bradley", "Micro820"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["estop", "e-stop", "safety relay", "wiring", "contact"],
            "next_step_keywords": ["check", "inspect", "reset", "verify", "test"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "safety_light_curtain_117",
            "image": "telegram_test_runner/test-assets/sample_tags/generic_cabinet_tag.jpg",
            "caption": "Light curtain showing muted fault, bypass key removed yesterday",
            "scenario": "Safety — light curtain muted fault",
            "expected": {
                "fault_category": "SAFETY_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": [],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["muted", "light curtain", "bypass", "fault", "key"],
            "next_step_keywords": ["check", "inspect", "reset", "verify", "clear"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "safety_relay_fault_118",
            "image": "telegram_test_runner/test-assets/sample_tags/ab_micro820_tag.jpg",
            "caption": "Safety relay input A1 not energizing, 24V at coil terminals confirmed",
            "scenario": "Safety — safety relay A1 input fault",
            "expected": {
                "fault_category": "SAFETY_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["Allen-Bradley", "Micro820"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["relay", "coil", "input", "wiring", "contact"],
            "next_step_keywords": ["check", "inspect", "measure", "verify", "replace"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "safety_door_interlock_119",
            "image": "telegram_test_runner/test-assets/sample_tags/generic_cabinet_tag.jpg",
            "caption": "Guard door interlock bypassed by previous tech, need to restore",
            "scenario": "Safety — guard door interlock restoration",
            "expected": {
                "fault_category": "SAFETY_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": [],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["interlock", "bypass", "guard", "door", "switch"],
            "next_step_keywords": ["restore", "check", "wire", "inspect", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
        {
            "name": "safety_two_hand_control_120",
            "image": "telegram_test_runner/test-assets/sample_tags/ab_micro820_tag.jpg",
            "caption": "Two-hand control only works if you hold left button longer than right",
            "scenario": "Safety — two-hand control timing fault",
            "expected": {
                "fault_category": "SAFETY_FAULT",
                "must_identify_device": True,
                "must_give_fault_cause": True,
                "must_give_next_step": True,
            },
            "pass_conditions": {
                "max_words": 150,
                "min_words": 20,
                "must_contain": ["Allen-Bradley", "Micro820"],
                "must_not_contain": [],
                "must_include_action_verb": True,
            },
            "fault_cause_keywords": ["two-hand", "timing", "button", "contact", "synchrony"],
            "next_step_keywords": ["check", "inspect", "test", "replace", "verify"],
            "max_words": 150,
            "speed_timeout": 30,
            "adversarial": False,
            "scenario_type": "fault",
        },
    ]
    return cases


def write_manifest_v2(
    cases_100_path: str,
    new_cases: list[dict],
    output_path: str,
) -> None:
    """Concatenate 100 existing + 20 generated cases → manifest_v2.yaml."""
    data_100 = yaml.safe_load(Path(cases_100_path).read_text())
    existing = data_100.get("cases", [])
    combined = {"cases": existing + new_cases}
    Path(output_path).write_text(yaml.dump(combined, default_flow_style=False, allow_unicode=True))
    print(f"manifest_v2.yaml written: {len(existing)} existing + {len(new_cases)} generated = {len(combined['cases'])} total")


def is_stale(path: str, max_age_hours: float = 24.0) -> bool:
    p = Path(path)
    if not p.exists():
        return True
    age = time.time() - p.stat().st_mtime
    return age > max_age_hours * 3600
