"""Verbatim evidence verification.

Principle 1 says "evidence or it doesn't ship". This module is what makes
that a fact rather than a wish: a Beat's evidence must be a span that
genuinely appears in the candidate's own text. A fluent, plausible,
entirely invented rationale fails here and gets dropped upstream.

Matching is deliberately forgiving about *format* and unforgiving about
*content*. Pasted profiles arrive with ragged newlines, smart quotes and
stray bullets, and rejecting a real citation over a line break would push
us toward loosening the rule itself. Rejecting invented content is the
part that must never bend.
"""

import re

# Fragments a model tends to wrap around a quote it is citing.
_TRIM = ' \t\r\n"\'“”‘’.,;:-—–'
_ELLIPSIS = re.compile(r"^(\.\.\.|…)+|(\.\.\.|…)+$")

MIN_SPAN_CHARS = 12


def normalize(text: str) -> str:
    """Collapse whitespace and unify quote characters for comparison."""
    text = (text or "").replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip()


def canonical(span: str) -> str:
    """Normalized, ellipsis-stripped, punctuation-trimmed, lowercased."""
    span = _ELLIPSIS.sub("", normalize(span))
    return span.strip(_TRIM).lower()


def verify_span(evidence: str, raw_text: str) -> bool:
    """True if `evidence` genuinely appears in `raw_text`.

    A span shorter than MIN_SPAN_CHARS is refused even when it technically
    matches: two or three words will substring-match almost any profile by
    accident, which would make the check theatre.
    """
    needle = canonical(evidence)
    if len(needle) < MIN_SPAN_CHARS:
        return False
    return needle in normalize(raw_text).lower()


__all__ = ["MIN_SPAN_CHARS", "canonical", "normalize", "verify_span"]
