"""Does this codebase still behave the way it did when it was known good?

Not a test suite. The tests say each piece is correct in isolation; this says
the whole pipeline still produces the SAME answers it produced on the day
everything worked. A refactor that keeps every test green and quietly changes
what a recruiter sees shows up here and nowhere else.

The model is stubbed with a fixed response on purpose. We are benchmarking
this code, not Qwen - a live model would make every run differ and the
comparison would be worthless.

    python bench/run.py             compare against the recorded baseline
    python bench/run.py --update    re-record (only when a change is INTENDED)
"""

import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from src.common.types import CandidateProfile           # noqa: E402
from src.story import extract_arc_detailed              # noqa: E402
from src.story.entails import entails                   # noqa: E402
from src.story.identity import one_person               # noqa: E402
from src.story.timeline import (confirms_order, contradicts_order,  # noqa: E402
                                extract as extract_timeline,
                                proves_departure,
                                summary as timeline_summary)
from src.story.verify import verify_span                # noqa: E402

HERE = pathlib.Path(__file__).parent
BASELINE = HERE / "baseline.json"

PROFILE = """Marta Reyes - Berlin
2019-2023  Senior Backend Engineer, Zalando
2023-now   Backend Engineer, Pleo
Worked on checkout and returns. Spent about eighteen months on a migration
that got cancelled. Now closer to the money side of things. Two kids, so I
optimise for predictable weeks. I keep bees."""

# A fixed model response containing, deliberately, one of each failure the
# gates exist to catch: a good beat, an intent claim backed by a doing quote,
# a departure claim with no departure language, and an invented quote.
RESPONSE = json.dumps({
    "throughline": "Optimises for predictable, self-contained work.",
    "throughline_evidence": ["Two kids, so I optimise for predictable weeks."],
    "unresolved_tension": "Whether the move to a smaller company was the point.",
    "tension_evidence": ["Now closer to the money side of things."],
    "departures": [
        {"description": "Left large-organisation politics behind",
         "evidence": "Spent about eighteen months on a migration that got cancelled.",
         "confidence": 0.9},
        {"description": "Moved toward smaller company work",
         "evidence": "She grew tired of the corporate treadmill.",   # not in the profile
         "confidence": 0.8},
    ],
    "pursuits": [
        {"description": "Predictable weeks around family",
         "evidence": "Two kids, so I optimise for predictable weeks.",
         "confidence": 0.85},
        {"description": "Seeking work closer to payments",
         "evidence": "Now closer to the money side of things.",
         "confidence": 0.8},
    ],
})

ENTAILS_CASES = [
    ("Seeking roles building trading infrastructure",
     "Currently working at Odum Research where I help building a modern trading platform."),
    ("Works on trading platform engineering",
     "Currently working at Odum Research where I help building a modern trading platform."),
    ("Left agency work behind", "Left the agency after six years."),
    ("Left agency work behind", "Joined a Series B to own a product end to end."),
    ("Now manages a team", "Writes Go and Java every day."),
    ("Led a team of 40 engineers", "Led a team of engineers."),
    ("Moved from Java to Go", "I moved from Java to Go over the last two years."),
]

PARITY = json.loads((HERE / "parity-cases.json").read_text())


def _timeline_answers():
    spans = extract_timeline(PARITY["timeline_text"])
    out = {"summary": timeline_summary(spans)}
    for q in PARITY["timeline"]["proves_departure"]:
        out["dep:" + q] = proves_departure(q, spans)
    for q in PARITY["timeline"]["contradicts"]:
        out["con:" + q] = contradicts_order(q, spans)
    for q in PARITY["timeline"]["confirms"]:
        out["cfm:" + q] = confirms_order(q, spans)
    return out


def parity():
    """The deployed page runs its own copy of these gates. A fix once landed in
    Python and never reached docs/app.js; the live page stayed wrong for hours
    with every test green. This compares the two directly."""
    py = {
        "entails": {f"{c} || {q}": entails(c, q).ok for c, q in PARITY["entails"]},
        "verify": {q: verify_span(q, PARITY["verify_text"]) for q in PARITY["verify"]},
        "onePerson": {k: one_person(v).ok for k, v in PARITY["onePerson"].items()},
        "timeline": _timeline_answers(),
    }
    try:
        js = json.loads(subprocess.run(
            ["node", str(HERE / "parity.js")], capture_output=True, text=True,
            timeout=60, check=True).stdout)
    except Exception as exc:
        return [("node could not run", "-", str(exc)[:80])]
    return [(f"{sec}.{k}", v, js.get(sec, {}).get(k))
            for sec in py for k, v in py[sec].items()
            if v != js.get(sec, {}).get(k)]


VERIFY_CASES = [
    ("Two kids, so I optimise for predictable weeks.", True),
    ("two kids so i optimise for predictable weeks", True),
    ("She grew tired of the corporate treadmill.", False),
    ("optimise", False),   # too short to mean anything
]


def measure():
    arc, report = extract_arc_detailed(
        CandidateProfile(raw_text=PROFILE, name="Marta Reyes"),
        complete=lambda *a, **k: RESPONSE)
    return {
        "pipeline": {
            "throughline": arc.throughline,
            "throughline_evidence": arc.throughline_evidence,
            "tension_evidence": arc.tension_evidence,
            "kept": sorted(b.description for b in arc.departures + arc.pursuits),
            "dropped": sorted([d.description, d.reason] for d in report.dropped),
            "arc_confidence": arc.confidence,
            "beat_confidences": sorted(b.confidence for b in arc.departures + arc.pursuits),
        },
        "entails": {f"{c} || {q}": entails(c, q).ok for c, q in ENTAILS_CASES},
        "verify": {q: verify_span(q, PROFILE) for q, _ in VERIFY_CASES},
        "identity": {k: one_person(v).ok for k, v in PARITY["onePerson"].items()},
        "timeline": _timeline_answers(),
    }


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key + "."))
        else:
            out[key] = v
    return out


def main():
    now = measure()
    if "--update" in sys.argv or not BASELINE.exists():
        BASELINE.write_text(json.dumps(now, indent=2, sort_keys=True) + "\n")
        print(f"baseline recorded: {BASELINE}")
        return 0

    was = flatten(json.loads(BASELINE.read_text()))
    isnow = flatten(now)
    diffs = [(k, was.get(k), isnow.get(k))
             for k in sorted(set(was) | set(isnow)) if was.get(k) != isnow.get(k)]

    drift = parity()
    if drift:
        print(f"narrative-sourcing  PYTHON AND JAVASCRIPT DISAGREE  ({len(drift)})\n")
        for k, a, b in drift:
            print(f"  {k}\n      python: {a}\n      js    : {b}")
        print("\nThe deployed page is the JavaScript. Fix docs/app.js.")
        return 1

    if not diffs:
        print(f"narrative-sourcing  SAME as known good  "
              f"({len(isnow)} checks, python and js agree)")
        return 0
    print(f"narrative-sourcing  CHANGED  ({len(diffs)} of {len(isnow)} checks differ)\n")
    for k, a, b in diffs:
        print(f"  {k}\n      was: {a}\n      now: {b}")
    print("\nIf every change above is one you meant to make:  python bench/run.py --update")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
