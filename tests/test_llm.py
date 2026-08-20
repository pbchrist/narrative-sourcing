import httpx
import pytest

from src.common import llm


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_complete_returns_message_content():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "the arc"}}]
        })

    assert llm.complete("prompt", client=_client(handler)) == "the arc"


def test_complete_sends_system_prompt_as_first_message():
    seen = {}

    def handler(request):
        import json
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "ok"}}]
        })

    llm.complete("user text", system="be terse", client=_client(handler))
    assert seen["messages"][0] == {"role": "system", "content": "be terse"}
    assert seen["messages"][1] == {"role": "user", "content": "user text"}


def test_complete_omits_system_message_when_none():
    seen = {}

    def handler(request):
        import json
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "ok"}}]
        })

    llm.complete("user text", client=_client(handler))
    assert [m["role"] for m in seen["messages"]] == ["user"]


def test_complete_posts_to_chat_completions_endpoint():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "ok"}}]
        })

    llm.complete("x", base_url="http://example.test:9999", client=_client(handler))
    assert seen["url"] == "http://example.test:9999/v1/chat/completions"


def test_complete_raises_on_http_error():
    def handler(request):
        return httpx.Response(500, text="boom")

    with pytest.raises(llm.LLMError):
        llm.complete("x", client=_client(handler))


def test_complete_raises_on_malformed_payload():
    def handler(request):
        return httpx.Response(200, json={"unexpected": True})

    with pytest.raises(llm.LLMError):
        llm.complete("x", client=_client(handler))


def test_reasoning_model_truncated_before_content_raises_clearly():
    # A reasoning backend fills reasoning_content first and content last.
    # Running out of tokens mid-reasoning yields an empty content field,
    # which must not be mistaken for a valid empty completion.
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{
                "finish_reason": "length",
                "message": {"content": "", "reasoning_content": "thinking..."},
            }]
        })

    with pytest.raises(llm.LLMError, match="reasoning"):
        llm.complete("x", client=_client(handler))


def test_inline_think_block_is_stripped_from_content():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {
                "content": "<think>weighing it up</think>\n{\"ok\": true}"
            }}]
        })

    assert llm.complete("x", client=_client(handler)) == '{"ok": true}'


def test_sends_max_tokens_so_reasoning_has_room():
    seen = {}

    def handler(request):
        import json
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "ok"}}]
        })

    llm.complete("x", client=_client(handler))
    assert seen["max_tokens"] >= 4000


def test_empty_content_without_reasoning_still_raises():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "   "}}]
        })

    with pytest.raises(llm.LLMError):
        llm.complete("x", client=_client(handler))
