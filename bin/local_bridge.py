#!/usr/bin/env python3
"""A model endpoint that needs no other machine.

The hosted default is a Cloudflare quick tunnel to a box running Qwen, and
when that box is off - or has rebooted without republishing - the page has
nowhere to go and says so. This is the fallback: the same OpenAI-shaped
endpoint the page already speaks, answered by the Claude Code CLI that is
already installed and already signed in. No API key, no second machine.

    python3 bin/local_bridge.py            # then point Settings at it

It prints the URL to paste into Settings -> Endpoint URL. Leave the API key
field blank; there is nothing to authenticate against.
"""

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8123
MODEL = "claude-sonnet-5"
TIMEOUT = 900


def ask(system: str, user: str) -> str:
    """One turn through the CLI. The prompt goes in on stdin rather than as an
    argument, because a résumé is bigger than a comfortable argv."""
    out = subprocess.run(
        ["claude", "-p", "--system-prompt", system, "--model", MODEL],
        input=user, capture_output=True, text=True, timeout=TIMEOUT,
    )
    if out.returncode != 0:
        raise RuntimeError((out.stderr or "claude exited non-zero").strip()[:400])
    return out.stdout.strip()


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        # The page is served from somewhere else - localhost during a check,
        # github.io in normal use - so every answer needs to say it is allowed.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self._json(200, {"object": "list", "data": [{"id": MODEL}]})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
            msgs = req.get("messages") or []
            system = "\n\n".join(m.get("content", "") for m in msgs if m.get("role") == "system")
            user = "\n\n".join(m.get("content", "") for m in msgs if m.get("role") != "system")
            if not user.strip():
                return self._json(400, {"error": "no user message"})
            print(f"  -> {len(system):,} char system, {len(user):,} char profile", flush=True)
            answer = ask(system, user)
            print(f"  <- {len(answer):,} characters", flush=True)
            self._json(200, {
                "id": "local", "object": "chat.completion", "model": MODEL,
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": answer}}],
            })
        except subprocess.TimeoutExpired:
            self._json(504, {"error": f"the model took longer than {TIMEOUT}s"})
        except Exception as exc:  # noqa: BLE001 - the browser gets the reason
            self._json(500, {"error": str(exc)[:400]})

    def log_message(self, *a):  # the useful lines are printed above
        pass


if __name__ == "__main__":
    url = f"http://localhost:{PORT}/v1/chat/completions"
    print(f"\n  Model bridge running.\n\n  Settings -> Endpoint URL:  {url}"
          f"\n  API key: leave blank\n  Model:   leave blank\n\n  Ctrl-C to stop.\n", flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
