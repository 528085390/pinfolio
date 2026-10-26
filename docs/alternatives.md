# How pinfolio compares

pinfolio does a few small things on purpose. This page is the honest version of "should I use this instead of X" — including the cases where the answer is no.

Nothing here is a knock on the projects below. Memos, HomeBox, Uptime Kuma and linkding are each better at their one job than pinfolio is at that same job. They just don't talk to each other.

Checked in October 2026. Features move; when in doubt, check the project itself.

## At a glance

| | pinfolio | Memos | HomeBox | Uptime Kuma | linkding |
|---|---|---|---|---|---|
| Notes, Markdown, `#tags` | yes | yes | — | — | — |
| Asset inventory, custom fields | yes | — | yes | — | — |
| Expiry / warranty reminders | yes | — | yes | — | — |
| Price totals | yes | — | price per item, no total | — | — |
| Uptime checks | reads Kuma | — | — | yes, it probes | — |
| Host CPU / memory / disk | yes | — | — | — | — |
| Read-only merged inbox | yes | — | — | — | — |
| Bookmarks | — | — | — | — | yes |
| One tag namespace across features | yes | n/a | n/a | n/a | n/a |
| Multi-user | **no** | yes | yes | yes | yes |
| Database | SQLite | SQLite / MySQL / PostgreSQL | SQLite | SQLite | SQLite / PostgreSQL |
| License | AGPL-3.0 | MIT | AGPL-3.0 | MIT | MIT |

## What pinfolio does not do

- **More than one user.** One password, one owner, no roles, no invitations, no sharing. If a family or a team needs separate accounts, every project in the table above has real user management and pinfolio does not.
- **SSO, OIDC, 2FA.** A scrypt password, 30-day sliding sessions, a device list you can revoke, and bearer tokens for scripts. That is the whole auth surface.
- **Probe your services.** The monitors page is a UI over an Uptime Kuma instance, read through Kuma's socket.io API. No Kuma, no monitors page. pinfolio never opens a connection to your services itself.
- **Write to your mailbox.** Mail is read-only by design: `SELECT` / `SEARCH` / `FETCH BODY.PEEK[]`, not a single `STORE`, so opening a message cannot mark it read on the server. No reply, no move, no delete.
- **Keep long-term metrics.** Host charts cover the last 24 hours. The daily heartbeat CSVs in `data/audit/` are the long-term record. There is no alerting engine and no Prometheus or Grafana integration.
- **Import anything.** The JSON export on the settings page is the only data path out. There is no Memos or HomeBox importer, and none is planned.

## When one of the others is the better choice

### Memos — notes are the whole job, and other people will use it

Go, single binary, MIT. Mature, fast, large community, real multi-user, sharing, SSO. pinfolio's notes page is a filtered list with `#tags`, not a timeline with comments, visibility settings and an activity feed. If you want a thought-capture tool, Memos is the better one.

### HomeBox — the inventory is the whole job

Go, one container, AGPL-3.0. Labels, locations, attachments, warranty dates, CSV import and export, user groups. If you are cataloguing a house, HomeBox goes deeper on purpose: item photos, quantities, insured value, purchase details, CSV both ways. pinfolio tracks servers, domains and accounts with custom fields and stops there.

### Uptime Kuma — you need alerts, not an overview

Node, MIT. Twenty-odd check types, notifications to everything, public status pages, maintenance windows, 2FA. pinfolio has no notification engine at all; it reads a Kuma instance and draws a calmer overview over it. If you do not already run Kuma, start there.

### linkding — bookmarks

Python/Django, MIT. Tags, full-text search, auto-tagging from page metadata, a browser extension, a REST API. pinfolio has no bookmark concept whatsoever.

### Also worth a look

flatnotes and Blinko (notes), TriliumNext (hierarchical notes), Joplin (client plus sync), Vikunja (tasks). None of them overlap pinfolio's inventory or monitoring side.

## When pinfolio is the right fit

- One person's stuff on one machine. No roles, no invitations, no sharing — by design, because that removes most of the auth surface.
- You already run Uptime Kuma, or you are willing to, and you want the monitoring view to sit next to the notes about those machines.
- You want a note about a server and the server itself under the same tag.
- You would rather back up one directory than three databases.

## Running them side by side

- **pinfolio + Kuma** is the intended pair. The monitors page needs `KUMA_URL` (default `http://127.0.0.1:3001`) and reads Kuma's database only for backups.
- **pinfolio + Memos / HomeBox / linkding** works, but they share nothing: no importers, no sync, no common tag store. Running two note apps is usually worse than picking one.
- pinfolio does not import from anything, so migrating in means retyping or scripting the HTTP API ([docs/api.md](api.md)).
