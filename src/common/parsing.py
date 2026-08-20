"""Pulling a JSON object out of a model response.

Lives in common/ because story/ and fit/ both need it and DESIGN.md is
explicit that no module reaches into another's internals: fit/ must not
import from story/, or swapping story's backend would drag fit/ along.
"""

import json


class ParseError(RuntimeError):
    """The response did not contain a readable JSON object."""


def extract_json(text: str) -> dict:
    """Pull the first balanced JSON object out of a model response.

    Models wrap JSON in prose, markdown fences and commentary. Scanning
    for a balanced object is more forgiving than json.loads on the whole
    string and more precise than a regex.
    """
    start = text.find("{")
    if start == -1:
        raise ParseError(f"no JSON object in response: {text[:200]!r}")

    depth = 0
    in_string = False
    escaped = False
    for i, ch in enumerate(text[start:], start):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except ValueError as exc:
                    raise ParseError(f"malformed JSON in response: {exc}") from exc
    raise ParseError("unterminated JSON object in response")


__all__ = ["ParseError", "extract_json"]
