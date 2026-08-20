"""(CareerArc, RoleContext) -> FitAssessment.

The question this module answers is not "does this person match the
requirements" but "does this role continue the story we just read". The
requirements match is computed alongside it and kept deliberately small.
"""

from src.common import llm
from src.common.parsing import ParseError, extract_json
from src.common.types import CandidateProfile, CareerArc, FitAssessment, RoleContext
from src.fit import overlap

# Below this arc confidence, no verdict is allowed to stand. A clean
# yes/no resting on a poorly evidenced arc is Principle 4's failure mode.
AMBIGUITY_FLOOR = 0.45

_AMBIGUOUS_WORDS = {"ambiguous", "unclear", "unknown", "none", "null", "n/a"}

SYSTEM = """You are given a reading of a candidate's career arc and a \
description of what they are being considered for. That description may be \
a full job posting, or it may be a single sentence, a set of working \
conditions, or a direction ("going to found something"). Treat whatever \
you are given as the move under consideration.

Judge one thing: does this move continue that arc, or does it fracture it?

You are not scoring qualifications. Skills overlap is computed separately \
and is not your job. Your job is the narrative question: would making this \
move be the next chapter of the story you were given, a detour from it, or \
a contradiction of it? If the description is thin, say so in your \
reasoning rather than inventing detail to judge.

Return ONLY a JSON object:
{
  "continues_arc": true | false | null,
  "reasoning": "two or three sentences",
  "risk_flags": ["things the recruiter should raise directly rather than \
paper over"]
}

Use null when the evidence genuinely does not support a verdict. null is a \
real answer and is preferred over a confident guess. Do not write anything \
addressed to the candidate."""


class FitError(RuntimeError):
    """The backend returned something unusable as a FitAssessment."""


def _read_verdict(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    if isinstance(value, str) and value.strip().lower() in _AMBIGUOUS_WORDS:
        return None
    if isinstance(value, str):
        if value.strip().lower() in {"true", "yes"}:
            return True
        if value.strip().lower() in {"false", "no"}:
            return False
    return None


def _build_prompt(arc: CareerArc, role: RoleContext) -> str:
    lines = [
        "CAREER ARC",
        f"Throughline: {arc.throughline}",
        f"Unresolved tension: {arc.unresolved_tension}",
        f"Arc confidence (derived from verified evidence): {arc.confidence}",
    ]
    for label, beats in (("Departures", arc.departures), ("Pursuits", arc.pursuits)):
        lines.append(f"{label}:")
        if not beats:
            lines.append("  (none survived evidence verification)")
        for b in beats:
            lines.append(f"  - {b.description} [confidence {b.confidence}]")
            lines.append(f'    evidence: "{b.evidence}"')

    lines += ["", "UNDER CONSIDERATION", f"Label: {role.title}"]
    if role.company_context:
        lines.append(f"Context: {role.company_context}")
    lines += ["Description:", role.raw_description]
    return "\n".join(lines)


def assess(
    arc: CareerArc,
    role: RoleContext,
    profile: CandidateProfile,
    *,
    complete=None,
) -> FitAssessment:
    complete = complete or llm.complete

    # LLMError propagates untouched: a backend timeout is not a fit
    # failure, and relabelling it as one hides what actually went wrong.
    try:
        data = extract_json(complete(_build_prompt(arc, role), system=SYSTEM))
    except ParseError as exc:
        raise FitError(str(exc)) from exc

    reasoning = str(data.get("reasoning") or "").strip()
    if not reasoning:
        raise FitError("response contained no reasoning")

    verdict = _read_verdict(data.get("continues_arc"))
    flags = [
        str(f).strip() for f in (data.get("risk_flags") or [])
        if str(f).strip()
    ]

    if verdict is not None and arc.confidence < AMBIGUITY_FLOOR:
        flags.insert(0, (
            f"Verdict withheld: the arc's own confidence is {arc.confidence}, "
            f"below the {AMBIGUITY_FLOOR} floor. The model offered a verdict "
            f"but the arc is too thinly evidenced to support one."
        ))
        verdict = None

    return FitAssessment(
        continues_arc=verdict,
        reasoning=reasoning,
        risk_flags=flags,
        # Computed here, never taken from the model's JSON.
        skill_overlap=overlap.compute(profile.raw_text, role.raw_description),
    )


__all__ = ["AMBIGUITY_FLOOR", "FitError", "assess"]
