import pytest

from src.intake import IntakeError, load_candidate, load_role


ARC_TEXT = (
    "Ten years of agency work, then in-house at a Series B. Left the agency "
    "because shipping and walking away stopped being satisfying."
)


def test_load_candidate_builds_profile():
    p = load_candidate(f"  {ARC_TEXT}  ", name="Dana")
    assert p.name == "Dana"
    assert p.raw_text == ARC_TEXT


def test_load_candidate_rejects_empty_text():
    with pytest.raises(IntakeError):
        load_candidate("   ")


def test_load_candidate_rejects_text_too_short_to_have_an_arc():
    with pytest.raises(IntakeError):
        load_candidate("Dana. Engineer.")


def test_load_candidate_defaults_optional_fields_to_none():
    p = load_candidate("x" * 200)
    assert p.name is None
    assert p.known_roles is None
    assert p.source_notes is None


def test_load_candidate_drops_blank_known_roles():
    p = load_candidate("x" * 200, known_roles=["Staff Engineer", "  ", ""])
    assert p.known_roles == ["Staff Engineer"]


def test_load_role_builds_context():
    r = load_role("x" * 100, title="  Staff Engineer  ")
    assert r.title == "Staff Engineer"
    assert r.company_context is None


def test_load_role_derives_a_title_when_given_a_blank_one():
    # A title is a label for the human reading the brief; scoring does not
    # depend on it, so a blank one is filled in rather than refused.
    assert load_role("x" * 100, title="").title


def test_load_role_rejects_empty_description():
    with pytest.raises(IntakeError):
        load_role("  ", title="Staff Engineer")


def test_intake_makes_no_llm_calls(monkeypatch):
    def explode(*a, **k):
        raise AssertionError("intake must not call the LLM")

    monkeypatch.setattr("src.common.llm.complete", explode)
    load_candidate("x" * 200)
    load_role("x" * 100, title="Staff Engineer")
