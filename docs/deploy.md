# Deployment

Three ways to run it, same codebase:

| Way | Who it is for | Entry point |
|---|---|---|
| Docker Compose | **the main path for open-source users** | `docker compose up -d` + optional Caddy automatic TLS |
| Bare metal (Linux / macOS) | no Docker | `pnpm install && pnpm build && pnpm start` |
| Bare metal (Windows) | the author's machine | double-click `start.cmd` (hidden in the background, logs in `logs/pinboard.log`) |

All three listen on the loopback address only (in a container that is `0.0.0.0` on the container network), and **anything facing outwards goes through a front reverse proxy + HTTPS**. It has built-in single-user password login (first start goes to `/setup` to set a password), but that does not mean it can be mapped straight to the public internet — do it as described under "Reverse proxy and TLS" below.

---

## 1. Docker (recommended)

```bash
git clone https://github.com/<owner>/pinfolio.git
cd pinfolio
docker compose up -d
```

Once it is up:

- Open <http://127.0.0.1:7788> in a browser; the first visit redirects to `/setup` so you can set a password (8 characters or more).
- Everything lives in the named volume `pinfolio-data` (`/data` inside the container): `pinboard.db`, `secret.key`, `backups/`, `audit/`.
- Logs: `docker compose logs -f pinfolio`.
- Stop: `docker compose down` (**does not** delete the data volume); only `docker compose down -v` deletes the data with it.

### Skip the password and initialise from an environment variable

To skip setting the password in the browser (common in automated deployments), uncomment it in `environment` in `docker-compose.yml`:

```yaml
PINBOARD_PASSWORD: change-me-please
```

It only takes effect while the database has no password yet; once one is set this variable does nothing (change the password on the settings page, or with `--reset-password`).

### Reverse proxy and TLS

Expose 7788 on the host loopback only (the compose file already does this) and hang a layer of Caddy in front to obtain certificates automatically:

```bash
PINBOARD_DOMAIN=pin.example.com docker compose --profile tls up -d
```

