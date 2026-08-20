import json

from src.intake import load_candidate, load_role
from src.pipeline import render, run

RAW = """Led growth at an agency for six years.
Left because shipping and walking away stopped being satisfying.
Joined a Series B to own a product end to end.
Now runs a team of four and keeps asking about platform scope."""

JD = ("Own the platform roadmap end to end. You will grow and lead a small "
      "team and set technical direction for the next two years.")


def scripted(*responses):
    calls = iter(responses)

    def _complete(prompt, *, system=None, **kw):
        return next(calls)

    return _complete


ARC = json.dumps({
    "throughline": "Keeps trading reach for ownership.",
    "unresolved_tension": "Whether ownership means scope or depth.",
    "confidence": 0.95,
    "departures": [{
        "description": "Left agency work for ownership",
        "evidence": "Left because shipping and walking away stopped being satisfying.",
        "confidence": 0.8,
    }],
    "pursuits": [{
        "description": "Wants end-to-end ownership",
        "evidence": "Joined a Series B to own a product end to end.",
        "confidence": 0.8,
    }],
})

FIT = json.dumps({
    "continues_arc": True,
    "reasoning": "The role extends ownership into platform scope.",
    "risk_flags": ["Team is smaller than their current one; ask about it."],
})


def test_end_to_end_produces_a_brief():
    profile = load_candidate(RAW, name="Dana")
    role = load_role("Platform Lead", JD)
    brief = run(profile, role, complete=scripted(ARC, FIT))

    assert brief.candidate_name == "Dana"
    assert brief.draft_status == "needs_human_message"
    assert "ownership" in brief.one_line_story.lower()
    assert "Team is smaller than their current one; ask about it." in brief.cautions


def test_invented_evidence_does_not_survive_the_pipeline():
    poisoned = json.dumps({
        "throughline": "Burned out and wants calm.",
        "unresolved_tension": "Whether they still want intensity.",
        "departures": [{
            "description": "Left after burnout",
            "evidence": "Burned out badly after years of unsustainable hours",
            "confidence": 0.95,
        }],
        "pursuits": [],
    })
    profile = load_candidate(RAW, name="Dana")
    role = load_role("Platform Lead", JD)
    brief = run(profile, role, complete=scripted(poisoned, FIT))

    # The invented departure is gone, and the brief says so loudly rather
    # than presenting the burnout story as a finding.
    assert any("no evidence" in c.lower() for c in brief.cautions)
    rendered = render(brief).lower()
    assert "burned out badly" not in rendered


def test_render_never_emits_a_ready_to_send_message():
    profile = load_candidate(RAW, name="Dana")
    role = load_role("Platform Lead", JD)
    out = render(run(profile, role, complete=scripted(ARC, FIT)))
    assert "Write the message yourself." in out
    assert "hi dana" not in out.lower()


def test_a_recommendation_cannot_become_evidence(tmp_path):
    """Third-party praise is stripped at intake, so a model that tries to
    cite it fails verification and the inference is dropped.

    This is the belt-and-braces case: stripping alone would be enough, and
    verification alone would not (the quote IS verbatim in the export), so
    the two together are what close it.
    """
    from src.intake import read_source
    from src.story import extract_arc
    from tests._pdfbuild import minimal_pdf

    export = [
        "Summary", "I like problems where the hard part isn't the code.",
        "Experience", "Kepler Health", "Staff Engineer", "2019 - 2022",
        "Owned the patient-scheduling rewrite end to end, including the",
        "parts nobody wanted: migration, on-call and the edge cases.",
        "Recommendations",
        "Riley single-handedly transformed our entire platform and would",
        "excel in any executive role.",
    ]
    path = tmp_path / "p.pdf"
    path.write_bytes(minimal_pdf(export))
    text, removed = read_source(str(path))
    profile = load_candidate(text, name="Riley")

    flattering = json.dumps({
        "throughline": "A visionary executive in the making.",
        "unresolved_tension": "When they will take an executive role.",
        "departures": [],
        "pursuits": [{
            "description": "Reaching for executive scope",
            "evidence": "would excel in any executive role",
            "confidence": 0.95,
        }],
    })
    arc = extract_arc(profile, complete=scripted(flattering))

    assert arc.pursuits == []
    assert arc.confidence == 0.0
    assert any("executive role" in r for r in removed)
