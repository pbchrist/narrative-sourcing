"""FitAssessment -> OutreachBrief.

Deliberately makes no model call. Everything in a brief is already
present in the arc and the assessment; generating fresh prose here would
be the one place in the pipeline where unverified sentences could enter
at the very end, after every check has run. So this module only selects,
labels and warns.

It also runs the sendable-text guard over every field on the way out.
"""

from src.brief.guard import reject_sendable_text, scan_sendable_text
from src.common.types import (
    CandidateProfile, CareerArc, FitAssessment, OutreachBrief,
)

# Below this, the brief says so in plain language rather than presenting
# the arc as settled. Principle 2: surfaced, not smoothed.
LOW_CONFIDENCE = 0.6

_ANONYMOUS = "(unnamed candidate)"


def _cautions(arc: CareerArc, assessment: FitAssessment) -> list[str]:
    cautions: list[str] = []

    evidence_count = len(arc.departures) + len(arc.pursuits)
    if evidence_count == 0:
        cautions.append(
            f"No evidence survived verification: every beat this arc was "
            f"built from failed to match the profile text, so arc "
            f"confidence is {arc.confidence}. Treat the throughline as an "
            f"unsupported guess and re-read the profile yourself."
        )
    elif arc.confidence < LOW_CONFIDENCE:
        cautions.append(
            f"Arc confidence is {arc.confidence}, below {LOW_CONFIDENCE}. "
            f"This read is built on {evidence_count} verified quote(s) and "
            f"is a hypothesis, not a finding. Do not write as if it is "
            f"settled."
        )

    if assessment.continues_arc is None:
        cautions.append(
            "No verdict: the evidence did not support a clear call on "
            "whether this role continues the arc. That ambiguity is the "
            "finding, not a gap to paper over."
        )
    elif assessment.continues_arc is False:
        cautions.append(
            "This role appears to fracture the arc rather than continue "
            "it. If you reach out anyway, name that directly instead of "
            "pitching around it."
        )

    if not arc.unresolved_tension.strip():
        cautions.append(
            "No unresolved tension was identified, so the open question "
            "below is generic. Find a real one before reaching out."
        )

    low_beats = [
        b for b in (arc.departures + arc.pursuits) if b.confidence < LOW_CONFIDENCE
    ]
    for beat in low_beats:
        cautions.append(
            f'Low-confidence inference ({beat.confidence}): '
            f'"{beat.description}" rests on a thin quote — "{beat.evidence}".'
        )

    # Risk flags are model-authored, so they are screened rather than
    # trusted. A flag that reads as a message to the candidate is withheld
    # and its absence reported, not silently dropped.
    for flag in assessment.risk_flags:
        if scan_sendable_text(flag):
            cautions.append(
                "A risk flag was withheld: it read as text addressed to the "
                "candidate rather than to you. Check the model output "
                "directly if you need it."
            )
        else:
            cautions.append(flag)
    return cautions


def _quarantine(value: str, label: str, fallback: str) -> tuple[str, str | None]:
    """Screen a model-authored field. Returns (value, caution_or_None)."""
    kind = scan_sendable_text(value)
    if not kind:
        return value, None
    return fallback, (
        f"The {label} was withheld: the model produced {kind}, which is "
        f"message text rather than a brief. Rule 3 in PRINCIPLES.md. Read "
        f"the profile yourself for this part."
    )


def build_brief(
    profile: CandidateProfile,
    arc: CareerArc,
    assessment: FitAssessment,
) -> OutreachBrief:
    tension = arc.unresolved_tension.strip()
    open_question = tension or (
        "What would make the next move worth it to them? "
        "(No specific tension was found in the profile — ask, do not assume.)"
    )

    cautions = _cautions(arc, assessment)

    # These three carry model prose, so they are screened and withheld on
    # failure rather than aborting a run that is otherwise fine.
    story, c1 = _quarantine(
        arc.throughline, "one-line story", "(withheld — see cautions)")
    why, c2 = _quarantine(
        assessment.reasoning, "role rationale", "(withheld — see cautions)")
    question, c3 = _quarantine(
        open_question, "open question",
        "What is actually unresolved for them right now? (ask, do not assume)")
    cautions = [c for c in (c1, c2, c3) if c] + cautions

    brief = OutreachBrief(
        candidate_name=(profile.name or _ANONYMOUS),
        one_line_story=story,
        why_this_role=why,
        open_question=question,
        cautions=cautions,
    )

    # Final sweep over text this module composed. Verbatim citations are
    # exempt: they are the candidate's own words, already verified, and
    # policing their prose is not what rule 3 is for.
    quotes = [b.evidence for b in (arc.departures + arc.pursuits)]
    for i, caution in enumerate(brief.cautions):
        reject_sendable_text(caution, field=f"cautions[{i}]", exempt=quotes)

    return brief


__all__ = ["LOW_CONFIDENCE", "build_brief"]
