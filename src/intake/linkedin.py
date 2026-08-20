"""Stripping export furniture out of a LinkedIn profile.

A LinkedIn PDF export is mostly not the candidate's narrative. It carries
contact blocks, skill lists, page footers, and — the one that matters —
recommendations written by other people.

Recommendations are the reason this module exists. A colleague's praise
is verbatim text sitting in the document, so it passes
src/story/verify.py cleanly and gets attributed to the candidate's own
self-narrative. That is a *verifiable* false attribution, which is worse
than a hallucination: every check downstream says it is fine. Principle 1
rests on "the candidate's own words", so third-party voice is removed
before the model ever sees it.

Two deliberate asymmetries:

Line furniture is removed aggressively; sections are removed
conservatively, against a whitelist. Over-stripping silently destroys
narrative signal, and the sections people reach for first are often the
ones carrying it — a mid-career degree is a real departure signal, so
Education stays.

Stripping happens before CandidateProfile.raw_text is set, so the model
and the verifier always see byte-identical text. If they diverged, every
citation would fail verification for reasons that have nothing to do with
whether the model made it up.
"""

import html
import re

# Sections in a third party's voice, or pure list-noise. Whitelist only:
# anything not named here survives.
# Sections of short list items. A dropped list section ends at the first
# line that reads as prose, because a real export runs
# Top Skills -> name -> headline -> Summary with no reliable blank line
# between them, and dropping blindly to the next heading eats the headline
# and the summary along with the skills.
_DROP_LIST_SECTIONS = {
    "top skills", "skills & endorsements", "endorsements",
}

# Sections that are prose by nature, so the prose rule above cannot apply.
# These end ONLY at a recognised heading, or at end of input. A blank line
# must not end them: a real Recommendations block is several entries
# separated by blank lines, each preceded by the recommender's name, and
# ending at the first blank line lets every one of them through.
# Recommendations are usually last in an export, so running to EOF is the
# right default.
_DROP_PROSE_SECTIONS = {
    "recommendations", "received recommendations", "given recommendations",
}

_DROP_SECTIONS = _DROP_LIST_SECTIONS | _DROP_PROSE_SECTIONS

# Eight words is the point where a line stops looking like a skill tag and
# starts looking like something a person wrote about themselves.
#
# Known limitation: a one-or-two-word headline ("Engineer") is
# indistinguishable in shape from a skill tag ("Team Leadership"), so it is
# lost along with the skills block. That is accepted — the damaging case is
# a long narrative headline, which this threshold protects, and the
# candidate's name arrives separately via --name.
_PROSE_WORDS = 8

# Every heading we recognise, needed to know where a dropped section ends.
_SECTION_HEADINGS = _DROP_SECTIONS | {
    "contact", "summary", "about", "experience", "education", "languages",
    "certifications", "licenses & certifications", "honors-awards",
    "honors & awards", "publications", "projects", "volunteer experience",
    "interests", "courses", "patents", "organizations", "test scores",
}

# Checked before anything else: a date range is the load-bearing signal in
# an export, and it looks enough like a phone number to be eaten by one.
_DATE_LINE = re.compile(
    r"^\s*(\w+\s+)?\d{4}\s*[-–—to]+\s*((\w+\s+)?\d{4}|present|current)\s*$",
    re.I,
)

_LINE_FURNITURE = [
    re.compile(r"^\s*page\s+\d+\s+of\s+\d+\s*$", re.I),
    # 1-3 digits only: a page number, never a year.
    re.compile(r"^\s*\d{1,3}\s*$"),
    re.compile(r"^\s*[\w.+-]+@[\w-]+\.[\w.]+\s*$"),
    # Requires 9+ digits so a "2015 - 2019" cannot be read as a phone.
    re.compile(r"^\s*\+?[\d][\d\s().-]{7,}\s*$"),
    re.compile(r"^\s*(www\.|https?://)\S+", re.I),
    re.compile(r"^\s*\d[\d,+]*\s+(connections|followers)\s*$", re.I),
    re.compile(r"^\s*contact\s*$", re.I),
    # The URL and its "(LinkedIn)" label extract onto separate lines.
    re.compile(r"^\s*\(linkedin\)\s*$", re.I),
]


def _is_prose(line: str) -> bool:
    return len(line.split()) >= _PROSE_WORDS


def _heading(line: str) -> str | None:
    key = line.strip().strip(":").lower()
    return key if key in _SECTION_HEADINGS else None


def _is_furniture(line: str) -> bool:
    for pattern in _LINE_FURNITURE:
        if pattern.match(line):
            # The phone pattern is loose enough to catch date-like runs, so
            # a digit-count floor decides the ambiguous cases.
            if pattern.pattern.startswith(r"^\s*\+?[\d]"):
                return sum(c.isdigit() for c in line) >= 9
            return True
    return False


def strip_furniture(text: str) -> tuple[str, list[str]]:
    """Return (cleaned_text, removed_lines).

    The removed list exists so the caller can show its work. These
    patterns are written against the shape a LinkedIn export usually has,
    and the fastest way to find out where that guess is wrong is to print
    what was thrown away.
    """
    # PDF extraction hands back HTML entities ("-&gt;" for "->"). Decoding
    # here keeps raw_text as close to what the person actually wrote as
    # possible: a model quoting the decoded form would otherwise fail
    # verification for a reason unrelated to whether it invented anything.
    text = html.unescape(text or "")

    kept: list[str] = []
    removed: list[str] = []
    dropping = None  # None, "list" or "prose"

    for line in text.splitlines():
        heading = _heading(line)

        if heading is not None:
            if heading in _DROP_LIST_SECTIONS:
                dropping = "list"
            elif heading in _DROP_PROSE_SECTIONS:
                dropping = "prose"
            else:
                dropping = None
            if heading in _DROP_SECTIONS or heading == "contact":
                removed.append(line)
                continue
            kept.append(line)
            continue

        if dropping:
            if not line.strip():
                # Only a list section ends at a blank line. See the note on
                # _DROP_PROSE_SECTIONS for why prose sections must not.
                if dropping == "list":
                    dropping = None
                    kept.append(line)
                continue
            if dropping == "list" and _is_prose(line):
                dropping = None
            else:
                removed.append(line)
                continue

        if line.strip() and not _DATE_LINE.match(line) and _is_furniture(line):
            removed.append(line)
            continue

        kept.append(line)

    return "\n".join(kept).strip(), removed


__all__ = ["strip_furniture"]
