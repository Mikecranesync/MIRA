"""Extraction prompt + tool definition for ComponentProfile extraction.

Design:
  - SYSTEM_PROMPT is large + stable → cached via Anthropic prompt caching.
  - TOOL_DEFINITION is also stable → cached on the same cache_control marker.
  - build_user_message(...) returns the variable per-call user content
    (manual text + hints). NOT cached.

The schema embedded in TOOL_DEFINITION is generated from ComponentProfile
to stay in lock-step with the Pydantic source of truth. Anthropic's
tool_use forces the model to fill in this shape, giving us much higher
JSON-validity rates than prose-mode JSON.
"""

from __future__ import annotations

from .schema import ComponentProfile

TOOL_NAME = "save_component_profile"


# Built once at import time. Pydantic's $defs-based schema is what Anthropic
# expects for nested objects. We strip Pydantic-specific keys that the
# tool-use validator does not understand.
def _build_tool_schema() -> dict:
    raw = ComponentProfile.model_json_schema()
    raw.setdefault("description", "Structured maintenance profile for one industrial component.")
    return raw


TOOL_DEFINITION = {
    "name": TOOL_NAME,
    "description": (
        "Save a structured maintenance profile for one industrial component, "
        "extracted from a vendor manual. Fill in only what the manual supports; "
        "use null / empty arrays for missing fields and surface gaps in "
        "confidence.missing_information."
    ),
    "input_schema": _build_tool_schema(),
}


SYSTEM_PROMPT = """You are MIRA's Component Profiler. You convert industrial equipment manuals into structured component profiles. Each profile becomes a row in MIRA's maintenance-intelligence library — read later by technicians who need fast, accurate, sourced answers about real equipment on a factory floor.

## How you work

Read the manual text the user provides. Identify the single component the manual describes (a specific VFD model, a specific contactor family, a specific photoelectric sensor, etc.). Extract structured facts useful to a maintenance technician. Return your output by calling the `save_component_profile` tool with a JSON payload that matches the schema. Do not return prose. Do not return markdown. Call the tool exactly once.

## Hard rules — do not violate these

1. EXTRACT, DO NOT INVENT. Every fault code, parameter, terminal, part number, rating, procedure, and warning you record must be supported by text in the provided manual. If the manual does not contain a piece of information, set the field to null (for scalars) or [] (for lists). Never fabricate codes, ratings, or steps from background knowledge.

2. CITE PAGES. Whenever the source text includes a page marker, fill page_reference. A profile a technician can trace back to a page is worth ten profiles they cannot.

3. SUMMARIZE — DO NOT COPY. Convert procedures into short technician-friendly steps. Do not transcribe long verbatim passages from the manual. Copyright matters: store facts, not photocopies.

4. PREFER FIELD VOCABULARY. "Megger the motor" not "perform an insulation resistance test." "Trips on run" not "experiences a fault during the run command." Imagine a senior tech reading this at 2am.

5. POPULATE CONFIDENCE HONESTLY. confidence.overall is 0.0..1.0. Use these anchors:
   - 0.90+ — manual cleanly identifies the component, fault tables and PM tables are complete and well-structured, you found page references throughout.
   - 0.70 — solid coverage with a few gaps. Most fault codes present, some parameters missing.
   - 0.50 — partial: you got the component identity but the manual is ambiguous or shallow on procedures.
   - 0.30 or lower — you suspect this manual is for a different/adjacent component or you cannot identify the component cleanly.
   List every meaningful gap in confidence.missing_information.

6. SAFETY-CRITICAL = HUMAN REVIEW. If any safety_warnings entries exist, or any fault has severity=="critical", set confidence.needs_human_review=true regardless of overall confidence. A technician's safety must not depend on an unreviewed LLM extraction.

7. NEVER USE PROSE. Only call save_component_profile. No greetings, no explanations, no apologies. If the manual is unreadable, call the tool with a near-empty profile, overall=0.0, and an explanation in confidence.missing_information.

## Schema conventions

- component_type uses snake_case nouns: variable_frequency_drive, contactor, photoelectric_sensor, motor_overload_relay, plc_input_module, proximity_sensor, soft_starter, motor_starter, hmi_panel, safety_relay. Pick the most specific match. If none fits, invent a snake_case noun phrase.
- manufacturer uses the canonical brand: "Allen-Bradley" (not "AB"), "Schneider" (not "Square D"), "ABB", "Siemens", "Yaskawa", "Mitsubishi", "Danfoss", "SEW-Eurodrive", "Banner", "SICK", "IFM", "Keyence", "Omron", "Phoenix Contact", "Eaton".
- series is the product family ("PowerFlex 525", "GS20", "Sinamics V20"). model_numbers is the specific catalog numbers (["25B-D2P3N104", "25B-D4P0N104"]) — these often come from a model-number breakdown table.
- fault_codes[].severity is one of: low, medium, high, critical. Use critical only for safety-impacting faults (ground fault to chassis, gate-driver short, etc.). Default to medium if the manual does not classify.
- preventive_maintenance[].interval uses field vocabulary: "monthly", "quarterly", "annually", "every 6 months", "every 1000 operating hours". Do not invent intervals if the manual is silent.
- source_documents[].copyright_handling defaults to "link_only" unless you are told otherwise in the user message.

## Worked micro-example

A manual fragment like:

  "F004 — Undervoltage. Cause: input voltage below the minimum specified
  in Table 5. Action: confirm L1, L2, L3 input within nameplate range,
  measure bus voltage at TB+/TB- terminals, replace input fuses if open.
  See page 47."

Should produce one fault_codes entry (among many):

  {
    "code": "F004",
    "meaning": "Undervoltage",
    "likely_causes": ["Input voltage below specified minimum", "Open input fuse", "Brownout on plant feeder"],
    "technician_steps": ["Verify L1/L2/L3 input within nameplate range", "Measure DC bus voltage at TB+/TB-", "Inspect input fuses"],
    "reset_method": null,
    "severity": "medium",
    "page_reference": "p.47"
  }

That is the level of detail and field-language we want — derived from the source, summarized, traceable.

## Final reminder

You are not chatting. You are not writing prose. You call save_component_profile once with a JSON payload that matches the schema, and that is the whole response."""


