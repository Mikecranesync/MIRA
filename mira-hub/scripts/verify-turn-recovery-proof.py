#!/usr/bin/env python3
"""Fail closed on a missing, filtered, skipped or short turn-recovery database run."""

import copy
import json
import pathlib
import sys

REQUIRED = {
    "turn-recovery/status.integration.test.ts": 10,
    "turn-recovery/chat.integration.test.ts": 7,
    "turn-recovery/round2.integration.test.ts": 12,
    "turn-recovery/photo-change.integration.test.ts": 10,
}
MINIMUM_TOTAL = 29


def verify(report):
    files = report.get("testResults", [])
    cases = [case for file in files for case in file.get("assertionResults", [])]
    if not report.get("success") or not cases:
        raise ValueError("missing successful nonzero test collection")
    if report.get("numTotalTests") != len(cases) or report.get("numPassedTests") != len(cases):
        raise ValueError("collected/passed case totals disagree")
    if (
        report.get("numFailedTests")
        or report.get("numPendingTests")
        or report.get("numFailedTestSuites")
    ):
        raise ValueError("failed or skipped required cases")
    if any(case.get("status") != "passed" for case in cases):
        raise ValueError("every required case must execute and pass")
    if len(cases) < MINIMUM_TOTAL:
        raise ValueError("fewer than %d recovery cases collected: %d" % (MINIMUM_TOTAL, len(cases)))
    for suffix, minimum in REQUIRED.items():
        matches = [file for file in files if file.get("name", "").endswith(suffix)]
        if len(matches) != 1 or matches[0].get("status") != "passed":
            raise ValueError("missing/duplicate/failed suite: " + suffix)
        if len(matches[0].get("assertionResults", [])) < minimum:
            raise ValueError("zero or incomplete suite: " + suffix)
    return len(cases)


def self_test(report):
    controls = []

    empty = copy.deepcopy(report)
    empty["testResults"] = []
    controls.append(empty)

    missing = copy.deepcopy(report)
    missing["testResults"] = missing["testResults"][1:]
    controls.append(missing)

    skipped = copy.deepcopy(report)
    skipped["testResults"][0]["assertionResults"][0]["status"] = "pending"
    controls.append(skipped)

    short = copy.deepcopy(report)
    short["testResults"][0]["assertionResults"] = short["testResults"][0]["assertionResults"][:-1]
    short["numTotalTests"] = short["numPassedTests"] = sum(
        len(f["assertionResults"]) for f in short["testResults"]
    )
    controls.append(short)

    for index, control in enumerate(controls):
        try:
            verify(control)
        except ValueError:
            continue
        raise ValueError("negative evidence control was accepted: " + str(index))
    return len(controls)


if __name__ == "__main__":
    try:
        report = json.loads(pathlib.Path(sys.argv[1]).read_text())
        total = verify(report)
        print(
            "Required recovery DB proof: %d cases PASS, 0 SKIP; %d negative controls rejected"
            % (total, self_test(report))
        )
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        sys.exit("Required turn-recovery DB evidence rejected: " + str(error))
