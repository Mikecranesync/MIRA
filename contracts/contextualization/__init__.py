"""Cross-module contextualization contracts (Hub is system of record).

Neutral home for the shared Intake Contract Python twin so the offline
Contextualizer and Telegram thin client can import it without either owning it.
See intake_contract.py and mira-hub/src/lib/contextualization/intake-contract.ts.
"""

from .intake_contract import (  # noqa: F401
    CONTRACT_VERSION,
    INGEST_ROUTES,
    SOURCE_TYPES,
    AssetHints,
    IntakeContract,
    IntakeSource,
    ProposedSignal,
    SourceMetadata,
    validate_envelope,
)
