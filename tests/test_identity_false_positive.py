"""One real profile must never be called two people.

Reported from live use. A single LinkedIn export was refused with a list of
twenty-six "people" that were actually cities, skills, employers, universities,
job titles, and the names of colleagues who had left recommendations:

    found Los Angeles and Digitelio Film Development and Cort Maclean and
    Western Michigan University and Brand Strategy and Beverly Hills and
    Line Producer and Quicken Loans and Problem Solving and ...

The old detector counted lines of two to four capitalised words. A LinkedIn
export is almost entirely lines of two to four capitalised words, so it fired
on every real profile it ever saw.

The costs here are not symmetric. A missed detection produces one arc that
blends two careers, which a reader can see. A false positive refuses the tool
outright for someone holding a perfectly ordinary profile, which they cannot
work around. So the signal is now structural rather than name-shaped, and the
result is a warning rather than a refusal.
"""

from src.story.identity import one_person

# Rebuilt from the terms in the live refusal - a single person's export.
REAL_EXPORT = """Contact
www.linkedin.com/in/cortmaclean
Los Angeles, California

Cort Maclean
Line Producer | Physical Production | Scripted Development

Top Skills
Brand Strategy
Problem Solving
Project Scheduling
Physical Production
Film Production
Music Production
Video Post-Production
International Marketing
Studio Liaison

Experience
Digitelio Film Development
Supervising Producer
2021 - Present
Beverly Hills, California
Ran physical production across four scripted projects.

Quicken Loans
Mortgage Loan Originator
2015 - 2017
Detroit, Michigan

Production Coordinator, then Office Production Assistant
2013 - 2015

Education
Western Michigan University
Erasmus University Rotterdam

Recommendations
Michael Saint-Aubin - "Cort is the person you want on a hard week."
Jennifer Levine - "Unflappable."
Arielle Worona - "She solves problems before you see them."
"""

SECOND_EXPORT = """Contact
www.linkedin.com/in/danielaortiz
Chicago, Illinois

Daniela Ortiz
Structural Engineer

Experience
Thornton Tomasetti
Senior Structural Engineer
2019 - Present

Education
Illinois Institute of Technology
"""


def test_the_reported_profile_is_not_called_two_people():
    f = one_person(REAL_EXPORT)
    assert f.ok, f.evidence


def test_a_city_is_not_a_person():
    assert one_person("Los Angeles, California\nBeverly Hills, California").ok


def test_a_skills_list_is_not_a_roster():
    assert one_person("Top Skills\nBrand Strategy\nProblem Solving\nProject Scheduling").ok


def test_recommendations_do_not_count_as_extra_people():
    assert one_person(REAL_EXPORT + "\nSarah Chen - \"Excellent.\"\n").ok


def test_two_exports_pasted_together_are_still_caught():
    f = one_person(REAL_EXPORT + "\n\n" + SECOND_EXPORT)
    assert not f.ok


def test_the_finding_points_at_what_it_actually_saw():
    f = one_person(REAL_EXPORT + "\n\n" + SECOND_EXPORT)
    joined = " ".join(f.evidence).lower()
    assert "cortmaclean" in joined or "danielaortiz" in joined or "experience" in joined


def test_empty_text_is_not_an_accusation():
    for text in ("", "   ", None):
        assert one_person(text).ok
