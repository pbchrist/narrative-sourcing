"""A claim about consequence needs a quote about consequence.

Second live failure, from the unresolved tension rather than a beat:

    claim: "balancing a recent career shift with the lingering impact of a
            long, cancelled project"
    quote: "Spent about eighteen months on a migration that got cancelled."

The quote proves the project was cancelled. It says nothing about lingering
impact - that is the tool assigning a person an inner life it cannot observe.
Same shape as the intent failure: the claim asserts in a mode the quote never
speaks in.
"""

from src.story.entails import entails

CANCELLED = "Spent about eighteen months on a migration that got cancelled."


def test_the_live_failure_is_rejected():
    v = entails("Carrying the lingering impact of a cancelled project", CANCELLED)
    assert not v.ok


def test_a_causal_claim_needs_causal_language():
    # Deliberately avoids "left" and "moved on": those already trip the
    # departure mode, so a test using them would pass without the new gate
    # existing and prove nothing.
    assert not entails("Chose smaller companies because the migration was cancelled",
                       CANCELLED).ok


def test_an_emotional_claim_needs_emotional_language():
    for feeling in ("Frustrated by", "Burned out by", "Demoralised by"):
        assert not entails(f"{feeling} the cancelled work", CANCELLED).ok, feeling


def test_the_same_claim_passes_when_the_quote_speaks_that_way():
    assert entails("Frustrated by the cancelled migration",
                   "I was frustrated by the migration that got cancelled.").ok


def test_a_causal_claim_passes_on_a_causal_quote():
    assert entails("Chose smaller companies because the migration was cancelled",
                   "I chose smaller companies because the migration was cancelled.").ok


def test_a_plain_factual_claim_is_untouched():
    """The gate must not start eating ordinary descriptions."""
    assert entails("Worked on a migration that was cancelled", CANCELLED).ok


def test_impact_wording_does_not_trip_on_a_quote_that_states_it():
    assert entails("The cancellation still affects how she picks work",
                   "That cancellation still affects how I pick work.").ok
