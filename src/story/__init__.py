"""CandidateProfile -> CareerArc. The core novel piece.

Three stages, deliberately separable: ask the model, verify what it
claimed against the source text, then derive confidence from what
survived. The model proposes; this module decides what ships.
"""

import difflib
from dataclasses import dataclass, field

from src.common import llm
from src.common.parsing import ParseError, extract_json
from src.common.types import Beat, CandidateProfile, CareerArc
from src.story import prompt as prompt_mod
from src.story.entails import entails
from src.story.identity import one_person
from src.story.verify import MIN_SPAN_CHARS, canonical, normalize, verify_span

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


@dataclass
class DroppedBeat:
    """A claim that failed evidence verification, and why.

    `reason` separates the model inventing things from this codebase being
    strict. Reporting a drop rate without that split would overstate the
    verifier's value: a quote rejected over a stray hyphen is not a
    hallucination caught.
    """
    description: str
    evidence: str
    overlap: float  # longest run of the quote actually present, 0-1
    reason: str     # too_short | near_miss | paraphrase | fabricated | unsupported
    note: str = ""  # for "unsupported": why the real quote does not back it


@dataclass
class ExtractionReport:
    proposed: int = 0
    kept: int = 0
    dropped: list = field(default_factory=list)
    # Things worth telling the reader that are not grounds for refusing to
    # work. Refusing on a guess locked a real user out of the tool over an
    # ordinary profile; see src/story/identity.py.
    warnings: list = field(default_factory=list)

    @property
    def drop_rate(self) -> float:
        return round(len(self.dropped) / self.proposed, 3) if self.proposed else 0.0


def _classify(evidence: str, raw_text: str) -> tuple[float, str]:
    """Why a citation failed: the model inventing, or this code being strict.

    Two signals, because neither alone separates the cases. The longest
    contiguous run says how much of the quote is literally present; local
    similarity around that run says whether the surrounding text is the
    same content reworded. Anything fully contiguous has already passed
    verify_span, so "near_miss" here means a large fragment matched but
    the rest did not.

    The paraphrase/fabricated boundary is a judgement call, not a fact.
    Calibrated against hand-written examples; treat counts near the
    boundary as soft.
    """
    needle = canonical(evidence)
    if len(needle) < MIN_SPAN_CHARS:
        return 1.0, "too_short"

    hay = normalize(raw_text).lower()
    match = difflib.SequenceMatcher(None, needle, hay).find_longest_match(
        0, len(needle), 0, len(hay))
    contiguous = match.size / len(needle)

    lo = max(0, match.b - len(needle) // 2)
    window = hay[lo:match.b + len(needle) * 3 // 2]
    local = round(difflib.SequenceMatcher(None, needle, window).ratio(), 3)

    if contiguous >= 0.5:
        return local, "near_miss"
    if local >= 0.55:
        return local, "paraphrase"
    return local, "fabricated"


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


def _verified_beats(raw_beats, raw_text: str, report=None) -> tuple[list[Beat], int]:
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
            if report is not None:
                overlap, reason = _classify(evidence, raw_text)
                report.dropped.append(DroppedBeat(
                    description=description, evidence=evidence,
                    overlap=overlap, reason=reason))
            continue

        # The quote is genuinely theirs. Second gate: does it actually back
        # this claim? A real quote attached to an inference it does not
        # support is how a sourcing tool starts inventing motives.
        verdict = entails(description, evidence)
        if not verdict.ok:
            if report is not None:
                report.dropped.append(DroppedBeat(
                    description=description, evidence=evidence,
                    overlap=1.0, reason="unsupported", note=verdict.reason))
            continue
        kept.append(Beat(
            description=description,
            evidence=normalize_evidence(evidence),
            confidence=_beat_confidence(item.get("confidence"), evidence),
        ))
    return kept, proposed


def _verified_quotes(raw, raw_text: str, claim: str = "") -> list[str]:
    """Keep only the quotes that genuinely appear in the profile.

    Used for the throughline and the unresolved tension. Those two cannot be
    checked the way a beat is - they are syntheses - so instead they are made
    to cite, and the citations get the identical treatment. A synthesis nobody
    checked is precisely the line a reader repeats as fact.

    Both gates, not one. verify_span stops a quote that is not in the profile;
    entails stops a quote that IS in the profile but does not back what the
    headline says. A live run produced both failures here: a tension claiming
    "the lingering impact of a long, cancelled project" citing the line that
    only says it was cancelled, and a throughline about "broader engineering
    leadership" citing a line that is an employer and a date.
    """
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    out = []
    for q in raw:
        if isinstance(q, str) and verify_span(q, raw_text):
            if claim and not entails(claim, q).ok:
                continue
            text = normalize_evidence(q)
            if text not in out:
                out.append(text)
    return out


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


def extract_arc(profile: CandidateProfile, *, complete=None) -> CareerArc:
    """Read the arc out of a profile, keeping only what the text supports."""
    return extract_arc_detailed(profile, complete=complete)[0]


def extract_arc_detailed(
    profile: CandidateProfile,
    *,
    complete=None,
) -> tuple[CareerArc, ExtractionReport]:
    """As extract_arc, but also reports what was thrown away and why.

    Exists to answer the question the whole design rests on: does evidence
    verification actually catch anything, or is it ceremony?
    """
    complete = complete or llm.complete
    report = ExtractionReport()

    # Is this one person? Every other gate asks whether a claim is supported
    # by the text; none asks whether the text is about a single human being.
    # This warns rather than refuses. The first version refused, on a signal
    # that turned out to fire on every real LinkedIn export, and locking
    # someone out of the tool over an ordinary profile is a far worse outcome
    # than one arc a reader can see is muddled.
    who = one_person(profile.raw_text)
    if not who.ok:
        report.warnings.append(f"{who.reason} ({'; '.join(who.evidence)})")

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
        data.get("departures"), profile.raw_text, report
    )
    pursuits, pur_proposed = _verified_beats(
        data.get("pursuits"), profile.raw_text, report
    )
    beats = departures + pursuits
    report.proposed = dep_proposed + pur_proposed
    report.kept = len(beats)

    tension = str(data.get("unresolved_tension") or "").strip()
    arc = CareerArc(
        throughline=throughline,
        throughline_evidence=_verified_quotes(
            data.get("throughline_evidence"), profile.raw_text, throughline),
        tension_evidence=_verified_quotes(
            data.get("tension_evidence"), profile.raw_text, tension),
        departures=departures,
        pursuits=pursuits,
        unresolved_tension=tension,
        # data["confidence"] is read and deliberately discarded; see
        # _arc_confidence and the backend note in src/common/llm.py.
        confidence=_arc_confidence(beats, dep_proposed + pur_proposed),
    )
    return arc, report


__all__ = ["DroppedBeat", "ExtractionReport", "StoryError", "extract_arc",
           "extract_arc_detailed"]
