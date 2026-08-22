"""Does the verbatim-quote rule actually change what the model does?

The whole design rests on one claim: forcing a model to quote its source
verbatim, and deleting anything that fails the check, is not ceremony. This
measures it. Two runs over the same profiles with the same model at the same
temperature, differing in one thing: whether the system prompt demands the
quote be verbatim.

The ablation removes ONLY the verbatim requirement. Both conditions still ask
for evidence, so this measures the effect of "quote exactly, or it is
discarded" - not the effect of asking for evidence at all. Removing evidence
entirely would prove nothing anyone doubted.

Grading is done by src/story/verify.py, the same deterministic check the
product ships. No model judges this.

    python ablation/run.py          run it, write results.json and raw/
"""

import json
import pathlib
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from src.common.parsing import ParseError, extract_json   # noqa: E402
from src.story import prompt as prompt_mod                # noqa: E402
from src.story.verify import verify_span                  # noqa: E402

HERE = pathlib.Path(__file__).parent
RAW = HERE / "raw"
ENDPOINT = json.loads(urllib.request.urlopen(
    "https://pbchrist.github.io/narrative-sourcing/endpoint.json", timeout=30
).read())["url"]

WITH = prompt_mod.SYSTEM

# The two hard rules about verbatim citation, replaced by an instruction that
# still asks for evidence but does not require it be copied exactly.
OLD = """1. Every departure and pursuit must quote VERBATIM text from the profile \
as its evidence. Copy the characters exactly. Do not paraphrase, \
summarize, tidy or reconstruct the quote. A quote that does not appear \
in the profile word for word will be discarded automatically.
2. If you cannot find verbatim text supporting a claim, omit the claim. \
An honest short arc beats a well-written invented one."""
NEW = """1. Every departure and pursuit should include supporting evidence \
from the profile.
2. Prefer claims the profile supports."""
assert OLD in WITH, "prompt text moved - fix the ablation before trusting it"
WITHOUT = WITH.replace(OLD, NEW, 1)

PROFILES = json.loads((HERE / (sys.argv[1] if len(sys.argv) > 1 else "profiles.json")).read_text())
TAG = "-long" if len(sys.argv) > 1 else ""


def ask(system, user):
    body = json.dumps({
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": 0.2, "max_tokens": 8000,
    }).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"Content-Type": "application/json",
                 "Origin": "https://pbchrist.github.io"})
    with urllib.request.urlopen(req, timeout=300) as r:
        d = json.loads(r.read())
    return (d.get("choices") or [{}])[0].get("message", {}).get("content", "")


def quotes_from(data):
    out = []
    for key in ("departures", "pursuits"):
        for b in data.get(key) or []:
            if isinstance(b, dict) and b.get("description"):
                out.append((str(b.get("description")), str(b.get("evidence") or "")))
    return out


def main():
    RAW.mkdir(exist_ok=True)
    results = {"endpoint": ENDPOINT, "profiles": len(PROFILES), "runs": []}

    for cond, system in (("with_rule", WITH), ("without_rule", WITHOUT)):
        for prof in PROFILES:
            text = prof["text"]
            user = ("PROFILE TEXT (quote only from between these markers):\n"
                    "---BEGIN PROFILE---\n" + text + "\n---END PROFILE---")
            try:
                content = ask(system, user)
            except Exception as exc:
                content = ""
                print(f"  !! {cond}/{prof['id']}: {exc}", flush=True)
            (RAW / f"{cond}--{prof['id']}{TAG}.txt").write_text(content)

            try:
                data = extract_json(content)
            except (ParseError, Exception):
                data = {}
            pairs = quotes_from(data)
            graded = [{"claim": c, "evidence": e, "verbatim": bool(verify_span(e, text))}
                      for c, e in pairs]
            results["runs"].append({
                "condition": cond, "profile": prof["id"],
                "claims": len(graded),
                "verbatim": sum(1 for g in graded if g["verbatim"]),
                "graded": graded,
            })
            ok = sum(1 for g in graded if g["verbatim"])
            print(f"  {cond:<13} {prof['id']:<12} {ok}/{len(graded)} quotes check out",
                  flush=True)
            time.sleep(30)   # stay well inside the bridge's 12-per-5-minutes

    for cond in ("with_rule", "without_rule"):
        rs = [r for r in results["runs"] if r["condition"] == cond]
        claims = sum(r["claims"] for r in rs)
        good = sum(r["verbatim"] for r in rs)
        results[cond] = {
            "claims": claims, "verbatim": good, "fabricated": claims - good,
            "fabrication_rate": round((claims - good) / claims, 3) if claims else None,
            "profiles_fully_clean": sum(1 for r in rs if r["claims"] and r["verbatim"] == r["claims"]),
            "profiles_fully_invented": sum(1 for r in rs if r["claims"] and r["verbatim"] == 0),
        }
    (HERE / f"results{TAG}.json").write_text(json.dumps(results, indent=2) + "\n")
    print("\n" + json.dumps({k: results[k] for k in ("with_rule", "without_rule")}, indent=2))


if __name__ == "__main__":
    main()
