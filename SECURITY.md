# Security policy

## Supported versions

pinfolio is pre-1.0. Only the newest `0.x` release gets fixes; there are no backports to older tags.
Running from `master` or `arch` means you get whatever is there today.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting:

<https://github.com/528085390/pinfolio/security/advisories/new>

(Repository → Security → Advisories → *Report a vulnerability*.) Please include:

- the version, commit or image tag you run;
- how it is deployed (Docker Compose, bare metal, reverse proxy, `TRUST_PROXY`);
- what an attacker gains, and the steps to reproduce;
- any relevant log lines, with secrets removed.

You can expect an acknowledgement within about a week. This is a hobby project maintained in spare time,
so there is no bounty and no formal SLA — but reports are taken seriously and credited unless you ask
otherwise.

## What is in scope

- Authentication bypass: reading or writing `/api/*` without a valid session cookie or API token.
- Session or token handling: cookie flags, fixation, tokens that survive a password change, tokens stored
  in clear text.
- Secret handling: anything that lets a remote attacker recover `data/secret.key`, mailbox passwords, the
  Kuma password or the metrics token.
- Injection through the API (SQL, path traversal in backup download/restore, SSRF in the tunnel checker).
- XSS in mail rendering or in note/asset content (the reader sanitises HTML inside a Shadow DOM).

## What is out of scope

- **No built-in TLS.** TLS belongs to the reverse proxy in front (`docs/deploy.md`). Serving pinfolio on a
  public IP over plain HTTP is a misconfiguration, not a vulnerability.
- **Encryption at rest protects files, not a running process.** AES-256-GCM with the key in
  `data/secret.key` stops a leaked backup or database file from exposing credentials. If an attacker can
  execute code as the pinfolio user, they can read everything the app can read.
- **Single-user by design.** Anyone who can log in is the owner; there is no per-device or per-page
  permission model to bypass.
- Denial of service from an authenticated user, brute force beyond the built-in limiter (5 failures per IP
  per 15 minutes with exponential backoff), and issues that require a compromised host.
- Vulnerabilities in Uptime Kuma, your IMAP provider, MySQL or PostgreSQL themselves.

## Hardening checklist for self-hosters

1. Put it behind HTTPS (Caddy or nginx) and keep `127.0.0.1:7788` bound to loopback unless the proxy is on
   the same host; set `TRUST_PROXY=1` only when a proxy really is in front.
2. Set a strong password at `/setup`, then add an API token instead of reusing the password in scripts.
3. Back up `data/` **and** `data/secret.key`; keep the key out of the same place as the backup if you can
   (see `docs/backup-restore.md`).
4. Keep the image or checkout up to date; `docker compose pull && docker compose up -d` is the whole
   upgrade (see `docs/upgrade.md`).
