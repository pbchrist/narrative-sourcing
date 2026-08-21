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
    # The throughline and the tension are the two lines a recruiter will
    # actually repeat, so they carry their own verified quotes. Empty means
    # nothing in the profile could be quoted to support them - every beat
    # below may check out and the headline still be invented, which is the
    # exact failure this model exists to prevent.
    throughline_evidence: list[str] = field(default_factory=list)
    tension_evidence: list[str] = field(default_factory=list)

    @property
    def throughline_anchored(self) -> bool:
        return bool(self.throughline_evidence)

    @property
    def tension_anchored(self) -> bool:
        return bool(self.tension_evidence)


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
