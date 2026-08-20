# narrative-sourcing

Every AI sourcing tool scores candidates against a job description like a
resume is a bag of keywords. It isn't. It's a plot with the connective
tissue removed.

This is a small, honest experiment: extract a candidate's actual career
arc (what they've been reaching for, what they left, what tension their
next move would resolve), score whether a given role genuinely continues
that story, and hand a recruiter a brief to write a real message from.

It does not send messages. It never will, on purpose. The evidence is
clear that AI-personalized outreach is exactly what candidates have
learned to tune out. The message has to stay human. This tool's job is
insight, not sentences.

See `docs/DESIGN.md` for the full spec and `docs/PRINCIPLES.md` for the
rules that keep this from turning into another confident-sounding
bullshit generator.

## Status

v1 pipeline is implemented end to end: `intake -> story -> fit -> brief`.
Paste a candidate profile and a job description in, get one human-gated
brief out. No scraping, no batch mode, no auto-send.

    python -m src.cli --profile profile.pdf --role jd.txt \
        --title "Founding Engineer, Platform" --name "Riley"

`--profile` takes a `.txt` or a LinkedIn PDF export (detected by magic
bytes, so an export saved without an extension still works). Export
furniture — contact blocks, skill lists, page footers — is stripped
before extraction. Run with `--show-stripped` on your first real export
to see exactly what was removed; the strip rules are written against the
usual export shape and that is how you find out where they guess wrong.

The most important thing the stripper removes is **recommendations**. A
colleague's praise is verbatim text in the export, so it passes evidence
verification cleanly and would be attributed to the candidate's own
self-narrative — a *verifiable* false attribution, which nothing
downstream can flag. Principle 1 rests on the candidate's own words, so
third-party voice never reaches the model.

Job history is the most important input. Departures and pursuits are
inferences about transitions, so they only exist in the sequence of
moves; paste the About section alone and you will get a throughline with
almost nothing under it, and a confidence score that says so.

The principles in `docs/PRINCIPLES.md` are enforced in code, not just
asserted:

- every cited quote is verified verbatim against the profile text, and
  beats that fail are dropped (rule 1)
- arc confidence is derived from what survived verification, never read
  from the model, and low confidence is injected into the brief's
  cautions with the number visible (rule 2)
- a guard rejects any brief field containing salutations, sign-offs or
  second-person pitch, so no sendable text can leak out (rule 3)
- a verdict is withheld when the arc is too thinly evidenced, even if
  the model offered one (rule 4)

Run the suite with `pytest`. It is fully offline; no test touches the
network.

## Stack

Python, local inference via llama.cpp / Qwen (see `src/common/llm.py`
for the swappable backend interface).

## Building this

This repo is built with Claude Code using the Superpowers plugin
(brainstorming -> planning -> subagent-driven TDD -> code review per
task). Start any session by pointing Claude Code at `docs/DESIGN.md`
and `docs/PRINCIPLES.md` and let it plan from there.
