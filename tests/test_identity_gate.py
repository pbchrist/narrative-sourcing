"""The pipeline warns about a profile that looks like two people.

It used to refuse. Refusing turned out to be the wrong call: the detector
fired on ordinary single profiles and locked people out entirely, with no way
around it. A warning still tells the reader what was noticed, and an arc they
can look at and judge beats a door they cannot open.
"""

import json

import pytest

from src.common.types import CandidateProfile
from src.story import StoryError, extract_arc_detailed

ONE = """Contact
www.linkedin.com/in/cortmaclean
Cort Maclean
Experience
Digitelio Film Development
Education
Western Michigan University
I moved from mortgages to film and I am not going back."""

TWO = ONE + """

Contact
www.linkedin.com/in/danielaortiz
Daniela Ortiz
Experience
Thornton Tomasetti
Education
Illinois Institute of Technology"""

BODY = json.dumps({
    "throughline": "Builds things.",
    "throughline_evidence": ["I moved from mortgages to film and I am not going back."],
    "unresolved_tension": "", "tension_evidence": [], "departures": [], "pursuits": [],
})


def run(text):
    return extract_arc_detailed(CandidateProfile(raw_text=text),
                                complete=lambda *a, **k: BODY)


def test_two_profiles_produce_a_warning_not_an_error():
    arc, report = run(TWO)
    assert report.warnings
    assert arc.throughline == "Builds things."


def test_the_warning_says_what_it_saw():
    _, report = run(TWO)
    assert "cortmaclean" in " ".join(report.warnings)


def test_one_profile_produces_no_warning():
    arc, report = run(ONE)
    assert report.warnings == []
    assert arc.throughline == "Builds things."
