import json

import pytest

from src.common.types import Beat, CandidateProfile, CareerArc, RoleContext
from src.fit import assess, AMBIGUITY_FLOOR, FitError

RAW = """Led growth at an agency for six years.
Left because shipping and walking away stopped being satisfying.
Joined a Series B to own a product end to end.
Now runs a team of four and keeps asking about platform scope."""

PROFILE = CandidateProfile(raw_text=RAW, name="Dana")
ROLE = RoleContext(
    title="Platform Lead",
    raw_description="Own the platform roadmap end to end and grow a team.",
)


def arc(confidence=0.8):
    return CareerArc(
        throughline="Keeps trading reach for ownership.",
        departures=[Beat("Left agency", "Left because shipping", 0.8)],
        pursuits=[Beat("Wants ownership", "own a product end to end", 0.8)],
        unresolved_tension="Scope or depth.",
        confidence=confidence,
    )


def fake(payload):
    def _complete(prompt, *, system=None, **kw):
        return payload if isinstance(payload, str) else json.dumps(payload)
    return _complete


def test_returns_true_when_model_says_the_arc_continues():
    a = assess(arc(), ROLE, PROFILE, complete=fake(
        {"continues_arc": True, "reasoning": "Platform scope is the next step."}))
    assert a.continues_arc is True
    assert "platform" in a.reasoning.lower()


def test_returns_false_when_model_says_it_fractures():
    a = assess(arc(), ROLE, PROFILE, complete=fake(
        {"continues_arc": False, "reasoning": "This is a step back."}))
    assert a.continues_arc is False


def test_honors_model_returned_null_as_ambiguous():
    a = assess(arc(), ROLE, PROFILE, complete=fake(
        {"continues_arc": None, "reasoning": "Evidence is thin either way."}))
    assert a.continues_arc is None


def test_reads_ambiguous_string_as_none():
    a = assess(arc(), ROLE, PROFILE, complete=fake(
        {"continues_arc": "ambiguous", "reasoning": "Could read either way."}))
    assert a.continues_arc is None


def test_downgrades_confident_verdict_when_arc_is_poorly_evidenced():
    weak = arc(confidence=AMBIGUITY_FLOOR - 0.01)
    a = assess(weak, ROLE, PROFILE, complete=fake(
        {"continues_arc": True, "reasoning": "Looks like a fit."}))
    assert a.continues_arc is None
    assert any("confidence" in f.lower() for f in a.risk_flags)


def test_does_not_downgrade_when_arc_is_well_evidenced():
    a = assess(arc(confidence=0.9), ROLE, PROFILE, complete=fake(
        {"continues_arc": True, "reasoning": "Clear continuation."}))
    assert a.continues_arc is True


def test_carries_model_risk_flags_through():
    a = assess(arc(), ROLE, PROFILE, complete=fake({
        "continues_arc": True,
        "reasoning": "Fits.",
        "risk_flags": ["May read as a title downgrade; ask directly."],
    }))
    assert "May read as a title downgrade; ask directly." in a.risk_flags


def test_skill_overlap_is_computed_without_the_model():
    a = assess(arc(), ROLE, PROFILE, complete=fake(
        {"continues_arc": True, "reasoning": "Fits.", "skill_overlap": {"bogus": 1}}))
    assert "platform" in a.skill_overlap["matched"]
    assert a.skill_overlap["ratio"] > 0
    assert "bogus" not in a.skill_overlap


def test_skill_overlap_ignores_stopwords():
    a = assess(arc(), ROLE, PROFILE, complete=fake(
        {"continues_arc": True, "reasoning": "Fits."}))
    assert not {"the", "and", "end"} & set(a.skill_overlap["matched"])


def test_raises_without_reasoning():
    with pytest.raises(FitError):
        assess(arc(), ROLE, PROFILE, complete=fake({"continues_arc": True, "reasoning": " "}))


def test_prompt_carries_arc_and_role():
    seen = {}

    def _complete(prompt, *, system=None, **kw):
        seen["prompt"] = prompt
        return json.dumps({"continues_arc": True, "reasoning": "Fits."})

    assess(arc(), ROLE, PROFILE, complete=_complete)
    assert "Keeps trading reach for ownership." in seen["prompt"]
    assert "Platform Lead" in seen["prompt"]
