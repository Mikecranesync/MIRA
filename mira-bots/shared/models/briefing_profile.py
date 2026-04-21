"""BriefingProfile — per-user configuration for personalized daily briefings."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BriefingProfile:
    user_id: str
    tenant_id: str
    role: str = "technician"  # technician | supervisor | manager
    assigned_assets: list[str] = field(default_factory=list)
    shift: str = "day"  # day | evening | night | all
    preferred_channel: str = "push"  # push | email | telegram | slack
    preferred_time: str = "06:00"  # HH:MM local time — not UTC
    email: str = ""
    language: str = "en"
    include_kpis: bool = False
    include_open_wos: bool = True
    include_team_activity: bool = False
    digest_length: str = "short"  # short | detailed
