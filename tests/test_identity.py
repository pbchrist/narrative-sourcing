"""Does this text look like two profiles stacked together?

Rewritten after the first version caused a worse bug than the one it fixed.
It counted lines of two to four capitalised words as people's names, which
meant it fired on every real LinkedIn export ever pasted into it - cities,
skills, employers, schools and job titles all match that shape.

It was also quietly biased. Its exemption list was senior/staff/lead/engineer/
developer/analyst/manager - tech and corporate job words - so a tech profile's
titles were filtered out while "Line Producer" and "Studio Liaison" were
counted as human beings. It worked best on the kind of profile it was written
next to, which is the sort of failure worth writing down.

The contract now: structural evidence only, and a warning rather than a
refusal. Two bare CVs with no contact block and no section headings are NOT
detected, and that limit is deliberate - it beats guessing from capitalisation.
"""

from src.story.identity import one_person

ONE = """Contact
www.linkedin.com/in/cortmaclean
Los Angeles, California

Cort Maclean
Line Producer | Physical Production

Top Skills
Brand Strategy
Studio Liaison
Project Scheduling

Experience
Digitelio Film Development
Supervising Producer
2021 - Present

Education
Western Michigan University
"""

TWO = ONE + """

Contact
www.linkedin.com/in/danielaortiz
Chicago, Illinois

Daniela Ortiz
Structural Engineer

Experience
Thornton Tomasetti
2019 - Present

Education
Illinois Institute of Technology
"""


def test_a_single_export_passes():
    assert one_person(ONE).ok


def test_job_titles_are_not_people():
    assert one_person("Line Producer\nSupervising Producer\nStudio Liaison\n"
                      "Office Production Assistant\nProduction Coordinator").ok


def test_titles_outside_tech_are_treated_the_same_as_titles_inside_it():
    """The old list exempted engineer and manager but not producer or nurse."""
    for title in ("Senior Backend Engineer", "Line Producer", "Charge Nurse",
                  "Journeyman Electrician", "Sous Chef", "Claims Adjuster"):
        assert one_person(f"{title}\n{title}\n{title}").ok, title


def test_two_linkedin_handles_are_caught():
    f = one_person(TWO)
    assert not f.ok
    assert any("cortmaclean" in e or "danielaortiz" in e for e in f.evidence)


def test_two_email_addresses_are_caught():
    assert not one_person("a@example.com wrote this\nlater: b@example.com").ok


def test_the_same_address_twice_is_one_person():
    assert one_person("a@example.com\nsee also a@example.com").ok


def test_repeated_section_headings_are_caught():
    assert not one_person("Experience\nx\nEducation\ny\nExperience\nz\nEducation\nw").ok


def test_one_repeated_heading_alone_is_not_enough():
    assert one_person("Experience\nx\nExperience\ny\nSkills\nz").ok


def test_empty_text_is_not_an_accusation():
    for text in ("", "   ", None):
        assert one_person(text).ok
