# Principles (do not erode these under implementation pressure)

## 1. Evidence or it doesn't ship
Every inferred field in a CareerArc or FitAssessment must cite the specific
text it came from. If the model can't point to evidence, the field should
be omitted or marked low confidence, not filled in with a plausible-sounding
guess. A confident-sounding false story about why someone left a job is
worse than no story.

## 2. Confidence is surfaced, not smoothed
Low-confidence inferences must remain visibly low-confidence all the way
through to the OutreachBrief. Do not let a formatting/summarization step
launder a 0.4-confidence guess into a clean declarative sentence. If the
brief module can't represent uncertainty in plain language, that's a bug
in brief/, not a reason to drop the confidence field upstream.

## 3. No sendable text, ever, in v1
story/ and fit/ and brief/ never produce a message a human could copy and
paste to a candidate. The OutreachBrief is raw material for a human to
write from. This is not a UI safeguard that can be toggled off later for
convenience; it is the actual thesis of the tool (the message must stay
human because that's what the market data says candidates can tell apart).
If a future version adds a drafting assist, it must remain clearly
separate from the brief and require explicit human action per message,
never a batch/auto-send path.

## 4. Ambiguity is a valid output
FitAssessment.continues_arc can be None. A tool that always renders a
confident verdict is lying about how much the evidence actually supports.
Forcing a clean yes/no where the evidence is thin is the same failure mode
as an unsupported CareerArc inference, just at the scoring layer instead
of the extraction layer.

## 5. Small, real test cases over synthetic breadth
Test against real (anonymized, or your own past placements where you have
consent) candidate profiles you already know the true story of, not
generated fake profiles. You already know, from having done this job for
years, what a good read of someone's arc looks like versus a shallow one.
Use that judgment as the test oracle before trying to scale test coverage.
