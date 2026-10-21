# pinfolio

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/unit%20tests-259%20passing-brightgreen)](#development)

**English** · [中文](README.zh.md)

A small tool that runs on your own machine: **jot notes** — write `#tags` inline and they sort themselves — plus an **asset inventory** for servers, domains, accounts and devices, with expiry reminders and notes you can pin onto any asset. There is also a **mail** page that merges your Gmail / QQ / 163 inboxes into one read-only view, and a **monitors** page that lines up the live status of every machine and service.

One process, one port, one SQLite file. No cloud, no accounts, no Docker. Open http://127.0.0.1:7788 and it works.

- Repo: <https://github.com/528085390/pinfolio> — a personal tool, published in case someone finds it useful. Not on npm.
- Running it: the code can live in any directory — `pnpm install && pnpm build && pnpm start`
- Stack: Node 24 + TypeScript + Hono + `node:sqlite`; frontend is Vite 7 + React 19 + hand-written CSS
- Data: `data/pinboard.db` (local only)

## Screenshots

Screenshots are deliberately not shipped with this repo: every page would show the author's real notes, mailboxes and hostnames. Run it locally and take your own:

```powershell
node tools/screenshots/shots.mjs      # notes / assets / settings / command palette / dark mode
node tools/screenshots/shots-assets.mjs
```

Output goes to `tmp/shot-*.png` (gitignored).

## Features

### Notes
- Type straight into the box at the top, **Ctrl / ⌘ + Enter** to save. Markdown supported (headings, lists, code blocks, links).
- `#tags` in the body group the note automatically; tags after Chinese punctuation are recognised too (`。#chores` counts) and every tag gets a colour derived from its name.
- **Done state**: click the circle on the left of a card, or **double-click the card body**, to mark it done; click or double-click again to undo. Done notes get a green check, a "Done" pill and dimmed, struck-through text — the card stays exactly where it was instead of jumping away.
- Filters: All / Open / Done / Pinned / by tag / ＋ new tag, with debounced search on the right.
- Pinned notes get their own section and always stay on top.
- Inline edit (pencil), **archive** (the archive icon — the normal list no longer has a delete button), and pinning a note to an asset.
- **Archived**: archived notes are hidden by default; the "Archived" chip in the filter row (with a count) opens a read-only view where you can "Restore" or "Delete forever" (red button + confirmation). Ctrl+K global search never returns archived notes.

### Tags
- 12 preset tags out of the box: 待办 / 想法 / 阅读 / 工作 / 学习 / 生活 / 灵感 / 重要 / 整理 / 运维 / 账号 / 购物 (todo / idea / reading / work / study / life / inspiration / important / tidy / ops / accounts / shopping). They live in `PRESET_TAGS` in `server/db.ts` and are written once when the database is first created — delete one and it will not come back on its own.
- The "Tags" button under the composer opens a popover; clicking a tag inserts `#tag ` so you never have to remember spelling. The bottom of the popover can **create a tag** (name + colour).
- The filter row only shows tags that are in use, to keep it readable; the full list lives in the popover and on the settings page.
- Tags are **shared between notes and assets** — which is the main reason both live in one app.

### Assets
- Kinds: device / server / account / domain / other. Status: active / idle / retired / lost (list order: active → idle → the rest).
- Common fields: name, location, vendor, serial number, price + currency, purchase date, expiry date, link, notes (Markdown).
- **Custom fields**: define key, label and type (text / number / date / url / select / bool) on the settings page; they apply to every asset. Four are seeded: `ip`, `login`, `secret_at` (where the key or credential lives) and `renew_cycle` (monthly / quarterly / yearly / one-off).
- Expiry reminders: cards and the stat tile show "N days left / expired", and anything expiring within 30 days is highlighted in the counts.
- Card view / table view, filter by kind and status; a **tag bar** always shows the tags in use (`#tag count`, most links first, ties by name) — click to filter, click again to clear. Search matches name / serial / notes.
- Clicking a card opens the drawer on the right: edit every field, see linked notes, add a note right there, delete the asset.

### Monitors
- The data source is a **local Uptime Kuma** (default `http://127.0.0.1:3001`, status page slug `obs`). Kuma is only the probing backend; the UI lives here.
- **Kuma's own `http://127.0.0.1:3001/status/obs` was retired on 2026-10-19** (it returns 404) — this page is the only UI. Kuma's `/api/status-page/obs` and `/api/status-page/heartbeat/obs` JSON endpoints are kept and are what this page reads.
- Everything fits on one screen: 4 columns (6 on screens ≥1700px wide), grouped by machine (12 monitors used to be two rows at 2560×1440 and three rows at 1600×900; as of 2026-10-20 there are 15 monitors in 5 groups, so a few more rows).
- Each card: name + machine + type, a bar of the **last 40 heartbeats** (green up / red down / yellow pending / grey maintenance), response time in ms, time of the last check, 24h uptime and the number of incidents in the window.
- Four tiles on top: monitors / up / down / 24h uptime; below them you can filter by machine or status, or search by name / message.
- Auto-refresh every 30 seconds (can be switched off), plus a manual refresh; card / table view switch.
- **Jump to the admin page**: monitors that have one show a ↗ after the title, which opens that project's admin page in a new tab (same in table view). The mapping lives in `monitor-links.json` at the repo root and takes effect when you reload the page — no restart. The repo only ships `monitor-links.example.json`: **copy it to `monitor-links.json` and edit that** (the real file is gitignored so private panel URLs don't get committed):

  ```json
  [
    { "id": 1, "name": "local panel", "url": "http://127.0.0.1:7863/panel/", "label": "Local console" },
    { "id": 3, "name": "public entry", "url": "https://example.com/panel/", "label": "Public console" }
  ]
  ```

  Monitors without a mapping (a port-only probe of nginx or xray, say) simply have no ↗. **Matching is by `id` first**: monitors can be renamed in the drawer and names are not stable keys, so `id` decides and `name` is only a comment / fallback. Point `MONITOR_LINKS` at another file if you prefer.
