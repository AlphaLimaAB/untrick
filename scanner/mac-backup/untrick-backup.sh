#!/bin/zsh
# Daily copy of the Untrick scanner data (database snapshot and evidence) from the Pi to iCloud Drive.
# Runs on Anton's Mac from ~/Library/LaunchAgents/eu.untrick.backup.plist. Log: ~/Library/Logs/untrick-backup.log
set -eu
PI=anton@100.108.227.68
DEST="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Business/Untrick/Scanner backup"
LOG="$HOME/Library/Logs/untrick-backup.log"
mkdir -p "$DEST"
{
  echo "$(date '+%F %T') start"
  ssh -o BatchMode=yes -o ConnectTimeout=30 "$PI" 'docker exec untrick-scanner node admin.mjs backup'
  # The live database is skipped (the snapshot in backup/ is the consistent copy). Nothing is deleted in iCloud.
  rsync -a --exclude 'untrick.sqlite' --exclude 'untrick.sqlite-*' -e 'ssh -o BatchMode=yes -o ConnectTimeout=30' "$PI:/srv/untrick-scanner/data/" "$DEST/"
  echo "$(date '+%F %T') done"
} >> "$LOG" 2>&1
