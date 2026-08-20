"""Thin LLM backend wrapper. One function in, one string out, so story/
and fit/ never know or care which model is actually answering.

Default target: beastmaster, llama.cpp, port 8081, via Tailscale. Swap
the backend with environment variables, not by editing call sites.

A note that matters for the rest of the codebase: the intended backend is
an abliterated model. Abliteration strips refusals, which this task needs,
but it degrades calibration along with them. Nothing downstream may trust
a confidence number this wrapper returns from the model. See
docs/superpowers/specs/2026-08-19-v1-pipeline-design.md.
"""

import os

import httpx

DEFAULT_BASE_URL = os.environ.get("NS_LLM_BASE_URL", "http://100.73.250.50:8081")
DEFAULT_MODEL = os.environ.get("NS_LLM_MODEL", "")
DEFAULT_TIMEOUT = float(os.environ.get("NS_LLM_TIMEOUT", "120"))


class LLMError(RuntimeError):
    """The backend was unreachable, errored, or returned something we
    could not read as a completion."""


def complete(
    prompt: str,
    *,
    system: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    client: httpx.Client | None = None,
) -> str:
    """Send a prompt to the configured backend, return the raw text.

    Intentionally minimal for v1: no retries, no streaming, no tool use.
    `client` exists so tests can inject a mock transport and the suite
    never touches the network.
    """
    base = (base_url or DEFAULT_BASE_URL).rstrip("/")
    messages = []
    if system is not None:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {"messages": messages, "temperature": temperature}
    chosen_model = model if model is not None else DEFAULT_MODEL
    if chosen_model:
        payload["model"] = chosen_model

    owned = client is None
    http = client or httpx.Client(timeout=DEFAULT_TIMEOUT)
    try:
        response = http.post(f"{base}/v1/chat/completions", json=payload)
    except httpx.HTTPError as exc:
        raise LLMError(f"could not reach backend at {base}: {exc}") from exc
    finally:
        if owned:
            http.close()

    if response.status_code >= 400:
        raise LLMError(
            f"backend returned {response.status_code}: {response.text[:200]}"
        )

    try:
        return response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise LLMError(f"unreadable response from backend: {exc}") from exc
