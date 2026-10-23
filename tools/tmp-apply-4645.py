#!/usr/bin/env python3
"""One-shot #4645 production patch. Applied by CI, then deleted. Do not keep."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NQ = ROOT / "mira-hub/src/lib/notebook-query.ts"
AV = ROOT / "mira-hub/src/capabilities/answer-validation.ts"
GOOD = "e3d42cde318745730cb37d8f60c6ed9669ba9994"


def must_replace(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {n}")
    return text.replace(old, new, 1)


def main() -> None:
    nq = subprocess.check_output(
        ["git", "show", f"{GOOD}:mira-hub/src/lib/notebook-query.ts"],
        text=True,
    )
    if "import { canonicalModelKey }" not in nq:
        raise SystemExit("restored notebook-query.ts is not the last-good file")

    nq = must_replace(
        nq,
        r"""  [/\bfault\b|\btrip\b|\balarm\b|\berror\s*code\b/i, ["fault"]],
  [/\breset\b|\bclear\b/i, ["fault clear"]],
""",
        r"""  [/\bfault\b|\btrip\b|\balarm\b|\berror\s*code\b/i, ["fault"]],
  // Technician "ACK" names a pictogram key; OEM manuals say "acknowledge" /
  // "group acknowledgment" and never the token ACK (#4645 / Comfort p.74).
  [/\back\b/i, ["acknowledge", "group acknowledgment", "fault clear"]],
  // Fault-clear and acknowledge are the same operator-action class. Expand
  // only when the object is a fault/alarm so a parameter-reset is not flooded.
  [/\b(?:reset|clear)\b[^.?!]*\b(?:fault|trip|alarm)|\b(?:fault|trip|alarm)\b[^.?!]*\b(?:reset|clear)\b/i, ["acknowledge", "group acknowledgment", "fault clear"]],
  [/\breset\b|\bclear\b/i, ["fault clear"]],
""",
        "SYNONYMS",
    )

    nq = must_replace(
        nq,
        r"""const PROC_SIGNALS =
  /\b(verify|check|set|press|remove|clear|reset|correct|corrected|apply|turn|ensure|connect|disconnect|measure|inspect|replace|confirm|select|enter|navigate|attention|warning|caution|step|steps|procedure|follow)\b/gi;
""",
        r"""const PROC_SIGNALS =
  /\b(verify|check|set|press|remove|clear|reset|acknowledge|acknowledges|acknowledged|acknowledging|acknowledgment|correct|corrected|apply|turn|ensure|connect|disconnect|measure|inspect|replace|confirm|select|enter|navigate|attention|warning|caution|step|steps|procedure|follow)\b/gi;
""",
        "PROC_SIGNALS",
    )

    nq = must_replace(
        nq,
        r"""const FAULT_ACTION =
  /\b(clear|reset|recover|clears|resets|recovers|clearing|resetting)\b[^.?!]*\b(fault|trip)|\b(fault|trip)\b[^.?!]*\b(clear|reset|recover)|after (?:it|the drive|this) (?:faults|trips)|get (?:it|the drive) running again/i;
""",
        r"""const FAULT_ACTION =
  /\b(?:clears?|reset(?:s|ting)?|recovers?|acknowledg(?:e|es|ed|ing)|acks?)\b[^.?!]*\b(?:fault|trip|alarm)s?|\b(?:fault|trip|alarm)s?\b[^.?!]*\b(?:clear|reset|recover|acknowledge|ack)|after (?:it|the drive|this) (?:faults|trips)|get (?:it|the drive) running again|\back(?:nowledg\w*)?\s+key\b/i;
""",
        "FAULT_ACTION",
    )

    nq = must_replace(
        nq,
        r"""  if (/\b[PpAaBbCcHhLdtUu]\d{2,4}\b|\bparameter\b|\bwhat does\b/i.test(q)) return "param_lookup";
  return "generic";
}
""",
        r"""  if (/\b[PpAaBbCcHhLdtUu]\d{2,4}\b|\bparameter\b|\bwhat does\b/i.test(q)) return "param_lookup";
  return "generic";
}

