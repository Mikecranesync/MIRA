"""Convert MIRA's WebDev handler SOURCES into Ignition 8.3 project resources.

Why this exists
---------------
`ignition/webdev/FactoryLM/**` is written as ordinary Python modules: a comment
header, some module-level helpers, then `def doGet(request, session):`. That is
a good source layout and it is what `tests/regime7_ignition/` loads with
`importlib`. It is **not** an Ignition 8.3 WebDev resource, and copying it onto a
gateway does not produce a working endpoint. Three separate reasons, all
confirmed on a live 8.3.4 gateway (see docs/integrations/ignition-tag-collector.md):

1. A WebDev python resource is a THREE-file directory —
   `resource.json` (the 8.3 project-resource manifest; its ``files`` array *is*
   the resource's data-key list), `config.json` (``resource-type`` plus one
   kebab-case object per HTTP method), and `<method>.py`. A directory holding
   only `doGet.py` yields ``HTTP 500 No data found for resource '<name>'``.

2. `<method>.py` must be a DEF-FIRST body. ``PythonResource.maybeRemoveDef``
   only strips a *leading* ``def``. A comment-first, module-style file is not
   rejected — it returns **HTTP 200 with an empty body**, no log line, no
   stack trace. That silent-success failure mode is why this was invisible for
   months, and it is the reason this module refuses to ship raw sources.

3. Helper modules are NOT importable from beside a handler. Inside a WebDev
   resource ``sys.path`` is only the gateway's pylib dirs; the resource's own
   directory is never on it, and ``__file__`` is undefined. Helpers must be
   deployed as project script-library modules
   (``ignition/script-python/<name>/code.py``), from which a handler imports
   them as flat top-level names. That route is proven; sibling files are not.

Gateway evidence (Ignition 8.3.4, WebDev 6.3.4, 2026-07-31)
-----------------------------------------------------------
Three resources, one gateway restart, ``GET`` each. This is why the emitted
shape is what it is — it is measured, not chosen::

    shape                                        result
    def on line 1, 4-space body                  HTTP 200  {"shape":"a"}      <- what this module emits
    comment header, then def at col 0            HTTP 200  len=0              <- the silent failure
    def on line 1 + module-level helper AFTER    HTTP 200  {"shape":"c",...}

So ``INDENT`` below is confirmed: four spaces works, and the tab used by an
earlier probe is not required. The middle row is the whole reason this module
exists — it is not an error the operator can see.

The third row shows the gateway ALSO accepts trailing module-level helpers, so
nesting them inside the handler is stricter than strictly necessary. It is kept
deliberately: one module-level statement is the only shape with no ordering or
dedent subtleties left to get wrong, and it is the shape row 1 proves.

Scope of that proof, stated plainly: the probe validates the *shape class* these
handlers are emitted in. It does not exercise the nine converted handlers
end-to-end — that needs a real deploy plus live calls against each endpoint.

So deployment is a CONVERSION, not a copy. This module is that conversion, kept
in Python (not PowerShell) precisely so it is unit-testable offline —
`tests/regime7_ignition/test_webdev_deploy_contract.py` exercises every function
here and validates the emitted JSON and handler bodies for all nine endpoints
without a gateway.

Read-only: this module reads repo sources and writes deployment artifacts. It
never touches a tag, a PLC, or a fieldbus.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# The eight method names Ignition's WebDev module recognises, from
# PythonResource.METHODS in webdev-common-6.3.4.jar. A file named after anything
# else in an endpoint directory is a helper module, not an HTTP method.
WEBDEV_METHODS = (
    "doGet",
    "doPost",
    "doPut",
    "doDelete",
    "doHead",
    "doOptions",
    "doTrace",
    "doPatch",
)

# The WebDev module's own resource-type discriminator, read by
# ProjectDispatcher/WebResourceEditor out of config.json.
PYTHON_RESOURCE_TYPE = "python-resource"

# Where WebDev resources live inside a project directory:
# WebDevModule.RESOURCE_TYPE = ResourceType("com.inductiveautomation.webdev", "resources")
WEBDEV_RESOURCE_ROOT = "com.inductiveautomation.webdev/resources"

# Where project script-library modules live inside a project directory.
SCRIPT_LIBRARY_ROOT = "ignition/script-python"

# Helper modules that must be deployed to the script library so handlers and the
# stream timer can import them as flat top-level names.
SCRIPT_LIBRARY_MODULES = (
    "signing",
    "allowlist",
    "collector",
    "gateway_live_snapshot",
)

# Body indent. Four spaces, matching the existing handler sources so a converted
# body keeps a single consistent indent unit (mixing a tab prefix with 4-space
# source lines is a Jython-2.7 tabnanny error waiting to happen).
INDENT = "    "

# PEP 263 coding cookies are FORBIDDEN in deployed artifacts — proven live.
#
# The encoding question is now settled by the gateway itself, in the direction
# opposite to the first guess. A cookied deployment on Ignition 8.3.4
# (2026-08-01) failed to compile EVERY handler with:
#
#   org.python.core.PySyntaxError: SyntaxError: encoding declaration in
#   Unicode string (<<MiraDeployTest/FactoryLM/api/status:doGet>>, line 0)
#   at com.inductiveautomation.ignition.common.script.ScriptManager
#      .compileFunction(ScriptManager.java:906)
#
# and the dispatcher answered HTTP 501 on every method. That error message is
# itself the load-bearing fact: the platform DECODES resource bytes to a
# unicode string before compiling (so undeclared non-ASCII UTF-8 is safe), and
# Python 2 *forbids* an encoding declaration inside an already-decoded unicode
# source. So the cookie is not "harmless either way" — it is a guaranteed
# SyntaxError on the only branch that exists. Emit valid UTF-8, no declaration,
# and strip any cookie a source may carry. _reject_cookie() enforces this at
# build time; tests pin it.
CODING_COOKIE_RE = re.compile(r"^[ \t\f]*#.*?coding[:=][ \t]*[-_.a-zA-Z0-9]+")


class ConversionError(Exception):
    """A source file cannot be converted into a valid WebDev resource."""


@dataclass
class WebDevResource:
    """One deployable WebDev endpoint."""

    resource_path: str            # e.g. "FactoryLM/api/chat"
    methods: dict[str, str] = field(default_factory=dict)   # method -> body source

    @property
    def files(self) -> list[str]:
        """resource.json's ``files`` array — config.json plus one file per method.

        Sorted so a redeploy is byte-identical when nothing changed; an unstable
        manifest would make every deploy look like a change.
        """
        return ["config.json"] + sorted("%s.py" % m for m in self.methods)


@dataclass
class ScriptModule:
    """One deployable project script-library module."""

    name: str
    source: str


@dataclass
class DeploymentPlan:
    resources: list[WebDevResource] = field(default_factory=list)
    modules: list[ScriptModule] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Handler conversion
# ---------------------------------------------------------------------------

def convert_handler(source: str, method: str) -> str:
    """Convert a module-style handler source into a def-first resource body.

    Everything that is not the handler function — the comment header, imports,
    module-level constants, and helper ``def``s (including any that appear
    *after* the handler, as in api/connect/doPost.py) — is nested INSIDE the
    emitted function, ahead of the original body. Nesting rather than dropping
    keeps the file self-contained, and nested defs are bound before the body
    runs, so call order is unchanged.

    Returns source of exactly one module-level statement:

        def <method>(request, session):
            <preamble, indented>
            <original body, unchanged>
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ConversionError("%s source does not parse: %s" % (method, exc)) from exc

    handlers = [
        n for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == method
    ]
    if len(handlers) != 1:
        raise ConversionError(
            "expected exactly one module-level `def %s(...)`, found %d"
            % (method, len(handlers))
        )
    handler = handlers[0]

    args = [a.arg for a in handler.args.args]
    if args != ["request", "session"]:
        raise ConversionError(
            "%s must be declared `def %s(request, session)`, found args %r"
            % (method, method, args)
        )

    lines = source.splitlines()
    # 1-based lineno -> 0-based slice bounds. `handler.lineno` is the `def` line,
    # so lines[handler.lineno:] starts at the line after it.
    before = lines[: handler.lineno - 1]
    body = lines[handler.lineno : handler.end_lineno]
    after = lines[handler.end_lineno :]

    preamble = before + after
    out = ["def %s(request, session):" % method]
    out.extend(_indent_block(preamble))
    if preamble and body:
        out.append("")
    out.extend(body)

    converted = "\n".join(out).rstrip() + "\n"
    _validate_converted(converted, method)
    return converted