- `deploy/Caddyfile` is four config lines (the site block, `encode`, `reverse_proxy`, and the closing `}`), plus two comment lines explaining usage.
- Only 80 / 443 are opened; HSTS and certificate renewal are Caddy's job.
- The proxy passes `X-Forwarded-For` / `X-Forwarded-Proto` in, and the compose file already sets `TRUST_PROXY=1` (without it every session's device IP is the container gateway address).
- Your own nginx / Traefik works too, just remember: `proxy_set_header X-Forwarded-Proto $scheme;`, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, and set `TRUST_PROXY=1`.

### Put the data in a host directory instead

The named volume is enough by default (the backup page can download from it directly). If you really want a bind mount:

```bash
mkdir -p ./data && sudo chown -R 1000:1000 ./data
```

Then replace `- pinfolio-data:/data` with `- ./data:/data` in the compose file. **Wrong permissions make it fail to start** (the container runs as the uid 1000 `node` user, not root).

### Upgrading

```bash
docker compose pull
docker compose up -d
```

The startup order is fixed: read the master key → open the database → run migrations → start serving. Before migrating it automatically takes a snapshot at `data/backups/pre-migrate-v<old-version>-<timestamp>.db` (5 kept); a failed migration exits immediately and never leaves a half-migrated database behind:

```bash
docker compose logs pinfolio        # see which step failed
```

Rolling back: change the image tag back to the old version (`PINBOARD_TAG=v1.2.3`), then copy the `pre-migrate-*.db` back as `pinboard.db` (**and delete `pinboard.db-wal` / `-shm` at the same time**, otherwise the WAL overwrites the old database). Details in [backup-restore.md](backup-restore.md).

Only `N → N+1` upgrades are guaranteed; crossing several major versions means upgrading one version at a time.

### Backup

- Automatic: every day at 03:00 it packs a tarball into `/data/backups/pinfolio-YYYYMMDD-HHMM.tar.gz` and keeps 14; `BACKUP=0` turns it off.
- Remote: the backup page takes MySQL / PostgreSQL and writes the pack into the `pinfolio_backups` table (the sha256 is read back and verified after upload).
- Manual: "Back up now" on the backup page, or `docker compose exec pinfolio node dist/server.js --backup`.
- Getting it out: click "Download" on the backup page, or `docker compose cp pinfolio:/data/backups/<file> .`.

The pack contains `secret.key`. **Lose the master key and the mailbox passwords / Kuma password / metrics source can no longer be decrypted** — treat the whole pack as a password and keep it off public cloud drives.

---

## 2. Bare metal on Linux / macOS

```bash
git clone https://github.com/<owner>/pinfolio.git && cd pinfolio
pnpm install
pnpm build                 # frontend into dist/web, server bundled into dist/server.js
PINBOARD_DATA=/var/lib/pinfolio node dist/server.js
```

- Needs Node ≥ 24 (it uses the built-in `node:sqlite`) and pnpm 12.
- Defaults are `HOST=127.0.0.1` and `PORT=7788`; to listen somewhere else set `HOST=0.0.0.0` explicitly (and make sure a reverse proxy and authentication are in front).
- Development mode is `pnpm dev` (API 7788 + Vite 5273, hot reload on change); `tsx server/index.ts` is equivalent to `node dist/server.js` — the latter is fast, the former needs no build.

systemd example:

```ini
[Unit]
Description=pinfolio
After=network.target

[Service]
User=pinfolio
WorkingDirectory=/opt/pinfolio
Environment=HOST=127.0.0.1
Environment=PORT=7788
Environment=PINBOARD_DATA=/var/lib/pinfolio
Environment=TRUST_PROXY=1
ExecStart=/usr/bin/node /opt/pinfolio/dist/server.js
Restart=always
MemoryMax=400M

[Install]
WantedBy=multi-user.target
```

---

## 3. Bare metal on Windows

Double-click `start.cmd` (starts hidden in the background; if it is already running it only opens the browser), `stop.cmd` stops it. The command-line equivalent is `pnpm start`.

Forgot the password:

```powershell
powershell -File tools\pinboard.ps1 stop
node --import tsx server/index.ts --reset-password
powershell -File tools\pinboard.ps1 start
```

---

## Environment variables

Configuration goes in environment variables, or in a **`.env` at the project root** — `pnpm start` / `pnpm start:dist` read it automatically with
`node --env-file-if-exists=.env` (in a container use compose's `environment` / `env_file`).
The repo ships an `.env.example`; copy it to `.env` and edit. `.env` is in `.gitignore` and never enters version control.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `7788` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on; `0.0.0.0` in a container |
| `PINBOARD_DATA` | `<app dir>/data` | Data directory; `/data` in a container |
| `PINBOARD_PASSWORD` | — | Sets the password on first start, skipping `/setup` |
| `PINBOARD_SECRET` | auto-generated into `data/secret.key` | Master key for encryption at rest (32 bytes base64) |
| `PUBLIC_URL` | the request origin | Builds the absolute links for "Hook up this machine" |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so `X-Forwarded-*` is read (the client IP is the last entry of `X-Forwarded-For`) |
| `BACKUP` | on | `0` / `off` / `false` turns off the daily 03:00 backup |
| `BACKUP_HOUR` / `BACKUP_KEEP` / `BACKUP_DIR` | `3` / `14` / `<data>/backups` | Hour and copy count of the scheduled backup |
| `KUMA_URL` / `KUMA_SLUG` / `KUMA_USER` / `KUMA_PASS` | `http://127.0.0.1:3001` / `obs` / `admin` / read from `data/kuma-pass.txt` | Data source for the monitors page (`KUMA_SLUG` = the Kuma status page slug) |
| `KUMA_DB` / `KUMA_DIR` | `<KUMA_DIR>/data/kuma.db` / `<parent dir>/kuma` | The Kuma database the day's heartbeats are exported from during backup, and the checkout it lives in |
| `METRICS_INSTALL_URL` | derived from `PUBLIC_URL` | Where the host-metrics install command is hosted |
| `KUMA_FLAVOR` | auto-detected | Force `fork` / `upstream` for whether Kuma is the modified build (detection uses the `policyJson` field) |
| `PINBOARD_METRICS_BASE` / `PINBOARD_MAIL_PROXY` | from `data/metrics.json` / empty | Fallbacks for the metrics pull base and the mail proxy (normally set in the UI) |
| `MONITOR_ACTIONS` / `MONITOR_LINKS` / `MONITOR_QUICK` / `HOST_SERVICES` / `KUMA_CLI` | see the code | Monitor recipes / jump links / quick links / service mapping |
| `SERVICES_FILE` | `<data dir>/services.json` | Deployment map for the services page (`servers` / `services` / `deploys` / `monitors`), re-read on every request; without the file the page is empty |

---

## Does the monitors page need Uptime Kuma

Yes. The monitors page does not probe anything itself; it reads Uptime Kuma's JSON API:

- Local use: that fork under `kuma/` runs on 3001 and works by default.
- Another machine: set `KUMA_URL` (protocol and port included, e.g. `http://192.168.1.10:3001`), `KUMA_USER` and `KUMA_PASS`.
- **With nothing connected the page is not blank**: it shows a three-step setup guide (start Kuma → create a status page with the slug `obs` → fill in `KUMA_URL` / `KUMA_SLUG` / `KUMA_PASS`),
  and says the other seven pages work as usual. Detection goes through `GET /api/monitors/meta`: either the environment variables are set explicitly, or a public status page is readable at the default address — both count as connected.
- Connected but unreachable shows a connection failure (not the setup guide); the other seven pages (notes / mail / assets / hosts / services / backup / settings) are unaffected.
- Stock upstream Kuma connects too: detected automatically from whether a monitor has `policyJson`, and on upstream the detail drawer does not show "check now"; to force it, set `KUMA_FLAVOR=auto|fork|upstream`.
- The heartbeat CSV in a backup pack comes from the `kuma.db` that `KUMA_DB` points at; a wrong path only loses the "day's heartbeats" item, the backup itself is still made.

---

## Acceptance checklist (walk it once after deploying)

1. `curl -s http://127.0.0.1:7788/api/health` → `{"ok":true,"id":"…"}`
2. Open the home page in a browser → redirect to `/setup` → set a password → all eight pages are reachable
3. Write a note → still there after a refresh; still there after restarting the container / process
4. Settings page → the device list shows the current device; after "log out" you have to log in again
5. Backup page → "Back up now" → a `pinfolio-*.tar.gz` appears; click "content list" to see the members and their sha256
6. (Optional) connect a phone to the same network → open the reverse-proxied https address → all eight pages work, with a tab bar at the bottom
