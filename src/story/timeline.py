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
# Years, however they are dressed. Whatever precedes a year - a month name, an
# 03/, a 3/1/ - is thrown away, because only the year matters for putting a
# career in order.
_MON = rf"(?:{MONTHS})"
_PRE = rf"(?:{_MON}\s+|\d{{1,2}}[/.]\d{{1,2}}[/.]|\d{{1,2}}[/.])?\s*"
_Y = r"(?:19|20)\d{2}"
_OPEN = r"Present|Current|Now|Today|Ongoing"

_RANGE = re.compile(
    rf"^[\s·•\-–(\[]*{_PRE}({_Y})\s*(?:[-–—]|to|until)\s*{_PRE}({_Y}|{_OPEN})[\s)\]·•]*$",
    re.I)

# "Since 2015" / "From 2015" - a start with no stated end.
_SINCE = re.compile(rf"^[\s·•(\[]*(?:since|from)\s+{_PRE}({_Y})[\s)\]·•]*$", re.I)

# A whole role on one line: "Acme, Engineer, 2015 - 2019".
_INLINE = re.compile(
    rf"^(.{{3,90}}?)[,;·•\s]+{_PRE}({_Y})\s*(?:[-–—]|to|until)\s*{_PRE}({_Y}|{_OPEN})"
    r"[\s)\]·•]*$", re.I)

# "Jan '15" is a year like any other; normalised before matching so the
# patterns above only ever deal with four digits.
_APOS = re.compile(r"'(\d{2})\b")


def _year(text: str) -> int:
    n = int(text)
    if n >= 100:
        return n
    return 1900 + n if n > 40 else 2000 + n


def _normalise(line: str) -> str:
    return _APOS.sub(lambda m: str(_year(m.group(1))), line)


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
    line: int = -1       # where the date sat, so a bullet can be traced to its job


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
        bare = _normalise(line.strip())
        m = _RANGE.match(bare)
        if m:
            tail = m.group(2)
            end = _year(tail) if tail[:1].isdigit() else None
            label = _label_for(lines, i)
            if label:
                spans.append(Span(label=label, start=_year(m.group(1)), end=end, line=i))
            continue
        m = _SINCE.match(bare)
        if m:
            label = _label_for(lines, i)
            if label:
                spans.append(Span(label=label, start=_year(m.group(1)), end=None, line=i))
            continue
        m = _INLINE.match(bare)
        if m:
            label = m.group(1).strip(" ,;·•-\u2013")
            if label and not _NOT_A_LABEL.__contains__(label.lower()):
                tail = m.group(3)
                spans.append(Span(label=label,
                                  start=_year(m.group(2)),
                                  end=_year(tail) if tail[:1].isdigit() else None,
                                  line=i))
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


# Longest first, so "ation" is tried before "ion" and "ing" before "s".
_SUFFIXES = ("ational", "ization", "isation", "ators", "ation", "ition",
             "ement", "ments", "ment", "ering", "ings", "ator", "ing", "ors",
             "ers", "ies", "ion", "ist", "or", "er", "ed", "es", "s")
_MIN_STEM = 3


def _stem(word: str) -> str:
    """Crude but honest: strip one common ending, then a trailing e.

    A fixed shared-prefix length cannot work here. teaching/teacher share five
    characters and nursing/nurse share four, but consulting/construction also
    share four and are unrelated - so any threshold low enough to catch a nurse
    is low enough to confuse a consultant with a construction site.
    """
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= _MIN_STEM:
            word = word[:-len(suffix)]
            break
    return word.rstrip("e") or word


def same_word(a: str, b: str) -> bool:
    """Two words naming the same thing: teaching/teacher, nursing/nurse.

    Exact matching missed the pivot entirely - a claim about "scriptwriting"
    never lined up with a role titled "Scriptwriter" - so the gate had nothing
    to compare and stayed silent on a backwards claim. Synonyms are out of
    reach: cooking and chef are the same job and share no letters, and no
    amount of string handling fixes that.
    """
    return a == b or _stem(a) == _stem(b)


_same = same_word


def _match(text, spans):
    """Spans whose label shares a distinctive word with the text."""
    tw = _words(text)
    return [s for s in spans
            if any(_same(a, b) for a in _words(s.label) for b in tw)]


def _span_owning(quote, spans, text):
    """Which job does this line of the CV belong to?

    By position, not by wording. A bullet under a job almost never repeats the
    job title - "Read scripts and bought films" says nothing about being an
    acquisitions executive - so matching on shared words either misses it or,
    worse, attaches it to a different job that happens to share a word.
    """
    if not text or not quote:
        return None
    at = text.find(quote.strip())
    if at < 0:
        return None
    line_no = text.count("\n", 0, at)
    owner = None
    for s in spans:
        if 0 <= s.line <= line_no and (owner is None or s.line > owner.line):
            owner = s
    return owner


def proves_departure(quote, spans, text=None) -> bool:
    """Did the record itself show them leaving whatever this quote names?

    A CV proves a departure with dates, not with the word "left". If the quote
    belongs to a role that finished, and other work began at or after it
    finished, the person left it. That is not an inference about their
    feelings - it is what the document says happened.
    """
    spans = spans or []
    owner = _span_owning(quote, spans, text)
    candidates = [owner] if owner is not None else _match(quote, spans)
    for s in candidates:
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
           "proves_departure", "same_word", "summary"]
