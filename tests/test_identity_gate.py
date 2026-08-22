"""The pipeline refuses a profile that is two people.

Refusing is the point. The live failure was not a wrong answer that looked
wrong - it was a confident, internally consistent arc for a person who does
not exist, built from real quotes. A tool that says "this is two people" is
useful. A tool that averages them is worse than no tool.
"""

import json

import pytest

from src.common.types import CandidateProfile
from src.story import StoryError, extract_arc_detailed

MARTA = """Marta Reyes - Berlin
2023-now Backend Engineer, Pleo
I moved from Java to Go over the last two years."""

DEVON = """Devon Okonkwo - Austin, TX
2018-now Staff Embedded Engineer, Applied Materials
I write C for motion control on semiconductor deposition tools."""

BODY = json.dumps({
    "throughline": "Builds systems.",
    "throughline_evidence": ["I write C for motion control on semiconductor deposition tools."],
    "unresolved_tension": "", "tension_evidence": [], "departures": [], "pursuits": [],
})


def run(text, calls=None):
    def complete(*a, **k):
        if calls is not None:
            calls.append(1)
        return BODY
    return extract_arc_detailed(CandidateProfile(raw_text=text), complete=complete)


def test_two_people_are_refused():
    with pytest.raises(StoryError):
        run(MARTA + "\n\n" + DEVON)


def test_the_refusal_names_who_it_found():
    with pytest.raises(StoryError) as e:
        run(MARTA + "\n\n" + DEVON)
    assert "Marta Reyes" in str(e.value) and "Devon Okonkwo" in str(e.value)


def test_the_model_is_never_called_for_two_people():
    """Refusing after paying for the call would be a strange kind of refusal."""
    calls = []
    with pytest.raises(StoryError):
        run(MARTA + "\n\n" + DEVON, calls)
    assert calls == []


def test_one_person_still_works():
    arc, _ = run(DEVON)
    assert arc.throughline == "Builds systems."
