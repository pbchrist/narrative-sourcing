"""The two lines a recruiter repeats must be quotable, or marked unquotable.

Regression suite for the worst bug the project has had: every beat could pass
the verbatim check while the throughline above them was pure invention, and
the brief printed a reassuring "0 were deleted" underneath it.
"""

import json

from src.common.types import CandidateProfile
from src.story import extract_arc

RAW = """Led growth at an agency for six years.
Left because shipping and walking away stopped being satisfying.
Joined a Series B to own a product end to end."""

PROFILE = CandidateProfile(raw_text=RAW, name="Dana")


def fake(body):
    return lambda p, *, system=None, **k: json.dumps(body)


def body(**over):
    b = {
        "throughline": "Trades reach for ownership.",
        "unresolved_tension": "Scope or depth.",
        "departures": [{"description": "Left the agency",
                        "evidence": "Left because shipping and walking away stopped being satisfying.",
                        "confidence": 0.8}],
        "pursuits": [{"description": "Wants ownership",
                      "evidence": "Joined a Series B to own a product end to end.",
                      "confidence": 0.8}],
    }
    b.update(over)
    return b


def test_headline_quotes_that_check_out_are_kept():
    arc = extract_arc(PROFILE, complete=fake(body(
        throughline_evidence=["Joined a Series B to own a product end to end."])))
    assert arc.throughline_anchored
    assert arc.throughline_evidence == ["Joined a Series B to own a product end to end."]


def test_invented_headline_quotes_are_struck():
    arc = extract_arc(PROFILE, complete=fake(body(
        throughline_evidence=["Left the bank because the politics were unbearable"])))
    assert not arc.throughline_anchored
    assert arc.throughline_evidence == []


def test_a_headline_offering_no_quote_is_not_anchored():
    arc = extract_arc(PROFILE, complete=fake(body()))
    assert not arc.throughline_anchored
    assert not arc.tension_anchored


def test_verified_beats_do_not_launder_an_invented_headline():
    # The original bug, stated as a test: every beat checks out, the headline
    # is fiction, and the arc must not present it as grounded.
    arc = extract_arc(PROFILE, complete=fake(body(
        throughline="They have spent their career escaping bureaucracy in search of autonomy.",
        throughline_evidence=["escaping bureaucracy in search of autonomy"])))
    assert len(arc.departures) + len(arc.pursuits) == 2   # beats are fine
    assert not arc.throughline_anchored                    # headline is not


def test_tension_is_held_to_the_same_rule():
    arc = extract_arc(PROFILE, complete=fake(body(
        tension_evidence=["Left because shipping and walking away stopped being satisfying."])))
    assert arc.tension_anchored


def test_a_single_string_is_accepted_not_only_a_list():
    arc = extract_arc(PROFILE, complete=fake(body(
        throughline_evidence="Joined a Series B to own a product end to end.")))
    assert arc.throughline_anchored


def test_duplicate_quotes_collapse():
    q = "Joined a Series B to own a product end to end."
    arc = extract_arc(PROFILE, complete=fake(body(throughline_evidence=[q, q])))
    assert len(arc.throughline_evidence) == 1


def test_garbage_in_the_field_does_not_crash():
    for junk in (42, {"a": 1}, [None, 7], None):
        arc = extract_arc(PROFILE, complete=fake(body(throughline_evidence=junk)))
        assert arc.throughline_evidence == []
