"""The throughline and the tension are held to the same gate as the beats.

verify_span already stops them citing text that is not in the profile. It does
not stop them citing text that IS in the profile but does not back what they
say - and those two lines are precisely the ones a recruiter repeats out loud.

Both cases below came out of a live run against the real model.
"""

import json

from src.common.types import CandidateProfile
from src.story import extract_arc_detailed

PROFILE = """Devon Okonkwo - Austin, TX
2014-2018  Firmware Engineer, National Instruments
2018-now   Staff Embedded Engineer, Applied Materials
I write C for motion control on semiconductor deposition tools.
Spent about eighteen months on a migration that got cancelled."""


def arc_for(**over):
    body = {"throughline": "Builds low-level deterministic systems.",
            "throughline_evidence": ["I write C for motion control on semiconductor deposition tools."],
            "unresolved_tension": "", "tension_evidence": [],
            "departures": [], "pursuits": []}
    body.update(over)
    return extract_arc_detailed(
        CandidateProfile(raw_text=PROFILE, name="Devon"),
        complete=lambda *a, **k: json.dumps(body))[0]


def test_a_supported_throughline_keeps_its_quote():
    assert arc_for().throughline_evidence == [
        "I write C for motion control on semiconductor deposition tools."]


def test_a_leadership_throughline_loses_a_quote_about_a_job_title():
    """Live: 'a shift toward broader engineering leadership' cited by a line
    that is nothing but an employer and a date."""
    arc = arc_for(
        throughline="A shift toward broader engineering leadership.",
        throughline_evidence=["2018-now   Staff Embedded Engineer, Applied Materials"])
    assert arc.throughline_evidence == []


def test_a_tension_about_lingering_impact_loses_a_quote_about_the_event():
    """Live: 'the lingering impact of a long, cancelled project' cited by the
    line that merely says the project was cancelled."""
    arc = arc_for(
        unresolved_tension="She still carries the lingering impact of the cancelled project.",
        tension_evidence=["Spent about eighteen months on a migration that got cancelled."])
    assert arc.tension_evidence == []


def test_a_supported_tension_keeps_its_quote():
    arc = arc_for(
        unresolved_tension="Whether the cancelled migration was time well spent.",
        tension_evidence=["Spent about eighteen months on a migration that got cancelled."])
    assert arc.tension_evidence == [
        "Spent about eighteen months on a migration that got cancelled."]


def test_an_invented_quote_still_goes_first():
    """The verbatim rule has not been softened by adding a second gate."""
    arc = arc_for(throughline_evidence=["He grew tired of the corporate treadmill."])
    assert arc.throughline_evidence == []
