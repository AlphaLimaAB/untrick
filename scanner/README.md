# Untrick instant-check scanner

A small HTTP service that opens a shop's home page in headless Chromium and runs six
automatic checks (UT-01, UT-10, UT-12, UT-13, UT-14, UT-17 in the checklist). It runs on
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
  timeouts. Scans are forgotten after two hours; nothing personal is stored.

## Deploy (on the Pi)

```bash
sudo mkdir -p /opt/untrick-scanner && sudo cp -r scanner/* /opt/untrick-scanner/
sudo install -m 755 /opt/untrick-scanner/untrick-scanner-firewall /usr/local/sbin/
sudo install -m 644 /opt/untrick-scanner/untrick-scanner.service /etc/systemd/system/
sudo docker build -t untrick-scanner:1 /opt/untrick-scanner
sudo systemctl daemon-reload && sudo systemctl enable --now untrick-scanner
sudo tailscale funnel --bg --set-path=/scan http://127.0.0.1:8090
```
