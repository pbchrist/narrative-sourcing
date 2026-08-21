"""The pipeline must drop a beat whose quote is real but does not support it."""

import json

from src.common.types import CandidateProfile
from src.story import extract_arc_detailed

RAW = """Currently working at Odum Research where I help building a modern trading platform.
I moved from Java to Go over the last two years.
Interested in automation, tool development and code optimization."""

PROFILE = CandidateProfile(raw_text=RAW, name="Balazs")


def fake(body):
    return lambda p, *, system=None, **k: json.dumps(body)


def body(pursuits):
    return {"throughline": "Builds systems regardless of language.",
            "unresolved_tension": "Which employer is current.",
            "departures": [], "pursuits": pursuits}


def test_a_real_quote_that_does_not_support_the_claim_is_dropped():
    # The exact live failure.
    arc, rep = extract_arc_detailed(PROFILE, complete=fake(body([{
        "description": "Seeking roles that involve building trading infrastructure",
        "evidence": "Currently working at Odum Research where I help building a modern trading platform.",
        "confidence": 0.9}])))
    assert arc.pursuits == []
    assert rep.dropped and rep.dropped[0].reason == "unsupported"


def test_the_same_quote_supports_a_claim_of_fact():
    arc, _ = extract_arc_detailed(PROFILE, complete=fake(body([{
        "description": "Works on trading platform engineering",
        "evidence": "Currently working at Odum Research where I help building a modern trading platform.",
        "confidence": 0.9}])))
    assert len(arc.pursuits) == 1


def test_the_drop_reason_explains_itself():
    _, rep = extract_arc_detailed(PROFILE, complete=fake(body([{
        "description": "Wants to lead a platform team",
        "evidence": "I moved from Java to Go over the last two years.",
        "confidence": 0.9}])))
    assert rep.dropped
    assert len(rep.dropped[0].note) > 20


def test_fabricated_quotes_still_fail_before_entailment_is_reached():
    _, rep = extract_arc_detailed(PROFILE, complete=fake(body([{
        "description": "Seeking roles in trading",
        "evidence": "Left the bank because the politics were unbearable",
        "confidence": 0.9}])))
    assert rep.dropped[0].reason in ("fabricated", "paraphrase", "near_miss")
