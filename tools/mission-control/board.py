"""Read-only model of GitHub Project #4 for the owner's mission-control page (#4737).

Fetches EVERY project item (paginated, never just the first 100) with one
GraphQL query shape, normalises each card, and sorts cards into the views the
proposal in docs/proposals/project4-mission-control.md asks for. Pure rules over
the GitHub record: no model calls, no writes. The page answers "what needs me",
it never acts.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any, Callable, Dict, List, Optional

PROJECT_OWNER = "Mikecranesync"
PROJECT_NUMBER = 4
STALE_DAYS = 14

QUERY = """
query($owner: String!, $number: Int!, $after: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      title
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          content {
            __typename
            ... on Issue {
              number title url state updatedAt
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              assignees(first: 5) { nodes { login } }
            }
            ... on PullRequest {
              number title url state updatedAt isDraft
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              assignees(first: 5) { nodes { login } }
            }
          }
        }
      }
    }
  }
}
"""

# Labels that mean "the owner has to do or decide something".
NEEDS_OWNER_RE = re.compile(r"ready-for-human|needs-info|needs-mike|owner|decision|approval", re.I)
BLOCKED_RE = re.compile(r"blocked", re.I)


def fetch_items(post: Callable[[dict], dict]) -> List[dict]:
    """Page through every item. `post` sends one GraphQL request and returns JSON."""
    items: List[dict] = []
    after: Optional[str] = None
    while True:
        data = post(
            {
                "query": QUERY,
                "variables": {"owner": PROJECT_OWNER, "number": PROJECT_NUMBER, "after": after},
            }
        )
        if data.get("errors"):
            raise RuntimeError(
                f"GitHub GraphQL error: {data['errors'][0].get('message', 'unknown')}"
            )
        page = data["data"]["user"]["projectV2"]["items"]
        items.extend(i for i in (normalise(n) for n in page["nodes"]) if i is not None)
        if not page["pageInfo"]["hasNextPage"]:
            return items
        after = page["pageInfo"]["endCursor"]


def normalise(node: dict) -> Optional[dict]:
    content = node.get("content") or {}
    if content.get("__typename") not in ("Issue", "PullRequest"):
        return None  # draft notes carry no canonical record to cite
    status = ((node.get("fieldValueByName") or {}).get("name")) or "No status"
    return {
        "kind": "PR" if content["__typename"] == "PullRequest" else "Issue",
        "number": content["number"],
        "title": content["title"],
        "url": content["url"],
        "repo": content["repository"]["nameWithOwner"],
        "state": content["state"],  # OPEN / CLOSED / MERGED
        "updated": content["updatedAt"],
        "status": status,
        "labels": [lb["name"] for lb in content["labels"]["nodes"]],
        "assignees": [a["login"] for a in content["assignees"]["nodes"]],
        "draft": bool(content.get("isDraft")),
    }


def _is(status: str, want: str) -> bool:
    return status.strip().lower() == want.lower()


def _age_days(item: dict, now: dt.datetime) -> int:
    updated = dt.datetime.fromisoformat(item["updated"].replace("Z", "+00:00"))
    return (now - updated).days


def recommend(item: dict, now: dt.datetime) -> Dict[str, str]:
    """One rule-based recommendation per card, with the evidence it rests on."""
    if item["state"] != "OPEN" and not _is(item["status"], "Done"):
        return {
            "option": "Mark Done",
            "why": f"The {item['kind'].lower()} is {item['state'].lower()} but the card says {item['status']}.",
        }
    if item["state"] == "OPEN" and _is(item["status"], "Done"):
        return {
            "option": "Reopen or close",
            "why": "The card says Done but the record is still open.",
        }
    if any(BLOCKED_RE.search(lb) for lb in item["labels"]):
        return {"option": "Unblock", "why": "Labelled blocked."}
    if any(NEEDS_OWNER_RE.search(lb) for lb in item["labels"]):
        return {"option": "Decide", "why": "Labelled as waiting on the owner."}
    age = _age_days(item, now)
    if _is(item["status"], "In Progress") and age >= STALE_DAYS:
        return {"option": "Hold", "why": f"No activity for {age} days."}
    when = "today" if age <= 0 else ("yesterday" if age == 1 else f"{age} days ago")
    return {"option": "Continue", "why": f"Updated {when}."}


def build_views(items: List[dict], now: Optional[dt.datetime] = None) -> Dict[str, Any]:
    now = now or dt.datetime.now(dt.timezone.utc)
    # Copies: the cached snapshot is shared across request threads and must never be mutated.
    items = [dict(it, rec=recommend(it, now)) for it in items]
    is_open = [i for i in items if i["state"] == "OPEN"]
    focus = [i for i in is_open if _is(i["status"], "In Progress")]
    return {
        "total": len(items),
        "by_status": _count(i["status"] for i in items),
        # Mirrors saved View 2: status:"In progress" is:open
        "focus": sorted(focus, key=lambda i: i["updated"], reverse=True),
        "needs_owner": [i for i in is_open if any(NEEDS_OWNER_RE.search(lb) for lb in i["labels"])],
        "blocked": [i for i in is_open if any(BLOCKED_RE.search(lb) for lb in i["labels"])],
        "mismatched": [i for i in items if i["rec"]["option"] in ("Mark Done", "Reopen or close")],
        "stale": [i for i in focus if i["rec"]["option"] == "Hold"],
    }


def _count(values) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for v in values:
        out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))
