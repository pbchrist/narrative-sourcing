import json

from src.common.types import CandidateProfile
from src.story import extract_arc_detailed

RAW = """Led growth at an agency for six years.
Left because shipping and walking away stopped being satisfying.
Joined a Series B to own a product end to end."""

PROFILE = CandidateProfile(raw_text=RAW, name="Dana")


def fake(payload):
    return lambda prompt, *, system=None, **kw: json.dumps(payload)


def body(pursuits):
    return {"throughline": "t", "unresolved_tension": "u",
            "departures": [], "pursuits": pursuits}


def one(evidence):
    return body([{"description": "d", "evidence": evidence, "confidence": 0.8}])


def test_counts_proposed_and_kept():
    _, rep = extract_arc_detailed(PROFILE, complete=fake(one(
        "Joined a Series B to own a product end to end.")))
    assert rep.proposed == 1
    assert rep.kept == 1
    assert rep.dropped == []


def test_classifies_an_exact_reformatting_as_near_miss():
    # Same words, different whitespace/punctuation. This is my checker
    # being strict, not the model inventing anything.
    _, rep = extract_arc_detailed(PROFILE, complete=fake(one(
        "Joined a Series B to own a product end to end")))
    assert rep.kept == 1  # normalization should absorb this outright


def test_classifies_a_paraphrase():
    _, rep = extract_arc_detailed(PROFILE, complete=fake(one(
        "Joined a Series B company to own the product end to end")))
    assert rep.kept == 0
    assert rep.dropped[0].reason == "paraphrase"
    assert 0.5 <= rep.dropped[0].overlap < 0.9


def test_classifies_a_fabrication():
    _, rep = extract_arc_detailed(PROFILE, complete=fake(one(
        "Burned out after a toxic manager made the job unbearable")))
    assert rep.dropped[0].reason == "fabricated"
    assert rep.dropped[0].overlap < 0.5


def test_classifies_a_too_short_span():
    _, rep = extract_arc_detailed(PROFILE, complete=fake(one("agency")))
    assert rep.dropped[0].reason == "too_short"


def test_report_records_the_offending_quote():
    _, rep = extract_arc_detailed(PROFILE, complete=fake(one(
        "Burned out after a toxic manager made the job unbearable")))
    assert "toxic manager" in rep.dropped[0].evidence


def test_extract_arc_still_returns_just_an_arc():
    arc = extract_arc(PROFILE, complete=fake(one(
        "Joined a Series B to own a product end to end.")))
    assert arc.throughline == "t"


from src.story import extract_arc  # noqa: E402
