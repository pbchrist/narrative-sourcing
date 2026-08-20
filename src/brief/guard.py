"""The no-sendable-text guard.

Principle 3 is the actual thesis of this tool: the message stays human.
A rule that lives only in a design document erodes the first time someone
is in a hurry. This module makes it fail loudly instead.

The guard runs on every field of every brief. It looks for the shape of a
message to a candidate rather than the shape of a note about one:
salutations, sign-offs, and second-person recruiting pitch. Analytical
prose about a person trips none of it.

Two scoping decisions that matter as much as the patterns:

Verbatim quotes are exempt. A cited span is the candidate's own text,
already verified as theirs by src/story/verify.py. Plenty of people write
"I'd love to connect" in their own About section, and a guard that
aborted the pipeline over that would be policing the candidate's prose
rather than ours. The guard exists to stop the *tool* authoring sendable
text.

Model output is quarantined, not fatal. Text we wrote tripping the guard
is a bug and raises. Text the model produced tripping it is untrusted
input behaving badly: the offending field is withheld and the brief says
so. Throwing away a five-minute inference run because the model got
chatty would push people toward disabling the guard, which is exactly how
a principle erodes.
"""

import re

_PATTERNS = [
    (re.compile(r"\b(hi|hey|hello|dear)\b[ ,]+[A-Z][a-z]+", re.I), "salutation"),
    (re.compile(r"^\s*(hi|hey|hello|dear)\b", re.I | re.M), "salutation"),
    (re.compile(r"\b(best|regards|cheers|thanks|sincerely|warmly)\s*,\s*\n", re.I), "sign-off"),
    (re.compile(r"\b(best|kind) regards\b", re.I), "sign-off"),
    (re.compile(r"\bi(?:'d| would) love to (chat|talk|connect|hear)\b", re.I), "second-person pitch"),
    (re.compile(r"\bwould you be (open|interested|available)\b", re.I), "second-person pitch"),
    # Scoped to first person on purpose: a caution telling the recruiter
    # what to check "before reaching out" is analysis, not a message.
    (re.compile(r"\bi(?:'m| am)?\s+reaching out\b", re.I), "outreach opener"),
    (re.compile(r"\bcame across your (profile|background|work)\b", re.I), "outreach opener"),
    (re.compile(r"\b(are|were) you (open|interested|looking)\b", re.I), "second-person pitch"),
    (re.compile(r"\blet me know if you\b", re.I), "second-person pitch"),
]


class SendableTextError(RuntimeError):
    """A brief field contained text that could be pasted to a candidate.

    This is a bug in whatever produced the text, not a reason to relax the
    check. See docs/PRINCIPLES.md rule 3.
    """


def scan_sendable_text(value: str, exempt=()) -> str | None:
    """Return the kind of sendable text found, or None if the text is clean.

    `exempt` spans are blanked before scanning so a verbatim candidate
    quote cannot trip the guard, while the prose around it still does.
    """
    text = str(value or "")
    for span in exempt:
        if span:
            text = text.replace(str(span), " [quoted] ")
    for pattern, kind in _PATTERNS:
        if pattern.search(text):
            return kind
    return None


def reject_sendable_text(value: str, *, field: str, exempt=()) -> None:
    """Raise if `value` reads as text addressed to a candidate.

    For text this codebase authored. Use scan_sendable_text for text the
    model authored, which should be withheld rather than fatal.
    """
    kind = scan_sendable_text(value, exempt)
    if kind:
        raise SendableTextError(
            f"{field} contains {kind}. The brief is raw material for a "
            f"human to write from, never text that could be sent to a "
            f"candidate. See PRINCIPLES.md rule 3."
        )


__all__ = ["SendableTextError", "reject_sendable_text", "scan_sendable_text"]
