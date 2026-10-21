# pinfolio HTTP API

Every endpoint the frontend uses. For a quick overview see the [README](../README.md).

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
