#!/bin/sh
# Install or update the Untrick scanner on the Pi. Run from this folder: sudo sh install.sh
set -eu
[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo sh install.sh"; exit 1; }
cd "$(dirname "$0")"
OWNER_GROUP=$(id -gn "${SUDO_USER:-anton}")

# Customer data (database and evidence). Written by the container user (uid 1001), readable by you.
install -d -o 1001 -g "$OWNER_GROUP" -m 2775 /srv/untrick-scanner /srv/untrick-scanner/data
chown 1001:"$OWNER_GROUP" /srv/untrick-scanner/data && chmod 2775 /srv/untrick-scanner/data

mkdir -p /opt/untrick-scanner
cp Dockerfile package.json package-lock.json server.mjs store.mjs admin.mjs README.md /opt/untrick-scanner/
install -m 755 untrick-scanner-firewall /usr/local/sbin/untrick-scanner-firewall
install -m 644 untrick-scanner.service /etc/systemd/system/untrick-scanner.service
docker build -q -t untrick-scanner:1 /opt/untrick-scanner
systemctl daemon-reload
systemctl enable untrick-scanner >/dev/null 2>&1
systemctl restart untrick-scanner

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8090/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:8090/health && echo
docker logs --tail 2 untrick-scanner
echo "Done. Customer mode: docker exec untrick-scanner node admin.mjs help"
