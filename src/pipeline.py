"""The thin end-to-end path: intake -> story -> fit -> brief.

One candidate, one role, one brief. No batching here, and there is no
send step to add one to.
"""

from src.brief import build_brief
from src.common.types import CandidateProfile, OutreachBrief, RoleContext
from src.fit import assess
from src.story import extract_arc


def run(
    profile: CandidateProfile,
    role: RoleContext,
    *,
    complete=None,
) -> OutreachBrief:
    arc = extract_arc(profile, complete=complete)
    assessment = assess(arc, role, profile, complete=complete)
    return build_brief(profile, arc, assessment)


def render(brief: OutreachBrief) -> str:
    """Plain-text rendering for the terminal.

    Note what this does not do: it does not assemble the fields into
    anything resembling a message. The cautions are printed before the
    pitch angle on purpose, so the uncertainty is read first.
    """
    lines = [
        f"BRIEF: {brief.candidate_name}",
        f"status: {brief.draft_status}",
        "",
    ]
    if brief.cautions:
        lines.append("READ FIRST")
        lines += [f"  ! {c}" for c in brief.cautions]
        lines.append("")
    lines += [
        "THEIR STORY IN ONE LINE",
        f"  {brief.one_line_story}",
        "",
        "WHY THIS ROLE (or why not)",
        f"  {brief.why_this_role}",
        "",
        "WORTH ASKING",
        f"  {brief.open_question}",
        "",
        "-" * 60,
        "This is raw material. Write the message yourself.",
    ]
    return "\n".join(lines)


__all__ = ["render", "run"]
