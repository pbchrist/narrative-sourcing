# STABLE STATE — Friday, 21 August 2026

Everything worked on this day. If something later feels broken, this is the
point to come back to. You do not need to remember what changed.

## Just tell Claude

> "Go back to the stable state from August 21st."

That is enough. The tag name is in this file and in both repos.

## Or do it yourself

```
cd ~/Desktop/narrative-sourcing  && git checkout stable-2026-08-21
cd ~/Desktop/talent-market-map   && git checkout stable-2026-08-21
```

To come back to the latest work afterwards: `git checkout main`

## Is it still working right now?

Double-click **CHECK-EVERYTHING.command** on your Desktop.

Green means the code still behaves exactly as it did on 21 August.
Red means something changed, and it prints exactly what.

## What "working" meant on this date — verified, not assumed

- Both web apps return real results from Qwen 3.8. No API key for anyone.
- The public address survived a power outage on its own: the box rebooted,
  the tunnel came back at a different address, and both apps found it.
- Prior searches are chips. The input boxes stay empty. You can run a new
  search without deleting anything.
- Buttons click and press.
- narrative-sourcing: 165 tests passing. talent-market-map: 94 tests passing.

## The two apps

- https://pbchrist.github.io/narrative-sourcing/
- https://pbchrist.github.io/talent-market-map/

## Known problems on this date (not fixed here)

1. **Obviousness scores are unreliable.** Whole maps come back all 1/5 or
   all 4/5. Diagnosed: ranking pools within a map works, the absolute 1-5
   score does not.
2. **The throughline and the tension can overreach.** Their quotes are real
   but are not checked against the claim the way the beats are.
3. **Two people pasted in together produce one confident profile.** Nothing
   checks that the text describes one person.
