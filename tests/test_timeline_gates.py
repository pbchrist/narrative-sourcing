"""Dates can prove a departure, and dates can disprove a direction.

Two separate failures on the same blind spot.

A CV that says "Focus Features, Acquisitions Executive, 2005" and then shows
recruiting roles from 2014 has proven the person left film. It does not need
to contain the word "left", and demanding one produced an empty "what they
left" section for a career changer - the exact reader this tool is for.

And a model reading a newest-first export can state the pivot backwards. The
record is right there; a claim pointing the wrong way down it is wrong.
"""

from src.story.timeline import contradicts_order, extract, proves_departure

CV = """Experience

Iconic
Founder and Principal
January 2023 - Present

Groupon
Technical Recruiter
2015 - 2016

NBCUniversal, Inc.
Scriptwriter
October 2011 - January 2012

Focus Features
Acquisitions Executive
May 2005 - December 2005
"""
SPANS = extract(CV)


# --- dates can prove a departure ------------------------------------------

def test_a_finished_role_with_later_work_proves_they_left_it():
    assert proves_departure("Focus Features Acquisitions Executive", SPANS)


def test_the_job_they_still_hold_is_not_something_they_left():
    assert not proves_departure("Iconic Founder and Principal", SPANS)


def test_a_quote_naming_nothing_in_the_record_proves_nothing():
    assert not proves_departure("I care about doing good work", SPANS)


def test_with_no_timeline_it_proves_nothing():
    assert not proves_departure("Focus Features Acquisitions Executive", [])


# --- dates can disprove a direction ---------------------------------------

def test_a_backwards_pivot_is_caught():
    """Recruiting came after film. Saying it went the other way is wrong."""
    assert contradicts_order("Moved from technical recruiting into scriptwriting", SPANS)


def test_the_same_pivot_stated_correctly_is_fine():
    assert not contradicts_order("Moved from scriptwriting into technical recruiting", SPANS)


def test_a_claim_naming_only_one_role_cannot_contradict_anything():
    assert not contradicts_order("Worked as a technical recruiter", SPANS)


def test_a_claim_naming_nothing_in_the_record_is_left_alone():
    assert not contradicts_order("Moved from teaching into carpentry", SPANS)


def test_no_timeline_means_no_opinion():
    assert not contradicts_order("Moved from recruiting into scriptwriting", [])


# --- dates can also confirm a direction ------------------------------------
# contradicts_order only ever says "no". A record that settles the direction
# can equally say "yes", and without that a correctly-stated pivot still died
# on the entailment gate for lack of the word "left" in its quote.

def test_the_record_confirms_a_correctly_stated_pivot():
    from src.story.timeline import confirms_order
    assert confirms_order("Moved from scriptwriting into technical recruiting", SPANS)


def test_the_record_does_not_confirm_a_backwards_one():
    from src.story.timeline import confirms_order
    assert not confirms_order("Moved from technical recruiting into scriptwriting", SPANS)


def test_confirmation_needs_both_ends_in_the_record():
    from src.story.timeline import confirms_order
    assert not confirms_order("Moved from scriptwriting into carpentry", SPANS)


# --- a quote belongs to the job it sits under ------------------------------
# Matching a quote to a role by shared words only works when the bullet
# repeats the job title, which real CVs never do. "Read scripts and bought
# films" belongs to the acquisitions job because of where it sits on the page,
# and the only reason it ever passed before was an accident: it matched the
# word "Scriptwriter" in a different job entirely.

CV_WITH_BULLETS = """Experience

Iconic
Founder and Principal
January 2023 - Present
Runs the consultancy day to day.

Focus Features
Acquisitions Executive
May 2005 - December 2005
Read scripts and bought films.
"""


def test_a_bullet_under_a_finished_job_proves_they_left_it():
    spans = extract(CV_WITH_BULLETS)
    assert proves_departure("Read scripts and bought films.", spans, CV_WITH_BULLETS)


def test_a_bullet_under_the_current_job_does_not():
    spans = extract(CV_WITH_BULLETS)
    assert not proves_departure("Runs the consultancy day to day.", spans, CV_WITH_BULLETS)


def test_a_quote_that_is_not_in_the_text_falls_back_to_words():
    spans = extract(CV_WITH_BULLETS)
    assert proves_departure("Focus Features Acquisitions Executive", spans, CV_WITH_BULLETS)
