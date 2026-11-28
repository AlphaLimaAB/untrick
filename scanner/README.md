# Untrick instant-check scanner

A small HTTP service that opens a shop's home page in headless Chromium and runs automatic
checks: UT-01, UT-10, UT-12, UT-13, UT-14, UT-17, UT-21 (tracking before consent), and UT-20
(chat widget) and UT-22 (ODR link) when found. It runs on
Anton's Raspberry Pi in Docker and is public at `https://betting-pi.tail689e03.ts.net/scan`
through Tailscale Funnel.

| Endpoint | What it does |
| --- | --- |
| `POST /scan` `{"url": "dinbutik.se"}` | Queues a scan, returns `{id}`. Only from untrick.eu (CORS), 10 per IP per hour. |
| `GET /scan/<id>?email=…` | Status; checks and score only when the email's domain matches the site. |
| `GET /scan/health` | Queue status. |

## Safety

- Blocks private, loopback, link-local, CGNAT/Tailscale and multicast addresses, both for the
  start URL and for every request the browser makes.
- `untrick-scanner-firewall` adds host firewall rules so the container cannot reach the home
  network, the Tailscale network or the Pi's own services, whatever the code does.
- Runs as a non-root user, read-only file system, no capabilities, one scan at a time, hard
  timeouts. Instant checks are forgotten after two hours; nothing personal is stored.

## Customer mode (monitoring for paying customers)

When `/srv/untrick-scanner/data` is mounted at `/data`, the scanner also keeps customer sites:

- **Scheduled scans.** Active sites are scanned every 7 days by default, at night (01:00–06:59
  Stockholm time, `SCAN_HOURS`). Instant checks from the website always go first.
- **Evidence.** Every scheduled scan saves `first-screen.png`, `full-page.jpg` and `result.json`
  (with SHA-256 hashes) in `data/evidence/<site>/<date>_<scan>/`. The database stores the hash of
  `result.json`, so a later change to the evidence can be detected.
- **Findings register.** One row per site, rule and place. The automatic checks update it:
  - a problem seen for the first time is **New**; seen again, **Open**;
  - a pass marks **New/Open/Reopened** findings **Fixed**;
  - a problem on a **Fixed** finding makes it **Reopened**;
  - an unknown result never changes a status;
  - **Accepted risk** is only set by hand and stays until the problem is gone.
  Manual results (checkout, terms, product pages) go in with `record` and follow the same rules.
- **Deeper scheduled scans.** Each scheduled scan also opens up to 5 product pages (product safety
  details, UT-19, and prices) and up to 4 terms pages (terms, returns, privacy, delivery).
- **Price history.** Every night the tracked product pages (up to 20 per site) are read again. With
  20+ days of our own history, a reduced price whose reference is above the lowest price we recorded
  in the 30 days before is a UT-03 finding, with a dated screenshot.
- **Terms change log.** Terms pages are kept as dated text; a change shows in `alerts` and `summary`.
- **Campaign mode.** Campaign words or many reduced prices on the front page mean daily scans for
  7 days; Singles Day, Black Week and Christmas to New Year are always daily.
- **No HTTP endpoints.** It is managed on the Pi with `docker exec`, so nothing new is exposed.

```bash
alias ut='docker exec untrick-scanner node admin.mjs'
ut add dinbutik.se --company "Din Butik AB"     # baseline scan within a minute
ut set dinbutik-se status Active                # weekly scans from now on
ut record dinbutik-se UT-02 Checkout fail --severity High --saw "Insurance pre-ticked"
ut finding dinbutik-se UT-14 "Front page" status "Accepted risk"
ut alerts 7                                     # new, reopened, fixed, terms changed, campaigns, failing
ut prices dinbutik-se                           # our price history
ut pages dinbutik-se                            # terms pages we keep copies of
ut set dinbutik-se markets SE,NO                # markets for the monthly enforcement watch
ut summary dinbutik-se 2026-12                  # Markdown for the monthly report
ut register dinbutik-se --tsv                   # paste into the tracker's Register sheet
```

**Backup.** `ut backup` writes a consistent copy of the database to `data/backup/` (the last 30 are kept).
On Anton's Mac, `mac-backup/untrick-backup.sh` runs every day at 12:15 (or when the Mac wakes) from the
LaunchAgent `eu.untrick.backup`. It makes that copy and pulls `data/` to iCloud Drive, in
`Business/Untrick/Scanner backup`. Nothing is deleted in iCloud. Log: `~/Library/Logs/untrick-backup.log`.

## Deploy or update (on the Pi)

```bash
curl -fsSL https://codeload.github.com/AlphaLimaAB/untrick/tar.gz/main | tar xz --strip-components=2 -C ~/untrick-scanner untrick-main/scanner
cd ~/untrick-scanner && sudo sh install.sh
sudo tailscale funnel --bg --set-path=/scan http://127.0.0.1:8090   # first install only
```
