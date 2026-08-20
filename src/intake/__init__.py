"""Loads and validates the two pasted inputs. No LLM calls happen here,
by design: intake is the one stage that must never be able to invent
anything, so it has no path to a model at all.
"""

from src.common.types import CandidateProfile, RoleContext
from src.intake.linkedin import strip_furniture
from src.intake.pdf import PdfError, extract_text, looks_like_pdf

# A profile shorter than this has no arc to extract. Better to refuse at
# the door than to let story/ infer a life story from one line.
MIN_PROFILE_CHARS = 80
MIN_ROLE_CHARS = 40


class IntakeError(ValueError):
    """The pasted input is not usable as a profile or a role."""


def read_source(path: str, *, strip: bool = True) -> tuple[str, list[str]]:
    """Read a profile or role from a .txt or .pdf file.

    Returns (text, removed_lines). Stripping happens here rather than
    later so that CandidateProfile.raw_text and the text the model is
    shown are the same bytes; if they diverged, evidence verification
    would fail for reasons unrelated to whether the model invented
    anything.
    """
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        raise IntakeError(f"could not open {path}: {exc}") from exc

    if looks_like_pdf(data):
        try:
            text = extract_text(data)
        except PdfError as exc:
            raise IntakeError(str(exc)) from exc
    else:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise IntakeError(
                f"{path} is neither UTF-8 text nor a PDF ({exc}). If it is a "
                f"Word or Pages document, export it as text or PDF first."
            ) from exc

    if not strip:
        return text, []
    return strip_furniture(text)


def load_candidate(
    raw_text: str,
    *,
    name: str | None = None,
    known_roles: list[str] | None = None,
    source_notes: str | None = None,
) -> CandidateProfile:
    text = (raw_text or "").strip()
    if not text:
        raise IntakeError("candidate raw_text is empty")
    if len(text) < MIN_PROFILE_CHARS:
        raise IntakeError(
            f"candidate raw_text is {len(text)} chars, below the "
            f"{MIN_PROFILE_CHARS}-char floor; paste the full profile"
        )

    roles = None
    if known_roles is not None:
        roles = [r.strip() for r in known_roles if r and r.strip()]

    return CandidateProfile(
        raw_text=text,
        name=(name.strip() or None) if name else None,
        known_roles=roles,
        source_notes=(source_notes.strip() or None) if source_notes else None,
    )


def load_role(
    title: str,
    raw_description: str,
    *,
    company_context: str | None = None,
) -> RoleContext:
    clean_title = (title or "").strip()
    if not clean_title:
        raise IntakeError("role title is empty")

    description = (raw_description or "").strip()
    if not description:
        raise IntakeError("role raw_description is empty")
    if len(description) < MIN_ROLE_CHARS:
        raise IntakeError(
            f"role raw_description is {len(description)} chars, below the "
            f"{MIN_ROLE_CHARS}-char floor; paste the full job description"
        )

    return RoleContext(
        title=clean_title,
        raw_description=description,
        company_context=(
            (company_context.strip() or None) if company_context else None
        ),
    )


__all__ = ["IntakeError", "load_candidate", "load_role", "read_source"]
