# pinfolio — features in detail

The full behaviour of the two busiest pages. For a quick overview see the [README](../README.md).

## Monitors
- The data source is a **local Uptime Kuma** (default `http://127.0.0.1:3001`, status page slug `obs`). Kuma is only the probing backend; the UI lives here.
- **Kuma's own `http://127.0.0.1:3001/status/obs` was retired on 2026-10-19** (it returns 404) — this page is the only UI. Kuma's `/api/status-page/obs` and `/api/status-page/heartbeat/obs` JSON endpoints are kept and are what this page reads.
- Everything fits on one screen: 4 columns (6 on screens ≥1700px wide), grouped by machine (12 monitors used to be two rows at 2560×1440 and three rows at 1600×900; as of 2026-10-20 there are 15 monitors in 5 groups, so a few more rows).
- Each card: name + machine + type, a bar of the **last 40 heartbeats** (green up / red down / yellow pending / grey maintenance), response time in ms, time of the last check, 24h uptime and the number of incidents in the window. **Hover any segment** to see that single beat: exact time (to the second), status, relative time, response time, `beat i/N` and the heartbeat message. The hovered segment grows slightly and pushes its neighbours aside; it eases back when the mouse leaves.
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

## Mail (read-only merged inbox)
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
