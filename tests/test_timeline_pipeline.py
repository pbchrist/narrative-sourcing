"""The pipeline uses the dates it can see.

Three things it could not do before: prove a departure from the record, notice
a claim running backwards through that record, and tell the model what order
anything happened in.
"""

import json

from src.common.types import CandidateProfile
from src.story import extract_arc_detailed
from src.story import prompt as prompt_mod

CV = """Experience

Iconic
Founder and Principal
January 2023 - Present
Independent sourcing consultancy.

Groupon
Technical Recruiter
2015 - 2016
Hired engineers.

NBCUniversal, Inc.
Scriptwriter
October 2011 - January 2012
Created teleplays for Unilever and Syfy.

Focus Features
Acquisitions Executive
May 2005 - December 2005
Read scripts and bought films.
"""


def arc_for(**over):
    body = {"throughline": "Storytelling applied to hiring.",
            "throughline_evidence": [], "unresolved_tension": "",
            "tension_evidence": [], "departures": [], "pursuits": []}
    body.update(over)
    return extract_arc_detailed(CandidateProfile(raw_text=CV),
                                complete=lambda *a, **k: json.dumps(body))


def test_the_dates_prove_a_departure_the_words_never_state():
    """The failure that started this: an empty 'what they left' for a pivot."""
    arc, _ = arc_for(departures=[{
        "description": "Moved on from film acquisitions",
        "evidence": "Read scripts and bought films.", "confidence": 0.8}])
    assert [b.description for b in arc.departures] == ["Moved on from film acquisitions"]


def test_a_departure_from_the_job_they_still_hold_is_not_proven():
    arc, _ = arc_for(departures=[{
        "description": "Moved on from running the consultancy",
        "evidence": "Independent sourcing consultancy.", "confidence": 0.8}])
    assert arc.departures == []


def test_a_claim_running_backwards_through_the_dates_is_deleted():
    arc, report = arc_for(pursuits=[{
        "description": "Moved from technical recruiting into scriptwriting",
        "evidence": "Created teleplays for Unilever and Syfy.", "confidence": 0.9}])
    assert arc.pursuits == []
    assert any(d.reason == "contradicts_dates" for d in report.dropped)


def test_the_same_move_stated_the_right_way_round_survives():
    arc, _ = arc_for(pursuits=[{
        "description": "Moved from scriptwriting into technical recruiting",
        "evidence": "Hired engineers.", "confidence": 0.9}])
    assert len(arc.pursuits) == 1


def test_the_model_is_told_the_order_things_happened():
    built = prompt_mod.build(CandidateProfile(raw_text=CV))
    assert "2005" in built and "2023" in built
    assert built.index("2005") < built.index("2023"), "oldest must come first"


def test_a_profile_with_no_dates_still_works():
    body = json.dumps({"throughline": "t", "throughline_evidence": [],
                       "unresolved_tension": "", "tension_evidence": [],
                       "departures": [], "pursuits": []})
    arc, _ = extract_arc_detailed(
        CandidateProfile(raw_text="I write code and I like it a great deal."),
        complete=lambda *a, **k: body)
    assert arc.throughline == "t"
