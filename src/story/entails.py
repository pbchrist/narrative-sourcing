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
DEPARTURE = (
    "left", "leaving", "departed", "moved away", "moved on", "stepped away",
    "stepped back", "exited", "quit", "walked away", "gave up", "abandoned",
    "moved from", "transitioned from", "shifted from", "away from",
)
# A second live failure, this one from the unresolved tension rather than a
# beat: "the lingering impact of a long, cancelled project" cited by "Spent
# about eighteen months on a migration that got cancelled." The quote proves
# the cancellation. The impact is the tool assigning someone an inner life it
# cannot observe.
CONSEQUENCE = (
    "because", "due to", "as a result", "resulted in", "led to", "caused",
    "prompted", "impact", "affect", "lingering", "legacy of", "in the wake of",
    "shaped by", "frustrated", "burned out", "burnt out", "demorali",
    "disillusioned", "tired of", "weary", "resent", "bitter", "scarred",
    "soured", "jaded",
)
LEADERSHIP = (
    "lead", "leads", "leading", "led", "manage", "manages", "managing",
    "managed", "head of", "heads", "director", "supervis", "mentor",
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

    if _has(claim, DEPARTURE) and not _has(quote, DEPARTURE):
        return Verdict(False,
                       "The claim says they left something, and the quote never "
                       "mentions leaving anything.")

    if _has(claim, LEADERSHIP) and not _has(quote, LEADERSHIP):
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