/**
 * Content signature of destructive factory-restore / OS-wipe material.
 * Measured on Siemens Comfort Panel Operating Instructions (pp. 141, 169–171):
 * factory-settings restore and OS update delete project data and license keys.
 * This is a document-content signature, not a list of technician questions.
 */
const FACTORY_RESTORE_MATERIAL =
  /\bfactory[\s-]+(?:reset|settings|defaults?)\b|\breset\b[^.!?]{0,40}\bfactory\b|\brestore\b[^.!?]{0,40}\bfactory\b|\boperating\s+system\s+(?:update|upgrade|image)\b|\bupdat(?:e|ing)\s+the\s+operating\s+system\b/i;

export function isFactoryResetMaterial(text: string): boolean {
  FACTORY_RESTORE_MATERIAL.lastIndex = 0;
  return FACTORY_RESTORE_MATERIAL.test(text);
}
""",
        "isFactoryResetMaterial",
    )

    nq = must_replace(
        nq,
        "      score += specScore(c.content) * 1.5;\n"
        "    }\n"
        "    // broad / param_lookup / spec / generic: no index penalty. (Broad already has\n",
        "      score += specScore(c.content) * 1.5;\n"
        "    }\n"
        "    if (intent === \"fault\") {\n"
        "      if (isFactoryResetMaterial(c.content)) {\n"
        "        // Factory-restore pages share the token \"reset\" with fault-clear\n"
        "        // questions and also read as procedure (imperatives). Demote them\n"
        "        // below acknowledge / fault-clear prose. A true factory-reset\n"
        "        // question classifies as procedure and is not demoted.\n"
        "        score -= 6.0;\n"
        "      } else if (/\\backnowledg/i.test(c.content)) {\n"
        "        score += 2.0;\n"
        "      }\n"
        "    }\n"
        "    // broad / param_lookup / spec / generic: no index penalty. (Broad already has\n",
        "rerankChunks",
    )

    NQ.write_text(nq)

    av = AV.read_text()
    av = must_replace(
        av,
        'import { stepEnergyContradiction } from "./step-energy";\n'
        'import { firstUngovernedMatch } from "./hazard-modifiers";\n',
        'import { stepEnergyContradiction } from "./step-energy";\n'
        'import { firstUngovernedMatch } from "./hazard-modifiers";\n'
        'import { factoryResetAsFaultClear, FACTORY_RESET_AS_FAULT_REPLACEMENT } from "./fault-reset-safety";\n',
        "AV import",
    )
    av = must_replace(
        av,
        "  // B \u2014 general lane only. The grounded lane's specificity discipline is the\n"
        "  // citation contract, already enforced upstream.\n"
        "  if (!general || refused) return energizedWarningOr(restore, answerText);\n",
        "  // #4645: a factory-restore / OS-wipe procedure is never a fault-clear\n"
        "  // answer. Both lanes \u2014 the reproduced leak was grounded in the OEM manual.\n"
        "  const factoryReset = factoryResetAsFaultClear(scanQuestion, scanText);\n"
        "  if (factoryReset) {\n"
        "    return {\n"
        "      ok: false,\n"
        "      kind: \"unsupported_specificity\",\n"
        "      violation: \"unsupported-specificity:factory-reset-as-fault-clear\",\n"
        "      detail: factoryReset,\n"
        "      replacement: FACTORY_RESET_AS_FAULT_REPLACEMENT,\n"
        "    };\n"
        "  }\n"
        "\n"
        "  // B \u2014 general lane only. The grounded lane's specificity discipline is the\n"
        "  // citation contract, already enforced upstream.\n"
        "  if (!general || refused) return energizedWarningOr(restore, answerText);\n",
        "AV factory-reset guard",
    )
    AV.write_text(av)

    checks = (
        ("isFactoryResetMaterial", nq),
        ("group acknowledgment", nq),
        ("acknowledg(?:e|es|ed|ing)", nq),
        ("acknowledge|acknowledges|acknowledged|acknowledging|acknowledgment", nq),
        ("factoryResetAsFaultClear", av),
        ("unsupported-specificity:factory-reset-as-fault-clear", av),
    )
    for needle, blob in checks:
        if needle not in blob:
            raise SystemExit(f"post-check failed: {needle}")
    print("applied #4645 production edits")


if __name__ == "__main__":
    main()
