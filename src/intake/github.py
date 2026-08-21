"""A GitHub account -> a CandidateProfile built from real artifacts.

Every other sourcing tool reads what a person wrote about themselves. This
reads what they built: repositories, languages, what they starred, how long
they have been shipping, what they came back to. A bio is a claim. A
six-year-old repository someone still commits to is evidence.

That distinction is the entire reason this module exists. Everything here
becomes raw_text, so story/verify.py can hold the arc to the same verbatim
standard it holds a pasted profile to - an inference about this person has
to quote their actual work.

Official API only. No scraping.
"""

import os
import subprocess
from datetime import datetime

import httpx

from src.common.types import CandidateProfile

API = "https://api.github.com"


class GitHubError(RuntimeError):
    """The account could not be read."""


def _token() -> str:
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        return tok
    try:
        return subprocess.run(["gh", "auth", "token"], capture_output=True,
                              text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _client() -> httpx.Client:
    headers = {"Accept": "application/vnd.github+json"}
    tok = _token()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    return httpx.Client(timeout=30, headers=headers)


def _year(ts: str | None) -> str:
    return (ts or "")[:4] or "?"


def fetch(login: str, *, get=None, max_repos: int = 12) -> dict:
    if get is None:
        client = _client()
        def get(path):
            try:
                r = client.get(f"{API}{path}")
            except httpx.HTTPError as exc:
                raise GitHubError(f"could not reach GitHub: {exc}") from exc
            if r.status_code == 404:
                raise GitHubError(f"no such GitHub account: {login}")
            if r.status_code == 403:
                raise GitHubError("GitHub rate limit hit. Set GITHUB_TOKEN.")
            if r.status_code >= 400:
                raise GitHubError(f"GitHub returned {r.status_code}")
            return r.json()

    user = get(f"/users/{login}")
    repos = get(f"/users/{login}/repos?sort=pushed&per_page={max_repos}") or []
    return {"user": user, "repos": [r for r in repos if not r.get("fork")]}


def to_text(data: dict) -> str:
    """Render the account as prose an arc can be read from and quoted against."""
    u, repos = data["user"], data["repos"]
    lines = []

    name = u.get("name") or u.get("login")
    lines.append(f"{name} ({u.get('login')})")
    if u.get("bio"):
        lines.append(f"Bio: {u['bio'].strip()}")
    for label, key in (("Company", "company"), ("Location", "location"),
                       ("Blog", "blog")):
        if u.get(key):
            lines.append(f"{label}: {u[key]}")
    lines.append(f"On GitHub since {_year(u.get('created_at'))}. "
                 f"{u.get('public_repos', 0)} public repositories, "
                 f"{u.get('followers', 0)} followers.")

    if repos:
        langs = []
        for r in repos:
            if r.get("language") and r["language"] not in langs:
                langs.append(r["language"])
        if langs:
            lines.append("Languages across recent work: " + ", ".join(langs) + ".")

        lines.append("")
        lines.append("What they have built, most recently pushed first:")
        for r in repos:
            started, touched = _year(r.get("created_at")), _year(r.get("pushed_at"))
            span = started if started == touched else f"{started} to {touched}"
            bits = [f"{r.get('name')} ({span})"]
            if r.get("language"):
                bits.append(r["language"])
            if r.get("stargazers_count"):
                bits.append(f"{r['stargazers_count']} stars")
            lines.append("- " + ", ".join(bits))
            if r.get("description"):
                lines.append(f"  {r['description'].strip()}")

        long_lived = [r for r in repos
                      if _year(r.get("pushed_at")) != _year(r.get("created_at"))]
        if long_lived:
            lines.append("")
            lines.append("Projects they came back to across more than one year: "
                         + ", ".join(r["name"] for r in long_lived) + ".")

    return "\n".join(lines)


def load(login: str, *, get=None, source_notes: str | None = None) -> CandidateProfile:
    data = fetch(login, get=get)
    u = data["user"]
    return CandidateProfile(
        raw_text=to_text(data),
        name=u.get("name") or u.get("login"),
        known_roles=None,
        source_notes=source_notes or f"Built from github.com/{u.get('login')} "
                                     f"on {datetime.now().date().isoformat()}.",
    )


__all__ = ["GitHubError", "fetch", "load", "to_text"]
