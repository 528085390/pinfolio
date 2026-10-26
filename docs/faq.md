# FAQ

## What is this

**In one sentence**: a self-hosted six-in-one — "notes + asset inventory + uptime dashboard + read-only mail + host metrics + backups" — one Node process,
one SQLite file, single user.

**How is it different from Memos / HomeBox?** Those two each do only half (timeline notes / asset inventory); pinfolio is the two stitched together,
plus monitoring and mail. Their design was a reference, but no code was copied.

## Deployment

**Do I have to use Docker?** No. Three ways to run it are equivalent: `docker compose up -d`, bare metal `pnpm build && node dist/server.js`,
or double-clicking `start.cmd` on Windows. See [`deploy.md`](deploy.md).

**Can it run on a Synology / Raspberry Pi / small ARM box?** Yes. The image comes in `linux/amd64` and `linux/arm64`, and
about 256 MB of RAM is enough (one process + SQLite).

**Does it need an extra database?** No. The data lives in `data/pinboard.db` (SQLite, WAL). MySQL / PostgreSQL are only a **backup destination**,
not a runtime dependency.

**Can the port / data directory be changed?** Yes: `PORT`, `HOST`, `PINBOARD_DATA`. If you change `PINBOARD_DATA`, remember to move the old data over.

**Does it support multiple users?** No, and there are no plans to. By design it is "one person's instance": one password, one set of data.
Multi-user would mean adding `user_id` to a dozen or so tables and isolating them; that is another product.

**Does it work on a phone?** Yes. At 390 px wide the UI is a bottom tab bar layout, and you can "add to home screen" and open it as an app (PWA).
The prerequisite is being able to reach it from the phone: a direct LAN connection, an HTTPS reverse proxy, or a tunnel such as frp (the settings page has a "public access" card).

## Features

**What happens if Uptime Kuma is not installed?** Only the monitors page shows a three-step setup card; the other seven pages are entirely normal.
The probing itself is run by Kuma — pinfolio is only its interface.

**Can it connect to stock upstream Kuma?** Yes. It detects whether this is the modified fork from the `policyJson` field; on stock upstream it merely does not show
fork-only entry points such as "check now". To force it, use `KUMA_FLAVOR=fork|upstream`.

**Why is mail read-only?** It is deliberate: fetching always uses `BODY.PEEK`, so mail is never marked read, deleted or moved.
"Read on this page" is recorded only in the local database. To see another folder, switch in the dropdown.

**Can notes and assets be linked to each other?** There is one optional "pin a note to an asset" (`notes.asset_id`), but the two pages are independent,
and no more cross-linking is planned.

## Data and security

**Where does the data live?** All of it is under `PINBOARD_DATA` (default `data/`): `pinboard.db` is the main database, `secret.key` is the encryption master key,
`backups/` holds the backup packs, and `audit/` the daily monitor heartbeat CSVs.

**Are passwords stored in plain text?** The login password is a scrypt hash; mailbox passwords / the Kuma password / the metrics token are encrypted with AES-256-GCM
(`enc:v1:…`), and the master key is in `data/secret.key` or `PINBOARD_SECRET`.

**What if `secret.key` is lost?** Those encrypted fields can no longer be decrypted: mailbox accounts need their passwords entered again, the Kuma password needs re-configuring,
and the metrics source address needs entering again. The rest of the data (notes, assets, monitor history) is unaffected. So **a backup has to include `secret.key`**,
and do not put it on the same machine as the backup (losing both at once makes the encryption pointless).

**Forgot the login password?** Stop the service, run `node --import tsx server/index.ts --reset-password` (or the same command inside the container),
start it again and visit `/setup` to set a new one.

**Can it be exposed to the public internet?** Yes, but it has to sit behind an HTTPS reverse proxy, and log in with the password only. It listens on `127.0.0.1` by default;
in a container set `HOST=0.0.0.0`, and behind a reverse proxy set `TRUST_PROXY=1` to get the real IP (login rate limiting counts by IP).

**Why AGPL-3.0?** This is a network application that can run as a whole site: if someone modifies it and sells it as a service, the changes should go back to the community.
Using it yourself, modifying it yourself and deploying it yourself are all unrestricted.

## Backup and upgrade

**How do I turn backups on?** They are on by default: every day at 03:00 it packs everything into `data/backups/`, keeping 14 copies. `BACKUP=0` turns it off,
`BACKUP_HOUR` / `BACKUP_KEEP` / `BACKUP_DIR` are adjustable. MySQL / PostgreSQL can also be configured as a remote destination.

**How do I restore?** See [`backup-restore.md`](backup-restore.md): four scenarios — a whole-machine move, rolling back only the database, fetching back from the remote, and restoring only Kuma.

**Will upgrading lose data?** No. A snapshot is taken automatically before migrating (5 kept), and a failed migration aborts startup. Steps are in [`upgrade.md`](upgrade.md).

**Why does monitor history need a separate archive?** Kuma itself keeps only 365 days (`keepDataPeriodDays`); once deleted, it is gone.
`data/audit/heartbeats-YYYYMMDD.csv.gz` is one file of raw heartbeats per day, not subject to the backup retention policy, and is what long-term auditing uses.