def _reject_cookie(source: str) -> str:
    """Strip a PEP 263 cookie from the first two lines, if the source has one.

    The gateway compiles resources as already-decoded unicode, and Python 2
    raises `SyntaxError: encoding declaration in Unicode string` for a cookie
    in unicode source — proven live 2026-08-01 (see CODING_COOKIE_RE above).
    Only the PEP 263 positions (lines 1-2) are meaningful; a cookie-shaped
    comment later in the file is inert and left alone.
    """
    lines = source.splitlines(keepends=True)
    return "".join(
        ln for i, ln in enumerate(lines) if not (i < 2 and CODING_COOKIE_RE.match(ln))
    )


def _indent_block(lines: list[str]) -> list[str]:
    """Indent by one level, leaving blank lines genuinely blank.

    Indenting a blank line would emit trailing whitespace, which ruff (W291/W293)
    rejects and which makes diffs noisy.
    """
    return [INDENT + ln if ln.strip() else "" for ln in lines]


def _validate_converted(converted: str, method: str) -> None:
    """Fail loudly if the emitted body is not a valid WebDev resource.

    This is the guard against the silent-200-empty-body failure: a resource that
    is malformed in this specific way produces no error at runtime, so the error
    has to be raised at build time or never.
    """
    try:
        compile(converted, "<%s>" % method, "exec")
    except SyntaxError as exc:
        raise ConversionError(
            "converted %s body does not compile (line %s): %s"
            % (method, exc.lineno, exc.msg)
        ) from exc

    tree = ast.parse(converted)
    if len(tree.body) != 1:
        raise ConversionError(
            "converted %s body must have exactly one module-level statement, "
            "found %d — a comment-first / module-style resource returns HTTP 200 "
            "with an EMPTY body on 8.3" % (method, len(tree.body))
        )
    node = tree.body[0]
    if not isinstance(node, ast.FunctionDef) or node.name != method:
        raise ConversionError(
            "converted %s body must start with `def %s(...)`" % (method, method)
        )
    if not converted.startswith("def %s(request, session):" % method):
        raise ConversionError("converted %s body is not def-first" % method)


