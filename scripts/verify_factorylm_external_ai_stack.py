#!/usr/bin/env python3
"""Verify the FactoryLM external AI SDK/API/MCP conveyor stack.

This is an evidence harness, not a happy-path smoke test. It reports failures
when a layer is missing, a response is empty/static-looking, or unsafe tools are
exposed.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import uvicorn

REPO = Path(__file__).resolve().parents[1]
MCP_ROOT = REPO / "mira-mcp"
REPORT_PATH = REPO / "docs" / "external-ai" / "verification-report.md"

sys.path.insert(0, str(MCP_ROOT))

from factorylm_external_ai.api_adapter import create_api_app  # noqa: E402
from factorylm_external_ai.conveyor_context import ConveyorContextSDK  # noqa: E402
from factorylm_external_ai.mcp_server import TOOL_NAMES, build_mcp_toolset  # noqa: E402

UNSAFE_TERMS = (
    "start",
    "stop",
    "write",
    "modify",
    "delete",
    "sql",
    "dump",
    "bypass",
    "control",
    "reset",
)

PLACEHOLDER_TERMS = (
    "todo",
    "tbd",
    "placeholder",
    "lorem ipsum",
    "fake fixture",
    "mock response",
    "hardcoded demo text",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Print full JSON report")
    args = parser.parse_args()

    report: dict[str, Any] = {
        "goal": "Prove FactoryLM external AI SDK -> API -> MCP conveyor stack",
        "final_status": "FAIL",
        "sdk": {},
        "api": {},
        "mcp": {},
        "end_to_end": {},
        "failed_checks": [],
    }

    report["sdk"] = verify_sdk()
    report["api"] = verify_api(report["sdk"])
    report["mcp"] = verify_mcp()
    report["end_to_end"] = summarize_end_to_end(report)
    report["failed_checks"] = collect_failures(report)
    report["final_status"] = "PASS" if not report["failed_checks"] else "FAIL"

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(render_markdown(report), encoding="utf-8")

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"FactoryLM External AI stack verification: {report['final_status']}")
        print(f"Report: {REPORT_PATH}")
        for failure in report["failed_checks"]:
            print(f"FAIL: {failure}")
    return 0 if report["final_status"] == "PASS" else 1


def verify_sdk() -> dict[str, Any]:
    sdk = ConveyorContextSDK()
    checks: list[dict[str, Any]] = []

    checks.append(run_call("find_asset", {"query": "conveyor"}, lambda: sdk.find_asset("conveyor")))
    asset_id = output_value(checks[-1], "asset_id") or "conveyor_1"
    checks.append(
        run_call(
            "get_asset_context",
            {"asset_id": asset_id},
            lambda: sdk.get_asset_context(asset_id),
            validators=[response_has_required_context],
        )
    )
    checks.append(
        run_call(
            "list_asset_tags",
            {"asset_id": asset_id},
            lambda: sdk.list_asset_tags(asset_id),
            validators=[response_has_required_context, response_has_tags],
        )
    )
    checks.append(
        run_call(
            "search_evidence",
            {"asset_id": asset_id, "query": "VFD photoeye"},
            lambda: sdk.search_evidence(asset_id, "VFD photoeye"),
            validators=[response_has_evidence_metadata],
        )
    )
    checks.append(
        run_call(
            "get_diagnostic_context",
            {"asset_id": asset_id},
            lambda: sdk.get_diagnostic_context(asset_id),
            validators=[response_has_diagnostics],
        )
    )
    checks.append(
        run_call(
            "get_live_value",
            {"tag_id": "default_conveyor_motor_running"},
            lambda: sdk.get_live_value("default_conveyor_motor_running"),
            allow_not_available=True,
        )
    )
    checks.append(
        run_call(
            "missing_asset",
            {"query": "not-a-real-asset"},
            lambda: sdk.find_asset("not-a-real-asset"),
            expect_status="not_found",
        )
    )
    return section("SDK", checks)


def verify_api(sdk_report: dict[str, Any]) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    sdk = ConveyorContextSDK()
    app = create_api_app(sdk)
    route_paths = [getattr(route, "path", "") for route in app.routes]
    checks.append(
        check_result(
            "api_routes_read_only",
            not exposed_unsafe_names(route_paths),
            {"routes": route_paths, "unsafe": exposed_unsafe_names(route_paths)},
        )
    )

    port = free_port()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{port}"
    try:
        wait_for_http(f"{base_url}/health")
        http_calls = [
            ("asset_search", "GET", "/api/external-ai/assets/search", {"q": "conveyor"}),
            ("asset_context", "GET", "/api/external-ai/assets/conveyor_1/context", {}),
            ("asset_tags", "GET", "/api/external-ai/assets/conveyor_1/tags", {}),
            ("evidence_search", "GET", "/api/external-ai/assets/conveyor_1/evidence", {"q": "VFD"}),
            ("diagnostic_context", "GET", "/api/external-ai/assets/conveyor_1/diagnostics", {}),
            ("live_value", "GET", "/api/external-ai/live/default_conveyor_motor_running", {}),
            ("missing_asset", "GET", "/api/external-ai/assets/search", {"q": "not-a-real-asset"}),
        ]
        with httpx.Client(timeout=5) as client:
            for name, method, path, params in http_calls:
                response = client.request(method, f"{base_url}{path}", params=params)
                body = safe_json(response)
                expected = 404 if name == "missing_asset" else 200
                if name == "live_value":
                    expected = 200
                checks.append(
                    check_result(
                        name,
                        response.status_code == expected and not contains_placeholder_text(body),
                        {
                            "input": {"method": method, "path": path, "params": params},
                            "http_status": response.status_code,
                            "output": body,
                        },
                    )
                )
        sdk_asset_id = first_ok_output(sdk_report, "find_asset", "asset_id")
        api_asset_id = first_ok_output({"checks": checks}, "asset_search", "asset_id")
        checks.append(
            check_result(
                "api_wraps_sdk_consistently",
                sdk_asset_id == api_asset_id == "conveyor_1",
                {"sdk_asset_id": sdk_asset_id, "api_asset_id": api_asset_id},
            )
        )
    except Exception as exc:
        checks.append(check_result("api_server_runtime", False, {"error": repr(exc)}))
    finally:
        server.should_exit = True
        thread.join(timeout=5)
    return section("API", checks)


def verify_mcp() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    sdk = ConveyorContextSDK()
    toolset = build_mcp_toolset(sdk)
    checks.append(
        check_result(
            "mcp_metadata_tools_declared",
            set(toolset) == set(TOOL_NAMES),
            {"tools": sorted(toolset)},
        )
    )
    checks.append(
        check_result(
            "mcp_metadata_read_only",
            not exposed_unsafe_names(toolset.keys())
            and all(t["annotations"]["readOnlyHint"] for t in toolset.values()),
            {"unsafe": exposed_unsafe_names(toolset.keys())},
        )
    )
    checks.append(
        run_call(
            "mcp_metadata_callable",
            {"tool": "factorylm_find_asset", "query": "conveyor"},
            lambda: toolset["factorylm_find_asset"]["handler"](query="conveyor"),
            validators=[response_has_required_context],
        )
    )

    if importlib.util.find_spec("fastmcp") is None:
        checks.append(
            check_result(
                "mcp_server_runtime",
                False,
                {
                    "error": "fastmcp is not installed in the active Python environment",
                    "remediation": "python -m pip install -r mira-mcp/requirements.txt",
                },
            )
        )
        return section("MCP", checks)

    port = free_port()
    env = {
        **dict(**__import__("os").environ),
        "FACTORYLM_EXTERNAL_AI_PORT": str(port),
        "FACTORYLM_EXTERNAL_AI_HOST": "127.0.0.1",
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "factorylm_external_ai.mcp_server"],
        cwd=MCP_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        url = f"http://127.0.0.1:{port}/mcp"
        mcp_result = asyncio.run(call_mcp_server(url))
        checks.extend(mcp_result)
    except Exception as exc:
        stderr = ""
        if proc.stderr:
            try:
                stderr = proc.stderr.read(1000)
            except Exception:
                stderr = ""
        checks.append(check_result("mcp_server_runtime", False, {"error": repr(exc), "stderr": stderr}))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    return section("MCP", checks)


async def call_mcp_server(url: str) -> list[dict[str, Any]]:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    deadline = time.time() + 12
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            async with streamablehttp_client(url) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools_result = await session.list_tools()
                    tool_names = sorted(tool.name for tool in tools_result.tools)
                    call_result = await session.call_tool(
                        "factorylm_find_asset",
                        {"query": "conveyor"},
                    )
                    structured = getattr(call_result, "structuredContent", None)
                    payload = {
                        "tools": tool_names,
                        "call_result": structured if structured is not None else repr(call_result),
                    }
                    return [
                        check_result("mcp_server_starts_and_lists_tools", set(TOOL_NAMES).issubset(tool_names), payload),
                        check_result("mcp_tool_callable_over_client", call_result is not None, payload),
                    ]
        except Exception as exc:
            last_error = exc
            await asyncio.sleep(0.3)
    raise RuntimeError(f"MCP server did not become callable: {last_error!r}")


def summarize_end_to_end(report: dict[str, Any]) -> dict[str, Any]:
    sdk_sample = first_ok_output(report["sdk"], "get_asset_context")
    api_sample = first_ok_output(report["api"], "asset_context")
    mcp_sample = first_ok_output(report["mcp"], "mcp_metadata_callable")
    checks = [
        check_result(
            "sample_conveyor_response_present",
            all([sdk_sample, api_sample, mcp_sample]),
            {"sdk": sdk_sample, "api": api_sample, "mcp": mcp_sample},
        ),
        check_result(
            "evidence_or_citations_present",
            response_has_evidence_metadata(sdk_sample or {}) and response_has_diagnostics(first_ok_output(report["sdk"], "get_diagnostic_context") or {}),
            {},
        ),
        check_result(
            "safety_read_only",
            not exposed_unsafe_names(TOOL_NAMES),
            {"tools": TOOL_NAMES},
        ),
    ]
    return section("End-to-end", checks)


def run_call(
    name: str,
    input_data: dict[str, Any],
    fn: Callable[[], dict[str, Any]],
    validators: list[Callable[[dict[str, Any]], bool]] | None = None,
    expect_status: str = "ok",
    allow_not_available: bool = False,
) -> dict[str, Any]:
    try:
        output = fn()
        valid_statuses = {expect_status}
        if allow_not_available:
            valid_statuses.add("not_available")
        passed = (
            isinstance(output, dict)
            and bool(output)
            and output.get("status") in valid_statuses
            and not contains_placeholder_text(output)
        )
        for validator in validators or []:
            passed = passed and validator(output)
        return check_result(
            name,
            passed,
            {
                "input": input_data,
                "output": output,
                "approval_status": output.get("approval_status") if isinstance(output, dict) else None,
                "warnings": output.get("warnings") if isinstance(output, dict) else None,
            },
        )
    except Exception as exc:
        return check_result(name, False, {"input": input_data, "error": repr(exc)})


def section(name: str, checks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": name,
        "status": "PASS" if all(check["pass"] for check in checks) else "FAIL",
        "checks": checks,
    }


def check_result(name: str, passed: bool, details: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "pass": bool(passed), "details": details}


def contains_placeholder_text(value: Any) -> bool:
    text = json.dumps(value, sort_keys=True).lower() if not isinstance(value, str) else value.lower()
    return any(term in text for term in PLACEHOLDER_TERMS)


def response_has_required_context(value: dict[str, Any]) -> bool:
    return bool(value and value.get("asset_id") and value.get("uns_path"))


def response_has_tags(value: dict[str, Any]) -> bool:
    return bool(value.get("tags"))


def response_has_evidence_metadata(value: dict[str, Any]) -> bool:
    evidence = value.get("evidence") or value.get("related_documents") or []
    return bool(evidence) and all(item.get("source_url") and item.get("approval_status") for item in evidence)


def response_has_diagnostics(value: dict[str, Any]) -> bool:
    diagnostics = value.get("diagnostics") or []
    return bool(diagnostics) and all(item.get("citation_ids") for item in diagnostics)


def exposed_unsafe_names(names: Any) -> list[str]:
    unsafe: list[str] = []
    for name in names:
        name_l = str(name).lower()
        if any(term in name_l for term in UNSAFE_TERMS):
            unsafe.append(str(name))
    return unsafe


def output_value(check: dict[str, Any], key: str) -> Any:
    output = check.get("details", {}).get("output")
    return output.get(key) if isinstance(output, dict) else None


def first_ok_output(section_report: dict[str, Any], check_name: str, key: str | None = None) -> Any:
    for check in section_report.get("checks", []):
        if check.get("name") == check_name and check.get("pass"):
            output = check.get("details", {}).get("output")
            if key is None:
                return output
            return output.get(key) if isinstance(output, dict) else None
    return None


def safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return {"non_json_body": response.text[:500]}


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_http(url: str) -> None:
    deadline = time.time() + 10
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            response = httpx.get(url, timeout=1)
            if response.status_code < 500:
                return
        except Exception as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"HTTP server did not become ready: {last_error!r}")


def collect_failures(report: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for section_name in ("sdk", "api", "mcp", "end_to_end"):
        for check in report[section_name].get("checks", []):
            if not check["pass"]:
                failures.append(f"{section_name}.{check['name']}: {check['details']}")
    return failures


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# FactoryLM External AI Verification Report",
        "",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S %Z')}",
        f"Final status: **{report['final_status']}**",
        "",
        "## How To Run",
        "",
        "```powershell",
        "python scripts/verify_factorylm_external_ai_stack.py",
        "```",
        "",
        "Optional full JSON:",
        "",
        "```powershell",
        "python scripts/verify_factorylm_external_ai_stack.py --json",
        "```",
        "",
        "## Services Required",
        "",
        "- SDK proof: no external service.",
        "- API proof: the script starts a local uvicorn server around the SDK API adapter.",
        "- MCP proof: requires `fastmcp` in the active Python environment. Install with `python -m pip install -r mira-mcp/requirements.txt`.",
        "- Live values: optional. Without a real approved live read path or `FACTORYLM_LIVE_VALUES_JSON`, live-value checks are reported as not available.",
        "",
        "## Results",
        "",
    ]
    for key in ("sdk", "api", "mcp", "end_to_end"):
        section_report = report[key]
        lines.extend([f"### {section_report['name']}: {section_report['status']}", ""])
        for check in section_report["checks"]:
            mark = "PASS" if check["pass"] else "FAIL"
            lines.append(f"- **{mark}** `{check['name']}`")
            lines.append("")
            lines.append("```json")
            lines.append(json.dumps(check["details"], indent=2, sort_keys=True))
            lines.append("```")
            lines.append("")
    lines.extend(["## Failed Checks", ""])
    if report["failed_checks"]:
        for failure in report["failed_checks"]:
            lines.append(f"- {failure}")
    else:
        lines.append("- None")
    lines.extend(
        [
            "",
            "## Known Failures / Next Steps",
            "",
            "- If MCP runtime fails because `fastmcp` is missing, install `mira-mcp/requirements.txt` and rerun.",
            "- Replace env-injected demo live values with the approved `live_signal_cache` read path.",
            "- Run the same harness after exposing the MCP server through HTTPS for ChatGPT connector testing.",
        ]
    )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
