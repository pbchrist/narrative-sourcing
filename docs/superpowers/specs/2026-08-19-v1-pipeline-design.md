# v1 pipeline design (2026-08-19)

Implements the pipeline specced in docs/DESIGN.md under the hard rules in
docs/PRINCIPLES.md. This document covers the decisions DESIGN.md leaves
open: how inference is constrained, how confidence is produced, and how
each principle becomes an executable check rather than an aspiration.

## The core problem

The pipeline asks a model to infer a real person's motives from text they
did not write for this purpose. That is the product thesis and also the
main liability. Principles 1 and 2 exist to contain it. Both are only
worth anything if they are enforced in code, so every principle below is
paired with the mechanism that makes violating it fail.

## Backend

Runtime inference runs against a local llama.cpp OpenAI-compatible
endpoint. Configuration is environment-driven so the backend swaps
without code changes:

    NS_LLM_BASE_URL    default http://100.73.250.50:8081
    NS_LLM_MODEL       default unset (llama.cpp serves its loaded model)
    NS_LLM_TIMEOUT     default 600s
    NS_LLM_MAX_TOKENS  default 8000

The backend is a *reasoning* model: it fills `reasoning_content` before
it emits any `content`, and spends two to three minutes doing so on a
profile-sized prompt. Two consequences the client must handle, and does:
timeouts are measured in minutes rather than seconds, and an empty
`content` field alongside a non-empty `reasoning_content` means the token
budget ran out mid-thought. That is reported as itself rather than passed
downstream as an empty string for a JSON parser to choke on.

The intended backend is an abliterated Qwen. Abliteration removes
refusals, which this task needs (safety-tuned models decline to infer
motives about real people), but it also degrades calibration. Therefore:

**No self-reported confidence is ever trusted.** The model may emit a
confidence number; the parser reads it and discards it. All confidence
in the system is derived structurally from evidence that survived
verification. This is the single most important consequence of the
backend choice.

## Enforcement mechanisms

### Principle 1 -> verbatim evidence verification (src/story/verify.py)

`Beat.evidence` must be a verbatim span of `CandidateProfile.raw_text`.
Matching is whitespace-normalized and case-insensitive, with surrounding
quotes and ellipses stripped, so ordinary paste artifacts do not cause
false rejections. Anything that still fails to match is a citation to
text the candidate never wrote.

Beats that fail verification are dropped, per Principle 1's "omitted
rather than guessed". The count of dropped beats is retained and feeds
confidence.

### Principle 2 -> derived confidence, surfaced to the brief

    arc.confidence = survival_rate * coverage_factor * mean_beat_confidence

`survival_rate` is verified beats / proposed beats. `coverage_factor`
scales with how much distinct evidence the surviving beats cite: an arc
built from two beats that both quote the same sentence is not as
well-supported as one drawing on four distinct spans, and the number
reflects that. `mean_beat_confidence` carries the model's own doubt
through, under the asymmetry described below.

Per beat, the model may *lower* its confidence but never raise it:

    beat.confidence = min(reported, ceiling)

where `ceiling` is 0.9 for a substantial citation and 0.6 for a thin one.
The asymmetry is deliberate. An abliterated model's certainty is not
informative, but its doubt is — a model volunteering 0.2 is telling us
something worth keeping. So doubt is honored and certainty is capped.

`brief/` injects a caution naming the numeric confidence whenever the arc
falls below 0.6. The brief cannot render a low-confidence arc as clean
declarative prose, because the caution is added by the same function that
builds the brief and is not optional.

### Principle 3 -> sendable-text guard (src/brief/guard.py)

`OutreachBrief` has no message field, and `_reject_sendable_text` raises
`SendableTextError` if any brief field contains salutation patterns
("Hi <name>", "Dear"), sign-offs ("Best,", "Cheers,"), or second-person
recruiting pitch constructions ("I'd love to chat", "would you be open
to"). The guard runs on every brief built, so a future prompt change that
starts emitting copy-pasteable prose fails loudly instead of silently
turning this into the tool it was built not to be.

### Principle 4 -> forced ambiguity

`fit/` may return `continues_arc=None`. Beyond honoring a model-returned
null, it *downgrades* an asserted bool to `None` when
`arc.confidence < 0.45`, and appends a risk flag saying so. A confident
verdict resting on a poorly evidenced arc is exactly the failure mode
Principle 4 names.

## Module contracts

    intake.load_candidate(raw_text, ...) -> CandidateProfile   no LLM
    intake.load_role(title, raw_description, ...) -> RoleContext   no LLM
    story.extract_arc(profile, complete=...) -> CareerArc
    fit.assess(arc, role, profile, complete=...) -> FitAssessment
    brief.build_brief(profile, arc, assessment) -> OutreachBrief   no LLM

Every LLM-calling function takes an injectable `complete` callable
defaulting to `src.common.llm.complete`, so the entire suite runs offline
against fakes and no test touches the network.

`brief.build_brief` takes the profile and arc in addition to the
assessment, because it needs the candidate name and the throughline.
DESIGN.md's shorthand of "FitAssessment -> OutreachBrief" describes the
pipeline stage, not the literal arity.

`skill_overlap` is computed deterministically by token overlap with no
LLM call. It is the commoditized part of the problem and DESIGN.md wants
it kept subordinate; making it cheap and boring in code is how that
intent survives.

## Intake sources

`intake.read_source` reads `.txt` or `.pdf`, dispatching on magic bytes
rather than extension. This is not a scraper and does not weaken the
"recruiter pastes text in" rule: a PDF the recruiter exported themselves
is still recruiter-supplied text.

Stripping runs before `CandidateProfile.raw_text` is set, so the model and
the verifier see byte-identical text. If they diverged, citations would
fail verification for reasons unrelated to whether the model invented
anything.

Two asymmetries in the stripper, both learned by running it:

**Recommendations are the point.** Third-party praise passes
`verify_span` cleanly because it genuinely is in the document. A
verifiable false attribution is worse than a hallucination, since every
check downstream reports success. Third-party voice is removed at intake.

**Line furniture is dropped aggressively, sections conservatively.**
Over-stripping destroys narrative signal silently. Two real failures
found this way: a date range like `2015 - 2019` matches a phone-number
pattern, and dates are the load-bearing signal for an arc; and dropping a
list section to the next heading swallowed the name, headline and
location, because a real export runs Top Skills -> name -> headline ->
Summary with no reliable blank line. Dropped sections are therefore
typed — list sections end at the first prose line, prose sections
(recommendations) cannot use that rule.

These patterns are written against the remembered shape of an export and
have not been verified against a real LinkedIn PDF. `--show-stripped`
exists so the first real file reveals wrong guesses immediately.

## Out of scope for v1

No scraper, no batch mode, no send path, no scheduling. One candidate,
one role, one brief.
