# narrative-sourcing

## The thesis

Every AI sourcing tool on the market (Juicebox, Pin, Noon, etc) treats a
candidate as a bag of attributes: skills, titles, years of experience, keyword
overlap with a job description. That layer is now commoditized. It is also
increasingly failing: candidates are flooded with AI-personalized outreach
that reads as hollow, response rates are dropping, and "hyper-personalized"
has become a synonym for "spam with better production values."

What none of these tools do is treat a candidate's career as a *story* with
an arc, a throughline, a thing they're reaching for or moving away from. A
resume is a plot with the connective tissue removed. Putting that connective
tissue back, and then pitching a role as the next chapter that actually fits
the arc rather than a role that merely matches the tags, is not something
any competitor is building, because it requires narrative judgment, not
keyword matching.

This tool exists to prove that pipeline is buildable, and to force a human
decision point before any message reaches a candidate, because the data is
clear that the message itself is the part that must stay human.

This is not a database tool. It does not compete with Juicebox on profile
count. It is not an outreach-sending tool. It never sends anything. It
produces a brief a human uses to write a real message.

## v1 scope (thin, but end to end)

    intake -> story extraction -> role-fit scoring -> human-gated brief

No auto-send. No bulk mode. One candidate, one role, one brief, at a time,
for v1. Breadth (batch processing, multiple roles, a real data source
integration) comes after the thin path is proven to produce briefs that are
actually good and actually change how outreach gets written.

## Data model

### CandidateProfile (input)
Raw input for v1: a block of unstructured text (pasted LinkedIn "About" +
job history + any notes the recruiter has) plus optional structured fields.
Do not build a scraper in v1. The recruiter pastes text in.

    CandidateProfile
      raw_text: str
      name: str | None
      known_roles: list[str] | None      # optional structured hint
      source_notes: str | None           # recruiter's own notes, if any

### CareerArc (output of story extraction)
This is the core novel artifact. Not a summary. An arc.

    CareerArc
      throughline: str          # one sentence: the thing that's consistent
                                 # across every move this person has made
      departures: list[Beat]    # why they left, inferred, each with confidence
      pursuits: list[Beat]      # what they were visibly reaching for
      unresolved_tension: str   # the open question their next move would answer
      confidence: float         # 0-1, how much of this is inference vs stated fact

    Beat
      description: str
      evidence: str             # the specific line(s) in raw_text this comes from
      confidence: float

Every field that is inferred must carry its evidence and confidence. This
is a hard rule (see docs/PRINCIPLES.md). A narrative engine that
hallucinates a person's motivations with false confidence is worse than
useless, it's a liability. Low confidence outputs must surface as low
confidence, not get smoothed over into a clean-sounding story.

### RoleContext (input)
    RoleContext
      title: str
      raw_description: str
      company_context: str | None   # stage, culture notes, why this role exists now

### FitAssessment (output of role-fit scoring)
    FitAssessment
      continues_arc: bool | None    # None = genuinely ambiguous, don't force it
      reasoning: str                # does this role continue the throughline
                                     # or fracture it, and why
      risk_flags: list[str]         # e.g. "this looks like a step back from
                                     # their stated pursuit, worth asking about
                                     # directly rather than avoiding"
      skill_overlap: dict           # the boring commoditized part, kept but
                                     # subordinate, not the headline

### OutreachBrief (final output, human-gated)
    OutreachBrief
      candidate_name: str
      one_line_story: str           # the throughline, compressed
      why_this_role: str            # the pitch angle, grounded in the arc
      open_question: str            # something genuine to ask, not a
                                     # rhetorical hook
      cautions: list[str]           # anything the recruiter should know
                                     # before reaching out
      draft_status: Literal["needs_human_message"]  # this is never "ready
                                     # to send" - v1 never produces sendable
                                     # text, only a brief a human writes from

Note what's deliberately absent: there is no `drafted_message` field in v1.
The system's output is a brief, not a message. The human writes the message.
This is the human-in-the-loop gate, encoded in the data model itself, not
just as a UI checkbox that's easy to skip.

## Module boundaries

    src/intake/    - loads/validates CandidateProfile and RoleContext,
                      no LLM calls here
    src/story/     - CandidateProfile -> CareerArc, the core novel piece
    src/fit/       - (CareerArc, RoleContext) -> FitAssessment
    src/brief/     - FitAssessment -> OutreachBrief, formatting + the
                      hard rule that no sendable message is ever generated
    src/common/    - shared types (the dataclasses above), LLM client
                      wrapper, evidence/confidence utilities

Each module's public interface is one function in, one typed object out.
No module reaches into another module's internals. This boundary matters
more than usual here because story/ and fit/ are the parts doing genuine
inference and need to be independently testable and independently
swappable (e.g. swap which model backend does story extraction without
touching fit/ at all).

## What this is NOT in v1
- Not a data source / scraper. Recruiter pastes text in.
- Not a bulk tool. One candidate at a time.
- Not an outreach sender. It has no send capability, period, not even
  behind a flag.
- Not a scoring leaderboard. FitAssessment.continues_arc can and should
  come back None/ambiguous when the evidence doesn't support a clean call.

## Model backend

Runs against the existing local Qwen setup on beastmaster via llama.cpp
(port 8081) by default. src/common/llm.py should be a thin wrapper with
one function, `complete(prompt: str) -> str`, so the backend can be
swapped (e.g. to test against a hosted model for comparison) without
touching story/ or fit/.

## Definition of done for v1

Feed it one pasted LinkedIn profile and one pasted job description.
It produces one OutreachBrief. A human (you) reads the brief and can
say honestly: "yes, that's a true and useful read of this person's
arc, and yes, that's a real pitch angle I wouldn't have necessarily
seen from the resume alone." If it can't clear that bar on real
candidates you've actually placed before, the story-extraction prompt
needs more work before anything else gets built on top of it.
