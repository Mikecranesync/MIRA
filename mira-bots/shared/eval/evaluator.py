"""MIRA Eval Harness — Tests intent classification and output guardrails.

Run via: python -m shared.eval.evaluator
         (from mira-bots/ directory)
"""

import json
import os
import sys


def run_intent_tests(test_cases: list[dict]) -> tuple[int, int, list[str]]:
    """Run intent classification tests. No LLM/HTTP needed."""
    from shared.guardrails import classify_intent, check_output

    passed = 0
    failed = 0
    failures = []

    for i, tc in enumerate(test_cases):
        input_text = tc["input"]
        expected = tc.get("expected_intent")
        should_not_contain = tc.get("should_not_contain", [])
        desc = tc.get("description", "")

        # Test intent classification
        actual_intent = classify_intent(input_text)
        intent_ok = actual_intent == expected if expected else True

        # Test output guardrails (simulate a bad response)
        guardrail_ok = True
        if should_not_contain and expected:
            # Create a fake bad response containing forbidden content
            bad_response = f"The soft starter modbus fault code overcurrent on the motor"
            cleaned = check_output(bad_response, expected, has_photo=False)
            for forbidden in should_not_contain:
                if forbidden.lower() in cleaned.lower():
                    guardrail_ok = False
                    failures.append(
                        f"  FAIL [{i+1}] guardrail: '{forbidden}' found in "
                        f"cleaned output for intent={expected}"
                    )

        if intent_ok and guardrail_ok:
            passed += 1
            status = "PASS"
        else:
            failed += 1
            status = "FAIL"
            if not intent_ok:
                failures.append(
                    f"  FAIL [{i+1}] intent: input={input_text!r} "
                    f"expected={expected} got={actual_intent}"
                )

        label = f" ({desc})" if desc else ""
        print(f"  [{status}] {input_text!r}{label} -> {actual_intent}")

    return passed, failed, failures


def run_abbreviation_tests() -> tuple[int, int, list[str]]:
    """Test abbreviation expansion."""
    from shared.guardrails import expand_abbreviations

    cases = [
        ("mtr trpd on conv 4", "motor tripped on conveyor 4"),
        ("vfd oc fault", "variable frequency drive overcurrent fault"),
        ("normal text here", "normal text here"),
        ("brk trpd pnl 3", "breaker tripped panel 3"),
    ]
    passed = 0
    failed = 0
    failures = []

    for input_text, expected in cases:
        actual = expand_abbreviations(input_text)
        if actual == expected:
            passed += 1
            print(f"  [PASS] {input_text!r} -> {actual!r}")
        else:
            failed += 1
            failures.append(
                f"  FAIL abbreviation: {input_text!r} expected={expected!r} got={actual!r}"
            )
            print(f"  [FAIL] {input_text!r} -> {actual!r} (expected {expected!r})")

    return passed, failed, failures


def run_rewrite_tests(test_cases: list[dict]) -> tuple[int, int, list[str]]:
    """Test query rewrite quality — abbreviations expanded in rewritten queries."""
    from shared.guardrails import expand_abbreviations

    passed = 0
    failed = 0
    failures = []

    rewrite_cases = [tc for tc in test_cases if tc.get("rewrite_should_contain")]
    if not rewrite_cases:
        return 0, 0, []

    for tc in rewrite_cases:
        input_text = tc["input"]
        expected_words = tc["rewrite_should_contain"]
        rewritten = expand_abbreviations(input_text)

        all_found = True
        missing = []
        for word in expected_words:
            if word.lower() not in rewritten.lower():
                all_found = False
                missing.append(word)

        if all_found:
            passed += 1
            print(f"  [PASS] {input_text!r} -> {rewritten!r}")
        else:
            failed += 1
            failures.append(
                f"  FAIL rewrite: {input_text!r} missing {missing} in {rewritten!r}"
            )
            print(f"  [FAIL] {input_text!r} -> {rewritten!r} (missing {missing})")

    return passed, failed, failures


def main():
    # Load test cases
    test_dir = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(test_dir, "test_cases.json")) as f:
        test_cases = json.load(f)

    total_passed = 0
    total_failed = 0
    all_failures = []

    print("\n=== Intent Classification Tests ===")
    p, f, fails = run_intent_tests(test_cases)
    total_passed += p
    total_failed += f
    all_failures.extend(fails)

    print("\n=== Abbreviation Expansion Tests ===")
    p, f, fails = run_abbreviation_tests()
    total_passed += p
    total_failed += f
    all_failures.extend(fails)

    print("\n=== Query Rewrite Quality Tests ===")
    p, f, fails = run_rewrite_tests(test_cases)
    total_passed += p
    total_failed += f
    all_failures.extend(fails)

    print(f"\n{'='*50}")
    print(f"Results: {total_passed} passed, {total_failed} failed, "
          f"{total_passed + total_failed} total")

    if all_failures:
        print("\nFailures:")
        for fail in all_failures:
            print(fail)
        sys.exit(1)
    else:
        print("\nAll tests passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
