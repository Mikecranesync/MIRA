"""Regression gate for the Ignition 8.3 WebDev DEPLOYMENT contract.

These tests are OFFLINE. They prove the artifacts `ignition/tools/webdev_build.py`
generates match the contract established against a live 8.3.4 gateway; they do
NOT prove the gateway is working. Only the administrator-run probe
(`scratchpad/probe_format_matrix.ps1`) can do that, and its result is recorded
separately in the handoff. Nothing here talks to a gateway, a PLC, a fieldbus,
Neon, Doppler, or the network.

What went wrong, and what each test therefore pins:

* A WebDev resource directory holding only `doGet.py` returns
  `HTTP 500 No data found for resource`. -> the three-file tests.
* A comment-first, module-style handler returns `HTTP 200` with an EMPTY body,
  no log line, no stack trace. -> the def-first conversion tests. This is the
  dangerous one: it looks deployed and healthy.
* A helper file sitting beside a handler is not importable — inside a resource
  `sys.path` never contains the resource's own directory. -> the script-library
  placement tests.
* `deploy_ignition.ps1` installed project `ConveyorMIRA` while `allowlist.py`
  only searched `…/projects/factorylm/…`, so a scripted deploy wrote the
  allowlist where the loader never looked. -> the one-authoritative-location
  tests.
* An explicitly configured but unreadable `MIRA_ALLOWLIST_PATH` silently
  selected a *different* default allowlist. -> the fail-closed override tests.
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
WEBDEV_SRC = REPO_ROOT / "ignition" / "webdev"
TAGS_DIR = WEBDEV_SRC / "FactoryLM" / "api" / "tags"
DEPLOY_PS1 = REPO_ROOT / "ignition" / "deploy_ignition.ps1"

sys.path.insert(0, str(REPO_ROOT / "ignition" / "tools"))
sys.path.insert(0, str(TAGS_DIR))

import webdev_build as wb  # noqa: E402

import allowlist  # noqa: E402
import gateway_live_snapshot as gls  # noqa: E402

# There are EIGHT resource directories and NINE handlers: api/connect carries
# both doGet and doPost in one resource. Both numbers are asserted so neither
# can drift silently.
EXPECTED_RESOURCES = 8
EXPECTED_HANDLERS = 9
TIMESTAMP = "2026-07-31T00:00:00Z"


@pytest.fixture(scope="module")
def plan():
    return wb.plan_deployment(WEBDEV_SRC, WEBDEV_SRC)


@pytest.fixture(scope="module")
def deployed(tmp_path_factory, plan):
    project_dir = tmp_path_factory.mktemp("ConveyorMIRA")
    wb.apply_plan(plan, project_dir, TIMESTAMP)
    return project_dir


def _resource_dirs(project_dir: Path):
    root = project_dir / wb.WEBDEV_RESOURCE_ROOT
    return sorted(p for p in root.rglob("*") if p.is_dir() and (p / "config.json").is_file())


# --------------------------------------------------------------------------
# The plan covers everything, and nothing it should not
# --------------------------------------------------------------------------

class TestPlanCoverage:
    def test_every_endpoint_is_planned(self, plan):
        assert len(plan.resources) == EXPECTED_RESOURCES
        handlers = sum(len(r.methods) for r in plan.resources)
        assert handlers == EXPECTED_HANDLERS

    def test_plan_matches_the_handler_files_on_disk(self, plan):
        on_disk = {
            p for p in WEBDEV_SRC.rglob("*.py")
            if p.stem in wb.WEBDEV_METHODS and "__pycache__" not in p.parts
        }
        planned = {
            WEBDEV_SRC / r.resource_path / ("%s.py" % m)
            for r in plan.resources for m in r.methods
        }
        assert planned == on_disk

    def test_build_artifacts_never_reach_a_resource(self, deployed):
        strays = [
            p for p in (deployed / wb.WEBDEV_RESOURCE_ROOT).rglob("*")
            if p.suffix == ".pyc" or "__pycache__" in p.parts
        ]
        assert strays == []


# --------------------------------------------------------------------------
# Three files, correct keys — the HTTP-500 class
# --------------------------------------------------------------------------

class TestResourceManifests:
    def test_every_resource_has_the_three_required_files(self, deployed):
        dirs = _resource_dirs(deployed)
        assert len(dirs) == EXPECTED_RESOURCES
        for d in dirs:
            assert (d / "resource.json").is_file(), "%s has no manifest" % d
            assert (d / "config.json").is_file(), "%s has no config" % d
            methods = sorted(p.stem for p in d.glob("*.py"))
            assert methods, "%s has no handler" % d
            assert all(m in wb.WEBDEV_METHODS for m in methods)

    def test_generated_json_is_valid_for_every_endpoint(self, deployed):
        for d in _resource_dirs(deployed):
            for name in ("resource.json", "config.json"):
                json.loads((d / name).read_text(encoding="utf-8"))

    def test_resource_json_files_array_lists_exactly_the_data_keys(self, deployed):
        """`files` IS the data-key list. A method file missing from it does not
        exist to the dispatcher — the original HTTP 500."""
        for d in _resource_dirs(deployed):
            manifest = json.loads((d / "resource.json").read_text(encoding="utf-8"))
            on_disk = sorted(p.name for p in d.iterdir() if p.name != "resource.json")
            assert sorted(manifest["files"]) == on_disk
            assert manifest["scope"] == "G"
            assert manifest["version"] == 1
            assert manifest["attributes"]["lastModification"]["timestamp"] == TIMESTAMP

    def test_config_json_declares_the_type_and_every_method(self, deployed):
        for d in _resource_dirs(deployed):
            config = json.loads((d / "config.json").read_text(encoding="utf-8"))
            assert config["resource-type"] == wb.PYTHON_RESOURCE_TYPE
            methods = sorted(p.stem for p in d.glob("*.py"))
            declared = sorted(k for k in config if k != "resource-type")
            assert declared == methods, "%s: config/method mismatch" % d

    def test_config_json_uses_kebab_case_keys(self, deployed):
        """MethodObject$GsonAdapter serialises kebab-case, not the lowerCamel
        Java field names. lowerCamel keys are silently ignored."""
        expected = {
            "enabled", "require-https", "require-auth",
            "user-source", "required-roles", "max-retry-attempts",
        }
        for d in _resource_dirs(deployed):
            config = json.loads((d / "config.json").read_text(encoding="utf-8"))
            for method, block in config.items():
                if method == "resource-type":
                    continue
                assert set(block) == expected, "%s/%s" % (d, method)
                assert block["enabled"] is True

    def test_redeploy_is_byte_identical(self, plan, tmp_path):
        """An unstable manifest makes every deploy look like a change."""
        a, b = tmp_path / "a", tmp_path / "b"
        wb.apply_plan(plan, a, TIMESTAMP)
        wb.apply_plan(plan, b, TIMESTAMP)
        for pa in sorted(a.rglob("*")):
            if pa.is_file():
                pb = b / pa.relative_to(a)
                assert pa.read_bytes() == pb.read_bytes()


# --------------------------------------------------------------------------
# Def-first bodies — the silent HTTP-200-empty-body class
# --------------------------------------------------------------------------

class TestHandlerConversion:
    def test_every_deployed_handler_is_def_first_and_compiles(self, deployed):
        seen = 0
        for d in _resource_dirs(deployed):
            for f in sorted(d.glob("*.py")):
                src = f.read_text(encoding="utf-8")
                assert src.startswith("def %s(request, session):" % f.stem), (
                    "%s is not def-first — on 8.3 that returns HTTP 200 with an "
                    "empty body and logs nothing" % f
                )
                compile(src, str(f), "exec")
                tree = ast.parse(src)
                assert len(tree.body) == 1
                assert isinstance(tree.body[0], ast.FunctionDef)
                assert tree.body[0].name == f.stem
                seen += 1
        assert seen == EXPECTED_HANDLERS

    def test_raw_module_style_sources_are_never_shipped(self, deployed):
        """The repo sources are comment-first; the deployed bodies must not be."""
        for d in _resource_dirs(deployed):
            for f in d.glob("*.py"):
                first = f.read_text(encoding="utf-8").splitlines()[0]
                assert not first.lstrip().startswith("#")

    def test_module_level_helpers_after_the_handler_survive(self):
        """api/connect/doPost.py defines helpers AFTER the handler; a naive
        'everything below the def is the body' split would drop or mis-indent
        them."""
        src = (WEBDEV_SRC / "FactoryLM/api/connect/doPost.py").read_text(encoding="utf-8")
        out = wb.convert_handler(src, "doPost")
        assert "_get_config" in out and "_write_config" in out
        compile(out, "<doPost>", "exec")

    def test_comment_header_is_preserved_inside_the_body(self):
        src = (WEBDEV_SRC / "FactoryLM/api/status/doGet.py").read_text(encoding="utf-8")
        out = wb.convert_handler(src, "doGet")
        assert "Web Dev Module Handler" in out

    def test_conversion_rejects_a_wrong_signature(self):
        with pytest.raises(wb.ConversionError):
            wb.convert_handler("def doGet(req):\n    return {}\n", "doGet")

    def test_conversion_rejects_a_missing_handler(self):
        with pytest.raises(wb.ConversionError):
            wb.convert_handler("x = 1\n", "doGet")

    def test_conversion_rejects_two_handlers(self):
        src = (
            "def doGet(request, session):\n    return {}\n"
            "def doGet(request, session):\n    return {}\n"
        )
        with pytest.raises(wb.ConversionError):
            wb.convert_handler(src, "doGet")


# --------------------------------------------------------------------------
# Helpers go to the script library, never beside a handler
# --------------------------------------------------------------------------

class TestScriptLibraryPlacement:
    def test_helpers_are_deployed_as_script_library_modules(self, deployed):
        for name in wb.SCRIPT_LIBRARY_MODULES:
            d = deployed / wb.SCRIPT_LIBRARY_ROOT / name
            assert (d / "code.py").is_file(), "%s not in the script library" % name
            manifest = json.loads((d / "resource.json").read_text(encoding="utf-8"))
            assert manifest["files"] == ["code.py"]
            assert manifest["scope"] == "G"

    def test_no_helper_lands_beside_a_webdev_handler(self, deployed):
        """Inside a WebDev resource, sys.path never contains the resource's own
        directory — a sibling helper is dead weight that cannot be imported."""
        for d in _resource_dirs(deployed):
            non_methods = [p.stem for p in d.glob("*.py") if p.stem not in wb.WEBDEV_METHODS]
            assert non_methods == [], "%s ships un-importable helpers %s" % (d, non_methods)

    def test_handlers_import_helpers_as_flat_top_level_names(self, deployed):
        """The proven route: script-library modules resolve as bare names."""
        chat = deployed / wb.WEBDEV_RESOURCE_ROOT / "FactoryLM/api/chat/doPost.py"
        src = chat.read_text(encoding="utf-8")
        assert "from signing import build_headers" in src
        assert "from gateway_live_snapshot import" in src


# --------------------------------------------------------------------------
# One authoritative allowlist location, used by deploy AND loader
# --------------------------------------------------------------------------

class TestAllowlistLocation:
    def test_deploy_script_writes_the_loader_relpath(self):
        """The deploy step and the loader must not drift. If this fails, a
        scripted deploy is writing the allowlist somewhere nothing reads."""
        ps1 = DEPLOY_PS1.read_text(encoding="utf-8")
        assert allowlist.RUNTIME_ALLOWLIST_RELPATH in ps1.replace("\\", "/")

    def test_no_default_path_encodes_a_project_name(self):
        """`…/data/projects/<project>/approved_tags.json` is the bug: the deploy
        installs ConveyorMIRA, the bench project is FactoryLMCollector, and the
        old default searched a project called `factorylm` that never existed."""
        for p in allowlist._DEFAULT_PATHS:
            assert "/projects/" not in p.replace("\\", "/"), p

    def test_deployed_project_allowlist_path_resolves(self, tmp_path, monkeypatch):
        data_dir = tmp_path / "Ignition" / "data"
        target = data_dir / allowlist.RUNTIME_ALLOWLIST_RELPATH
        target.parent.mkdir(parents=True)
        target.write_text(json.dumps({"tags": ["[default]Conveyor/Motor_Running"]}))

        monkeypatch.delenv("MIRA_ALLOWLIST_PATH", raising=False)
        monkeypatch.setattr(
            allowlist, "_DEFAULT_PATHS", ["%s/%s" % (data_dir.as_posix(),
                                                     allowlist.RUNTIME_ALLOWLIST_RELPATH)]
        )
        resolved = allowlist.resolve_allowlist_path()
        assert resolved is not None
        assert Path(resolved).resolve() == target.resolve()
        assert allowlist.load_allowlist(resolved) == {"[default]Conveyor/Motor_Running"}


# --------------------------------------------------------------------------
# A configured-but-unreadable override fails closed
# --------------------------------------------------------------------------

class TestExplicitOverrideFailsClosed:
    @pytest.fixture(autouse=True)
    def _reset_cache(self):
        allowlist.reload_allowlist()
        yield
        allowlist.reload_allowlist()

    def test_missing_override_raises_instead_of_falling_through(self, tmp_path, monkeypatch):
        decoy = tmp_path / "decoy.json"
        decoy.write_text(json.dumps({"tags": ["[default]Conveyor/Motor_Running"]}))
        monkeypatch.setattr(allowlist, "_DEFAULT_PATHS", [str(decoy)])
        monkeypatch.setenv("MIRA_ALLOWLIST_PATH", str(tmp_path / "does-not-exist.json"))

        with pytest.raises(allowlist.AllowlistError):
            allowlist.resolve_allowlist_path()

    def test_missing_override_does_not_select_a_different_allowlist(self, tmp_path, monkeypatch):
        decoy = tmp_path / "decoy.json"
        decoy.write_text(json.dumps({"tags": ["[default]Conveyor/Motor_Running"]}))
        monkeypatch.setattr(allowlist, "_DEFAULT_PATHS", [str(decoy)])
        monkeypatch.setenv("MIRA_ALLOWLIST_PATH", str(tmp_path / "does-not-exist.json"))

        assert allowlist.is_allowed_tag("[default]Conveyor/Motor_Running") is False

    def test_invalid_override_yields_no_snapshot(self, tmp_path, monkeypatch):
        """End to end through the canonical adapter: readable tags, valid decoy
        allowlist on the default path, bad explicit override => EMPTY snapshot
        and allowlist_loaded False, not a snapshot filtered by the decoy."""
        decoy = tmp_path / "decoy.json"
        decoy.write_text(json.dumps({"tags": ["[default]Mira_Monitored/CV-101/Motor_Running"]}))
        monkeypatch.setattr(allowlist, "_DEFAULT_PATHS", [str(decoy)])
        monkeypatch.setenv("MIRA_ALLOWLIST_PATH", str(tmp_path / "nope.json"))

        class _Tag:
            fullPath = "[default]Mira_Monitored/CV-101/Motor_Running"

        class _QV:
            value = True
            quality = "Good"
            timestamp = "2026-07-31T00:00:00Z"

        snapshot, stats = gls.collect_live_snapshot(
            lambda folder: [_Tag()],
            lambda paths: [_QV()],
            "CV-101",
        )
        assert snapshot == {}
        assert stats["allowlist_loaded"] is False
        assert stats["read"] == 1
        assert stats["allowed"] == 0

    def test_unset_override_still_uses_the_defaults(self, tmp_path, monkeypatch):
        """The strictness must not break the normal path."""
        good = tmp_path / "approved_tags.json"
        good.write_text(json.dumps({"tags": ["[default]Conveyor/Motor_Running"]}))
        monkeypatch.setattr(allowlist, "_DEFAULT_PATHS", [str(good)])
        monkeypatch.delenv("MIRA_ALLOWLIST_PATH", raising=False)

        assert allowlist.resolve_allowlist_path() == str(good)
        assert allowlist.is_allowed_tag("[default]Conveyor/Motor_Running") is True


# --------------------------------------------------------------------------
# Read-only: the deploy tooling itself must never write to OT
# --------------------------------------------------------------------------

class TestDeployScriptIsRunnable:
    def test_deploy_script_is_pure_ascii(self):
        """A deploy script that does not parse cannot deploy anything.

        `deploy_ignition.ps1` had 22 UTF-8 em-dashes and no BOM. Windows
        PowerShell 5.1 defaults to Windows-1252 for a BOM-less file, so each
        em-dash decoded to `a-tilde/euro/quote` — and that embedded quote
        terminated a string literal. The parser reported SEVEN errors on
        origin/main: the script was unrunnable, which is a large part of why the
        WebDev deployment contract was never exercised. ASCII-only sidesteps the
        whole encoding question without adding a BOM.
        """
        raw = DEPLOY_PS1.read_bytes()
        non_ascii = sorted({b for b in raw if b > 127})
        assert non_ascii == [], (
            "deploy_ignition.ps1 contains non-ASCII bytes %r; under PowerShell "
            "5.1 without a BOM these mis-decode and can break string literals"
            % non_ascii
        )

    def test_deploy_script_refuses_to_clobber_a_live_project(self):
        ps1 = DEPLOY_PS1.read_text(encoding="ascii")
        assert "REFUSING" in ps1
        assert "$Force" in ps1

    def test_deploy_script_prints_project_qualified_webdev_urls(self):
        """A WebDev URL is /system/webdev/<PROJECT>/<RESOURCE PATH>. The old
        script printed /system/webdev/FactoryLM/..., reading the resource-path
        root as the project name, so every printed URL 404'd.

        The negative half is asserted against CODE ONLY. Checked against the raw
        text it fired on the comment that *describes* the old broken URL — a
        guard reading prose rather than behaviour, which is the same defect
        #3018 caught by mutation-testing its own guards.
        """
        ps1 = DEPLOY_PS1.read_text(encoding="ascii")
        code = "\n".join(
            ln for ln in ps1.splitlines() if not ln.lstrip().startswith("#")
        )
        assert "/system/webdev/$ProjectName/FactoryLM/" in code
        assert "/system/webdev/FactoryLM/" not in code

    def test_url_guard_is_not_vacuous(self):
        """Mutation check: the guard above must fail on a reintroduced bad URL."""
        code = 'Write-Host "$GatewayUrl/system/webdev/FactoryLM/api/status"'
        stripped = "\n".join(
            ln for ln in code.splitlines() if not ln.lstrip().startswith("#")
        )
        assert "/system/webdev/FactoryLM/" in stripped


class TestNoUnguardedDunderFile:
    """`__file__` is undefined in a WebDev resource. Unguarded, it is an
    uncaught NameError, i.e. HTTP 500 on every call to that endpoint."""

    def test_every_dunder_file_use_is_guarded(self):
        offenders = []
        for path in sorted(WEBDEV_SRC.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            src = path.read_text(encoding="utf-8")
            if "__file__" not in src:
                continue
            tree = ast.parse(src)
            for node in ast.walk(tree):
                if not (isinstance(node, ast.Name) and node.id == "__file__"):
                    continue
                if not _inside_try_handling_nameerror(tree, node):
                    offenders.append("%s:%s" % (path.name, node.lineno))
        assert offenders == [], (
            "unguarded __file__ (NameError -> HTTP 500 on a Gateway): %s" % offenders
        )


def _inside_try_handling_nameerror(tree: ast.AST, target: ast.AST) -> bool:
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        if not any(target is n for n in ast.walk(node) if isinstance(n, ast.Name)):
            continue
        for handler in node.handlers:
            if handler.type is None:
                return True
            names = (
                [handler.type.id] if isinstance(handler.type, ast.Name)
                else [e.id for e in getattr(handler.type, "elts", []) if isinstance(e, ast.Name)]
            )
            if "NameError" in names or "Exception" in names or "BaseException" in names:
                return True
    return False


class TestReadOnly:
    def test_build_tool_has_no_tag_or_fieldbus_write(self):
        src = (REPO_ROOT / "ignition" / "tools" / "webdev_build.py").read_text(encoding="utf-8")
        for forbidden in ("system.tag.write", "writeBlocking", "writeAsync",
                          "pymodbus", "pycomm3", "opcua"):
            assert forbidden not in src, forbidden
