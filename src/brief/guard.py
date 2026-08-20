"""The no-sendable-text guard.

Principle 3 is the actual thesis of this tool: the message stays human.
A rule that lives only in a design document erodes the first time someone
is in a hurry. This module makes it fail loudly instead.

The guard runs on every field of every brief. It looks for the shape of a
message to a candidate rather than the shape of a note about one:
salutations, sign-offs, and second-person recruiting pitch. Analytical
prose about a person trips none of it.
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


def reject_sendable_text(value: str, *, field: str) -> None:
    text = str(value or "")
    for pattern, kind in _PATTERNS:
        match = pattern.search(text)
        if match:
            raise SendableTextError(
                f"{field} contains {kind} ({match.group(0)!r}). The brief is "
                f"raw material for a human to write from, never text that "
                f"could be sent to a candidate. See PRINCIPLES.md rule 3."
            )


__all__ = ["SendableTextError", "reject_sendable_text"]
