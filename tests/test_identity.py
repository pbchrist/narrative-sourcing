"""Is this text about one person?

Nothing in the pipeline ever asked. Pasting two profiles together produced one
confident arc in a live run - and worse than a blend, it silently kept only
Devon and dropped Marta entirely, at confidence 0.45, with every quote
verbatim-correct. No gate can catch that downstream, because nothing was
fabricated. The check has to happen before any of it.
"""

from src.story.identity import one_person

MARTA = """Marta Reyes - Berlin
2019-2023  Senior Backend Engineer, Zalando
2023-now   Backend Engineer, Pleo
Worked on checkout and returns. Two kids, so I optimise for predictable weeks."""

DEVON = """Devon Okonkwo - Austin, TX
2014-2018  Firmware Engineer, National Instruments
2018-now   Staff Embedded Engineer, Applied Materials
I write C for motion control on semiconductor deposition tools."""

TERSE = """Sam Okafor
Software engineer, mostly infrastructure.
Previously at Monzo, now at Cloudflare."""

NO_HEADER = """I have spent eleven years building payment systems, most recently
at a company that clears about four million transactions a day. Before that I
wrote embedded firmware. I care about systems that stay correct under load."""


def test_two_profiles_pasted_together_are_caught():
    assert not one_person(MARTA + "\n\n" + DEVON).ok


def test_the_finding_names_both_people_so_the_reader_can_see_why():
    f = one_person(MARTA + "\n\n" + DEVON)
    joined = " ".join(f.evidence)
    assert "Marta Reyes" in joined and "Devon Okonkwo" in joined


def test_order_does_not_matter():
    assert not one_person(DEVON + "\n\n" + MARTA).ok


def test_one_profile_passes():
    for text in (MARTA, DEVON, TERSE, NO_HEADER):
        assert one_person(text).ok, text[:30]


def test_a_name_appearing_twice_is_still_one_person():
    assert one_person(MARTA + "\n\nMarta Reyes - Berlin\nAlso mentors juniors.").ok


def test_empty_text_is_not_an_accusation():
    for text in ("", "   ", None):
        assert one_person(text).ok


def test_a_reason_is_written_for_a_human():
    f = one_person(MARTA + "\n\n" + DEVON)
    assert len(f.reason) > 20 and f.reason[0].isupper()