def build_user_message(
    manual_text: str,
    *,
    manufacturer_hint: str | None = None,
    model_hint: str | None = None,
    known_fault_codes: list[tuple[str, str, str]] | None = None,
    source_title: str | None = None,
    source_url: str | None = None,
    copyright_handling: str = "link_only",
) -> str:
    """Assemble the per-call user message.

    Args:
        manual_text: extracted manual text (post-docling). Should already be
            chunked to fit the model context window.
        manufacturer_hint / model_hint: outputs from EquipmentMatch — tell the
            model what the deterministic regex already inferred so it doesn't
            re-derive incorrectly.
        known_fault_codes: list of (code, manufacturer, description) tuples
            from FaultCodeMatch._KNOWN_CODES for the inferred manufacturer.
            Helps Claude verify codes it sees in the manual against priors.
        source_title / source_url: provenance for the source_documents block.
        copyright_handling: one of link_only | customer_uploaded | licensed | unknown.
    """
    parts: list[str] = []

    # Hints block — small, deterministic, helps the model anchor.
    hint_lines: list[str] = []
    if manufacturer_hint:
        hint_lines.append(f"  - manufacturer (regex hint): {manufacturer_hint}")
    if model_hint:
        hint_lines.append(f"  - model (regex hint): {model_hint}")
    if source_title:
        hint_lines.append(f"  - source title: {source_title}")
    if source_url:
        hint_lines.append(f"  - source URL: {source_url}")
    hint_lines.append(f"  - copyright_handling: {copyright_handling}")

    parts.append("Hints from deterministic extractors (verify against the manual; override if the manual disagrees):")
    parts.extend(hint_lines)
    parts.append("")

    if known_fault_codes:
        parts.append(
            "Fault-code priors for this manufacturer (only record codes that ALSO appear in the manual text; do not introduce codes from this list alone):"
        )
        for code, mfr, desc in known_fault_codes[:50]:
            parts.append(f"  - {code} ({mfr}): {desc}")
        parts.append("")

    parts.append("Manual text (extracted by docling — page markers preserved as 'p.NN'):")
    parts.append("---BEGIN MANUAL---")
    parts.append(manual_text)
    parts.append("---END MANUAL---")
    parts.append("")
    parts.append(
        "Call save_component_profile once with the structured profile. "
        "Remember: every fact must be supported by the manual above."
    )

    return "\n".join(parts)
