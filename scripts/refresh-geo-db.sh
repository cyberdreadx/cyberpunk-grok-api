#!/usr/bin/env bash
#
# Refresh the DB-IP City Lite database used for legal geo-blocking.
#
# DB-IP publishes monthly. An IP database that stops being updated silently
# stops matching reassigned ranges, so this is not optional maintenance — it is
# the difference between a compliance measure that works and one that only
# looked like it did.
#
# Never clobbers a working database: the download is validated by a real lookup
# before it replaces anything, and a failed run leaves the current file alone.
# api/_lib/geo.ts watches the file's mtime, so the swap takes effect on its own
# without restarting the API.
#
# Installed as a systemd timer — see scripts/geo-db-refresh.timer.

set -euo pipefail

REPO="/home/neon/cyberpunk-grok-api"
DEST="$REPO/data/dbip-city-lite.mmdb"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log() { echo "[geo-refresh] $*"; }

# DB-IP publishes on the 1st, but not always at 00:00 — fall back a month so a
# run on the 1st doesn't fail on a file that isn't up yet.
for OFFSET in 0 1; do
  MONTH="$(date -d "-${OFFSET} month" +%Y-%m)"
  URL="https://download.db-ip.com/free/dbip-city-lite-${MONTH}.mmdb.gz"
  log "trying ${MONTH}"
  if curl -sfL --max-time 600 -o "$TMP/db.mmdb.gz" "$URL"; then
    log "downloaded ${MONTH} ($(stat -c%s "$TMP/db.mmdb.gz") bytes)"
    break
  fi
  log "not available: ${MONTH}"
  [ "$OFFSET" = "1" ] && { log "FAILED — no database available, keeping existing"; exit 1; }
done

gunzip -c "$TMP/db.mmdb.gz" > "$TMP/db.mmdb"

SIZE=$(stat -c%s "$TMP/db.mmdb")
# A truncated or error-page download would otherwise pass gunzip and then break
# every lookup silently, which is the exact failure this whole script exists to
# prevent.
if [ "$SIZE" -lt 50000000 ]; then
  log "FAILED — decompressed file is only ${SIZE} bytes, keeping existing"
  exit 1
fi

# Prove it actually resolves the region we block on before trusting it.
cd "$REPO"
VERIFY=$(node --input-type=module -e "
import { readFileSync } from 'fs';
import maxmind from 'maxmind';
const r = new maxmind.Reader(readFileSync('$TMP/db.mmdb'));
const rec = r.get('128.101.101.101');
const sub = rec?.subdivisions?.[0];
const name = String(sub?.names?.en || sub?.iso_code || '');
process.stdout.write(name);
" 2>/dev/null || true)

if [ "$VERIFY" != "Minnesota" ]; then
  log "FAILED — verification lookup returned '${VERIFY}', expected 'Minnesota'. Keeping existing."
  exit 1
fi
log "verified: Minneapolis IP resolves to Minnesota"

# Atomic: a reader opening mid-swap gets one file or the other, never a partial.
mv -f "$TMP/db.mmdb" "$DEST.new"
mv -f "$DEST.new" "$DEST"
log "installed ${MONTH} → ${DEST} (${SIZE} bytes)"
log "api picks it up within 10 minutes via mtime; no restart needed"
