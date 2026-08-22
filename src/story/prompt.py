"""The extraction prompt.

This is the one genuinely unproven piece of the system, so it is kept in
its own module: it is expected to be rewritten repeatedly against real
profiles without touching parsing, verification or scoring.

Two things the prompt must do that ordinary summarization prompts do not:
ask for an *arc* rather than a precis, and demand verbatim citation for
every claim. The verification layer enforces the second regardless of what
the prompt asks, but asking plainly raises the hit rate a lot.
"""

from src.story import timeline

SYSTEM = """You read a person's career history and identify the story in \
it: not a summary of what they did, but the arc underneath it.

You are looking for:
- the throughline: the one thing that stays constant across every move
- departures: what they moved away from, and what that suggests
- pursuits: what they were visibly reaching toward
- the unresolved tension: the open question their next move would answer

Hard rules:
1. Every departure and pursuit must quote VERBATIM text from the profile \
as its evidence. Copy the characters exactly. Do not paraphrase, \
summarize, tidy or reconstruct the quote. A quote that does not appear \
in the profile word for word will be discarded automatically.
2. If you cannot find verbatim text supporting a claim, omit the claim. \
An honest short arc beats a well-written invented one.
3. You are inferring about a real person from partial evidence. Where the \
profile supports several readings, prefer the plainer one.

Return ONLY a JSON object:
{
  "throughline": "one sentence",
  "unresolved_tension": "one sentence",
  "departures": [{"description": "...", "evidence": "verbatim quote", \
"confidence": 0.0}],
  "pursuits": [{"description": "...", "evidence": "verbatim quote", \
"confidence": 0.0}]
}

confidence is 0-1 and should reflect genuine doubt. Being unsure is a \
valid and useful answer."""


def build(profile) -> str:
    parts = []
    # The order things happened in, derived from the text rather than left to
    # be inferred. LinkedIn exports print newest first, so a model reading the
    # document top to bottom sees every career backwards - which is how someone
    # who moved from film into recruiting comes back described as the reverse.
    chronology = timeline.summary(timeline.extract(profile.raw_text))
    if chronology:
        parts += ["CHRONOLOGY (earliest first - this is the real order, "
                  "whatever order the document below is in):", chronology, ""]
    if profile.name:
        parts.append(f"Candidate: {profile.name}")
    if profile.known_roles:
        parts.append("Known roles: " + ", ".join(profile.known_roles))
    if profile.source_notes:
        parts.append(f"Recruiter's notes: {profile.source_notes}")
    parts.append("PROFILE TEXT (quote only from between these markers):")
    parts.append("---BEGIN PROFILE---")
    parts.append(profile.raw_text)
    parts.append("---END PROFILE---")
    return "\n\n".join(parts)


__all__ = ["SYSTEM", "build"]
