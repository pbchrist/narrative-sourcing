"""Shared data model. See docs/DESIGN.md for the rationale behind every
field, especially why confidence/evidence are mandatory on inferred data
and why OutreachBrief has no sendable-message field.
"""

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class CandidateProfile:
    raw_text: str
    name: str | None = None
    known_roles: list[str] | None = None
    source_notes: str | None = None


@dataclass
class Beat:
    description: str
    evidence: str
    confidence: float  # 0.0-1.0


@dataclass
class CareerArc:
    throughline: str
    departures: list[Beat] = field(default_factory=list)
    pursuits: list[Beat] = field(default_factory=list)
    unresolved_tension: str = ""
    confidence: float = 0.0


@dataclass
class RoleContext:
    title: str
    raw_description: str
    company_context: str | None = None


@dataclass
class FitAssessment:
    continues_arc: bool | None  # None = genuinely ambiguous, do not force it
    reasoning: str
    risk_flags: list[str] = field(default_factory=list)
    skill_overlap: dict = field(default_factory=dict)


@dataclass
class OutreachBrief:
    candidate_name: str
    one_line_story: str
    why_this_role: str
    open_question: str
    cautions: list[str] = field(default_factory=list)
    draft_status: Literal["needs_human_message"] = "needs_human_message"
