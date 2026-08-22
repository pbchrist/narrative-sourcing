"""Does the timeline work for careers other than the one it was built on?

The first version was tuned to a single CV and it showed. Word matching used a
shared six-character prefix, which is exactly long enough for scriptwriting /
scriptwriter - the pair in front of me at the time - and too long for
teaching / teacher or nursing / nurse. So the direction gate stayed silent for
teachers and nurses while working for screenwriters. Same shape of mistake as
a job-title list containing only tech words.

Date reading had the same problem: LinkedIn's format worked, and a European
03/2015, an American 3/1/2015, a terse Jan '15 and a plain "Since 2015" did
not.
"""

from src.story.timeline import contradicts_order, extract, same_word


# --- words -----------------------------------------------------------------

def test_short_rooted_professions_match_their_own_verb():
    for a, b in (("teaching", "teacher"), ("nursing", "nurse"),
                 ("writing", "writer"), ("welding", "welder"),
                 ("farming", "farmer"), ("policing", "police")):
        assert same_word(a, b), f"{a} / {b}"


def test_long_rooted_ones_still_match():
    for a, b in (("scriptwriting", "scriptwriter"), ("recruiting", "recruiter"),
                 ("administration", "administrator"), ("management", "manage")):
        assert same_word(a, b), f"{a} / {b}"


def test_different_words_that_merely_start_alike_do_not_match():
    for a, b in (("consulting", "construction"), ("marketing", "marine"),
                 ("engineering", "england")):
        assert not same_word(a, b), f"{a} / {b}"


def test_a_known_miss_is_recorded_rather_than_hidden():
    """producer/production share a root and this stemmer does not see it.

    Stripping far enough to join them ("tion" -> produc) also splits
    construction from construct, which matters more here. Recorded so the
    next person knows it was a choice.
    """
    assert not same_word("producer", "production")


def test_synonyms_are_not_claimed_to_match():
    """An honest limit: cooking and chef are the same job and different words."""
    assert not same_word("cooking", "chef")


# --- dates -----------------------------------------------------------------

def _one(cv):
    s = extract(cv)
    return (s[0].start, s[0].end) if s else None


def test_slash_month_and_year():
    assert _one("Acme\nEngineer\n03/2015 - 05/2019") == (2015, 2019)


def test_american_month_day_year():
    assert _one("Acme\nEngineer\n3/1/2015 - 5/1/2019") == (2015, 2019)


def test_apostrophe_years():
    assert _one("Acme\nEngineer\nJan '15 - Mar '19") == (2015, 2019)


def test_since_is_open_ended():
    assert _one("Acme\nEngineer\nSince 2015") == (2015, None)


def test_a_role_written_on_one_line():
    assert _one("Acme, Engineer, 2015 - 2019") == (2015, 2019)


def test_the_label_survives_the_one_line_form():
    assert "Engineer" in extract("Acme, Engineer, 2015 - 2019")[0].label


def test_formats_already_working_keep_working():
    for cv in ("Acme\nEngineer\nJanuary 2015 - March 2019",
               "Acme\nEngineer\n2015 - 2019",
               "Acme\nEngineer\n2015 – 2019",
               "Acme\nEngineer\nJan 2015 - Mar 2019",
               "Acme\nEngineer\n2015 to 2019"):
        assert _one(cv) == (2015, 2019), cv


def test_present_still_means_still_there():
    assert _one("Acme\nEngineer\n2015 - Present") == (2015, None)


# --- the whole point -------------------------------------------------------

def test_a_teacher_turned_engineer_gets_the_same_protection_as_a_screenwriter():
    cv = """Experience

Stripe
Software Engineer
2021 - Present

Lincoln High School
Mathematics Teacher
2013 - 2020
"""
    assert contradicts_order("Moved from software engineering into teaching", extract(cv))
