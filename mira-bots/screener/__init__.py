"""MIRA Interaction Screener — real-time conversation quality monitor.

Tails SQLite interactions, NDJSON sessions, Docker logs, and feedback_log.
Scores sessions against Amazon Lex / Contact Lens / Dialogflow CX quality schema.
Emits FixProposal objects for every detected quality flag.

Usage:
    python -m screener --mode live
    python -m screener --mode report --hours 24
    python -m screener --mode batch
"""
