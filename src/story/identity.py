"""Does this text look like two profiles pasted together?

A live run refused a single perfectly ordinary LinkedIn export and listed
twenty-six "people" it had found - among them Los Angeles, Brand Strategy,
Line Producer, Quicken Loans, Western Michigan University, and three
colleagues who had left recommendations.

The old signal was "a line of two to four capitalised words". A LinkedIn
export is almost entirely lines of two to four capitalised words: cities,
skills, employers, schools, job titles, section headings. It fired on every
real profile it ever saw. Careers being wildly divergent is also not the
signal - plenty of real people have been a mortgage originator and then a film
producer, and a tool that doubts them is worse than useless.

What actually distinguishes two documents from one is structure, not names:

    handles   two different linkedin.com/in/... slugs
    contact   two different email addresses
    sections  the one-per-document headings appearing twice each

The costs are not symmetric, so this no longer refuses. A missed detection
produces one arc blending two careers, which a reader can see and judge. A
false positive locks someone out of the tool entirely with no way around it.
So this warns, loudly, and lets the run proceed.

It follows that the plain case - two bare CVs concatenated, no contact block,
no section headings - is not detected. That is a real limit and it is better
than guessing from capitalisation.
"""

import re
from dataclasses import dataclass, field

# Headings that appear at most once in a single profile export.
_SECTIONS = (
    "contact", "top skills", "skills", "experience", "education", "summary",
    "about", "certifications", "licenses", "honors", "publications",
)


@dataclass
class Finding:
    ok: bool
    reason: str = ""
    evidence: list = field(default_factory=list)


def _handles(text: str) -> list:
    found = re.findall(r"linkedin\.com/in/([A-Za-z0-9\-_%]+)", text, re.I)
    out = []
    for h in found:
        h = h.strip("/").lower()
        if h and h not in out:
            out.append(h)
    return out


def _emails(text: str) -> list:
    found = re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
    out = []
    for e in found:
        e = e.lower()
        if e not in out:
            out.append(e)
    return out


def _repeated_sections(text: str) -> list:
    counts = {}
    for line in text.splitlines():
        bare = line.strip().strip(":").lower()
        if bare in _SECTIONS:
            counts[bare] = counts.get(bare, 0) + 1
    return sorted(k for k, n in counts.items() if n >= 2)


def one_person(raw_text) -> Finding:
    """Whether the text looks like a single person's profile."""
    if not isinstance(raw_text, str) or not raw_text.strip():
        return Finding(True)

    handles = _handles(raw_text)
    emails = _emails(raw_text)
    repeated = _repeated_sections(raw_text)

    if len(handles) >= 2:
        return Finding(False,
                       "Two different LinkedIn profiles appear in this text.",
                       [f"linkedin.com/in/{h}" for h in handles])
    if len(emails) >= 2:
        return Finding(False,
                       "Two different email addresses appear in this text.",
                       emails)
    # One repeated heading can happen; two separate ones repeating is a document
    # boundary rather than a quirk of formatting.
    if len(repeated) >= 2:
        return Finding(False,
                       "The one-per-profile headings appear twice, which usually "
                       "means two documents are stacked here.",
                       [f'"{s}" appears more than once' for s in repeated])

    return Finding(True)


__all__ = ["Finding", "one_person"]
