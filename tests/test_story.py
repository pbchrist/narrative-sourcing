import json

import pytest

from src.common.types import CandidateProfile
from src.story import StoryError, extract_arc

RAW = """Led growth at an agency for six years.
Left because shipping and walking away stopped being satisfying.
Joined a Series B to own a product end to end.
Now runs a team of four and keeps asking about platform scope."""

PROFILE = CandidateProfile(raw_text=RAW, name="Dana")


def fake(payload):
    def _complete(prompt, *, system=None, **kw):
        return payload

    return _complete


def arc_json(**over):
    body = {
        "throughline": "Keeps trading reach for ownership.",
        "unresolved_tension": "Whether ownership means scope or depth.",
        "confidence": 0.99,
        "departures": [
            {
                "description": "Left agency work for ownership",
                "evidence": "Left because shipping and walking away stopped being satisfying.",
                "confidence": 0.8,
            }
        ],
        "pursuits": [
            {
                "description": "Wants end-to-end product ownership",
                "evidence": "Joined a Series B to own a product end to end.",
                "confidence": 0.8,
            },
            {
                "description": "Reaching toward platform scope",
                "evidence": "keeps asking about platform scope",
                "confidence": 0.7,
            },
        ],
    }
    body.update(over)
    return json.dumps(body)


def test_extracts_throughline_and_tension():
    arc = extract_arc(PROFILE, complete=fake(arc_json()))
    assert arc.throughline == "Keeps trading reach for ownership."
    assert arc.unresolved_tension == "Whether ownership means scope or depth."


def test_keeps_beats_whose_evidence_verifies():
    arc = extract_arc(PROFILE, complete=fake(arc_json()))
    assert len(arc.departures) == 1
    assert len(arc.pursuits) == 2


def test_drops_beat_whose_evidence_is_invented():
    payload = arc_json(departures=[{
        "description": "Left after a conflict with a manager",
        "evidence": "Left after clashing with a difficult manager",
        "confidence": 0.9,
    }])
    arc = extract_arc(PROFILE, complete=fake(payload))
    assert arc.departures == []


def test_dropping_all_evidence_drives_confidence_to_zero():
    payload = arc_json(
        departures=[{"description": "d", "evidence": "invented entirely", "confidence": 0.9}],
        pursuits=[{"description": "p", "evidence": "also invented", "confidence": 0.9}],
    )
    arc = extract_arc(PROFILE, complete=fake(payload))
    assert arc.confidence == 0.0


def test_model_self_reported_arc_confidence_is_discarded():
    arc = extract_arc(PROFILE, complete=fake(arc_json(confidence=0.99)))
    assert arc.confidence != 0.99


def test_model_may_lower_beat_confidence_but_never_raise_it():
    low = arc_json(pursuits=[{
        "description": "Reaching toward platform scope",
        "evidence": "Joined a Series B to own a product end to end.",
        "confidence": 0.1,
    }])
    arc = extract_arc(PROFILE, complete=fake(low))
    assert arc.pursuits[0].confidence == pytest.approx(0.1)

    high = arc_json(pursuits=[{
        "description": "Reaching toward platform scope",
        "evidence": "Joined a Series B to own a product end to end.",
        "confidence": 1.0,
    }])
    arc = extract_arc(PROFILE, complete=fake(high))
    assert arc.pursuits[0].confidence < 1.0


def test_repeated_citation_of_one_span_scores_lower_than_distinct_spans():
    same = arc_json(
        departures=[{"description": "a", "evidence": "Joined a Series B to own a product end to end.", "confidence": 0.8}],
        pursuits=[{"description": "b", "evidence": "Joined a Series B to own a product end to end.", "confidence": 0.8}],
    )
    narrow = extract_arc(PROFILE, complete=fake(same))
    broad = extract_arc(PROFILE, complete=fake(arc_json()))
    assert narrow.confidence < broad.confidence


def test_parses_json_wrapped_in_markdown_fence():
    payload = "Here you go:\n```json\n" + arc_json() + "\n```\n"
    arc = extract_arc(PROFILE, complete=fake(payload))
    assert arc.throughline == "Keeps trading reach for ownership."


def test_raises_when_response_has_no_json():
    with pytest.raises(StoryError):
        extract_arc(PROFILE, complete=fake("I cannot help with that."))


def test_raises_when_throughline_missing():
    with pytest.raises(StoryError):
        extract_arc(PROFILE, complete=fake(arc_json(throughline="   ")))


def test_prompt_contains_the_profile_text():
    seen = {}

    def _complete(prompt, *, system=None, **kw):
        seen["prompt"] = prompt
        seen["system"] = system
        return arc_json()

    extract_arc(PROFILE, complete=_complete)
    assert RAW in seen["prompt"]
    assert "verbatim" in seen["system"].lower()
