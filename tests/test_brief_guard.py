import pytest

from src.brief.guard import SendableTextError, reject_sendable_text


def test_allows_third_person_analytical_prose():
    reject_sendable_text("Their arc points toward platform ownership.", field="why")


def test_rejects_salutation():
    with pytest.raises(SendableTextError):
        reject_sendable_text("Hi Dana, I came across your profile", field="why")


def test_rejects_dear_opening():
    with pytest.raises(SendableTextError):
        reject_sendable_text("Dear Dana, quick note about a role", field="why")


def test_rejects_signoff():
    with pytest.raises(SendableTextError):
        reject_sendable_text("...worth a chat.\n\nBest,\nSam", field="why")


def test_rejects_second_person_pitch():
    with pytest.raises(SendableTextError):
        reject_sendable_text("I'd love to chat about this opportunity", field="why")


def test_rejects_would_you_be_open_to():
    with pytest.raises(SendableTextError):
        reject_sendable_text("Would you be open to a quick call?", field="why")


def test_error_names_the_offending_field():
    with pytest.raises(SendableTextError, match="one_line_story"):
        reject_sendable_text("Hi Dana, quick note", field="one_line_story")


def test_allows_recruiter_facing_advice_about_outreach():
    # "before reaching out" is analysis addressed to the recruiter, not a
    # message addressed to the candidate. The guard must tell them apart.
    reject_sendable_text("Find a real question before reaching out.", field="c")
    reject_sendable_text("If you reach out anyway, name it directly.", field="c")


def test_still_rejects_first_person_outreach_opener():
    with pytest.raises(SendableTextError):
        reject_sendable_text("I'm reaching out because your background", field="c")


def test_exempt_spans_are_not_scanned():
    # A verbatim quote is the candidate's own text, already verified as
    # theirs. The guard exists to stop the TOOL authoring sendable text,
    # not to forbid quoting a candidate who writes like a recruiter.
    quote = "I'd love to connect with people working on climate hardware."
    reject_sendable_text(
        f'Low-confidence inference (0.5): "{quote}".',
        field="cautions[0]", exempt=[quote],
    )


def test_exemption_does_not_blind_the_rest_of_the_field():
    quote = "I'd love to connect with people working on climate hardware."
    with pytest.raises(SendableTextError):
        reject_sendable_text(
            f'Hi Dana, quoting you: "{quote}".',
            field="cautions[0]", exempt=[quote],
        )


def test_scan_reports_without_raising():
    from src.brief.guard import scan_sendable_text
    assert scan_sendable_text("Hi Dana, quick note") == "salutation"
    assert scan_sendable_text("Their arc points toward ownership.") is None
