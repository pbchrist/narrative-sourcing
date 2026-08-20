"""narrative-sourcing CLI: paste in two files, get one brief."""

import argparse
import sys

from src.intake import IntakeError, load_candidate, load_role
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
                        help="file containing the pasted job description")
    parser.add_argument("--title", required=True, help="role title")
    parser.add_argument("--name", help="candidate name, if known")
    parser.add_argument("--company-context",
                        help="stage, culture, why this role exists now")
    args = parser.parse_args(argv)

    try:
        profile = load_candidate(
            open(args.profile).read(), name=args.name,
        )
        role = load_role(
            args.title, open(args.role).read(),
            company_context=args.company_context,
        )
    except (IntakeError, OSError) as exc:
        print(f"intake failed: {exc}", file=sys.stderr)
        return 2

    try:
        brief = run(profile, role)
    except RuntimeError as exc:
        print(f"pipeline failed: {exc}", file=sys.stderr)
        return 1

    print(render(brief))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
