# What to hand the agent in your first session

> **Historical.** This described the first session, which has happened:
> the v1 pipeline in the list below is built and tested. Kept because the
> closing note about where to spend effort is still the right instinct.
> For current state, read `README.md` and
> `docs/superpowers/specs/2026-08-19-v1-pipeline-design.md`.


Open this repo with the Superpowers plugin installed, then paste
something like:

---

Read docs/DESIGN.md and docs/PRINCIPLES.md. src/common/types.py already
has the data model. src/common/llm.py is a stub pointing at my beastmaster
llama.cpp endpoint.

I want to build v1 in this order:

1. src/common/llm.py — real implementation against the llama.cpp
   OpenAI-compatible endpoint, TDD'd against a mocked HTTP layer first.
2. src/intake/ — load a CandidateProfile and RoleContext from plain
   pasted text (no LLM calls, just validation/loading).
3. src/story/ — the CandidateProfile -> CareerArc extraction. This is
   the core piece. Every inferred field needs evidence + confidence per
   PRINCIPLES.md. Let's brainstorm the actual prompt design together
   before you write code, this is the part that has to be genuinely good.
4. src/fit/ — CareerArc + RoleContext -> FitAssessment. continues_arc
   must be allowed to come back None.
5. src/brief/ — FitAssessment -> OutreachBrief. No sendable message
   field, ever, per PRINCIPLES.md rule 3.

Let's brainstorm step 3 first since it's the riskiest/most novel part,
then plan the rest.

---

That last instruction matters: story/ (the extraction prompt) is the
one piece that's genuinely unproven. Everything else is fairly ordinary
software. Make the agent spend its brainstorming budget there, not on
boilerplate.
