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
