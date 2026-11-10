# pinfolio HTTP API

Every endpoint the frontend uses. For a quick overview see the [README](../README.md).

Everything lives under `http://127.0.0.1:7788/api`, JSON in and JSON out. **Everything except `/health` and `/auth/*` needs a login** (session cookie, or `Authorization: Bearer <api token>`), and write endpoints with a body only accept `Content-Type: application/json` (a cross-site form can't send that header — that is the CSRF defence). **The one exception is attachment upload**, whose body is the file bytes and which must carry `x-pinfolio-upload: 1` (a cross-site form can't send that custom header).

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
| POST | `/attachments` | Upload any file: **the request body is the file bytes**, `Content-Type` from the file itself, and it must carry **`x-pinfolio-upload: 1`** (the only write endpoint that isn't JSON — that header is its CSRF token). `?name=` keeps the original filename, `?noteId=` binds it to a note up front. The kind (image / video / audio / file) and the extension are sniffed from the bytes; unrecognised types are stored as `application/octet-stream`. Empty body → 400, missing header → 400, over 100 MB → 413, total over `ATTACHMENTS_QUOTA_BYTES` (15 GB by default) → 507. Returns 201 `{ id, url, kind, mime, bytes, name }`; `url` is `/api/attachments/<id>` |
| GET | `/attachments/:id` | Serve the file: after auth it is **streamed** from disk or object storage, with `Range` passed through → 206 (out of range → 416). `Cache-Control: private, max-age=31536000, immutable` (an id's bytes never change — replacing a file mints a new id); only whitelisted media types (images / video / audio / PDF) get `Content-Disposition: inline`, everything else is `attachment` + `X-Content-Type-Options: nosniff` (**SVG / HTML never inline**). Missing row or lost file → 404, storage read failure → 502 |
| GET | `/assets` | List; supports `q` `kind` `status` `tag` |
| GET | `/assets/:id` | Detail, with `linkedNotes` (already tagged) |
| POST/PATCH/DELETE | `/assets`, `/assets/:id` | Create / update / delete |
| GET/POST | `/tags` | Tag list (with note and asset counts) / create |
| PATCH/DELETE | `/tags/:id` | Rename or recolour / delete |
| GET/POST | `/fields` | Custom field list / create |
| PATCH/DELETE | `/fields/:id` | Update / delete |
| GET | `/monitors` | Monitor data: `{ updatedAt, summary, groups, quick }`, aggregated from the native probe engine (HTTP / TCP / SSH / Push); `quick` holds link-only cards from `quick-links.json`; every monitor carries 40 beats of `beatTimes` / `beatMsgs` / `beatPings` for hover tooltips |
| GET | `/monitors/:id` | One monitor: `{ monitor, latest, beats, action, link }` (secrets redacted — no SSH keys, passwords or tokens) |
| PATCH | `/monitors/:id` | Rename / description / interval / timeout / retries / outbound mode pinning (`outboundMode: follow|direct|proxy`), transactionally saved to `pinboard.db` and debounced snapshot update |
| POST | `/monitors/:id/pause`, `/monitors/:id/resume` | Pause / resume probing (probe engine stops/resumes, history kept) |
| DELETE | `/monitors/:id?confirm=<name>` | Delete a monitor (name must match exactly); creates a VACUUM INTO backup of `pinboard.db` into `data/backups/` first, then deletes monitor and heartbeats |
| POST | `/monitors/:id/check` | Check now: run the recipe step by step, returning `{ ok, steps: [{ type, label, ok, detail, ms }], latest }` |
| GET/POST | `/push/:token` | External push heartbeat endpoint: records incoming beat status and message |
| GET/POST | `/outbound` | Get or save global outbound network configuration (`mode: direct|proxy`, `proxy`) |
| POST | `/outbound/test` | Test connection through the configured outbound proxy |
| GET/POST | `/mail/accounts` | Mailbox list (`?counts=1` adds unread counts) / create. **No response ever contains a password**, only `hasPassword`; includes a `proxy` field (empty = direct) |
| PUT/DELETE | `/mail/accounts/:id` | Update (empty password = unchanged) / delete (also clears local read marks) |
| POST | `/mail/accounts/test` | Test a connection with raw parameters or `{id}` (reusing the stored password and proxy); failures return a readable reason (and say "via proxy …" when one is configured) |
| GET | `/mail/folders?account=` | Folder list (with special-use, selectable folders only) |
| GET | `/mail/messages?account=all\|id&folder=INBOX&limit=50&offset=0` | One page of the merged inbox; `?fresh=1` bypasses the 60-second cache (the frontend poller uses it too). Returns `{ items, total, unseen, hasMore, errors, partial, fetchedAt }`, where `fetchedAt` is when this batch came back from IMAP |
| GET | `/mail/message?account=&folder=&uid=` | One message body (`text` / `html` / attachment list) |
| GET | `/mail/attachment?account=&folder=&uid=&index=` | Download an attachment (`Content-Disposition` carries the original filename) |
| POST/DELETE | `/mail/local-read` | Mark locally read / clear (`account=all` or a specific id). **There is no endpoint that writes to the server** |
| GET | `/hosts` | Host metrics: `{ hosts, updatedAt, polledAt, pollOk, pollFailed, samples }`. One entry per machine: the latest sample (cpu / mem / disk / load / units / top …) plus `id`, `label`, `note`, `paused`, `online`, `staleSec` (stale after 900 s), `series` (24 h of `[ts, cpuPct, memPct]`) and `unitMonitors` (`{ unit: { id, name } }` — the Kuma monitor each service chip jumps to, resolved from `host-services.json`; a unit with no match is absent, so its chip stays plain text). Paused machines count as neither online nor stale, and never appear in `pollFailed`. Empty database = this request waits for the pull instead of returning `[]` |
| POST | `/hosts` | Add a machine to `data/metrics.json`: `{ id, label?, note?, units?, disks?, address?, port?, http?: { url, keyword? }, services?: [{ unit, user, keyPath }] }`. `id` is 1–32 chars of `[A-Za-z0-9._-]`, `label` defaults to `id`, duplicate → 409. `units` / `disks` / `address` are the collector parameters (replayed later by `GET /hosts/:id/onboard`); `port` / `http` / `services` are optional monitors to create along with the host — they require `address` (400 otherwise), and SSH keys are read from `keyPath` before anything is written (unreadable key → 400). The monitor side-effect is best-effort: the host is kept even when it fails, and the response adds `provision: { ok, groupId?, groupName?, monitors?, error? }`. Written atomically (keeps `base` and unknown keys), then pulls once. Returns the fresh payload |
| GET | `/hosts/:id/onboard` | The one-line collector install command, plus `{ installUrl, ingestUrl, units, disks, address, ready, firstSampleAt, staleSec }`. **The ingest URL carries the token, so it only ever appears here** — never in `/hosts` and never in `SNAPSHOT.md`. Unknown id → 404 |
| PATCH | `/hosts/:id` | Update `{ paused?, label?, note?, units?, disks?, address? }`. `paused: true` stops pulling that machine (the card stays, dimmed); `paused: false` pulls once to backfill the newest frame. Unknown id → 404 |
| DELETE | `/hosts/:id?confirm=<id>&purge=1` | Remove a machine — the id must be typed exactly. `purge=1` also deletes its `host_metrics` rows, the Kuma monitors created for it (the ids recorded as `monitors` in `data/metrics.json`), the group once empty, and its `host-services.json` rules; the response adds `{ purged, monitorsDeleted, monitorsFailed }`. Unknown id → 404 |
| POST | `/hosts/refresh` | Pull every machine from the ingest bucket right now (bypasses the 4-minute minimum gap). Requires `Content-Type: application/json`, otherwise 415 |
| GET | `/services` | Deployment map for the services page: `{ servers, services, deploys, monitors, file }`, read from `data/services.json` (`SERVICES_FILE` overrides the path) on **every request**, so edits show up on reload. `servers` = which machines, `services` = which projects / services / sites / scripts / tasks, `deploys` = who runs what where (path, runtime, port, `monitor` ids, optional management `url`), `monitors` = monitor id → short name for display only (unknown ids fall back to `观测项 N`). Malformed entries are skipped and deploys pointing at an unregistered server or service are dropped; `file` echoes the path actually read. **Relationships only — nothing is probed and no Kuma monitor is created** |
| POST | `/services/servers` | Add a machine: `{ id, name, vendor?, ip?, user?, note?, doc?, monitors?: [id] }`, optionally with `monitorNames` (`{ "24": "抖音续火花（每日打卡）" }`) so the file's `monitors` table stays readable. `id` is 1–32 chars of `[a-z0-9._-]` starting with a letter or digit, case-insensitively unique (409 on duplicate); validation failures return 400. **Returns the whole payload** so the page can replace its state without refetching |
| PATCH/DELETE | `/services/servers/:id` | Edit (only the fields you send; changing `id` rewrites the references in `deploys`) / delete (`?confirm=<id>`, typed by hand). **Refused while the machine still has deploys** — the error lists them |
| POST | `/services/catalog` | Add a service (the `services` section of the JSON; the path is `catalog` to avoid `/services/services`): `{ id, name, kind?, summary?, doc? }`. `kind` is one of `project` / `service` / `site` / `script` / `task` (default `service`) |
| PATCH/DELETE | `/services/catalog/:id` | Edit / delete a service (delete also needs `?confirm=<id>`). Changing `id` rewrites deploy references; **deletion is refused while it is still deployed somewhere** |
| POST | `/services/deploys` | Add a deployment: `{ server, service, path, runtime?, port?, monitor?: [id], url?, note? }`. `server` and `service` must already exist and the pair `server+service` is unique (409 on duplicate); `path` is required and `url` must be `http(s)://`. `monitorNames` accepted too |
| PATCH/DELETE | `/services/deploys/:key` | Edit / delete one deployment; `:key` is `server:service` (`%3A` works too) and delete needs `?confirm=<key>`. Moving a deployment onto an existing pair is refused. **Every write endpoint requires `Content-Type: application/json` (415 otherwise); the previous file is copied to `data/services-backups/services-YYYYMMDD-HHMMSS.json` (last 10 kept) before each write, and the data is re-normalised through the parser (bad entries dropped). Kuma is never touched** |
| GET | `/backup` | Backup status: `{ local: { dir, keep, files: [{ name, size, mtime }], last, lastOkAt, lastError }, remote: { type, host, port, database, user, table, hasPassword, rows, last, lastError } }` |
| GET | `/backup/local/:name/manifest` | The pack's `manifest.json` (member names, sizes, sha256, generated time, instance id) |
| GET | `/backup/local/:name/download` | Download one pack (`Content-Disposition` carries the filename) |
| DELETE | `/backup/local/:name` | Delete one pack (the name must match `pinfolio-*.tar.gz`; `pre-migrate-*` is refused) |
| POST | `/backup/run` | Back up now: `{ only?: "local" | "remote" }`, returns the new status |
| GET | `/backup/remote` | Remote rows (metadata only, never the payload) |
| POST | `/backup/remote/test` | Test a connection: `{ type, host, port?, database, user, password?, table? }`; returns the server version. An empty password reuses the stored one |
| POST | `/backup/remote/config` | Save the destination (same fields; the password is encrypted at rest) and create the table if it is missing |
| DELETE | `/backup/remote/config` | Forget the destination (rows already uploaded stay in the database) |
| DELETE | `/backup/remote/:id` | Delete one remote row |
| POST | `/backup/remote/:id/download` | Fetch one remote row back into `data/backups/` (sha256 checked) |

Examples:

```powershell
# create a note
curl.exe -X POST http://127.0.0.1:7788/api/notes -H "Content-Type: application/json" \
  -d '{"content":"renew the cert for my-server #ops #todo"}'

# mark it done
curl.exe -X PATCH http://127.0.0.1:7788/api/notes/1 -H "Content-Type: application/json" -d '{"done":true}'
```
