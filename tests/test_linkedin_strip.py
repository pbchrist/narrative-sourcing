from src.intake.linkedin import strip_furniture
from tests._pdfbuild import LINKEDIN_EXPORT

RAW = "\n".join(LINKEDIN_EXPORT)


def clean():
    return strip_furniture(RAW)[0]


def test_keeps_the_candidates_own_prose():
    out = clean()
    assert "the hard part isn't the code" in out
    assert "estimating work I would never have to maintain" in out


def test_drops_page_footer():
    assert "Page 1 of 2" not in clean()


def test_drops_contact_furniture():
    out = clean()
    assert "riley@example.com" not in out
    assert "+1 555 010 9931" not in out
    assert "linkedin.com/in/rileychen" not in out


def test_drops_top_skills_section():
    out = clean()
    assert "Distributed Systems" not in out
    assert "PostgreSQL" not in out


def test_drops_recommendations_because_they_are_someone_elses_voice():
    # The most important rule here. A colleague's praise is verbatim in
    # the document, so it would pass verify_span cleanly and be attributed
    # to the candidate's own self-narrative. A verifiable false
    # attribution is worse than a hallucination: nothing downstream flags
    # it.
    out = clean()
    assert "most talented engineer" not in out
    assert "single-handedly" not in out


def test_keeps_education_which_carries_transition_signal():
    # A mid-career degree or bootcamp is a real departure signal.
    out = clean()
    assert "Reed College" in out


def test_keeps_experience_section_intact():
    out = clean()
    assert "Kepler Health" in out
    assert "Thornbury Digital" in out
    assert "2015 - 2019" in out


def test_reports_what_it_removed():
    _, removed = strip_furniture(RAW)
    assert any("Page 1 of 2" in r for r in removed)
    assert any("most talented engineer" in r for r in removed)


def test_plain_text_without_furniture_is_left_alone():
    text = "Led growth at an agency.\nLeft to own a product end to end."
    out, removed = strip_furniture(text)
    assert out == text
    assert removed == []


def test_keeps_date_ranges_which_look_like_phone_numbers():
    # Dates are the load-bearing signal in an export: the arc is inferred
    # from the sequence of moves, so losing them costs more than any
    # furniture they resemble.
    for line in ["2015 - 2019", "2019 - 2022", "Jan 2019 - Mar 2022",
                 "2022 - Present", "2019"]:
        out, _ = strip_furniture(f"Experience\nKepler Health\n{line}\nDid work.")
        assert line in out, line


def test_still_drops_a_real_phone_number():
    out, _ = strip_furniture("Summary\n+1 555 010 9931\nReal prose here.")
    assert "555 010 9931" not in out


def test_still_drops_a_bare_page_number():
    out, _ = strip_furniture("Summary\nReal prose here.\n2")
    assert out.strip().endswith("Real prose here.")


def test_list_section_drop_stops_at_prose():
    # The sidebar in a real export runs Top Skills -> name -> headline ->
    # Summary with no reliable blank line between them. A naive "drop
    # until the next heading" eats the headline and the summary with it.
    text = "\n".join([
        "Top Skills", "PostgreSQL", "Kubernetes",
        "Riley Chen",
        "Engineering leader who likes the unglamorous half of software",
        "Summary", "Real prose here.",
    ])
    out, _ = strip_furniture(text)
    assert "PostgreSQL" not in out
    assert "Kubernetes" not in out
    assert "unglamorous half of software" in out
    assert "Real prose here." in out


def test_prose_section_drop_does_not_stop_at_prose():
    # Recommendations ARE prose, so the same rule must not apply to them.
    text = "\n".join([
        "Recommendations",
        "Riley single-handedly transformed our entire platform and would",
        "excel in any executive role, a visionary leader in every respect.",
        "Experience", "Kepler Health",
    ])
    out, _ = strip_furniture(text)
    assert "single-handedly" not in out
    assert "visionary leader" not in out
    assert "Kepler Health" in out


def test_blank_line_ends_a_dropped_section():
    text = "Top Skills\nPostgreSQL\n\nRiley Chen\nStaff Engineer"
    out, _ = strip_furniture(text)
    assert "PostgreSQL" not in out
    assert "Riley Chen" in out
