"""A quote must SUPPORT the claim, not merely sit next to it.

Found in a live playtest. The verifier confirmed this quote appears verbatim:

    "Currently working at Odum Research where I help building a modern
     trading platform."

and then let it stand as evidence for:

    "seeking roles that involve building trading infrastructure"

The quote proves he does the work. It says nothing about what he is seeking.
Verification of the quote is not verification of the inference, and the gap
between those two is where a sourcing tool starts inventing motives for real
people.
"""

import pytest

from src.story.entails import Verdict, entails

# The exact pair that failed in production.
LIVE_QUOTE = ("Currently working at Odum Research where I help building "
              "a modern trading platform.")
LIVE_CLAIM = "Seeking roles that involve building trading infrastructure and platforms"


def test_the_live_failure_is_rejected():
    v = entails(LIVE_CLAIM, LIVE_QUOTE)
    assert not v.ok
    assert "does" in v.reason.lower() or "want" in v.reason.lower()


def test_a_claim_of_fact_backed_by_a_quote_of_fact_passes():
    assert entails("Works on trading platform engineering", LIVE_QUOTE).ok


def test_intent_claim_passes_when_the_quote_states_intent():
    v = entails("Seeking work on trading infrastructure",
                "I am looking for roles building trading infrastructure.")
    assert v.ok


def test_wants_to_is_intent_too():
    assert not entails("Wants to lead a team", "Leads a team of six engineers.").ok


def test_hoping_and_aiming_count_as_intent():
    for verb in ("hopes to move into", "aims to move into", "is pursuing"):
        assert not entails(f"{verb} platform work", "Builds platforms today.").ok


def test_a_departure_claim_needs_departure_language():
    assert not entails("Left agency work behind",
                       "Joined a Series B to own a product end to end.").ok


def test_departure_claim_passes_with_departure_language():
    assert entails("Left agency work behind",
                   "Left the agency after six years.").ok


def test_a_leadership_claim_needs_leadership_language():
    assert not entails("Now manages a team",
                       "Writes Go and Java every day.").ok


def test_quantity_claims_need_the_number_present():
    assert not entails("Led a team of 40 engineers",
                       "Led a team of engineers.").ok


def test_a_plain_restatement_passes():
    assert entails("Moved from Java to Go",
                   "I moved from Java to Go over the last two years.").ok


def test_empty_inputs_do_not_pass():
    assert not entails("", LIVE_QUOTE).ok
    assert not entails(LIVE_CLAIM, "").ok


def test_verdict_carries_a_human_readable_reason():
    v = entails(LIVE_CLAIM, LIVE_QUOTE)
    assert isinstance(v, Verdict)
    assert len(v.reason) > 15
    assert v.reason[0].isupper()
