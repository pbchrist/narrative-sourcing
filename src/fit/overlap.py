"""Deterministic skill overlap.

This is the commoditized half of the problem, the part every competitor
already does. DESIGN.md wants it kept but subordinate, so it is computed
here with no model call at all: cheap, boring, and impossible to
hallucinate. If it ever grows into something that needs inference, that
is a signal it has been promoted above its station.
"""

import re

_WORD = re.compile(r"[a-z][a-z+#.]{2,}")

_STOPWORDS = {
    "and", "the", "for", "with", "you", "our", "are", "was", "were", "has",
    "have", "had", "not", "but", "this", "that", "they", "them", "their",
    "who", "what", "when", "will", "would", "can", "could", "should", "from",
    "into", "out", "end", "own", "all", "any", "own", "new", "role", "work",
    "working", "team", "teams", "years", "year", "job", "about", "than",
    "then", "there", "here", "your", "his", "her", "its", "been", "being",
    "some", "more", "most", "such", "each", "other", "also", "how", "why",
}


def tokens(text: str) -> set[str]:
    return {
        w for w in _WORD.findall((text or "").lower())
        if w not in _STOPWORDS
    }


def compute(profile_text: str, role_description: str) -> dict:
    role_terms = tokens(role_description)
    matched = sorted(role_terms & tokens(profile_text))
    return {
        "matched": matched,
        "matched_count": len(matched),
        "role_term_count": len(role_terms),
        "ratio": round(len(matched) / len(role_terms), 3) if role_terms else 0.0,
    }


__all__ = ["compute", "tokens"]
