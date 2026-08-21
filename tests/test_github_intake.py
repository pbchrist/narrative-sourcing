import pytest

from src.intake.github import GitHubError, load, to_text

USER = {"login": "ada", "name": "Ada L", "bio": "graphics + simulation",
        "company": "@weta", "location": "Wellington", "blog": "",
        "created_at": "2014-03-02T00:00:00Z", "public_repos": 31, "followers": 480}

REPOS = [
    {"name": "usd-tools", "language": "C++", "stargazers_count": 900, "fork": False,
     "created_at": "2019-01-01T00:00:00Z", "pushed_at": "2026-02-01T00:00:00Z",
     "description": "OpenUSD pipeline utilities"},
    {"name": "quick-thing", "language": "Python", "stargazers_count": 2, "fork": False,
     "created_at": "2023-05-01T00:00:00Z", "pushed_at": "2023-05-02T00:00:00Z",
     "description": None},
    {"name": "somebody-elses", "language": "Go", "fork": True,
     "created_at": "2022-01-01T00:00:00Z", "pushed_at": "2022-01-02T00:00:00Z"},
]


def api(user=USER, repos=REPOS):
    def _get(path):
        return user if path.startswith("/users/") and "repos" not in path else repos
    return _get


def test_builds_a_profile_from_a_real_account():
    p = load("ada", get=api())
    assert p.name == "Ada L"
    assert "github.com/ada" in p.source_notes


def test_forks_are_excluded():
    assert "somebody-elses" not in to_text({"user": USER, "repos": [r for r in REPOS if not r["fork"]]})


def test_text_carries_what_they_built_not_just_the_bio():
    t = load("ada", get=api()).raw_text
    assert "usd-tools" in t and "OpenUSD pipeline utilities" in t
    assert "900 stars" in t


def test_text_shows_the_span_of_a_project():
    assert "usd-tools (2019 to 2026)" in load("ada", get=api()).raw_text


def test_single_year_projects_are_not_padded():
    assert "quick-thing (2023)" in load("ada", get=api()).raw_text


def test_surfaces_projects_they_returned_to():
    t = load("ada", get=api()).raw_text
    assert "came back to across more than one year: usd-tools" in t


def test_languages_are_summarised():
    assert "Languages across recent work: C++, Python." in load("ada", get=api()).raw_text


def test_missing_account_raises():
    def boom(path):
        raise GitHubError("no such GitHub account: nope")
    with pytest.raises(GitHubError):
        load("nope", get=boom)


def test_output_is_long_enough_for_intake():
    from src.intake import MIN_PROFILE_CHARS, load_candidate
    p = load("ada", get=api())
    assert len(p.raw_text) > MIN_PROFILE_CHARS
    load_candidate(p.raw_text, name=p.name)


def test_every_line_is_quotable_evidence():
    # the arc has to be able to cite this text verbatim
    from src.story.verify import verify_span
    t = load("ada", get=api()).raw_text
    assert verify_span("OpenUSD pipeline utilities", t)
    assert not verify_span("Ada is a rendering expert who loves teams", t)
