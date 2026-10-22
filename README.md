# pinfolio

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/unit%20tests-259%20passing-brightgreen)](#development)

**English** · [中文](README.zh.md)

Notes, an asset inventory and an uptime dashboard in one local app. Jot a note, put `#tags` in it and it files itself; track servers, domains and accounts with expiry reminders; watch every machine on one screen; read several mailboxes as one read-only inbox.

One Node process, one SQLite file, no accounts, no cloud, no Docker. Open http://127.0.0.1:7788 and it works.

- Repo: <https://github.com/528085390/pinfolio> — a personal tool, published in case someone finds it useful. Not on npm.
- Run it: copy the directory anywhere, then `pnpm install && pnpm build && pnpm start`
- Stack: Node 24 + TypeScript + Hono + `node:sqlite`; Vite 7 + React 19 + hand-written CSS
- Data: `data/pinboard.db` (local only)

## Screenshots

Not shipped with the repo: every page would show the author's real notes, mailboxes and hostnames. Run it yourself and take your own:

```powershell
node tools/screenshots/shots.mjs      # notes / assets / settings / command palette / dark mode
```

Output goes to `tmp/shot-*.png` (gitignored).

## Features

### Notes
- Type in the box at the top, **Ctrl / ⌘ + Enter** to save. Markdown supported.
- `#tags` in the body group notes automatically (Chinese punctuation works too: `。#chores`). Every tag gets a colour from its name.
- **Done state**: click the circle on a card, or **double-click the card**, to mark it done; again to undo. The card stays in place instead of jumping away.
- Filters: All / Open / Done / Pinned / by tag / new tag, plus debounced search; pinned notes have their own section.
- **Archived** notes are hidden behind a chip with a count (read-only view, restore or delete forever). Ctrl+K search never returns them.

### Tags
- 12 presets out of the box (待办 / 想法 / 阅读 / 工作 / 学习 / 生活 / 灵感 / 重要 / 整理 / 运维 / 账号 / 购物).
- The Tags popover inserts `#tag ` so you never misspell one; the filter row only shows tags in use. **Tags are shared between notes and assets** — the main reason both live in one app.

### Assets
- Kinds: device / server / account / domain / other. Status: active / idle / retired / lost.
- Fields: name, location, vendor, serial, price + currency, purchase and expiry dates, link, Markdown notes — plus **custom fields** (text / number / date / url / select / bool) defined on the settings page.
- Expiry reminders on cards and tiles; anything expiring within 30 days is counted.
- Card or table view, filter by kind / status / tag (a tag bar shows what's in use), search over name, serial and notes.

### Monitors
- Data comes from a **local Uptime Kuma** (default `http://127.0.0.1:3001`, status page `obs`); Kuma is only the probing backend, the UI is here.
- One screen: tiles (monitors / up / down / 24h uptime), then cards grouped by machine, each with the last 40 heartbeats, response time, 24h uptime and incident count. 30-second auto-refresh, card or table view.
- Clicking a card opens a drawer to rename, change the interval, pause, delete (type the name to confirm) and **check now**; all of it is written back to Kuma.
- Full behaviour, jump-to-admin links and recipes: [`docs/features.md`](docs/features.md#monitors).

### Mail
- Any IMAP server, several mailboxes merged into one inbox sorted by time, unread counts per account chip.
- **Read-only**: `SELECT` / `SEARCH` / `FETCH(BODY.PEEK[])`, not a single `STORE` — opening a message never marks it read on the server. Read state is local to `mail_local_read`.
- Bodies render inside a **Shadow DOM** so the sender's own layout survives, sanitised by DOMPurify; 50 messages per page, HTML or plain text, attachments listed and never stored.
- Remote images load by default; "Hide images" swaps them for placeholders. Auto-fetch every 60 seconds while the page is open.
- Details (proxy settings, 163 / Gmail quirks, caching, security): [`docs/features.md`](docs/features.md#mail-read-only-merged-inbox).

### Hosts
- CPU / memory / load / disk / service state for **six servers on one page**: one card per machine with four readouts, a 24-hour sparkline, disk bars and chips for the services you care about; `failed_units` and online state are visible at a glance.
- The collector lives **on each server** (`tools/node-metrics/`, a systemd timer that runs every 5 minutes and exits — nothing resident), pushes JSON to a public machine's nginx, and this app pulls it back every 5 minutes into SQLite.
- Anything older than 5 minutes shows "N min ago"; over 15 minutes counts as stale. "Refresh now" forces one pull.
- Details (fields, install, rollback, why not Prometheus): [`docs/features.md`](docs/features.md#host-metrics) and [`tools/node-metrics/README.md`](tools/node-metrics/README.md).

### Global
- **Every page has its own URL** (`/notes` `/mail` `/assets` `/monitors` `/hosts` `/settings`): F5 stays put, back/forward work, links open directly.
- **Ctrl / ⌘ + K** command palette: search notes and assets, or run "new note / open mail / add asset / open monitors / open hosts / export JSON".
- Theme light / dark / follow system; the settings page exports everything as JSON and can seed sample data.

## Quick start

### Option 1: double-click `start.cmd` (recommended)
Runs hidden in the background, waits for `/api/health`, then opens http://127.0.0.1:7788. Logs go to `logs/pinboard.log`. Stop it with **`stop.cmd`**.

### Option 2: command line

```powershell
cd <project dir>
pnpm install     # first time
pnpm start       # http://127.0.0.1:7788
```

Requirements: Node ≥ 22 (it uses the built-in `node:sqlite`; tested on 24.16) and pnpm. No Docker, no database server, no native modules. Stop it with `stop.cmd` or `.\tools\pinboard.ps1 stop`.

## Data and backup

| Item | Notes |
|---|---|
| Database | `data/pinboard.db` (SQLite, WAL) — notes, tags, assets, fields, links, mailbox settings |
| Backup | Stop the service and copy `data/`, or use "Export JSON" on the settings page |
| Relocating | Set `PINBOARD_DATA` to another directory before starting |
| Monitors | Read from Uptime Kuma, not from this database (`KUMA_URL` / `KUMA_SLUG` to point elsewhere) |
| Mail | **IMAP passwords are stored in plain text** — fine for a local, 127.0.0.1-only service, but don't hand `data/` or an export to anyone. Bodies are never written to disk (memory, 10 minutes) |
| Reset | Stop the service, delete `data/pinboard.db*`, start again |

## Project layout

```
pinfolio/
├─ start.cmd / stop.cmd        start and stop (background, hidden window)
├─ tools/                      pinboard.ps1 (control script), screenshots/, seed-assets.mjs, chrome-path.mjs, streak-panel-trigger.cjs
├─ monitor-actions.json        recipes for "check now" (keyed by monitor id / name)
├─ monitor-links.example.json  sample monitor → admin page mapping (copy to monitor-links.json)
├─ server/                     Hono backend
│  ├─ index.ts                thin entry point: mount routes, snapshot middleware, start
│  ├─ db.ts, schema/, hydrate.ts
│  ├─ snapshot/               rows / markdown (pure) / write
│  ├─ mail/                   types, parse, errors, pool, client, cache, rows, store, routes
│  ├─ kuma/                   client, source, payload, feed, recipe, runner, actions, links, backup, patch, routes
│  └─ routes/                 notes, assets, tags, fields, meta
├─ web/                        React frontend (pages/, components/, lib/, styles/, app/)
├─ tests/                      unit/ (node:test) + 14 Playwright e2e suites + fakeimap/
├─ docs/                       architecture, pitfalls, features, api, status-history, …
├─ data/  dist/web/  tmp/  logs/   runtime data, build output, scratch, logs
└─ SNAPSHOT.md                 auto-generated data snapshot (do not edit)
```

Per-file responsibilities: [`docs/architecture.md`](docs/architecture.md) (Chinese).

## Development

```powershell
pnpm dev        # API on 7788 (tsx watch) + Vite on 5273, /api proxied
pnpm build      # rebuild the frontend into dist/web — required after frontend changes
pnpm typecheck  # tsc --noEmit
pnpm start      # production mode, not watch: restart after backend changes
pnpm test       # typecheck + 259 unit tests (no running service needed)
pnpm test:e2e   # core + monitor suites (needs 7788 and Kuma on 3001)
pnpm test:mail  # mail suite, against an isolated instance
```

E2E suites drive the real UI through `playwright-core` with the Chromium already on the machine (override with `CHROME_PATH`); the mail suite starts its own fake IMAP server. `tests/README.md` explains the groups and the isolated instance.

## FAQ

**Port already in use (`EADDRINUSE 127.0.0.1:7788`)** — usually a leftover process; stop it with `stop.cmd` and start again.

**Changes don't show up** — frontend changes need `pnpm build` and a reload; backend changes need a restart (`pnpm start` is not watch mode).

**Can I expose it to the internet or use it from my phone** — not as-is: there is no authentication at all and it only listens on 127.0.0.1. Add auth and an HTTPS reverse proxy yourself.

**Why is the price total 0** — price and expiry date are empty by default; the total also adds currencies without converting, so don't treat it as accounting data.

## Stack and provenance

- Backend: Hono + `@hono/node-server` on Node 24's built-in `node:sqlite`, so there is no native module to compile.
- Mail: [imapflow](https://github.com/postalsys/imapflow) + [mailparser](https://github.com/postalsys/mailparser) — pure JS, and `fetch` goes through `BODY.PEEK` so it can never write the Seen flag.
- Design references: [usememos/memos](https://github.com/usememos/memos) for the note timeline and `#tags`, [sysadminsmedia/homebox](https://github.com/sysadminsmedia/homebox) for assets, locations, custom fields and expiry. **No code was copied from either**; both are standalone multi-user services and cover less than half of what is needed here.

## Docs

- [`docs/features.md`](docs/features.md): every page in full (English); [`docs/features.zh.md`](docs/features.zh.md) is the same in Chinese.
- [`docs/api.md`](docs/api.md): the complete HTTP API (English; [`docs/api.zh.md`](docs/api.zh.md) 中文).
- [`CHANGELOG.md`](CHANGELOG.md): what changed, and in which version.
- [`AGENTS.md`](AGENTS.md): engineering conventions, module responsibilities and 30 hard-won pitfalls — **read this before changing code** (Chinese).
- [`docs/adding-assets.md`](docs/adding-assets.md): the one page to read before adding an asset or note (Chinese).
- [`SNAPSHOT.md`](SNAPSHOT.md): auto-generated dump of the current data, rewritten 1.5 seconds after any write (do not edit).
- The rest of `docs/` (`architecture.md`, `pitfalls.md`, `status-history.md`, `mail-page-requirements.md`) is internal documentation, in Chinese.

## License

[MIT](LICENSE). Use it, change it, sell it — just don't blame me when it breaks.
