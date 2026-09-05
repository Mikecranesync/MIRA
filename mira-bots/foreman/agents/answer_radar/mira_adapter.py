"""MIRA evaluation adapter — real HTTP product path + fake for offline tests.

The adapter captures the exact MIRA version, retrieval version, prompt version,
and full answer + citations so benchmarks are reproducible.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from .mission_state import MiraAttempt, Question


class MiraAdapter(ABC):
    """Abstract adapter for evaluating questions through MIRA."""

    @abstractmethod
    def evaluate(self, question: Question) -> MiraAttempt:
        """Submit a question to MIRA and return the attempt record."""
        pass


class RealMiraAdapter(MiraAdapter):
    """Production adapter that calls the real MIRA HTTP product path.

    Requires:
    - MIRA_API_URL: The production MIRA endpoint
    - MIRA_API_KEY: Authentication token (optional, if auth is enabled)
    """

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> None:
        self.api_url = api_url or os.environ.get("MIRA_API_URL", "")
        self.api_key = api_key or os.environ.get("MIRA_API_KEY", "")

        if not self.api_url:
            raise ValueError(
                "MIRA_API_URL must be set for RealMiraAdapter. "
                "Example: http://factorylm.com:9099/v1/chat/completions"
            )

    def evaluate(self, question: Question) -> MiraAttempt:
        """Call real MIRA product HTTP endpoint.

        This is a placeholder that would be implemented with actual HTTP calls.
        For V1 MVP, this demonstrates the contract.
        """
        import requests

        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "benchmark_id": question.question_id,
            "question": question.body,
            "manufacturer": question.manufacturer or "unknown",
            "model": question.model or "unknown",
            "mode": "fresh_holdout",
            "allow_community_answers": False,
        }

        start_ms = int(datetime.utcnow().timestamp() * 1000)

        try:
            response = requests.post(
                self.api_url,
                json=payload,
                headers=headers,
                timeout=60,
            )
            response.raise_for_status()
            data = response.json()

            end_ms = int(datetime.utcnow().timestamp() * 1000)

            return MiraAttempt(
                question_id=question.question_id,
                mira_version_sha=data.get("mira_version_sha", "unknown"),
                mira_answer=data.get("answer", ""),
                mira_citations=data.get("citations", []),
                retrieval_version=data.get("retrieval_version", "unknown"),
                prompt_version=data.get("prompt_version", "unknown"),
                model_provider=data.get("model_provider", "unknown"),
                latency_ms=end_ms - start_ms,
                cost_usd=data.get("cost_usd", 0.0),
                answer_status="success",
                attempted_at=datetime.utcnow().isoformat() + "Z",
                source_documents=data.get("source_documents", []),
            )

        except Exception as exc:
            end_ms = int(datetime.utcnow().timestamp() * 1000)
            return MiraAttempt(
                question_id=question.question_id,
                mira_version_sha="error",
                mira_answer=f"ERROR: {exc}",
                mira_citations=[],
                answer_status="error",
                attempted_at=datetime.utcnow().isoformat() + "Z",
                latency_ms=end_ms - start_ms,
            )


class FakeMiraAdapter(MiraAdapter):
    """Fake adapter for offline tests with deterministic responses."""

    def __init__(self) -> None:
        self._attempt_count = 0

    def evaluate(self, question: Question) -> MiraAttempt:
        """Return a deterministic fake MIRA response for testing."""
        self._attempt_count += 1

        # Generate deterministic fake answers based on question content
        if "MicroLogix" in question.title or "MicroLogix" in question.body:
            answer = (
                "Error code 0x0002 on the MicroLogix 1100 typically indicates an Ethernet/IP "
                "communication initialization failure. Verify: 1) IP address configuration "
                "matches RSLinx settings, 2) Subnet mask is correct, 3) No IP conflicts on the "
                "network, 4) Firmware version compatibility with RSLinx. "
                "Try power cycling the PLC after verifying network settings."
            )
            citations = [
                "1756-UM001_-EN-P MicroLogix 1100 User Manual, Chapter 4, Section 4.3",
                "Knowledgebase Article KB12345: Ethernet/IP Troubleshooting",
            ]
        elif "Omron" in question.title or "FINS" in question.body:
            answer = (
                "The FINS error 0x1101 indicates an invalid memory area specification. "
                "For D100-D200, the correct format should use memory area code 0x82 (DM area) "
                "with proper byte ordering. Your command shows correct structure but verify: "
                "1) Word address is 0064 hex (100 decimal), 2) Item count is 0064 hex (100 words), "
                "3) Node addressing matches your network configuration."
            )
            citations = [
                "FINS Commands Reference Manual (W227), Section 5.1.1",
                "Omron CJ2M Hardware Manual, Appendix B",
            ]
        elif "ABB" in question.title or "ACS880" in question.body:
            answer = (
                "Fault F8302 (IGBT temperature) during ramp-up suggests thermal management or "
                "parameter configuration issues. At 25C ambient with proper cooling, check: "
                "1) Parameter 22.01 (motor nominal current) matches motor nameplate, "
                "2) Acceleration time (parameter 22.03) isn't too aggressive for the load inertia, "
                "3) IGBT thermal model parameters (group 94) match your installation. "
                "DO NOT attempt thermal paste replacement while drive is energized - this requires "
                "lockout/tagout and qualified personnel."
            )
            citations = [
                "ACS880 Firmware Manual (3AUA0000094046), Section 8.4.2",
                "Parameter List for Drives (3AUA0000162585), Group 22 and 94",
            ]
        else:
            answer = "Unable to provide a specific answer without more details."
            citations = []

        return MiraAttempt(
            question_id=question.question_id,
            mira_version_sha="fake-sha-1234567890abcdef1234567890abcdef12345678",
            mira_answer=answer,
            mira_citations=citations,
            retrieval_version="fake-retrieval-v1.0.0",
            prompt_version="fake-prompt-v2.3.1",
            model_provider="fake-claude-sonnet-4.5",
            latency_ms=1500 + (self._attempt_count * 100),
            cost_usd=0.05,
            answer_status="success",
            attempted_at=datetime.utcnow().isoformat() + "Z",
            source_documents=[
                "fake-doc-001.pdf",
                "fake-doc-002.pdf",
            ],
        )
