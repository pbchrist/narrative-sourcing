import pytest

from src.intake import IntakeError, load_role


def test_accepts_a_bare_sentence():
    r = load_role("founding engineer at a seed-stage AI infra company")
    assert "founding engineer" in r.raw_description


def test_derives_a_title_when_none_is_given():
    r = load_role("Founding Engineer, Platform\nOwn the roadmap end to end.")
    assert r.title == "Founding Engineer, Platform"


def test_derives_a_title_from_a_single_line_of_prose():
    r = load_role("someone who wants to go found their own company")
    assert r.title
    assert len(r.title) <= 80


def test_explicit_title_wins():
    r = load_role("Own the platform roadmap.", title="Platform Lead")
    assert r.title == "Platform Lead"


def test_accepts_a_short_semantic_prompt():
    # The point: this is not a job description, and it must still work.
    r = load_role("pre-PMF, no process, lots of ambiguity")
    assert r.raw_description == "pre-PMF, no process, lots of ambiguity"


def test_still_rejects_empty_input():
    with pytest.raises(IntakeError):
        load_role("   ")


def test_still_rejects_input_too_short_to_mean_anything():
    with pytest.raises(IntakeError):
        load_role("eng")


def test_keeps_a_full_job_description_intact():
    jd = "Own the platform roadmap end to end. " * 5
    r = load_role(jd, title="Platform Lead")
    assert r.raw_description.startswith("Own the platform roadmap")
