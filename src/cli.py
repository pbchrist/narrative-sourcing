"""narrative-sourcing CLI: paste in two files, get one brief."""

import argparse
import os
import sys

from src.intake import IntakeError, load_candidate, load_role, read_source
from src.pipeline import render, run


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="narrative-sourcing",
        description="Read a candidate's career as a story and produce a "
                    "brief a human writes the message from.",
    )
    parser.add_argument("--profile", required=True,
                        help="file containing the pasted candidate profile")
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

    try:
        profile_text, removed = read_source(args.profile)
        # --role is text or a path. A path that exists is read; anything
        # else is taken literally, so a bare sentence needs no temp file.
        if os.path.exists(args.role):
            role_text, _ = read_source(args.role, strip=False)
        else:
            role_text = args.role
        profile = load_candidate(profile_text, name=args.name)
        role = load_role(role_text, title=args.title,
                         company_context=args.company_context)
    except IntakeError as exc:
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
