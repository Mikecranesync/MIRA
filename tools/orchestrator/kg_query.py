#!/usr/bin/env python3
"""Query the orchestrator product knowledge graph (Graphify networkx node-link).

Standalone, stdlib-only. The orchestrator-pulse scheduled task SHELLS OUT to this
(it has no LLM key, so the `graphify` CLI is unavailable in the sandbox); render.py
also calls `insights --json` to embed a KG section in the artifact.

Graph shape (`wiki/orchestrator/kg/graph.json`):
  nodes: {id, label, file_type(code|rationale|concept|document), source_file,
          source_location("L15"), community, norm_label, ...}
  links: {source, target, relation(calls|contains|imports|method|...),
          confidence, weight, confidence_score, context?}

Usage:
  kg_query.py search <query> [--type code] [--limit N]
  kg_query.py node <id>
  kg_query.py neighbors <id> [--direction in|out|both] [--limit N]
  kg_query.py path <src_id> <dst_id> [--max-hops N]
  kg_query.py god [--limit N] [--type code]
  kg_query.py orphans [--type code]
  kg_query.py routes [--orphans-only]
  kg_query.py insights [--lens "<label>"] [--limit N]

Per-command flags (place AFTER the subcommand): --graph PATH (default
wiki/orchestrator/kg/graph.json), --json (emit JSON instead of a table).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GRAPH = Path(os.environ.get("MIRA_DIR") or REPO_ROOT) / "wiki" / "orchestrator" / "kg" / "graph.json"
HISTORY_MD = Path(os.environ.get("MIRA_DIR") or REPO_ROOT) / "wiki" / "orchestrator" / "HISTORY.md"


# --------------------------------------------------------------------------- #
# Loading + indexing
# --------------------------------------------------------------------------- #
class Graph:
    """In-memory view of the node-link graph. Undirected adjacency for paths;
    source/target preserved for directional caller/callee queries."""

    def __init__(self, data: dict):
        self.nodes: dict[str, dict] = {n["id"]: n for n in data.get("nodes", [])}
        self.links: list[dict] = data.get("links", data.get("edges", []))
        self.built_at_commit: Optional[str] = data.get("built_at_commit")
        self.directed: bool = bool(data.get("directed", False))

        self.degree: Counter = Counter()
        self.out_edges: dict[str, list[dict]] = defaultdict(list)
        self.in_edges: dict[str, list[dict]] = defaultdict(list)
        self.adj: dict[str, list[tuple[str, dict]]] = defaultdict(list)  # undirected
        for e in self.links:
            s, t = e.get("source"), e.get("target")
            if s is None or t is None:
                continue
            self.degree[s] += 1
            self.degree[t] += 1
            self.out_edges[s].append(e)
            self.in_edges[t].append(e)
            self.adj[s].append((t, e))
            self.adj[t].append((s, e))

    @classmethod
    def load(cls, path: Path) -> "Graph":
        return cls(json.loads(Path(path).read_text()))

    def get(self, nid: str) -> Optional[dict]:
        return self.nodes.get(nid)

    def label(self, nid: str) -> str:
        n = self.nodes.get(nid) or {}
        return n.get("label") or n.get("norm_label") or nid


def _field(n: dict, key: str) -> str:
    return n.get(key) or ""


# --------------------------------------------------------------------------- #
# Queries
# --------------------------------------------------------------------------- #
def search_nodes(g: Graph, query: str, file_type: Optional[str] = None, limit: int = 20) -> list[dict]:
    """Match query (case-insensitive substring) against id / label / norm_label /
    source_file. Exact-id and label-start matches rank first, then by degree."""
    q = query.lower()

    def score(nid: str, n: dict) -> tuple:
        label = _field(n, "label").lower()
        norm = _field(n, "norm_label").lower()
        sf = _field(n, "source_file").lower()
        if nid.lower() == q or norm == q or label == q:
            rank = 0
        elif label.startswith(q) or norm.startswith(q) or nid.lower().startswith(q):
            rank = 1
        elif q in label or q in norm or q in nid.lower():
            rank = 2
        elif q in sf:
            rank = 3
        else:
            rank = 99
        return (rank, -g.degree[nid])

    hits = []
    for nid, n in g.nodes.items():
        if file_type and n.get("file_type") != file_type:
            continue
        rank, negdeg = score(nid, n)
        if rank < 99:
            hits.append((rank, negdeg, nid, n))
    hits.sort(key=lambda h: (h[0], h[1]))
    return [_node_row(nid, n) for _, _, nid, n in hits[:limit]]


def neighbors(g: Graph, nid: str, direction: str = "both", limit: int = 50) -> dict:
    """Callers (in), callees (out), or both for a node."""
    if nid not in g.nodes:
        return {"error": f"unknown node id: {nid}"}
    out = [{"id": e["target"], "label": g.label(e["target"]), "relation": e.get("relation")}
           for e in g.out_edges.get(nid, [])]
    inc = [{"id": e["source"], "label": g.label(e["source"]), "relation": e.get("relation")}
           for e in g.in_edges.get(nid, [])]
    res: dict[str, object] = {"node": _node_row(nid, g.nodes[nid])}
    if direction in ("out", "both"):
        res["callees"] = out[:limit]
    if direction in ("in", "both"):
        res["callers"] = inc[:limit]
    return res


def find_path(g: Graph, src: str, dst: str, max_hops: int = 8) -> dict:
    """Shortest undirected path src->dst (BFS), with the relation on each hop."""
    if src not in g.nodes:
        return {"error": f"unknown source node: {src}"}
    if dst not in g.nodes:
        return {"error": f"unknown target node: {dst}"}
    if src == dst:
        return {"path": [src], "hops": 0}
    prev: dict[str, tuple[str, dict]] = {}
    seen = {src}
    queue = deque([(src, 0)])
    while queue:
        cur, depth = queue.popleft()
        if depth >= max_hops:
            continue
        for nxt, edge in g.adj.get(cur, []):
            if nxt in seen:
                continue
            seen.add(nxt)
            prev[nxt] = (cur, edge)
            if nxt == dst:
                return {"path": _reconstruct(g, prev, src, dst), "hops": depth + 1}
            queue.append((nxt, depth + 1))
    return {"path": None, "error": f"no path within {max_hops} hops"}


def _reconstruct(g: Graph, prev: dict, src: str, dst: str) -> list[dict]:
    chain = []
    cur = dst
    while cur != src:
        parent, edge = prev[cur]
        chain.append({"from": parent, "to": cur, "relation": edge.get("relation"),
                      "from_label": g.label(parent), "to_label": g.label(cur)})
        cur = parent
    chain.reverse()
    return chain


def god_nodes(g: Graph, limit: int = 10, file_type: Optional[str] = None) -> list[dict]:
    """Highest-degree nodes — the architectural load-bearers."""
    ranked = [(nid, d) for nid, d in g.degree.most_common()
              if not file_type or (g.nodes.get(nid) or {}).get("file_type") == file_type]
    return [{**_node_row(nid, g.nodes[nid]), "degree": d} for nid, d in ranked[:limit]]


def orphan_nodes(g: Graph, file_type: Optional[str] = None) -> list[dict]:
    """Degree-0 nodes — unreferenced symbols (often package __init__ / dead code)."""
    res = []
    for nid, n in g.nodes.items():
        if g.degree[nid] != 0:
            continue
        if file_type and n.get("file_type") != file_type:
            continue
        res.append(_node_row(nid, n))
    res.sort(key=lambda r: r["source_file"])
    return res


_ROUTE_FILE_RE = re.compile(r"/api/|/route\.(ts|tsx|js|py)$|\broutes?\.py$", re.I)
_ROUTE_LABEL_RE = re.compile(r"^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b|"
                             r"@(app|router)\.(get|post|put|delete|patch)", re.I)


def is_route(n: dict) -> bool:
    return bool(_ROUTE_FILE_RE.search(_field(n, "source_file"))
                or _ROUTE_LABEL_RE.search(_field(n, "label")))


def route_nodes(g: Graph, orphans_only: bool = False) -> list[dict]:
    """Route files / HTTP-method handlers. `orphans_only` keeps degree-0 routes
    (genuinely disconnected endpoints — extraction-missed or dead)."""
    res = []
    for nid, n in g.nodes.items():
        if n.get("file_type") != "code" or not is_route(n):
            continue
        if orphans_only and g.degree[nid] != 0:
            continue
        res.append({**_node_row(nid, n), "degree": g.degree[nid]})
    res.sort(key=lambda r: (r["degree"], r["source_file"]))
    return res


def latest_lens(history_path: Path = HISTORY_MD) -> Optional[dict]:
    """Parse the most recent `## YYYY-MM-DD (Lens X — <label>)` heading."""
    try:
        text = history_path.read_text()
    except OSError:
        return None
    # HISTORY.md is append-only; the newest lens entry is the LAST such heading.
    matches = re.findall(r"^##\s+(\d{4}-\d{2}-\d{2})\s*\(Lens\s+([A-Z])\s*[—-]\s*([^)]+)\)",
                         text, re.M)
    if not matches:
        return None
    date, letter, label = matches[-1]
    return {"date": date, "lens": letter.strip(), "label": label.strip()}


# Significant words for lens-scope matching (drop generic glue words).
_STOPWORDS = {"and", "the", "a", "an", "of", "for", "to", "&", "in", "on", "with",
              "hub", "lens", "audit"}  # "hub" alone is too broad; require pairing


def lens_subgraph(g: Graph, lens: Optional[dict], limit: int = 8) -> list[dict]:
    """Highest-degree code nodes relevant to a lens, matched by the lens label's
    significant words against source_file + label."""
    if not lens:
        return []
    words = [w for w in re.split(r"[^a-z0-9]+", lens["label"].lower())
             if w and w not in _STOPWORDS and len(w) > 2]
    # Re-admit "hub" only as a path scope (mira-hub) when paired with a topic word.
    scope_paths = ["mira-hub"] if "hub" in lens["label"].lower() else []
    matched = []
    for nid, n in g.nodes.items():
        if n.get("file_type") != "code":
            continue
        hay = (_field(n, "source_file") + " " + _field(n, "label") + " " + nid).lower()
        topic_hit = any(w in hay for w in words)
        scope_hit = any(p in hay for p in scope_paths)
        if (scope_paths and scope_hit and topic_hit) or (not scope_paths and topic_hit):
            matched.append((g.degree[nid], nid, n))
    matched.sort(key=lambda m: -m[0])
    return [{**_node_row(nid, n), "degree": d} for d, nid, n in matched[:limit]]


def insights(g: Graph, lens_label: Optional[str] = None, limit: int = 8) -> dict:
    """Composite payload for render.py — god nodes, latest-lens subgraph, orphan routes."""
    lens = {"date": "", "lens": "?", "label": lens_label} if lens_label else latest_lens()
    return {
        "built_at_commit": g.built_at_commit,
        "node_count": len(g.nodes),
        "edge_count": len(g.links),
        "god_nodes": god_nodes(g, limit=limit, file_type="code"),
        "lens": lens,
        "lens_subgraph": lens_subgraph(g, lens, limit=limit),
        "orphan_routes": route_nodes(g, orphans_only=True),
        "orphan_count": sum(1 for nid in g.nodes if g.degree[nid] == 0),
    }


def _node_row(nid: str, n: dict) -> dict:
    return {
        "id": nid,
        "label": n.get("label"),
        "file_type": n.get("file_type"),
        "source_file": n.get("source_file"),
        "source_location": n.get("source_location"),
    }


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _print(payload, as_json: bool):
    if as_json:
        print(json.dumps(payload, indent=2))
        return
    if isinstance(payload, dict) and "error" in payload:
        print(f"error: {payload['error']}", file=sys.stderr)
        return
    print(_humanize(payload))


def _humanize(payload) -> str:
    def fmt_row(r: dict) -> str:
        deg = f"[{r['degree']}] " if "degree" in r else ""
        loc = f":{r['source_location']}" if r.get("source_location") else ""
        return f"  {deg}{r['id']}  —  {r.get('label') or ''}\n      {r.get('source_file') or ''}{loc}"

    if isinstance(payload, list):
        return "\n".join(fmt_row(r) for r in payload) or "  (none)"
    if isinstance(payload, dict):
        lines = []
        for key, val in payload.items():
            if isinstance(val, list):
                lines.append(f"{key}:")
                lines.append("\n".join(fmt_row(r) if isinstance(r, dict) and "id" in r
                                       else f"  {r}" for r in val) or "  (none)")
            else:
                lines.append(f"{key}: {val}")
        return "\n".join(lines)
    return str(payload)


def main(argv: Optional[list[str]] = None) -> int:
    # Shared flags live on a parent parser so `--graph` / `--json` are accepted
    # both before AND after the subcommand (the pulse calls `insights --json`).
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--graph", type=Path, default=DEFAULT_GRAPH, help="path to graph.json")
    common.add_argument("--json", action="store_true", help="emit JSON instead of a table")

    # Shared flags go on the subparsers (not the top parser): with both, an
    # `--json` before the subcommand would be silently overridden by the
    # subparser default. `<cmd> --json` is the documented + pulse usage.
    p = argparse.ArgumentParser(description="Query the orchestrator KG (graph.json).")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("search", parents=[common], help="find nodes by name/type")
    sp.add_argument("query")
    sp.add_argument("--type", dest="file_type", default=None)
    sp.add_argument("--limit", type=int, default=20)

    sp = sub.add_parser("node", parents=[common], help="show one node")
    sp.add_argument("id")

    sp = sub.add_parser("neighbors", parents=[common], help="callers/callees of a node")
    sp.add_argument("id")
    sp.add_argument("--direction", choices=["in", "out", "both"], default="both")
    sp.add_argument("--limit", type=int, default=50)

    sp = sub.add_parser("path", parents=[common], help="shortest path between two nodes")
    sp.add_argument("src")
    sp.add_argument("dst")
    sp.add_argument("--max-hops", type=int, default=8)

    sp = sub.add_parser("god", parents=[common], help="highest-degree nodes")
    sp.add_argument("--limit", type=int, default=10)
    sp.add_argument("--type", dest="file_type", default=None)

    sp = sub.add_parser("orphans", parents=[common], help="degree-0 nodes")
    sp.add_argument("--type", dest="file_type", default=None)

    sp = sub.add_parser("routes", parents=[common], help="route files / HTTP-method handlers")
    sp.add_argument("--orphans-only", action="store_true")

    sp = sub.add_parser("insights", parents=[common], help="composite payload for render.py")
    sp.add_argument("--lens", default=None, help="override the lens label")
    sp.add_argument("--limit", type=int, default=8)

    args = p.parse_args(argv)
    try:
        g = Graph.load(args.graph)
    except OSError as e:
        print(f"error: cannot load graph {args.graph}: {e}", file=sys.stderr)
        return 2

    if args.cmd == "search":
        _print(search_nodes(g, args.query, args.file_type, args.limit), args.json)
    elif args.cmd == "node":
        n = g.get(args.id)
        _print(_node_row(args.id, n) if n else {"error": f"unknown node: {args.id}"}, args.json)
    elif args.cmd == "neighbors":
        _print(neighbors(g, args.id, args.direction, args.limit), args.json)
    elif args.cmd == "path":
        _print(find_path(g, args.src, args.dst, args.max_hops), args.json)
    elif args.cmd == "god":
        _print(god_nodes(g, args.limit, args.file_type), args.json)
    elif args.cmd == "orphans":
        _print(orphan_nodes(g, args.file_type), args.json)
    elif args.cmd == "routes":
        _print(route_nodes(g, args.orphans_only), args.json)
    elif args.cmd == "insights":
        _print(insights(g, args.lens, args.limit), args.json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
