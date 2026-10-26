# Upgrading and rolling back

In one line: **Docker is `pull` + `up -d`, bare metal is `pnpm install && pnpm build` and then a restart**. The database migration is the app's own job, and it takes a snapshot automatically before migrating; a failed migration aborts startup, so you are never left with a half-migrated database.

## Before you upgrade

1. Make sure the most recent backup is good: the backup page shows the "last backup time" and the copy count; if you are not sure, click "Back up now" once. The backup pack contains `data/secret.key`, which restoring needs (see [`backup-restore.md`](backup-restore.md)).
2. Read the section for the target version in [`CHANGELOG.md`](../CHANGELOG.md), especially entries with the word "breaking" in them.
3. Write down the current version (the `version` in `package.json`, or the image tag) — a rollback has to name it.

## Docker Compose

```bash
cd <your compose directory>
docker compose pull          # pull the new image (latest by default)
docker compose up -d         # recreate the container, the /data volume is kept as is
docker compose logs -f pinfolio   # watch the startup log: pre-migration snapshot / credential encryption / port
```

Pin a version instead of following latest:

```bash
PINBOARD_TAG=v0.2.0 docker compose up -d
```

Rollback (the data rolls back with it, see "Migrations and rollback" below):

```bash
PINBOARD_TAG=v0.1.0 docker compose up -d
```

## Bare metal (Linux / macOS)

```bash
cd <pinfolio directory>
git fetch --tags && git checkout v0.2.0    # or unpack the new version's archive
pnpm install --frozen-lockfile
pnpm build                                  # frontend dist/web + server dist/server.js
systemctl restart pinfolio                  # or whichever process manager you use
```

Only want to run the source without building? That works too: after `pnpm install`, use `pnpm start` (tsx runs `server/index.ts` directly).

## Windows (start.cmd)

```powershell
cd E:\bqj\pinboard
powershell -File tools\pinboard.ps1 stop
git pull; pnpm install; pnpm build
powershell -File tools\pinboard.ps1 start
```

`tools\pinboard.ps1` must stay UTF-8 **with a BOM**, and `run-pinboard.vbs` must be CRLF, or double-clicking silently does nothing (pitfall 10).

## Migrations and rollback

- The version number lives in SQLite's `PRAGMA user_version`; each migration step is one transaction, and a failure rolls it back and throws.
- When there are pending migrations, startup first makes a `VACUUM INTO` copy of the current database to `data/backups/pre-migrate-v<old version>-<timestamp>.db`, **keeping the newest 5**. Why `VACUUM INTO` rather than copying the file: in WAL mode a plain copy of the `.db` misses transactions still in `-wal` (pitfall 46).
- Snapshot fails → the migration does not run, the process exits and prints "迁移前备份失败，已中止升级". Better not to start at all than to leave a database with no way back.
- After a successful migration the old snapshot stays in `data/backups/`, and you can fall back by hand at any time: stop the service → overwrite `data/pinboard.db` with the snapshot (**delete `pinboard.db-wal` and `pinboard.db-shm` at the same time**) → put the old version's code back → start.

⚠️ Rolling the code back without rolling the data back is usually unsafe: the new version may already have written columns or tables the old code does not know. If you roll back, roll the data back with it.

## Acceptance checks after upgrading

```bash
curl -s http://127.0.0.1:7788/api/health      # {"ok":true,"id":"..."}
```

1. The home page opens and you can log in (an upgrade does not drop your session, unless the password was changed).
2. All eight pages open: Notes / Mail / Assets / Monitors / Hosts / Services / Backup / Settings.
3. The backup page's "last backup" time is normal, and the remote database (if configured) answers "Test connection".
4. The monitors page has data (which means the Kuma password can still be decrypted) — if it turned into the setup card, `data/secret.key` was most likely lost or replaced.
5. The log has no errors other than `凭据已就地加密`.

## FAQ

**Asked to set a password again after upgrading?** That only happens if the database was replaced (`password_hash` lives in the `settings` table). Really forgot the password: stop the service → `node --import tsx server/index.ts --reset-password` → start → visit `/setup` and set a new one.

**`EADDRINUSE 127.0.0.1:7788`** is usually an old process that did not exit cleanly. On Windows use `stop.cmd` (it ends the tsx child process too); on Linux use `systemctl stop`, or `ss -ltnp | grep 7788` to find the PID.

**The migration errors out and exits** keep the SQL error from the log together with the `pre-migrate-*.db` — that is the most valuable reproduction material.

**`/data` permission errors inside Docker** a named volume is fine; with a bind mount, `chown -R 1000:1000 <directory>` first (the container runs as the `node` user).
