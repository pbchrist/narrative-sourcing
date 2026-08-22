"""When things happened, derived from the text rather than assumed.

Nothing else in this codebase knew that careers happen in an order, and it
broke the case the whole tool exists for. A profile with twenty years in film
and television followed by a decade in recruiting produced an empty "what they
left" section: every departure claim died on the entailment gate saying the
quote never mentions leaving. The CV never says "I left". It proves the
departure the way real CVs do - with dates.

LinkedIn exports also print newest first, so raw document order is the reverse
of career order. A model reading top to bottom sees a pivot backwards, which
is how someone who went from film into recruiting comes back described as
having gone from recruiting into film.

So the order is extracted here, deterministically, before anyone reasons about
it - and then handed to the model explicitly instead of left to be inferred.
"""

import re
from dataclasses import dataclass

MONTHS = ("January|February|March|April|May|June|July|August|September|"
          "October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec")

# "January 2023 - Present", "October 2014 - December 2022", "2015 - 2016",
# "(1994 - 1997)". The whole line must be the date range: a year inside a
# sentence is a fact about a job, not a job.
_RANGE = re.compile(
    r"^[\s·•\-–(\[]*"
    rf"(?:(?:{MONTHS})\s+)?((?:19|20)\d{{2}})"
    r"\s*(?:[-–—]|to)\s*"
    rf"(?:(?:{MONTHS})\s+)?((?:19|20)\d{{2}}|Present|Current|Now)"
    r"[\s)\]·•]*$",
    re.I)

# Lines that sit above a date range but are not the job.
_NOT_A_LABEL = {
    "experience", "education", "certifications", "licenses", "summary",
    "about", "contact", "top skills", "skills", "honors", "publications",
    "recommendations", "volunteering", "projects", "languages",
}

_MAX_LABEL_CHARS = 90
_LABEL_LINES = 2


@dataclass
class Span:
    label: str
    start: int
    end: int | None      # None means it is still going


def _label_for(lines, i):
    """The employer and title sitting above a date line.

    Prose is excluded: a real label is short and does not end in a full stop,
    because export formats put the job on its own line and the description
    underneath.
    """
    out = []
    j = i - 1
    while j >= 0 and len(out) < _LABEL_LINES:
        line = lines[j].strip(" ·•\t")
        j -= 1
        if not line:
            if out:
                break
            continue
        if line.lower().strip(":") in _NOT_A_LABEL:
            break
        if len(line) > _MAX_LABEL_CHARS or line.endswith((".", "!", "?")):
            break
        if _RANGE.match(line):
            break
        out.append(line)
    return " — ".join(reversed(out))


def extract(text) -> list:
    """Every dated role in the text, oldest first."""
    if not isinstance(text, str) or not text.strip():
        return []
    lines = text.splitlines()
    spans = []
    for i, line in enumerate(lines):
        m = _RANGE.match(line.strip())
        if not m:
            continue
        start = int(m.group(1))
        tail = m.group(2)
        end = None if not tail[:1].isdigit() else int(tail)
        label = _label_for(lines, i)
        if label:
            spans.append(Span(label=label, start=start, end=end))
    # Oldest first, and a still-running role sorts last within its year.
    spans.sort(key=lambda s: (s.start, s.end if s.end is not None else 9999))
    return spans


def summary(spans) -> str:
    """The chronology as the model should read it: earliest at the top."""
    if not spans:
        return ""
    return "\n".join(
        f"{s.start}-{s.end if s.end is not None else 'present'}: {s.label}"
        for s in spans)


# Words too common in job titles to identify anything.
_WEAK = {
    "senior", "staff", "principal", "lead", "head", "chief", "director",
    "manager", "assistant", "associate", "consultant", "coordinator",
    "specialist", "executive", "officer", "partner", "founder", "vp",
    "inc", "llc", "ltd", "the", "and", "for", "via", "at", "of", "to",
    "from", "into", "moved", "left", "toward", "towards", "work", "working",
    "role", "roles", "career", "job", "jobs", "then", "now", "later",
}


def _words(text) -> set:
    return {w for w in re.findall(r"[a-z0-9+#]+", str(text or "").lower())
            if w not in _WEAK and len(w) > 2}


_STEM = 6   # shared prefix that counts as the same word


def _same(a: str, b: str) -> bool:
    """recruiting/recruiter and scriptwriting/scriptwriter are one word here.

    Exact matching missed the pivot entirely: a claim about "scriptwriting"
    never lined up with a role titled "Scriptwriter", so the gate had nothing
    to compare and stayed silent on a backwards claim.
    """
    if a == b:
        return True
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n >= _STEM


def _match(text, spans):
    """Spans whose label shares a distinctive word with the text."""
    tw = _words(text)
    return [s for s in spans
            if any(_same(a, b) for a in _words(s.label) for b in tw)]


def proves_departure(quote, spans) -> bool:
    """Did the record itself show them leaving whatever this quote names?

    A CV proves a departure with dates, not with the word "left". If the quote
    names a role that finished, and other work began at or after it finished,
    the person left it. That is not an inference about their feelings - it is
    what the document says happened.
    """
    for s in _match(quote, spans or []):
        if s.end is None:
            continue                      # still there; nothing was left
        if any(o is not s and o.start >= s.end for o in spans):
            return True
    return False


def _direction(claim, spans):
    """The two ends of a stated move, as they appear in the record.

    Returns (first_claimed, second_claimed) start years, or None when the claim
    does not state a move between two things the record knows about.
    """
    spans = spans or []
    text = " " + re.sub(r"\s+", " ", str(claim or "").lower()) + " "
    m = re.search(r"\bfrom\b(.+?)\b(?:to|into|toward|towards)\b(.+)", text)
    if not m:
        return None
    before, after = _match(m.group(1), spans), _match(m.group(2), spans)
    if not before or not after:
        return None
    return min(s.start for s in before), min(s.start for s in after)


def confirms_order(claim, spans) -> bool:
    """Does the record actively support the direction this claim states?

    The mirror of contradicts_order. Without it a correctly-stated pivot still
    died on the entailment gate, because the quote under it said what someone
    did rather than that they had left anything - which is how CVs are written.
    """
    d = _direction(claim, spans)
    return bool(d) and d[0] < d[1]


def contradicts_order(claim, spans) -> bool:
    """Does this claim run the wrong way down the record?

    Only fires when the claim names two different things that are both in the
    record and states a direction between them. Everything else is left alone -
    a gate that guesses is worse than no gate.
    """
    d = _direction(claim, spans)
    # The claim says the first thing came first. The record decides.
    return bool(d) and d[1] < d[0]


__all__ = ["Span", "confirms_order", "contradicts_order", "extract",
           "proves_departure", "summary"]