- **Clicking a card (or table row) opens the monitor drawer** on the right, with the same interaction as the asset drawer:
  - **Basics**: name, description, check interval (with 30s / 1m / 5m / 10m / 30m shortcuts); "Advanced" exposes timeout, retries, retry interval and whether the status message is always shown. All of it is **written back to Kuma** (Kuma stays the single source of truth — the CLI and `SNAPSHOT.md` see the same thing) and the list refreshes as soon as you save.
  - **Pause / resume**: paused monitors are dimmed and labelled in both views, and Kuma stops probing them (history is kept); resuming starts it again.
  - **Delete**: double confirmation in the drawer — you must **type the monitor's name exactly** before the button enables. On confirm the Kuma database is first copied to `kuma/backups/kuma-YYYYMMDD-HHMMSS.db` (only the newest 5 are kept), then the monitor and its heartbeats are deleted. Irreversible.
  - **Check now**: run this monitor's "recipe" immediately instead of waiting for the next cycle, with per-step timings and results. The default recipe restarts Kuma's check loop so it probes for real right away; special monitors (push-type ones, or ones that need an upstream refresh first) get a multi-step recipe in `monitor-actions.json` keyed by monitor id — **no restart needed**, just reload the page.
- Renaming a monitor propagates to Kuma. If another monitor's *policy* references it by name, the rename is refused with an explanation of who references it, so policies never break silently.
- If Kuma is down the page doesn't go blank: it falls back to the previous payload with a warning on top. If it never managed to read anything at all, you get "can't read monitors", the actual reason and a retry button.
- **Why the two-tier cache**: Kuma's `/api/status-page/obs` occasionally takes 5–30 seconds (it caches for 5 minutes itself, and the moment that cache expires while a dozen probes are running is slow), while the heartbeat endpoint answers in tens of milliseconds. So the backend caches the monitor list for 5 minutes (warmed at startup, refreshed every 5 minutes) and fetches heartbeats on demand — the page normally renders every card in 0.1–0.4 s.

