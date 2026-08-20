import dataclasses

import pytest

from src.brief import build_brief
from src.brief.guard import SendableTextError
from src.common.types import (
    Beat, CandidateProfile, CareerArc, FitAssessment, OutreachBrief,
)

PROFILE = CandidateProfile(raw_text="x" * 200, name="Dana")


def arc(confidence=0.8, tension="Whether ownership means scope or depth."):
    return CareerArc(
        throughline="Keeps trading reach for ownership.",
        departures=[Beat("Left agency", "shipping and walking away", 0.8)],
        pursuits=[Beat("Wants ownership", "own a product end to end", 0.8)],
        unresolved_tension=tension,
        confidence=confidence,
    )


def assessment(continues=True, flags=None):
    return FitAssessment(
        continues_arc=continues,
        reasoning="Platform scope is the next step in the arc.",
        risk_flags=flags or [],
        skill_overlap={"matched": ["platform"], "ratio": 0.2},
    )


def test_brief_has_no_sendable_message_field():
    names = {f.name for f in dataclasses.fields(OutreachBrief)}
    assert not names & {"message", "drafted_message", "draft", "body", "text"}


def test_draft_status_is_always_needs_human_message():
    b = build_brief(PROFILE, arc(), assessment())
    assert b.draft_status == "needs_human_message"


def test_carries_candidate_name():
    assert build_brief(PROFILE, arc(), assessment()).candidate_name == "Dana"


def test_unnamed_candidate_does_not_crash():
    anon = CandidateProfile(raw_text="x" * 200)
    assert build_brief(anon, arc(), assessment()).candidate_name


def test_one_line_story_is_the_throughline():
    b = build_brief(PROFILE, arc(), assessment())
    assert "ownership" in b.one_line_story.lower()


def test_open_question_comes_from_the_unresolved_tension():
    b = build_brief(PROFILE, arc(), assessment())
    assert "scope or depth" in b.open_question.lower()


def test_low_confidence_arc_surfaces_the_number_in_cautions():
    b = build_brief(PROFILE, arc(confidence=0.31), assessment())
    assert any("0.31" in c for c in b.cautions)


def test_high_confidence_arc_adds_no_confidence_caution():
    b = build_brief(PROFILE, arc(confidence=0.92), assessment())
    assert not any("confidence" in c.lower() for c in b.cautions)


def test_ambiguous_verdict_is_stated_plainly_not_smoothed():
    b = build_brief(PROFILE, arc(), assessment(continues=None))
    assert any("did not" in c.lower() or "no verdict" in c.lower() for c in b.cautions)


def test_negative_verdict_is_surfaced():
    b = build_brief(PROFILE, arc(), assessment(continues=False))
    assert any("fracture" in c.lower() or "does not continue" in c.lower()
               for c in b.cautions)


def test_risk_flags_reach_the_cautions():
    b = build_brief(PROFILE, arc(), assessment(flags=["Possible title downgrade."]))
    assert "Possible title downgrade." in b.cautions


def test_missing_tension_is_flagged_rather_than_invented():
    b = build_brief(PROFILE, arc(tension=""), assessment())
    assert any("tension" in c.lower() for c in b.cautions)
    assert b.open_question


def test_arc_with_no_surviving_evidence_is_loudly_flagged():
    empty = CareerArc(throughline="A guess.", departures=[], pursuits=[],
                      unresolved_tension="", confidence=0.0)
    b = build_brief(PROFILE, empty, assessment())
    assert any("no evidence" in c.lower() or "0.0" in c for c in b.cautions)


def test_guard_runs_on_every_brief():
    poisoned = assessment()
    poisoned.reasoning = "Hi Dana, I'd love to chat about this role."
    with pytest.raises(SendableTextError):
        build_brief(PROFILE, arc(), poisoned)
