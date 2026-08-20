"""Measure whether evidence verification catches anything.

The design of this tool rests on one empirical claim: that a model asked
to cite a career profile will sometimes cite things the profile does not
say, often enough that checking is worth the trouble. If the drop rate is
near zero, the verification layer is ceremony and the tool is a wrapper.

Reports drops split by cause, because a quote rejected over formatting is
not a hallucination caught, and counting it as one would overstate the
result.
"""

import json
import os
import sys
import time
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.intake import load_candidate, read_source  # noqa: E402
from src.story import extract_arc_detailed  # noqa: E402


def run(paths, repeats=1, out_path=None):
    rows = []
    for path in paths:
        for rep in range(repeats):
            text, _ = read_source(path)
            profile = load_candidate(text)
            started = time.time()
            try:
                arc, report = extract_arc_detailed(profile)
            except Exception as exc:
                print(f"  {os.path.basename(path)} rep{rep}: FAILED {exc}")
                rows.append({"profile": os.path.basename(path), "rep": rep,
                             "kind": "error", "error": str(exc)})
                continue
            name = os.path.basename(path)
            row = {
                "profile": name,
                "kind": ("dense" if name.startswith("dense")
                         else "sparse" if name.startswith("sparse")
                         else "real"),
                "rep": rep,
                "chars": len(text),
                "proposed": report.proposed,
                "kept": report.kept,
                "drop_rate": report.drop_rate,
                "arc_confidence": arc.confidence,
                "elapsed": round(time.time() - started, 1),
                "dropped": [
                    {"reason": d.reason, "overlap": d.overlap,
                     "description": d.description, "evidence": d.evidence}
                    for d in report.dropped
                ],
            }
            rows.append(row)
            print(f"  {row['profile']} rep{rep}: proposed={row['proposed']} "
                  f"kept={row['kept']} dropped={len(row['dropped'])} "
                  f"({row['elapsed']}s)")
            for d in report.dropped:
                print(f"      [{d.reason} {d.overlap}] {d.evidence[:90]!r}")
            if out_path:
                with open(out_path, "w") as fh:
                    json.dump(rows, fh, indent=2)
    return rows


def summarise(rows):
    ok = [r for r in rows if "error" not in r]
    proposed = sum(r["proposed"] for r in ok)
    dropped = sum(len(r["dropped"]) for r in ok)
    reasons = Counter(d["reason"] for r in ok for d in r["dropped"])

    print("\n" + "=" * 62)
    print(f"runs: {len(ok)}   claims proposed: {proposed}   dropped: {dropped}")
    print(f"overall drop rate: {dropped / proposed:.1%}" if proposed else "n/a")
    print("\nby cause:")
    for reason, n in reasons.most_common():
        print(f"  {reason:12} {n:3}  ({n / proposed:.1%} of all claims)")

    # The honest headline: only paraphrase and fabricated are the model
    # citing something the profile does not say.
    real = reasons["paraphrase"] + reasons["fabricated"]
    print(f"\ninvented citations (paraphrase + fabricated): {real}"
          f"  = {real / proposed:.1%} of claims" if proposed else "")

    print("\nby profile density:")
    for kind in ("dense", "sparse", "real"):
        sub = [r for r in ok if r["kind"] == kind]
        if not sub:
            continue
        p = sum(r["proposed"] for r in sub)
        d = sum(len(r["dropped"]) for r in sub)
        conf = sum(r["arc_confidence"] for r in sub) / len(sub)
        print(f"  {kind:7} runs={len(sub)} proposed={p} dropped={d} "
              f"rate={d / p:.1%} mean_arc_conf={conf:.2f}" if p else "")


if __name__ == "__main__":
    import glob
    paths = sorted(glob.glob("bench/profiles/*.txt"))
    if os.path.exists("/Users/user/Desktop/test1.pdf"):
        paths.append("/Users/user/Desktop/test1.pdf")
    reps = int(os.environ.get("BENCH_REPEATS", "1"))
    print(f"{len(paths)} profiles x {reps} rep(s)\n")
    rows = run(paths, repeats=reps, out_path="bench/results.json")
    summarise(rows)
