"""Guard: pydantic must stay below 2.12.

pydantic 2.12+ breaks the RAG worker's structured-output model build with
`unable to infer type for attribute "description"` (raised inside
`RAGWorker.process`, caught at `mira-bots/shared/engine.py:5686`), which makes
grounded/cited answers fall through (`GENERAL_QUESTION_RAG_FAILURE ... falling
through`). The bot requirements therefore pin `pydantic>=2.0,<2.12`
(mira-bots/telegram/requirements.txt, mira-bots/slack/requirements.txt).

This test fails if a pydantic >= 2.12 is installed — catching an accidental
unpin (or an unbounded transitive install) BEFORE a container rebuild ships the
break. It is an import-time/version guard, not a model-build reproduction: the
failing model is constructed at runtime deep in the engine; the pin is the
mitigation and this guard enforces it. When pydantic gains a fix for the
structured-output inference, raise the cap deliberately in one place.
"""

import pydantic


def test_pydantic_below_2_12() -> None:
    major, minor = (int(part) for part in pydantic.VERSION.split(".")[:2])
    assert (major, minor) < (2, 12), (
        f"pydantic {pydantic.VERSION} is installed but must be < 2.12 — "
        "2.12+ breaks the RAG worker structured-output build "
        '(unable to infer type for attribute "description"; engine.py:5686), '
        "dropping grounded answers. Fix the pin in mira-bots/*/requirements.txt "
        "(pydantic>=2.0,<2.12)."
    )
