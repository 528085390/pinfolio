## What

<!-- one or two sentences -->

## Why

<!-- the problem this solves; link the issue if there is one -->

## How I checked it

```bash
pnpm test        # typecheck + unit tests + snippets
pnpm build
node tests/run.mjs --only=ci
```

<!-- paste anything else you ran: a manual flow, a screenshot, a specific suite -->

## Checklist

- [ ] One topic only; no unrelated formatting churn
- [ ] New behaviour has a test (a bug fix has a test that failed before it)
- [ ] No real data, secrets, `data/` files or personal paths in the diff
- [ ] Docs updated when behaviour or configuration changed
- [ ] A new pitfall was added to `docs/pitfalls.md` if I hit one
