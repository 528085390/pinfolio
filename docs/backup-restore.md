# Backup and restore

> Design: `docs/superpowers/specs/2026-10-23-pinfolio-oss/05-backup.md`, code in `server/backup/*`.
> This page only covers **how to use it and how to restore**; when you change the logic, change both.

## In one sentence

Every day at 03:00 it packs a tarball into `data/backups/` and keeps 14 of them; you can additionally configure a MySQL / PostgreSQL as a remote destination.
A pack holds the database snapshot, **the day's monitor heartbeats at every point in time as CSV**, the config and key files — unpack it when you change machines and it keeps running.

## What is in the pack

| Member | Content | When present |
|---|---|---|
| `pinboard.db` | a consistent snapshot of the database (`node:sqlite`'s `backup()`, no need to stop the service under WAL) | every time |
| `heartbeats-YYYYMMDD.csv.gz` | every monitor heartbeat of the day: `time,monitor_id,monitor_name,status,msg,ping` | every time (header only when there were no heartbeats that day) |
| `monitors.json` | monitor definitions (id / name / group / interval / URL), so the CSV tells you who is who | every time (absent when Kuma cannot be reached) |
| `kuma.db` | full Kuma snapshot | **only in the Sunday pack** (about 3.3 MB gzipped) |
| `data/metrics.json`, `data/kuma-pass.txt`, `data/secret.key` | host collection config / Kuma password / **master key** | packed only if it exists |
| `monitor-links.json`, `monitor-actions.json`, `host-services.json`, `quick-links.json` | the four configs in the project root | packed only if it exists |
| `manifest.json` | name / size / sha256 per member + creation time + instance id | every time |

An ordinary day's pack is about 0.5–0.7 MB, the Sunday one about 3.9 MB. The "content list" on the page reads precisely this `manifest.json`.

## Automatic and manual

- Automatic: a timer inside the process, every day at **03:00** (`BACKUP_HOUR` changes it). `BACKUP=0` turns the local backup off.
- Manual: "Back up now" on the backup page; or the command line

```powershell
node dist/server.js --backup            # run both destinations (whichever are configured)
node dist/server.js --backup --local    # local pack only
node dist/server.js --backup --remote   # remote database only
```

Bare-metal dev mode (no `dist/server.js`) uses `pnpm start -- --backup` or `node --import tsx server/index.ts --backup`.

Environment variables:

| Variable | Default | What it does |
|---|---|---|
| `BACKUP` | `1` | `0` = turn the local scheduled backup off (the remote one stops running too) |
| `BACKUP_HOUR` | `3` | what hour of the day it runs (0–23) |
| `BACKUP_KEEP` | `14` | copies kept locally; beyond that the oldest are deleted |
| `BACKUP_DIR` | `<data>/backups` | directory for the backup packs |
| `KUMA_DB` | `../kuma/data/kuma.db` | source of the heartbeat CSV and of `kuma.db` |

## Remote database

In the bottom right corner of the backup page, "Connect remote database" takes: type (MySQL / PostgreSQL), host, port, database name, user, password, table name
(default `pinfolio_backups`, letters, digits and underscore only). "Test connection" returns the server version; after saving, the password is encrypted at rest the way 03 does it.

The program creates the table itself (`CREATE TABLE IF NOT EXISTS`), columns:

```sql
id VARCHAR(36) PRIMARY KEY,  -- randomUUID()
instance_id VARCHAR(36),     -- this instance's id (the id in /api/health)
filename VARCHAR(128),
created_at VARCHAR(32),      -- ISO string, not DATETIME (see pitfall 43)
size BIGINT,
sha256 CHAR(64),
payload LONGBLOB / BYTEA
```

After upload the `payload` is read back and hashed for the sha256 comparison; a mismatch is an outright error, never a silent success.
MySQL's `max_allowed_packet` defaults to 64 MB; when a pack exceeds the limit the page says so outright — raise it in `my.ini` or use local files instead.

## Restore

### A. Moving the whole instance to a new machine (most common)

1. Stop the service: `stop.cmd` (or `docker compose down`).
2. Unpack the backup pack into the project directory on the new machine:

   ```powershell
   tar -xzf pinfolio-20261026-0300.tar.gz -C <project dir>
   ```

   It overwrites `data/pinboard.db`, `data/secret.key`, `data/metrics.json` and so on, and puts the four configs back in the root.
3. **Delete the old WAL leftovers**: `data/pinboard.db-wal` and `data/pinboard.db-shm` (if they exist) — leave them and SQLite replays the old WAL onto the new database and corrupts it outright.
4. Start the service and log in with **the password as it was at backup time** (the `sessions` table came back with it, so the sessions already on your phone still work).

### B. Roll back only the database (the program is unchanged)

Steps 1–4 as above, but unpack only the `pinboard.db` member and do not overwrite `secret.key` — unless you mean to roll the key back as well (then the mailbox passwords have to roll back with it,
or they cannot be decrypted: the ciphertext was encrypted with the old key).

### C. Fetching back from the remote database

"Fetch back" on that row in the remote column of the backup page → it lands in `data/backups/`; then follow steps 1–4 of A.

### D. Restoring only the monitoring data (Kuma)

Only the Sunday pack has `kuma.db`. Before restoring, run `kuma\tools\kuma.ps1 stop` (**stopping pinfolio alone is not enough**),
overwrite `kuma/data/kuma.db`, delete `kuma.db-wal` / `kuma.db-shm`, then `kuma.ps1 start`.

## What to do when secret.key is lost

`secret.key` (or `PINBOARD_SECRET`) is the encryption key for the mailbox passwords / the Kuma password / the metrics token — **lose it and these fields can never be decrypted**.

- You have a pack: unpack that copy of `data/secret.key` from the pack and put it back, done.
- You don't: delete `data/secret.key` and let the program generate a new one (the old ciphertext can never be decrypted), then **fill them in again in the page**: the mailbox passwords,
  the Kuma password (or edit `data/kuma-pass.txt` directly), the host collection address. When decryption fails the account list says "please click edit and fill it in again";
  it does not pretend the password was never set.

## Monitor history (audit)

- The `heartbeats-YYYYMMDD.csv.gz` in each pack covers **that day's** heartbeats; across days you have to join several packs.
- At the same time one copy is kept per day in `data/audit/heartbeats-YYYYMMDD.csv.gz`, **not subject to the 14-copy retention rule** — that is the source for long-term auditing.
  Kuma's own `keepDataPeriodDays` is 365 days and anything older is deleted, so do not rely on Kuma alone.
- Usage: `zcat heartbeats-20261026.csv.gz | head`, or open it directly in pandas / Excel (UTF-8; a field containing a comma gets quoted).

## Verifying a backup

1. Click "Back up now" on the backup page, wait for the status to turn green, note the file name.
2. Click "content list" and look at the member count (there should be 10–12).
3. Unpack it into a temporary directory and open the snapshot with node to compare row counts:

   ```powershell
   node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('tmp/pinboard.db');console.log(d.prepare('select count(*) c from notes').get())"
   ```

   The number should match the live instance (check live: the row count from `curl http://127.0.0.1:7788/api/notes`).
4. CSV line count = the day's heartbeat count: `zcat heartbeats-*.csv.gz | wc -l`.

## FAQ

- **The backup fails but the service is fine**: by design — a failure only records a log line and the page status, requests are unaffected. Look at the `[backup]` lines in `logs/pinboard.log`.
- **Remote connection times out**: confirm the database's listen address first (MySQL listens on 127.0.0.1 only by default; inside a container put the host IP or `host.docker.internal`).
- **PostgreSQL reports `relation "pinfolio_backups" does not exist`**: after saving the config, click "upload now" once — the table is created then.
- **The pack keeps growing**: the Sunday one carries `kuma.db`, that is normal; if every day is 4 MB, check whether `kuma.db` is in every day's pack (only Sunday should have it).
