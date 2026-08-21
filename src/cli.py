"""narrative-sourcing CLI: paste in two files, get one brief."""

import argparse
import os
import sys

from src.intake import IntakeError, load_candidate, load_role, read_source
from src.intake.github import GitHubError, load as load_github
from src.pipeline import render, run


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="narrative-sourcing",
        description="Read a candidate's career as a story and produce a "
                    "brief a human writes the message from.",
    )
    parser.add_argument("--profile",
                        help="file containing the pasted candidate profile "
                             "(.txt or a LinkedIn PDF export)")
    parser.add_argument("--github", metavar="USERNAME",
                        help="read the candidate from a GitHub account instead: "
                             "what they built, in what languages, over how long. "
                             "Official API, nothing scraped.")
    parser.add_argument("--role", required=True,
                        help="what to score against: a file, or the text "
                             "itself. It does not have to be a job "
                             "description -- a sentence works, and so does "
                             "a direction like 'wants to go found something'.")
    parser.add_argument("--title",
                        help="optional label for the brief. Derived from the "
                             "role text when omitted.")
    parser.add_argument("--name", help="candidate name, if known")
    parser.add_argument("--company-context",
                        help="stage, culture, why this role exists now")
    parser.add_argument("--show-stripped", action="store_true",
                        help="print the export furniture that was removed "
                             "before extraction. Worth running on your first "
                             "real LinkedIn PDF: the strip rules are written "
                             "against the usual export shape, and this is how "
                             "you find out where that guess is wrong.")
    args = parser.parse_args(argv)

    if not args.profile and not args.github:
        parser.error("give me --profile or --github")

    try:
        if args.github:
            profile = load_github(args.github)
            removed = []
            print(f"read github.com/{args.github}: {len(profile.raw_text)} chars "
                  f"of built work", file=sys.stderr)
        else:
            profile_text, removed = read_source(args.profile)
            profile = load_candidate(profile_text, name=args.name)
        # --role is text or a path. A path that exists is read; anything
        # else is taken literally, so a bare sentence needs no temp file.
        if os.path.exists(args.role):
            role_text, _ = read_source(args.role, strip=False)
        else:
            role_text = args.role
        role = load_role(role_text, title=args.title,
                         company_context=args.company_context)
    except (IntakeError, GitHubError) as exc:
        print(f"intake failed: {exc}", file=sys.stderr)
        return 2

    if removed:
        print(f"stripped {len(removed)} line(s) of export furniture"
              + ("" if args.show_stripped else " (--show-stripped to see them)"),
              file=sys.stderr)
        if args.show_stripped:
            for line in removed:
                print(f"  - {line}", file=sys.stderr)

    try:
        brief = run(profile, role)
    except RuntimeError as exc:
        print(f"pipeline failed: {exc}", file=sys.stderr)
        return 1

    print(render(brief))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