# ---------------------------------------------------------------------------
# Manifest rendering
# ---------------------------------------------------------------------------

def render_config_json(methods) -> str:
    """config.json — resource type plus one kebab-case block per method.

    Key names are the JSON names emitted by MethodObject$GsonAdapter's
    serializer, NOT the lowerCamel Java field names. A method with no object
    here does not exist as far as the dispatcher is concerned, however present
    its .py file may be.
    """
    config = {"resource-type": PYTHON_RESOURCE_TYPE}
    for method in sorted(methods):
        config[method] = {
            "enabled": True,
            "require-https": False,
            "require-auth": False,
            "user-source": "",
            "required-roles": "",
            "max-retry-attempts": 0,
        }
    return json.dumps(config, indent=2, sort_keys=False) + "\n"


def render_resource_json(files, timestamp: str) -> str:
    """resource.json — the generic 8.3 project-resource manifest.

    ``files`` is the load-bearing field: it *is* the resource's data-key list.
    A file present on disk but absent from it does not exist to the dispatcher,
    which is what produced ``HTTP 500 No data found for resource``.
    """
    manifest = {
        "scope": "G",
        "version": 1,
        "restricted": False,
        "overridable": True,
        "files": list(files),
        "attributes": {
            "lastModification": {"actor": "external", "timestamp": timestamp}
        },
    }
    return json.dumps(manifest, indent=2) + "\n"


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------

def _is_ignored(path: Path) -> bool:
    """Build artefacts must never reach a gateway resource directory."""
    return "__pycache__" in path.parts or path.suffix == ".pyc"


