#!/usr/bin/env python3
"""Fail closed on missing, empty, filtered, skipped or incomplete database evidence."""
import copy
import hashlib
import json
import pathlib
import sys

REQUIRED = {
    "equipment-browser/__tests__/http.integration.test.ts": (21, [
        "20k fixture:", "real socket cancellation", "stale or corrected selections",
        "GETs leave recency", "rechecks authorization on every page", "same UUID",
    ]),
    "equipment-browser/__tests__/tenant-read.integration.test.ts": (3, [
        "aborts before acquiring", "read-only callbacks cannot change", "repeatable-read",
    ]),
    "bench-components/__tests__/store.integration.test.ts": (19, []),
}


def verify(report):
    files = report.get("testResults", [])
    cases = [case for file in files for case in file.get("assertionResults", [])]
    if not report.get("success") or not cases:
        raise ValueError("missing successful nonzero test collection")
    if report.get("numTotalTests") != len(cases) or report.get("numPassedTests") != len(cases):
        raise ValueError("collected/passed case totals disagree")
    if report.get("numFailedTests") or report.get("numPendingTests") or report.get("numFailedTestSuites"):
        raise ValueError("failed or skipped required cases")
    if any(case.get("status") != "passed" for case in cases):
        raise ValueError("every required case must execute and pass")
    for suffix, (minimum, names) in REQUIRED.items():
        matches = [file for file in files if file.get("name", "").endswith(suffix)]
        if len(matches) != 1 or matches[0].get("status") != "passed":
            raise ValueError("missing/duplicate/failed suite: " + suffix)
        assertions = matches[0].get("assertionResults", [])
        if len(assertions) < minimum:
            raise ValueError("zero or incomplete suite: " + suffix)
        for name in names:
            if not any(name in case.get("fullName", "") for case in assertions):
                raise ValueError("missing required named case: " + name)
    return {"total": len(cases), "suites": [{"file": f["name"], "cases": [
        {"name": c["fullName"], "status": c["status"], "duration": c.get("duration")}
        for c in f.get("assertionResults", [])]} for f in files]}


def self_test(report):
    controls = []
    empty = copy.deepcopy(report); empty["testResults"] = []; controls.append(empty)
    missing = copy.deepcopy(report); missing["testResults"] = missing["testResults"][1:]; controls.append(missing)
    skipped = copy.deepcopy(report); skipped["testResults"][0]["assertionResults"][0]["status"] = "pending"; controls.append(skipped)
    unnamed = copy.deepcopy(report)
    for file in unnamed["testResults"]:
        for case in file.get("assertionResults", []):
            if "20k fixture:" in case["fullName"]: case["fullName"] = "wrong case"
    controls.append(unnamed)
    for index, control in enumerate(controls):
        try: verify(control)
        except ValueError: continue
        raise ValueError("negative evidence control was accepted: " + str(index))
    return len(controls)


if __name__ == "__main__":
    try:
        source = pathlib.Path(sys.argv[1])
        report = json.loads(source.read_text())
        result = verify(report)
        result["negativeControlsRejected"] = self_test(report)
        result["reportSha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
        if len(sys.argv) > 2: pathlib.Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n")
        print("Required DB proof: %d cases PASS, 0 SKIP; %d negative controls rejected" % (result["total"], result["negativeControlsRejected"]))
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        sys.exit("Required equipment-browser DB evidence rejected: " + str(error))
