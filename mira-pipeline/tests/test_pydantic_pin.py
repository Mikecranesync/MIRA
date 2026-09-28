"""Guard: pydantic must stay below 2.12 in the mira-pipeline image.

mira-pipeline-saas is the LIVE VPS chat path and its Dockerfile copies
`mira-bots/shared/` (the RAG worker / engine). `fastapi` pulls pydantic in
transitively with no upper bound, so a container rebuild can land pydantic
2.12.x — and on 2.12 the RAG worker's runtime structured-output model build
(inside a provider SDK call path) throws `unable to infer type for attribute
"description"` (surfaced at `mira-bots/shared/engine.py:5686`), dropping
grounded/cited answers. `mira-pipeline/requirements.txt` therefore pins
`pydantic>=2.0,<2.12`.

This test fails if pydantic >= 2.12 is installed — catching an accidental
transitive bump before the OVH rebuild ships the break. Version guard, not a
model-build reproduction (the failing model is built at runtime inside the
provider SDK path). Raise the cap deliberately once pydantic fixes the
structured-output inference.
"""

import pydantic


def test_pydantic_below_2_12() -> None:
    major, minor = (int(part) for part in pydantic.VERSION.split(".")[:2])
    assert (major, minor) < (2, 12), (
        f"pydantic {pydantic.VERSION} is installed but must be < 2.12 — "
        "2.12+ breaks the RAG worker structured-output build "
        '(unable to infer type for attribute "description"; engine.py:5686) on '
        "the live mira-pipeline-saas chat path. Fix the pin in "
        "mira-pipeline/requirements.txt (pydantic>=2.0,<2.12)."
    )
