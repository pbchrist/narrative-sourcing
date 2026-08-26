"""Does the quote actually support the claim, or merely accompany it?

verify.py answers "did they write this?". That is necessary and it is not
sufficient. A live playtest surfaced the gap: the verifier confirmed

    "Currently working at Odum Research where I help building a modern
     trading platform."

and let it stand as evidence for

    "Seeking roles that involve building trading infrastructure and platforms"

The quote proves he does the work. It says nothing about what he wants. That
is the sourcing tool inventing a motive for a real person, which is the exact
failure the evidence rule exists to prevent, one level up.

The check here is deliberately narrow and deterministic. It does not attempt
general entailment - that needs a model and would put an unverifiable judgment
in the middle of the verification path. Instead it catches the specific
category of overreach that shows up in career inference, where the claim
asserts something in a different mode than the quote:

    intent      claim says wants/seeks, quote reports only what they do
    departure   claim says left, quote never mentions leaving
    leadership  claim says leads, quote never mentions leading
    consequence claim says an event caused, affected or upset them, quote
                reports only that the event happened
    quantity    claim names a number the quote does not contain

Everything else passes. A false pass costs a reader one weak beat; a false
reject silently deletes a true one, and the second is worse.
"""

import re
from dataclasses import dataclass

INTENT = (
    "seeking", "seeks", "seek ", "wants to", "want to", "looking for",
    "looking to", "hopes to", "hoping to", "aims to", "aiming to",
    "aspires", "is pursuing", "pursuing a", "intends to", "would like to",
    "ready to", "eager to", "open to",
)
# A CV says someone left in more ways than this list first allowed. "I stopped
# working on dashboards" is a departure stated outright, and the gate deleted
# the claim attached to it for never mentioning leaving - a false negative that
# quietly threw away sound claims all day. The words below are all ones that
# state the ending, not ones that merely imply it.
DEPARTURE = (
    "left", "leaving", "departed", "moved away", "moved on", "stepped away",
    "stepped back", "exited", "quit", "walked away", "gave up", "abandoned",
    "moved from", "transitioned from", "shifted from", "away from",
    "stopped", "no longer", "ceased", "wound down", "handed off", "handed over",
    "gave notice", "resigned", "retired from", "closed out", "wrapped up",
    "stepped down", "parted ways", "switched from", "pivoted from",
    "before moving", "until", "formerly", "previously",
)
# A second live failure, this one from the unresolved tension rather than a
# beat: "the lingering impact of a long, cancelled project" cited by "Spent
# about eighteen months on a migration that got cancelled." The quote proves
# the cancellation. The impact is the tool assigning someone an inner life it
# cannot observe.
CONSEQUENCE = (
    "because", "due to", "as a result", "resulted in", "led to", "caused",
    # "impact" and "affect" as bare words caught "documentary content with
    # social impact", which names a subject rather than an effect on anyone.
    # The consequence sense needs the grammar of consequence.
    "prompted", "impact on", "impacted", "impact of", "affected", "affects",
    "lingering", "legacy of", "in the wake of",
    "shaped by", "frustrated", "burned out", "burnt out", "demorali",
    "disillusioned", "tired of", "weary", "resent", "bitter", "scarred",
    "soured", "jaded",
)
# What makes a CLAIM one about leading is not the same as what makes a QUOTE
# prove it. "Pursued a career in film, starting with assisting a director"
# contains "director" and is not a claim about leading anybody - the title
# belongs to someone else, and the person in question is the assistant. Trigger
# on what the subject is said to DO; accept a title as proof only in the quote.
LEADS_CLAIM = (
    "led ", "leads ", "leading ", "leadership", "manage", "manages",
    "managing", "managed", "head of", "heads ", "supervis", "mentor",
    "hired", "hiring manager", "built a team", "grew the team",
    "reports to them", "direct reports",
)
# Every way a quote can SHOW leadership, including each way a claim can assert
# it - a quote saying the very words the claim used has to be able to prove it.
LEADERSHIP = (
    "lead", "leads", "leading", "led", "leadership", "manage", "manages",
    "managing", "managed", "head of", "heads", "director", "supervis", "mentor",
    "built a team", "grew the team", "team of", "direct reports",
    "hiring manager",
    "built a team", "hired", "reports",
)


@dataclass
class Verdict:
    ok: bool
    reason: str = ""


def _has(text: str, needles) -> bool:
    t = " " + re.sub(r"\s+", " ", text.lower()) + " "
    return any(n in t for n in needles)


def _numbers(text: str) -> set:
    return set(re.findall(r"\d[\d,]*", text.replace(",", "")))


_FROM_TO = re.compile(r"\bfrom\b(.{2,80}?)\b(?:to|into|toward|towards)\b", re.I)


def _directional(claim: str) -> bool:
    """A claim that moves the subject from one thing to another."""
    m = _FROM_TO.search(" " + " ".join(str(claim or "").split()) + " ")
    if not m:
        return False
    # "grew the team from 3 to 12" and "from 2019 to 2022" are ranges, not
    # departures. A number on either side means it is measuring, not moving.
    return not re.search(r"\d", m.group(0))


def entails(claim: str, quote: str) -> Verdict:
    """True when the quote supports the claim in the same mode it asserts it."""
    claim = (claim or "").strip()
    quote = (quote or "").strip()
    if not claim or not quote:
        return Verdict(False, "Nothing to check: a claim and a quote are both required.")

    if _has(claim, INTENT) and not _has(quote, INTENT):
        return Verdict(False,
                       "The quote shows what they do, not what they want. Doing "
                       "something is not evidence of seeking it.")

    # "Shifting focus from general tech to healthcare" is a departure claim
    # that names no departure verb, and it slipped the gate entirely while a
    # quote about a current focus stood as proof of leaving. A claim shaped
    # "from X to Y" asserts the move whatever verb it uses.
    if (_has(claim, DEPARTURE) or _directional(claim)) and not _has(quote, DEPARTURE):
        return Verdict(False,
                       "The claim says they left something, and the quote never "
                       "mentions leaving anything.")

    if _has(claim, LEADS_CLAIM) and not _has(quote, LEADERSHIP):
        return Verdict(False,
                       "The claim is about leading people, and the quote does not "
                       "mention leading, managing or hiring anyone.")

    if _has(claim, CONSEQUENCE) and not _has(quote, CONSEQUENCE):
        return Verdict(False,
                       "The claim says the event affected them, and the quote "
                       "only says the event happened. How someone felt about "
                       "their own history has to come from them.")

    missing = _numbers(claim) - _numbers(quote)
    if missing:
        return Verdict(False,
                       f"The claim names a figure the quote does not contain: "
                       f"{', '.join(sorted(missing))}.")

    return Verdict(True, "The quote supports the claim in the mode it is asserted.")


__all__ = ["Verdict", "entails"]
