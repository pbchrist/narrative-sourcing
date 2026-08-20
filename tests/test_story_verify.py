from src.story.verify import normalize, verify_span

RAW = """Led growth at an agency for six years.
Left because shipping and walking away stopped being satisfying.

Joined a Series B to own a product end to end."""


def test_exact_span_verifies():
    assert verify_span("Joined a Series B to own a product end to end.", RAW)


def test_span_spanning_a_newline_verifies():
    assert verify_span(
        "Led growth at an agency for six years. Left because shipping", RAW
    )


def test_case_insensitive_span_verifies():
    assert verify_span("LED GROWTH AT AN AGENCY", RAW)


def test_span_wrapped_in_quotes_verifies():
    assert verify_span('"Joined a Series B"', RAW)


def test_span_with_leading_ellipsis_verifies():
    assert verify_span("...own a product end to end", RAW)


def test_invented_span_does_not_verify():
    assert not verify_span("Burned out after a toxic manager", RAW)


def test_plausible_paraphrase_does_not_verify():
    # The single most important test in the codebase: this sentence is a
    # true-sounding summary of RAW that appears nowhere in it.
    assert not verify_span("They grew tired of agency client churn", RAW)


def test_empty_span_does_not_verify():
    assert not verify_span("   ", RAW)


def test_normalize_collapses_whitespace():
    assert normalize("a  b\n\nc") == "a b c"