def plan_deployment(webdev_src: Path, script_src: Path | None = None) -> DeploymentPlan:
    """Walk the source tree and produce the full deployment plan.

    `webdev_src` is `ignition/webdev` — its immediate children are resource-path
    roots (`FactoryLM`), and any directory below that containing a `<method>.py`
    is an endpoint.

    Helper modules are collected from `script_src` (defaults to the api/tags and
    api/chat directories, where they live today) and deployed to the script
    library. They are deliberately NOT added to any resource's ``files``.
    """
    plan = DeploymentPlan()

    endpoint_dirs = set()
    for path in sorted(webdev_src.rglob("*.py")):
        if _is_ignored(path):
            continue
        if path.stem in WEBDEV_METHODS:
            endpoint_dirs.add(path.parent)

    for d in sorted(endpoint_dirs):
        rel = d.relative_to(webdev_src).as_posix()
        resource = WebDevResource(resource_path=rel)
        for method in WEBDEV_METHODS:
            src_file = d / ("%s.py" % method)
            if not src_file.is_file():
                continue
            try:
                resource.methods[method] = convert_handler(
                    src_file.read_text(encoding="utf-8"), method
                )
            except ConversionError as exc:
                raise ConversionError("%s: %s" % (src_file, exc)) from exc
        if resource.methods:
            plan.resources.append(resource)

    search_roots = [script_src] if script_src else [webdev_src]
    found: dict[str, Path] = {}
    for root in search_roots:
        for path in sorted(root.rglob("*.py")):
            if _is_ignored(path) or path.stem in WEBDEV_METHODS:
                continue
            if path.stem in SCRIPT_LIBRARY_MODULES and path.stem not in found:
                found[path.stem] = path

    missing = [m for m in SCRIPT_LIBRARY_MODULES if m not in found]
    if missing:
        raise ConversionError(
            "script-library modules not found in source: %s — handlers import "
            "these as flat top-level names and will fail at runtime without them"
            % ", ".join(missing)
        )
    for name in SCRIPT_LIBRARY_MODULES:
        plan.modules.append(
            ScriptModule(
                name=name,
                source=_reject_cookie(found[name].read_text(encoding="utf-8")),
            )
        )

    return plan


# ---------------------------------------------------------------------------
# Applying
# ---------------------------------------------------------------------------

def apply_plan(plan: DeploymentPlan, project_dir: Path, timestamp: str) -> list[str]:
    """Write the plan into an Ignition project directory. Returns written paths."""
    written = []

    for resource in plan.resources:
        target = project_dir / WEBDEV_RESOURCE_ROOT / resource.resource_path
        target.mkdir(parents=True, exist_ok=True)
        for method, body in resource.methods.items():
            f = target / ("%s.py" % method)
            f.write_text(body, encoding="utf-8", newline="\n")
            written.append(str(f))
        f = target / "config.json"
        f.write_text(render_config_json(resource.methods), encoding="utf-8", newline="\n")
        written.append(str(f))
        f = target / "resource.json"
        f.write_text(
            render_resource_json(resource.files, timestamp), encoding="utf-8", newline="\n"
        )
        written.append(str(f))

    for module in plan.modules:
        target = project_dir / SCRIPT_LIBRARY_ROOT / module.name
        target.mkdir(parents=True, exist_ok=True)
        f = target / "code.py"
        f.write_text(module.source, encoding="utf-8", newline="\n")
        written.append(str(f))
        f = target / "resource.json"
        f.write_text(
            render_resource_json(["code.py"], timestamp), encoding="utf-8", newline="\n"
        )
        written.append(str(f))

    return written


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--webdev-src", required=True, type=Path)
    parser.add_argument("--script-src", type=Path, default=None)
    parser.add_argument("--project-dir", required=True, type=Path)
    parser.add_argument(
        "--timestamp", default="1970-01-01T00:00:00Z",
        help="lastModification stamp written into every resource.json",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="plan and validate every handler, write nothing",
    )
    args = parser.parse_args(argv)

    try:
        plan = plan_deployment(args.webdev_src, args.script_src)
    except ConversionError as exc:
        print("CONVERSION FAILED: %s" % exc, file=sys.stderr)
        return 1

    print("endpoints : %d" % len(plan.resources))
    for r in plan.resources:
        print("  %-28s %s" % (r.resource_path, ", ".join(sorted(r.methods))))
    print("script-library modules: %s" % ", ".join(m.name for m in plan.modules))

    if args.dry_run:
        print("dry-run — nothing written")
        return 0

    written = apply_plan(plan, args.project_dir, args.timestamp)
    print("wrote %d files under %s" % (len(written), args.project_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
