import json

from src.cli import main


def test_role_can_be_a_bare_sentence(tmp_path, monkeypatch, capsys):
    profile = tmp_path / "p.txt"
    profile.write_text("Led growth at an agency for six years. "
                       "Left because shipping and walking away stopped "
                       "being satisfying. Joined a Series B to own it.")

    calls = iter([
        json.dumps({"throughline": "Trades reach for ownership.",
                    "unresolved_tension": "Scope or depth.",
                    "departures": [], "pursuits": [{
                        "description": "Wants ownership",
                        "evidence": "Joined a Series B to own it",
                        "confidence": 0.8}]}),
        json.dumps({"continues_arc": True, "reasoning": "It fits."}),
    ])
    monkeypatch.setattr("src.common.llm.complete",
                        lambda *a, **k: next(calls))

    code = main(["--profile", str(profile),
                 "--role", "wants to go found something with two other people"])
    assert code == 0
    out = capsys.readouterr().out
    assert "needs_human_message" in out


def test_title_is_optional_and_derived(tmp_path, monkeypatch):
    from src.intake import load_role
    assert load_role("wants to go found something").title