### Mail (read-only merged inbox)
- Point it at any IMAP server (Gmail / QQ / 163 / anything else) and **several mailboxes become one inbox** sorted by time. Account chips at the top let you narrow to a single mailbox, with unread counts on each chip.
- **It only reads.** It uses `SELECT` / `SEARCH` / `FETCH(BODY.PEEK[])` and not a single `STORE` — opening a message **never** marks it read on the server (imapflow's `fetch` uses `BODY.PEEK` by design).
- **Read state is local only**: opening a message dims that row and records it in the local `mail_local_read` table; nothing is written back to the server. The account drawer has "clear local read marks".
- List rows: sender, subject, a 1–2 line plain-text snippet, time and mailbox; unread is bold, read is dimmed, account chips carry unread counts. **50 messages per page**, and you can page through to the end (you don't just get the newest batch).
- The reader pane on the right shows subject / sender (name + address) / to / cc / date / mailbox, with a one-click switch between HTML and plain text.
- **Layout**: the body renders inside a **Shadow DOM**, so the message's own `<style>` and inline styles are preserved exactly (scoped to the mail pane, they can't leak into the app) and marketing-mail table layouts survive. Fixed-width mail (720px, say) is scaled down to fit the pane instead of being cropped.
- **Security**: bodies still go through DOMPurify as a backstop (scripts / iframes / forms removed, `@import` / `expression()` / `javascript:` / `position:fixed` stripped), links always open in a new tab, and `cid:` images resolve through the local attachment endpoint.
- **Images**: **remote images load by default** so layout and artwork look right. If you'd rather not hand senders a tracking signal, "Hide images" in the reader header swaps them for dashed placeholders and a banner offers to load them again; the choice is remembered per browser. ⚠️ Loading remote images does **not** mark the mail read (this page never writes back), but it does tell the sender "this one was opened".
- Attachments are listed and downloadable, never stored; messages over 25 MB are not downloaded at all and say so.
- The search box filters the 50 loaded messages client-side (sender / subject / snippet); "unread only" toggles; `j` / `k` move through messages.
- **Auto-fetch**: while the page is open it silently re-fetches every 60 seconds (updating the list and unread counts only — never the message you are reading), pauses when the tab is hidden and catches up as soon as you come back. The "data as of 11:05:03" label in the toolbar is when that batch actually came back from the mail server. Hit "Refresh" to bypass the cache.
- Caching: list 60 seconds, bodies 10 minutes (memory only, never on disk); both manual refresh and the poller bypass the cache and re-read unread counts.
- A failing account doesn't take the page down: that chip shows a red exclamation with the reason on hover, and the other mailboxes keep working.
- 163 requires the client to send `IMAP ID` (otherwise you get `Unsafe Login`) — imapflow does that automatically. Gmail needs an app password; QQ / 163 need an authorisation code; your normal login password will fail.
- **Proxy (essential for Gmail)**: direct connections to `imap.gmail.com:993` are frequently blocked from mainland China (it looks like a timeout). The account drawer has an optional **Proxy** field that takes a local SOCKS5 proxy, e.g. `socks5://127.0.0.1:10808` (a bare `127.0.0.1:10808` gets `socks5://` prepended). `http(s)://` and `socks4://` work too; leave it empty for QQ / 163. For a global fallback set `PINBOARD_MAIL_PROXY` (used when an account has none).

### Global
- **Every page has its own URL**: `/notes`, `/mail`, `/assets`, `/monitors`, `/settings`. Switching pages updates the address bar, **F5 does not throw you back to notes**, back/forward work, and `http://127.0.0.1:7788/monitors` opens the monitors page directly. `/` and unknown paths fall back to `/notes`, and `document.title` follows the page (e.g. "Monitors · pinfolio").
- **Ctrl / ⌘ + K** command palette: search notes, search assets, or run "new note / open mail / add asset / open monitors / open settings / export JSON".
- Theme: light / dark / follow system, stored in `localStorage` under `pinboard-theme`.
- The settings page exports the whole database as JSON (`pinfolio-YYYY-MM-DD.json`); an empty database can be seeded with sample data in one click.

## Quick start

### Option 1: double-click `start.cmd` (recommended)
The server runs **hidden in the background**, so no console window sits in front of you. If it is already running it just opens the browser; otherwise it starts `pnpm start` in a hidden window, polls `/api/health` until it returns 200, opens http://127.0.0.1:7788 and closes itself.

Logs: `logs/pinboard.log` (appended, not rotated). To stop it: double-click **`stop.cmd`**.

### Option 2: command line

```powershell
cd <project dir>
pnpm install     # first time
pnpm start       # production mode, http://127.0.0.1:7788
```

Requirements: Node ≥ 22 (it uses the built-in `node:sqlite`; tested on Node 24.16) and pnpm. No Docker, no database server, no native modules to compile.

Stop it with `stop.cmd`, or:

```powershell
.\tools\pinboard.ps1 stop     # kills the whole node chain and waits for the port
.\tools\pinboard.ps1 status   # status; pass "logs" to tail the log
```

(Option 2 runs in the foreground, so closing that console window stops it too.)

## Data and backup

| Item | Notes |
|---|---|
| Database | `data/pinboard.db` (SQLite, WAL mode; `-wal` / `-shm` sit next to it) |
| Relocating | Set `PINBOARD_DATA` to another directory before starting |
| Backup | Stop the service and copy the whole `data/` directory, or use "Export JSON" on the settings page |
| Monitors | Read from Uptime Kuma, not from this database; set `KUMA_URL` / `KUMA_SLUG` to point elsewhere. Renaming / changing intervals / pausing / deleting in the drawer writes straight to Kuma, and deleting first backs Kuma's database up into `kuma/backups/` (newest 5 kept) |
| Mail | Mailbox settings and local read marks live in the same database (`mail_accounts` / `mail_local_read`). **IMAP passwords are stored in plain text** — acceptable only because the database is local and the service listens on 127.0.0.1. Don't hand `data/` or an exported JSON to anyone |
| Mail bodies | Never written to disk, cached in memory for 10 minutes; gone after a restart |
| Restore | Put the backed-up `data/` back (the JSON export is for reading only; there is no import button) |
| Reset | Stop the service, delete `data/pinboard.db*`, and the next start recreates an empty database — you can seed sample data from the settings page |

> Notes, tags, assets, custom fields and all links live in that one database, so copying `data/` is a complete backup.

## Project layout

```
pinfolio/
├─ start.cmd               start script (background, hidden; just opens the browser if already running)
├─ stop.cmd                stop script (background means no window to close — you need this one)
├─ run-pinboard.vbs        hidden-window launcher (CRLF, called by start.cmd)
├─ tools/pinboard.ps1      start|stop|restart|status|logs control script (UTF-8 with BOM)
├─ logs/                   runtime log pinboard.log (not in the repo)
├─ monitor-links.example.json  sample monitor → admin page mapping (copy to monitor-links.json)
├─ monitor-actions.json    recipes for "check now" (multi-step, keyed by monitor id / name, no restart)
├─ package.json            scripts and dependencies
├─ vite.config.ts          frontend build (root=web, output dist/web, /api proxied to 7788)
├─ tsconfig.json
├─ pnpm-workspace.yaml     pnpm 12 build allow-list (esbuild)
├─ SNAPSHOT.md             auto-generated data snapshot (assets + notes + tags, do not edit)
├─ server/                 backend (Hono)
│  ├─ index.ts             thin entry point (62 lines): mount routes + snapshot middleware + start
│  ├─ static.ts            serves dist/web and the SPA deep links
│  ├─ db.ts                open the database, SQL helpers, tag parsing/sync, presets, migrations
│  ├─ schema/              core.ts (notes/assets/tags/fields), mail.ts (mailboxes + local read marks)
│  ├─ hydrate.ts           row hydration for notes/assets (tags, linked asset, note counts)
│  ├─ tags.ts / dates.ts   pure functions: tag parsing and colours / days until expiry
│  ├─ snapshot/            rows.ts reads, markdown.ts renders (pure), write.ts writes with a 1.5s debounce
│  ├─ mail/                types / parse (snippets) / errors / pool (connections + read-only lock) / client (merge + cache) / store (two tables) / routes
│  ├─ kuma/                client (socket.io), feed (fetch + cache), recipe (pure recipe logic), runner (execution), actions (config),
│  │                       links (jump table), backup (database backup), patch / http (PATCH validation and HTTP helpers), routes
│  └─ routes/              notes.ts / assets.ts / tags.ts / fields.ts / meta.ts (health, bootstrap, search, stats, export, seed)
├─ web/                    frontend (React 19)
│  ├─ App.tsx              layout, sidebar, theme, command palette
│  ├─ pages/               NotesPage / MailPage / AssetsPage / MonitorsPage / SettingsPage + their subdirectories (notes/ mail/ monitors/ assets/)
│  ├─ components/          drawers / heartbeat strip / alert stack / command palette / ui + monitor-drawer/ asset-drawer/ mail-reader/ mail-account/
│  ├─ lib/                 api.ts (facade) + api/ (six domains), router.ts, format.ts, monitors.ts, cx.ts, paths.ts
│  └─ styles/              12 partials; index.css fixes the cascade order
├─ tests/                  unit tests (unit/, pnpm test:unit) + 14 Playwright e2e suites (run.mjs) + fakeimap/
├─ tools/                  screenshots/ (screenshot scripts, run from the project root), seed-assets.mjs, chrome-path.mjs
├─ docs/                   architecture.md / pitfalls.md (30 entries) / status-history.md / adding-assets.md / mail-page-requirements.md
├─ data/                   runtime data (not in the repo)
├─ dist/web/               frontend build output (served directly by the server)
└─ tmp/                    runtime logs and screenshots (safe to delete)
```

## HTTP API

Everything lives under `http://127.0.0.1:7788/api`, JSON in and JSON out, no authentication (it listens on localhost only).

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check, returns the database path |
| GET | `/bootstrap` | Startup data: `{ tags, fields }` |
| GET | `/stats` | Counts: notes, open, done, assets, active, total value, expiring within 30 days, expired, expiry list |
| GET | `/search?q=` | Global search, returns `{ notes, assets }` |
| GET | `/export` | Export the whole database as JSON |
| POST | `/seed` | Load sample data (only on an empty database) |
| GET | `/notes` | List; supports `q` `tag` `pinned` `done` `archived` `assetId` |
| GET/POST | `/notes/:id`, `/notes` | Single note / create |
| PATCH/DELETE | `/notes/:id` | Update (`content` `pinned` `done` `archived` `assetId`) / delete |
| GET | `/assets` | List; supports `q` `kind` `status` `tag` |
| GET | `/assets/:id` | Detail, with `linkedNotes` (already tagged) |
| POST/PATCH/DELETE | `/assets`, `/assets/:id` | Create / update / delete |
| GET/POST | `/tags` | Tag list (with note and asset counts) / create |
| PATCH/DELETE | `/tags/:id` | Rename or recolour / delete |
| GET/POST | `/fields` | Custom field list / create |
| PATCH/DELETE | `/fields/:id` | Update / delete |
| GET | `/monitors` | Monitor data: `{ kuma, updatedAt, summary, groups }`, merging Kuma's status page and heartbeats; `?fresh=1` forces a re-read of the monitor list (list cached 5 minutes, heartbeats 5 seconds) |
| GET | `/monitors/:id` | One monitor: `{ monitor, latest, beats, action, link }` (secrets redacted — no SSH keys, passwords or tokens) |
| PATCH | `/monitors/:id` | Rename / description / interval / timeout and retries (`name` `description` `interval` `timeout` `maxretries` `retryInterval` `showMsg`), written back to Kuma; duplicate names, names referenced by a policy, and timeout ≥ interval are rejected |
| POST | `/monitors/:id/pause`, `/monitors/:id/resume` | Pause / resume probing (Kuma stops, history kept) |
| DELETE | `/monitors/:id?confirm=<name>` | Delete a monitor (the name must be typed exactly); backs up `kuma/data/kuma.db` into `kuma/backups/` first, then deletes it with its heartbeats |
| POST | `/monitors/:id/check` | Check now: run the recipe step by step, returning `{ ok, steps: [{ type, label, ok, detail, ms }], latest }`; refused while paused or for push-type monitors without a recipe |
| GET/POST | `/mail/accounts` | Mailbox list (`?counts=1` adds unread counts) / create. **No response ever contains a password**, only `hasPassword`; includes a `proxy` field (empty = direct) |
| PUT/DELETE | `/mail/accounts/:id` | Update (empty password = unchanged) / delete (also clears local read marks) |
| POST | `/mail/accounts/test` | Test a connection with raw parameters or `{id}` (reusing the stored password and proxy); failures return a readable reason (and say "via proxy …" when one is configured) |
| GET | `/mail/folders?account=` | Folder list (with special-use, selectable folders only) |
| GET | `/mail/messages?account=all\|id&folder=INBOX&limit=50&offset=0` | One page of the merged inbox; `?fresh=1` bypasses the 60-second cache (the frontend poller uses it too). Returns `{ items, total, unseen, hasMore, errors, partial, fetchedAt }`, where `fetchedAt` is when this batch came back from IMAP |
| GET | `/mail/message?account=&folder=&uid=` | One message body (`text` / `html` / attachment list) |
| GET | `/mail/attachment?account=&folder=&uid=&index=` | Download an attachment (`Content-Disposition` carries the original filename) |
| POST/DELETE | `/mail/local-read` | Mark locally read / clear (`account=all` or a specific id). **There is no endpoint that writes to the server** |

Examples:

```powershell
# create a note
curl.exe -X POST http://127.0.0.1:7788/api/notes -H "Content-Type: application/json" \
  -d '{"content":"renew the cert for my-server #ops #todo"}'

# mark it done
curl.exe -X PATCH http://127.0.0.1:7788/api/notes/1 -H "Content-Type: application/json" -d '{"done":true}'
```

## Development

```powershell
pnpm dev        # API (7788, tsx watch) + Vite (5273), /api proxied
pnpm build      # rebuild the frontend into dist/web — required after frontend changes, the server serves that directory
pnpm typecheck  # tsc --noEmit
pnpm start      # production mode (tsx server/index.ts, not watch: restart after backend changes)
```

After frontend changes: `pnpm build` then Ctrl+F5 in the browser. After backend changes: restart `pnpm start`.

Tests live in `tests/`, screenshot scripts in `tools/screenshots/` (they still write into `tmp/`, which is gitignored):

```powershell
pnpm test          # typecheck + snippet unit tests (no running service needed)
pnpm test:e2e      # core + monitor suites (needs 7788 running and Kuma on 3001)
pnpm test:mail     # mail suite (use an isolated instance, see below)
node tests/run.mjs --only=core   # one group only: core / monitor / mail / all
```

The mail suite wants an isolated instance (especially when the database holds real mailboxes): `$env:PINBOARD_DATA='tests\e2e-data'; $env:PORT='7799'; pnpm start`, then `$env:MAIL_E2E_BASE='http://127.0.0.1:7799'; pnpm test:mail`, and delete `tests/e2e-data` afterwards.

| Script | Purpose |
|---|---|
| `tests/run.mjs` | Sequential runner (core / monitor / mail, prints a summary; `--only=` picks a group) |
| `tests/smoke.mjs` | API smoke test (CRUD, tags, links, stats, export) |
| `tests/e2e.mjs` | Playwright UI end-to-end (13 assertions) |
| `tests/e2e-done.mjs` / `tests/done-smoke.mjs` | Done state: UI + API |
| `tests/e2e-dblclick.mjs` | Double-click to toggle done (8 assertions) |
| `tests/e2e-filter.mjs` | Filter row behaviour with done notes (4 assertions) |
| `tests/e2e-archive.mjs` | Archive / archived view / restore / delete forever / Ctrl+K exclusion (20 assertions) |
| `tests/e2e-mail.mjs` | Mail page end-to-end (72 assertions: add account / list / paging / body / show and hide images / local read / filters / keyboard / folders / account CRUD / 60-second auto-fetch), with its own fake IMAP server |
| `tests/fakeimap/server.mjs` | Fake IMAP server (hoodiecrow-imap, 120 messages + attachment + tracking pixel); **installed in `tests/fakeimap/`'s own node_modules**, not a project dependency |
| `tests/fakeimap/mail-api-smoke.mjs` | Mail API smoke test (58 assertions, including "opening a message leaves the server's unread count unchanged" and proxy validation) |
| `tools/screenshots/shots.mjs` / `shots-assets.mjs` / `shots-mail.mjs` | Batch screenshots |
| `tools/seed-assets.mjs` | Rebuild the inventory from the current asset list (one-off script) |

UI tests use the Chromium you already have: `C:\Users\you\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe` (`playwright-core` is a devDependency; no extra browser download). Override with `CHROME_PATH`.

## FAQ

**Port already in use (`EADDRINUSE 127.0.0.1:7788`)**
Usually a leftover process from the previous run. Stop it with the command above, then start again.

**After moving or renaming the project directory, startup fails with `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR` (access denied)**
pnpm's virtual store path changed. Delete and reinstall: `Remove-Item .\node_modules -Recurse -Force` then `pnpm install` (fast, thanks to the local cache).

**My code changes don't show up**
Frontend changes need `pnpm build` and a reload; backend changes need a restart (`pnpm start` is not watch mode — use `pnpm dev` while developing).

**Where is the data, and how do I move it**
Copy the whole `data/` directory. On another machine you don't even need `node_modules` — just `pnpm install`.

**Can I expose it to the internet or reach it from my phone**
Not as-is: there is **no authentication at all** and it only listens on 127.0.0.1. If you need phone access, add auth plus an HTTPS reverse proxy yourself.

**Why is the price total 0**
Price and expiry date are empty by default and only count once filled in. Also note that the total simply adds the numbers across currencies without converting — don't treat it as accounting data.

## Stack and provenance

- Backend: Hono + `@hono/node-server`, with Node 24's built-in `node:sqlite` (`DatabaseSync`) — so there is no `better-sqlite3` or other native module to compile; install and run.
- Frontend: Vite 7 + React 19 + hand-written CSS (warm paper `#f6f3ec`, accent `#b45309`), icons from lucide-react, Markdown via marked with DOMPurify sanitising.
- Mail: [imapflow](https://github.com/postalsys/imapflow) + [mailparser](https://github.com/postalsys/mailparser) (same author, pure JS, no native build). Chosen because `fetch` goes through `BODY.PEEK` (never writes the Seen flag), it sends `IMAP ID` automatically based on server capabilities (required by 163), and `getMailboxLock` can open a mailbox read-only via `EXAMINE`.
- Design references: the interaction follows [usememos/memos](https://github.com/usememos/memos) (timeline notes, `#tags`, pinning) and the data model follows [sysadminsmedia/homebox](https://github.com/sysadminsmedia/homebox) (assets, locations, custom fields, expiry). Neither covers more than half of what is needed here, and both are standalone services with accounts, so this project was written from scratch — **no code was copied from them**.

## Docs

- This file: features, startup, backup and API for users.
- [`CHANGELOG.md`](CHANGELOG.md): what changed, and in which version.
- [`AGENTS.md`](AGENTS.md): engineering conventions, module responsibilities and hard-won pitfalls for whoever (or whatever) works on the code next. **Read it before changing code.** (Written in Chinese.)
- [`docs/adding-assets.md`](docs/adding-assets.md): **the one page to read before adding an asset or a note** (UI and API paths, field meanings, tag rules, templates for four asset kinds, batch script, common errors, one-page cheat sheet). (Written in Chinese.)
- [`SNAPSHOT.md`](SNAPSHOT.md): an **auto-generated** dump of the current data (asset table + every detail + all notes + tag/field overview). Rewritten within 1.5 seconds of any write, or manually with `pnpm snapshot`; **do not edit it by hand**. It's the fastest way for a fresh session to see everything without querying the database.
- The rest of `docs/` (`architecture.md`, `pitfalls.md` with 30 entries, `status-history.md`, `mail-page-requirements.md`) is internal documentation, also in Chinese.

## License

[MIT](LICENSE). Use it, change it, sell it — just don't blame me when it breaks.
