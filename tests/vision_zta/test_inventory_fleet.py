import importlib.util
import json
import subprocess
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[2] / "tools" / "vision_zta" / "inventory_fleet.py"
spec = importlib.util.spec_from_file_location("vision_zta_inventory_fleet", MODULE_PATH)
inventory_fleet = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(inventory_fleet)


def test_load_targets_uses_network_yaml_and_adds_vps_fallback(tmp_path):
    network = tmp_path / "network.yml"
    network.write_text(
        """
nodes:
  alpha:
    hostname: alpha.local
    role: orchestrator
    user: factorylm
    addresses:
      tailscale: 100.64.0.1
  bravo:
    hostname: bravo.local
    role: compute
    user: bravonode
    addresses:
      lan: 192.168.1.11
  charlie:
    hostname: charlie.local
    role: kb-host
    user: charlienode
    addresses:
      lan: 192.168.1.12
""",
        encoding="utf-8",
    )

    targets = inventory_fleet.load_targets(network)

    assert list(targets) == ["alpha", "bravo", "charlie", "vps"]
    assert targets["charlie"]["role"] == "kb-host"
    assert targets["vps"]["role"] == "production-ingress"
    assert targets["vps"]["addresses"]["tailscale"] == "100.68.120.99"


def test_probe_body_is_read_only_and_secret_safe():
    body = inventory_fleet.build_remote_probe_body()

    forbidden = [
        "doppler",
        "printenv",
        "env ",
        "docker compose up",
        "docker compose down",
        "restart",
        "rm -",
        "psql",
    ]
    lowered = body.lower()
    assert all(term not in lowered for term in forbidden)
    assert "ollama list" in body
    assert "colima status" in body
    assert "tesseract --version" in body
    assert "/opt/homebrew/bin" in body
    assert "importlib.util.find_spec" in body
    assert "command -v vm_stat" in body
    assert "command -v system_profiler" in body


def test_render_markdown_keeps_unreachable_nodes_unknown():
    results = [
        {
            "node_id": "charlie",
            "role": "kb-host",
            "status": "ok",
            "collected_at": "2026-07-18T12:00:00Z",
            "configured": {"hostname": "CharlieNodes-Mac-mini.local"},
            "facts": {
                "hostname": "CharlieNodes-Mac-mini.local",
                "os": "macOS 15.5",
                "architecture": "arm64",
                "memory_total_bytes": "17179869184",
                "disk_root": "228Gi 101Gi 127Gi 45% /",
                "ollama_models": "nomic-embed-text:latest\nqwen2.5vl:7b",
                "docker": "Docker version 28.0.4",
                "colima": "colima is running",
                "paddleocr": "missing",
                "mlx": "missing",
            },
        },
        {
            "node_id": "bravo",
            "role": "compute",
            "status": "unreachable",
            "collected_at": "2026-07-18T12:00:00Z",
            "configured": {"hostname": "FactoryLM-Bravo.local"},
            "error": "ssh timed out",
            "facts": {},
        },
    ]

    report = inventory_fleet.render_markdown(results, title_date="2026-07-18")

    assert "# Vision ZTA fleet inventory - 2026-07-18" in report
    assert "| charlie | kb-host | ok |" in report
    assert "| bravo | compute | unreachable | UNKNOWN | UNKNOWN | UNKNOWN |" in report
    assert "document OCR/layout, embeddings/retrieval, batch corpus work" in report
    assert "Resource-gated next actions" in report
    assert "qwen2.5vl:7b" in report
    assert "ssh timed out" in report
    assert all(line == line.rstrip() for line in report.splitlines())


def test_json_output_is_stable_and_parseable():
    result = {
        "node_id": "charlie",
        "role": "kb-host",
        "status": "ok",
        "collected_at": "2026-07-18T12:00:00Z",
        "configured": {"hostname": "CharlieNodes-Mac-mini.local"},
        "facts": {"hostname": "CharlieNodes-Mac-mini.local"},
    }

    encoded = inventory_fleet.dumps_json([result])

    parsed = json.loads(encoded)
    assert parsed[0]["node_id"] == "charlie"
    assert encoded.endswith("\n")


def test_vps_ssh_destination_uses_tailscale_address():
    target = {
        "user": "root",
        "addresses": {"tailscale": "100.68.120.99", "public": "165.245.138.91"},
    }

    assert inventory_fleet.ssh_destination("vps", target) == "root@100.68.120.99"


def test_summarize_ollama_tags_lists_model_names():
    payload = {
        "models": [
            {"name": "qwen2.5vl:7b"},
            {"model": "glm-ocr:latest"},
            {"name": "nomic-embed-text:latest"},
        ]
    }

    summary = inventory_fleet.summarize_ollama_tags("http://example/api/tags", payload)

    assert (
        summary
        == "http://example/api/tags => qwen2.5vl:7b, glm-ocr:latest, nomic-embed-text:latest"
    )


def test_probe_target_bounds_configured_ollama_probe_timeout(monkeypatch):
    class Completed:
        returncode = 0
        stdout = '{"hostname":"ci-runner"}\n'
        stderr = ""

    def fake_run(*args, **kwargs):
        assert kwargs["timeout"] == 8
        return Completed()

    seen = {}

    def fake_probe(target, *, timeout=4):
        seen["target"] = target
        seen["timeout"] = timeout
        return "unreachable"

    monkeypatch.setattr(inventory_fleet.subprocess, "run", fake_run)
    monkeypatch.setattr(inventory_fleet, "probe_configured_ollama", fake_probe)

    result = inventory_fleet.probe_target(
        "charlie",
        {
            "role": "kb-host",
            "addresses": {"tailscale": "100.70.49.126", "lan": "192.168.1.12"},
        },
        local_node="charlie",
        timeout=8,
    )

    assert result["status"] == "ok"
    assert result["facts"]["ollama_api_configured_address"] == "unreachable"
    assert seen["timeout"] <= 1.0


def test_shell_entrypoint_delegates_to_python_inventory():
    script = Path(__file__).resolve().parents[2] / "tools" / "vision_zta" / "inventory_fleet.sh"

    text = script.read_text(encoding="utf-8")

    assert "inventory_fleet.py" in text
    assert '"$@"' in text


def test_shell_entrypoint_runs_under_ambient_python3():
    script = Path(__file__).resolve().parents[2] / "tools" / "vision_zta" / "inventory_fleet.sh"

    cp = subprocess.run(
        [
            str(script),
            "--targets",
            "charlie",
            "--local-node",
            "charlie",
            "--timeout",
            "8",
            "--json",
        ],
        cwd=Path(__file__).resolve().parents[2],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=12,
    )

    assert cp.returncode == 0, cp.stderr
    parsed = json.loads(cp.stdout)
    assert parsed[0]["node_id"] == "charlie"
