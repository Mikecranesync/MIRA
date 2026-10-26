"""Prove the review-page tests can fail: build one mutated page at a time and run the test that guards it.

    cd test && python3 red_runs.py        (needs `npm i` and `npx playwright install chromium` here)

Each mutation must turn its named test red on the Pixel project; the unmutated control must pass it.
Writes results/red-runs.json and exits 1 if any mutation survives.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..", "app.html")
MUTATIONS = [
    ("control (no mutation)", None, None, "XP counts only server-confirmed saves"),
    (
        "answer XP from the phone's copy, not the server",
        "return s && s.confirmed ? s.data : null; }",
        "return S.local[key] || null; }",
        "XP counts only server-confirmed saves",
    ),
    (
        "hazard XP from the phone's copy",
        "const hazards = Object.values(S.serverHaz).filter(h => h.confirmed && !S.tomb[h.data.id]).length;",
        "const hazards = localHazCount();",
        "XP counts only server-confirmed saves",
    ),
    (
        "page gate removed",
        "seen = !!(S.seen[k] || pages[p]);",
        "seen = true;",
        "page buttons stay disabled until",
    ),
    (
        "v1 records rewritten on load",
        "if (!s) writer.put('answers', key, rec);",
        "writer.put('answers', key, rec);",
        "opening v2 writes nothing",
    ),
    (
        "Safety Sentinel lock removed",
        "const sentinelUnlocked = () => localHazCount() >= HAZARD_UNLOCK ||",
        "const sentinelUnlocked = () => true ||",
        "Safety Sentinel stays locked",
    ),
    (
        "XP depends on the label",
        "const forum = DATA.forum.filter(f => forumComplete(confirmedRec(forumKey(f)), f)).length;",
        "const forum = DATA.forum.filter(f => forumComplete(confirmedRec(forumKey(f)), f) && !Object.values(confirmedRec(forumKey(f)).pages).includes('unsure')).length;",
        "the label never changes XP",
    ),
    (
        "overall alone completes a case",
        "const forumComplete = (rec, f) => !!(rec && rec.overall && f.pages.every(p => rec.pages && rec.pages[p]));",
        "const forumComplete = (rec, f) => !!(rec && rec.overall);",
        "the label never changes XP",
    ),
    (
        "older phone copy overwrites the server",
        "else if ((rec.savedAt || '') > (s.data.savedAt || '') && !same(stripMeta(rec), stripMeta(s.data))) writer.put('answers', key, rec);",
        "else if (!same(stripMeta(rec), stripMeta(s.data))) writer.put('answers', key, rec);",
        "older copy on the phone never overwrites",
    ),
]


def main() -> None:
    src = open(APP, encoding="utf-8").read()
    out, bad = [], []
    for i, (name, old, new, test) in enumerate(MUTATIONS):
        code = src
        if old:
            if src.count(old) != 1:
                bad.append(f"{name}: anchor found {src.count(old)} times")
                continue
            code = src.replace(old, new)
        d = tempfile.mkdtemp()
        try:
            app = os.path.join(d, "app.html")
            open(app, "w", encoding="utf-8").write(code)
            subprocess.run(
                [sys.executable, os.path.join(HERE, "..", "build.py"), "--out", d, "--app", app],
                check=True,
                capture_output=True,
            )
            os.symlink(os.path.join(HERE, "..", "dist", "pages"), os.path.join(d, "pages"))
            env = {**os.environ, "REVIEW_DIST": d, "REVIEW_PORT": str(47920 + i)}
            p = subprocess.run(
                ["npx", "playwright", "test", "--project=pixel-9a", "--reporter=line", "-g", test],
                cwd=HERE,
                env=env,
                capture_output=True,
                text=True,
            )
        finally:
            shutil.rmtree(d, ignore_errors=True)
        failed = int(m.group(1)) if (m := re.search(r"(\d+) failed", p.stdout)) else 0
        passed = int(m.group(1)) if (m := re.search(r"(\d+) passed", p.stdout)) else 0
        ok = (failed == 0 and passed > 0) if old is None else failed > 0
        out.append(
            {
                "mutation": name,
                "guard_test": test,
                "failed": failed,
                "passed": passed,
                "as_expected": ok,
            }
        )
        print(f"{'OK ' if ok else 'BAD'} {name:42s} failed={failed} passed={passed}  [{test}]")
        if not ok:
            bad.append(name)
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, "red-runs.json"), "w"), indent=1)
    if bad:
        print("PROBLEMS:", bad)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
