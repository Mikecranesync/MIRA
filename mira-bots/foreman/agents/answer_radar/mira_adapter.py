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
    """Production adapter that calls the real MIRA OpenAI-compatible HTTP path.

    Matches the staging contract:
    - POST to MIRA_API_URL (default: http://165.245.138.91:4099/v1/chat/completions)
    - Authorization: Bearer $MIRA_API_KEY
    - OpenAI-compatible message format
    - Unique chat_id per question to prevent FSM/memory bleed

    Requires:
    - MIRA_API_URL: The MIRA endpoint (defaults to staging)
    - MIRA_API_KEY: Bearer token for authentication
    """

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> None:
        # Default to staging endpoint
        self.api_url = api_url or os.environ.get(
            "MIRA_API_URL", "http://165.245.138.91:4099/v1/chat/completions"
        )
        self.api_key = api_key or os.environ.get("MIRA_API_KEY", "")

        if not self.api_key:
            raise ValueError(
                "MIRA_API_KEY must be set for RealMiraAdapter. "
                "Set environment variable or pass to constructor."
            )

        # Extract base URL for health endpoint
        # http://165.245.138.91:4099/v1/chat/completions -> http://165.245.138.91:4099
        import re

        match = re.match(r"(https?://[^/]+(?::\d+)?)", self.api_url)
        self.base_url = match.group(1) if match else None

    def _probe_health(self) -> dict:
        """Probe GET /health endpoint to capture version metadata."""
        import requests

        if not self.base_url:
            return {"version": "unknown", "error": "cannot parse base URL"}

        try:
            health_url = f"{self.base_url}/health"
            response = requests.get(health_url, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            return {"version": "unknown", "error": str(exc)}

    def evaluate(self, question: Question) -> MiraAttempt:
        """Call real MIRA OpenAI-compatible endpoint.

        OpenAI-compatible contract:
        - model: "mira-diagnostic"
        - messages: [{"role": "user", "content": "<question>"}]
        - stream: false
        - user: "answer-radar-<question_id>" (unique per question)
        - metadata: {"chat_id": "answer-radar-<question_id>"}

        Unique chat_id per question prevents FSM/memory bleed across evaluations.
        """
        import requests

        # Probe health endpoint for version
        health = self._probe_health()
        mira_version = health.get("version", "unknown")

        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        # Unique chat_id per question to prevent FSM/memory bleed
        chat_id = f"answer-radar-{question.question_id}"

        payload = {
            "model": "mira-diagnostic",
            "messages": [{"role": "user", "content": question.body}],
            "stream": False,
            "user": chat_id,
            "metadata": {"chat_id": chat_id},
        }

        start_ms = int(datetime.utcnow().timestamp() * 1000)

        try:
            response = requests.post(
                self.api_url,
                json=payload,
                headers=headers,
                timeout=120,
            )
            response.raise_for_status()
            data = response.json()

            end_ms = int(datetime.utcnow().timestamp() * 1000)

            # Parse OpenAI-compatible response
            choices = data.get("choices", [])
            if not choices:
                raise ValueError("No choices in response")

            answer = choices[0].get("message", {}).get("content", "")
            if not answer:
                raise ValueError("Empty answer in response")

            # Extract citations if present (MIRA-specific extension)
            mira_citations = data.get("citations", [])
            source_documents = data.get("source_documents", [])

            return MiraAttempt(
                question_id=question.question_id,
                mira_version_sha=mira_version,
                mira_answer=answer,
                mira_citations=mira_citations,
                retrieval_version="unknown",  # Not exposed by current endpoint
                prompt_version="unknown",  # Not exposed by current endpoint
                model_provider=data.get("model", "mira-diagnostic"),
                latency_ms=end_ms - start_ms,
                cost_usd=0.0,  # Not tracked by current endpoint
                answer_status="success",
                attempted_at=datetime.utcnow().isoformat() + "Z",
                source_documents=source_documents,
            )

        except Exception as exc:
            end_ms = int(datetime.utcnow().timestamp() * 1000)
            return MiraAttempt(
                question_id=question.question_id,
                mira_version_sha=mira_version,
                mira_answer=f"ERROR: {exc}",
                mira_citations=[],
                retrieval_version="unknown",
                prompt_version="unknown",
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
