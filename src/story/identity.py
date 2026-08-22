"""Is this text about one person?

Nothing else in the pipeline asks. Every other gate here checks whether a
claim is supported by the text; none of them check whether the text is about
a single human being. A live run pasted two profiles together and produced one
confident arc - and not a blend, which would at least look wrong. It kept
Devon, silently discarded Marta, and reported confidence 0.45 with every quote
verbatim-correct. Nothing was fabricated, so nothing downstream could catch it.

The signal used is deliberately narrow: two or more distinct name headers. A
name header is the line a profile opens with - a person's name, sometimes
followed by a place. It is the one structural feature that a second person
almost always brings with them and that a single profile almost never repeats
with a different name.

Deliberately NOT used: two concurrent employers. People genuinely hold an
advisory role alongside a job, and accusing them of being two people over it
would be worse than the failure this prevents.
"""

import re
from dataclasses import dataclass, field

# Words that appear in job titles and section headings, which otherwise look
# exactly like names once a document is title-cased.
_NOT_A_NAME = {
    "senior", "staff", "principal", "lead", "head", "chief", "director",
    "manager", "engineer", "developer", "analyst", "specialist", "consultant",
    "experience", "education", "skills", "summary", "about", "projects",
    "work", "employment", "history", "contact", "profile", "recommendations",
    "certifications", "languages", "interests", "volunteering", "publications",
    "software", "technical", "professional", "current", "previous",
}

_MAX_NAME_WORDS = 4


@dataclass
class Finding:
    ok: bool
    reason: str = ""
    evidence: list[str] = field(default_factory=list)


def _name_header(line: str) -> str | None:
    """The name at the start of a profile, or None if this is not that line."""
    # A name header may carry a location after a dash or comma; drop it.
    head = re.split(r"\s+[-–—|]\s+|,", line.strip(), maxsplit=1)[0].strip()
    if not head or any(c.isdigit() for c in head):
        return None
    words = head.split()
    if not 2 <= len(words) <= _MAX_NAME_WORDS:
        return None
    for w in words:
        bare = w.strip(".'’")
        if not bare or not bare[0].isupper() or bare.lower() in _NOT_A_NAME:
            return None
        if not re.fullmatch(r"[A-Za-z][A-Za-z.'’-]*", bare):
            return None
    return head


def one_person(raw_text) -> Finding:
    """Whether the text looks like one person's profile."""
    if not isinstance(raw_text, str) or not raw_text.strip():
        return Finding(True)

    names, seen = [], set()
    for line in raw_text.splitlines():
        got = _name_header(line)
        if got and got.lower() not in seen:
            seen.add(got.lower())
            names.append(got)

    if len(names) < 2:
        return Finding(True)

    return Finding(
        False,
        "This looks like more than one person's profile pasted together. "
        "An arc drawn across two careers is not a career, and the pipeline "
        "would quietly keep one of them and drop the other.",
        names,
    )


__all__ = ["Finding", "one_person"]
