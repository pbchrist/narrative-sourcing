# narrative-sourcing

A recruiter pastes a résumé or LinkedIn profile and gets the connective tissue
for a message worth sending: what the person left, what they are reaching for,
what is unresolved. Every claim quotes the source word for word. Anything the
model cannot quote is deleted before the reader sees it.

Live at https://pbchrist.github.io/narrative-sourcing/ — a static site on GitHub
Pages. The model is a Qwen box on Patrick's hardware behind a Tailscale funnel;
`docs/endpoint.json` holds the URL. If that machine sleeps the site still loads
and the worked example still runs, because the example replays a saved run
through the live gates in the browser.

## Getting a profile in

**"Put a profile in" means the LinkedIn PDF export. Never a page scrape.**

Invoke the `linkedin-pdf` skill. Do not improvise a scrape because it seems
faster — a scrape paginates and lazy-loads, and has twice returned a fraction of
someone's career while looking complete. Once it returned half of Patrick's own
history because a `Load more` button went unread, and the tool found the wrong
throughline as a result.

Two consequences, both non-negotiable:

- **Never call a profile thin, sparse, or lacking material** unless that
  judgement comes from a PDF extraction of reasonable length (8k–20k chars is
  normal). Every time this was violated it was the tooling's blind spot being
  reported as a fact about a real person's career.
- **A downloaded file that cannot be read is not a failed download.** `~/Downloads`
  is unreadable to this process even though `ls` works there. Check Chrome's
  history DB before concluding anything about a download.

## Before pushing anything

Run all three suites. They are fast and they are the only thing standing between
a change and Patrick finding the bug in front of someone else.

```
./.venv/bin/python -m pytest tests -q     # 249 tests — use the venv, not system python3
node tests/js/sendable_guard.test.js      # the no-sendable-text guard
node tests/js/linkedin_paste.test.js      # third-party voice in a pasted page
node tests/js/bench_lift.test.js          # the bench's string-sliced lift still resolves
```

System `python3` is 3.9 and has no pytest. `./.venv/bin/python` is 3.11 and does.
Reporting "pytest isn't installed" after using the wrong interpreter has already
happened once.

**Never push a new `docs/example.json` without counting the gates** — survival,
invented quotes, unsupported claims, and sendable-text trips. A run that produced
a throughline but deleted every claim looks healthy in the JSON and renders as an
empty page.

## The rule the product is built on

`docs/index.html` promises: *"It is raw material for a recruiter. The message
stays human."* That is enforced by `scanSendable` in `docs/app.js` and
`src/brief/guard.py`. The tool never authors sendable text — no salutations, no
sign-offs, no second-person pitch. Verbatim candidate quotes are exempt, because
a candidate who wrote "I'd love to connect" in their own About did nothing wrong.

If a change would let the tool write the message, the change is wrong.

## Reporting

Say what was verified and how. Distinguish "the tests pass" from "I ran it on a
real profile and watched the output." Do not describe work as done when only part
of it ran. If something was skipped or blocked, say which part and why, in the
same breath as the result.
