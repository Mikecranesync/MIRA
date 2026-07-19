"""``python -m factorylm_ai.proofpack`` entry point -- delegates to run.main().

See ``run.py`` for the full CLI contract (handoff §10): dry-run on the mock
provider by default, ``--live`` gated on ``TOGETHERAI_API_KEY`` +
``FACTORYLM_AI_ALLOW_NETWORK``, every call budget-capped via
:class:`~factorylm_ai.budget.BudgetGuard`.
"""

from __future__ import annotations

import sys

from .run import main

if __name__ == "__main__":
    sys.exit(main())
