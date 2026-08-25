"""Careers happen in an order. Nothing in this codebase knew that.

The failure that forced this: a profile with twenty years in film and
television followed by a decade in recruiting produced an EMPTY "what they
left" section. Every departure claim died on the entailment gate saying "the
quote never mentions leaving" - because the CV never says "I left". It proves
the departure the way real CVs do, with dates.

Worse, LinkedIn exports print newest-first, so the raw document order is the
reverse of the career order. A model reading it top to bottom sees the pivot
backwards.

So the order gets derived here, deterministically, before anyone reasons
about it.
"""

from src.story.timeline import Span, extract, summary

# The real shape of a LinkedIn PDF export: company, then title, then dates.
CV = """Experience

Iconic
Founder and Principal
January 2023 - Present
Independent sourcing consultancy.

Hire4ce
Partner
October 2014 - December 2022
Built and ran the sourcing function.

Groupon
Technical Recruiter
2015 - 2016

NBCUniversal, Inc.
Scriptwriter
October 2011 - January 2012
Created teleplays for Unilever and Syfy.

Focus Features
Acquisitions Executive
May 2005 - December 2005

American Empirical Pictures
Assistant to Wes Anderson
June 2002 - June 2003
He represented the company as a speaker at Recruiting Trends 2016.
"""


def test_finds_every_dated_role():
    assert len(extract(CV)) == 6


def test_returns_them_oldest_first_whatever_order_the_document_used():
    years = [s.start for s in extract(CV)]
    assert years == sorted(years)
    assert years[0] == 2002 and years[-1] == 2023


def test_present_means_still_going():
    now = [s for s in extract(CV) if s.start == 2023][0]
    assert now.end is None


def test_a_bare_year_range_is_read_too():
    assert any(s.start == 2015 and s.end == 2016 for s in extract(CV))


def test_the_label_carries_the_job_title():
    early = extract(CV)[0]
    assert "Assistant to Wes Anderson" in early.label


def test_the_label_carries_the_employer():
    early = extract(CV)[0]
    assert "American Empirical Pictures" in early.label


def test_a_year_mentioned_in_a_sentence_is_not_a_job():
    """'a speaker at Recruiting Trends 2016' is prose, not a dated role."""
    assert not any("speaker" in s.label.lower() for s in extract(CV))


def test_nothing_in_nothing_out():
    for text in ("", "   ", None, "no dates here at all"):
        assert extract(text) == []


def test_summary_reads_oldest_first_for_the_model():
    lines = summary(extract(CV)).splitlines()
    assert "2002" in lines[0]
    assert "2023" in lines[-1]


def test_summary_of_nothing_is_empty():
    assert summary([]) == ""


def test_a_span_knows_what_it_is():
    s = extract(CV)[0]
    assert isinstance(s, Span) and s.start == 2002 and s.end == 2003


def test_reads_dates_that_carry_a_linkedin_duration():
    # "January 2023 - Present (3 years 8 months)" is how every dated role in a
    # LinkedIn export is written. Anchoring straight after the closing year
    # matched none of them, so a real export produced spans only from the
    # education section - and the departure gate, which needs the record to
    # show a role ending, could never fire for an actual job.
    spans = extract(
        "Cruise\nSenior Technical Recruiter\nJanuary 2023 - Present (3 years 8 months)\n"
        "\nIconic Talent\nFounder\nOctober 2014 - December 2022 (8 years 3 months)\n"
        "\nOld Co\nAnalyst\n2015 - 2015 (less than a year)\n")
    assert [(s.start, s.end) for s in spans] == [(2014, 2022), (2015, 2015), (2023, None)]
    assert "Cruise" in summary(spans)
    assert "Iconic Talent" in summary(spans)


def test_a_duration_is_not_mistaken_for_a_label():
    # Only a parenthetical that talks about elapsed time is a duration. Real
    # trailing text still has to stop the match, or a note after the dates
    # would be swallowed silently.
    assert extract("Acme\nEngineer\n2015 - 2019 (contract via Initech)\n") == []
