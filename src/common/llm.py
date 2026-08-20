"""Thin LLM backend wrapper. One function in, one function out, so
story/ and fit/ never know or care which model is actually answering.

Default target: beastmaster, llama.cpp, Qwen, port 8081, via Tailscale.
Swap the implementation here, not at any call site.
"""

import os

DEFAULT_BASE_URL = os.environ.get("NS_LLM_BASE_URL", "http://100.73.250.50:8081")


def complete(prompt: str, *, system: str | None = None) -> str:
    """Send a prompt to the configured backend, return raw text completion.

    Intentionally minimal for v1. No retries, no streaming, no tool use.
    Real implementation (HTTP call to llama.cpp's OpenAI-compatible
    endpoint) is a task for the first Claude Code session, TDD'd against
    a fake/mock backend before touching the real network call.
    """
    raise NotImplementedError(
        "Implement against llama.cpp's /v1/chat/completions endpoint at "
        f"{DEFAULT_BASE_URL}. Write the test against a mocked HTTP layer "
        "first."
    )
