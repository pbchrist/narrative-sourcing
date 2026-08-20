"""Control for the benchmark: does the verbatim-citation instruction do
the work, or does the model simply not fabricate?

The main benchmark found a 0% drop rate, which has two very different
readings. Either the model never invents citations (verification is
pointless), or the prompt's verbatim rules prevent it (verification is
what proves the prompt is holding). Removing the rules separates them.
"""

import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.story import prompt as prompt_mod  # noqa: E402

# What someone writes when they have not thought about citation fidelity:
# asks for evidence, does not demand it be verbatim, does not warn that
# unverifiable claims are discarded.
NAIVE = """You read a person's career history and identify the story in it.

Identify:
- the throughline: the one thing constant across every move
- departures: what they moved away from
- pursuits: what they were reaching toward
- the unresolved tension their next move would answer

Return ONLY a JSON object:
{
  "throughline": "one sentence",
  "unresolved_tension": "one sentence",
  "departures": [{"description": "...", "evidence": "what in the profile \
supports this", "confidence": 0.0}],
  "pursuits": [{"description": "...", "evidence": "what in the profile \
supports this", "confidence": 0.0}]
}"""

if __name__ == "__main__":
    prompt_mod.SYSTEM = NAIVE
    from bench.run import run, summarise

    paths = sorted(glob.glob("bench/profiles/*.txt"))
    if os.path.exists("/Users/user/Desktop/test1.pdf"):
        paths.append("/Users/user/Desktop/test1.pdf")
    print(f"ABLATION: naive prompt, {len(paths)} profiles\n")
    rows = run(paths, repeats=1, out_path="bench/results_ablation.json")
    summarise(rows)
