### D. Restoring only the monitoring data (Kuma)

Only the Sunday pack has `kuma.db`. Before restoring, run `kuma\tools\kuma.ps1 stop` (**stopping pinfolio alone is not enough**),
overwrite `kuma/data/kuma.db`, delete `kuma.db-wal` / `kuma.db-shm`, then `kuma.ps1 start`.

## What to do when secret.key is lost

`secret.key` (or `PINBOARD_SECRET`) is the encryption key for the mailbox passwords / the metrics token — **lose it and these fields can never be decrypted**.

- You have a pack: unpack that copy of `data/secret.key` from the pack and put it back, done.
- You don't: delete `data/secret.key` and let the program generate a new one (the old ciphertext can never be decrypted), then **fill them in again in the page**: the mailbox passwords,
  the host collection address. When decryption fails the account list says "please click edit and fill it in again";
  it does not pretend the password was never set.

## Monitor history (audit)

- The `heartbeats-YYYYMMDD.csv.gz` in each pack covers **that day's** heartbeats; across days you have to join several packs.
- At the same time one copy is kept per day in `data/audit/heartbeats-YYYYMMDD.csv.gz`, **not subject to the 14-copy retention rule** — that is the source for long-term auditing.
  This directory provides a persistent audit trail.
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

