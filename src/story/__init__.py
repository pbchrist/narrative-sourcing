"""CandidateProfile -> CareerArc. The core novel piece.

Three stages, deliberately separable: ask the model, verify what it
claimed against the source text, then derive confidence from what
survived. The model proposes; this module decides what ships.
"""

from src.common import llm
from src.common.parsing import ParseError, extract_json
from src.common.types import Beat, CandidateProfile, CareerArc
from src.story import prompt as prompt_mod
from src.story.verify import canonical, verify_span

# A well-supported arc cites several different parts of the profile. Four
# distinct spans is treated as full coverage; fewer scales down.
TARGET_DISTINCT_SPANS = 4

# A short quote can be verbatim yet carry little weight, so it caps the
# confidence of any beat resting on it.
SUBSTANTIVE_SPAN_CHARS = 40
CEILING_SUBSTANTIVE = 0.9
CEILING_THIN = 0.6


class StoryError(RuntimeError):
    """The backend returned something unusable as a CareerArc."""


def _beat_confidence(reported, evidence: str) -> float:
    """The model may lower its own confidence, never raise it.

    An abliterated backend is poorly calibrated in the confident
    direction, so a self-reported 1.0 means very little. Doubt, on the
    other hand, is informative: a model saying 0.2 is worth hearing. So
    the reported value is honored as a ceiling from below, and capped from
    above by how substantial the citation actually is.
    """
    try:
        value = float(reported)
    except (TypeError, ValueError):
        value = CEILING_THIN
    value = max(0.0, min(1.0, value))

    ceiling = (
        CEILING_SUBSTANTIVE
        if len(canonical(evidence)) >= SUBSTANTIVE_SPAN_CHARS
        else CEILING_THIN
    )
    return round(min(value, ceiling), 2)


def _verified_beats(raw_beats, raw_text: str) -> tuple[list[Beat], int]:
    """Return the beats whose evidence genuinely appears in raw_text, plus
    the number proposed. Unverifiable beats are dropped, per Principle 1."""
    kept: list[Beat] = []
    proposed = 0
    for item in raw_beats or []:
        if not isinstance(item, dict):
            continue
        proposed += 1
        evidence = str(item.get("evidence") or "")
        description = str(item.get("description") or "").strip()
        if not description or not verify_span(evidence, raw_text):
            continue
        kept.append(Beat(
            description=description,
            evidence=normalize_evidence(evidence),
            confidence=_beat_confidence(item.get("confidence"), evidence),
        ))
    return kept, proposed


def normalize_evidence(evidence: str) -> str:
    """Store the citation tidied but not rewritten."""
    return " ".join(str(evidence).split()).strip('"“” ')


def _arc_confidence(beats: list[Beat], proposed: int) -> float:
    """Derived, never taken from the model.

    Three things make an arc trustworthy: the model's claims held up
    (survival), it drew on several different parts of the profile
    (coverage), and it was not itself unsure (the beats' own confidence).
    """
    if proposed == 0 or not beats:
        return 0.0

    survival = len(beats) / proposed
    distinct = len({canonical(b.evidence) for b in beats})
    coverage = min(1.0, distinct / TARGET_DISTINCT_SPANS)
    mean_beat = sum(b.confidence for b in beats) / len(beats)
    return round(survival * coverage * mean_beat, 2)


def extract_arc(
    profile: CandidateProfile,
    *,
    complete=None,
) -> CareerArc:
    """Read the arc out of a profile, keeping only what the text supports."""
    complete = complete or llm.complete

    response = complete(
        prompt_mod.build(profile),
        system=prompt_mod.SYSTEM,
    )
    try:
        data = extract_json(response)
    except ParseError as exc:
        raise StoryError(str(exc)) from exc

    throughline = str(data.get("throughline") or "").strip()
    if not throughline:
        raise StoryError("response contained no throughline")

    departures, dep_proposed = _verified_beats(
        data.get("departures"), profile.raw_text
    )
    pursuits, pur_proposed = _verified_beats(
        data.get("pursuits"), profile.raw_text
    )
    beats = departures + pursuits

    return CareerArc(
        throughline=throughline,
        departures=departures,
        pursuits=pursuits,
        unresolved_tension=str(data.get("unresolved_tension") or "").strip(),
        # data["confidence"] is read and deliberately discarded; see
        # _arc_confidence and the backend note in src/common/llm.py.
        confidence=_arc_confidence(beats, dep_proposed + pur_proposed),
    )


__all__ = ["StoryError", "extract_arc"]
