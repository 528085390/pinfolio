# Contributing to pinfolio

Thanks for looking. pinfolio is a self-hosted, single-user app: one Node process, one SQLite file,
no accounts, no cloud. Bug reports, documentation fixes and deployment feedback are always welcome;
new features are judged against "does a self-hoster actually need this".

## Before you start

- Open an issue first for anything bigger than a typo or a one-line fix. It is cheaper than a rejected PR.
- The shape of the app is a feature, not an accident: **one process, one SQLite file, no external service**.
  Proposals that add a second daemon, a queue, a hosted dependency, a plugin system or multi-user accounts
  will be declined — not because they are bad ideas, but because they are different products.
- Never commit real data: `data/`, `secret.key`, `metrics.json`, screenshots of your own notes or mail.

## Development setup

Node 24 or newer and pnpm 12 (`corepack enable` is enough).

```bash
pnpm install
pnpm dev         # API on 7788 + Vite on 5273, /api proxied
pnpm typecheck   # tsc --noEmit
pnpm test        # typecheck + unit tests + snippets
pnpm build       # frontend into dist/web, server bundled into dist/server.js
```

The browser suites need a Chromium already on the machine (`CHROME_PATH` overrides the lookup in
`tools/chrome-path.mjs`):

```bash
pnpm test:e2e    # core + monitor groups
pnpm test:mail   # mail group, starts its own fake IMAP server
```

`tests/run.mjs` never touches your real database: it copies `data/pinboard.db` into a temp directory,
strips credentials and sessions, starts a private instance and deletes everything afterwards. Read
[`tests/README.md`](tests/README.md) before adding a suite.

## How the code is laid out

[`docs/architecture.md`](docs/architecture.md) is the map: which file owns what, and the "do not change this
back to X" notes. Two rules matter most:

1. **Pure logic goes in a pure module** (`server/tags.ts`, `server/kuma/recipe.ts`, `web/lib/paths.ts`, …)
   so it can be unit-tested without a server, a socket or a database.
2. **A bug you fix becomes a pitfall entry.** Add it to [`docs/pitfalls.md`](docs/pitfalls.md) with the next
   number, and reference it from the code as `见坑 N`.

## Pull requests

- One topic per PR. Describe what changed, why, and the commands you ran.
- CI must be green: typecheck, unit tests, build and the `ci` e2e group.
- New behaviour needs a test; a bug fix needs a test that fails before it and passes after.
- Commit messages: **English**, conventional-commit prefix when it fits (`fix:`, `feat:`, `docs:`, `chore:`).
  Keep the first line under ~70 characters; put the reasoning in the body.
- Large formatting-only diffs make review harder — split them out.

## Reporting bugs

Use the bug report template and include: pinfolio version or commit, how you run it (Docker, bare metal,
Windows `start.cmd`), Node version, the relevant lines from the log, and whether Kuma and mail are
configured. For anything security related, follow [`SECURITY.md`](SECURITY.md) instead of opening an issue.

## License

pinfolio is licensed under the GNU AGPL-3.0-or-later. By contributing you agree that your contribution
is licensed under the same terms.
