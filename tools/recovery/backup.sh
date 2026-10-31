#!/usr/bin/env bash
# Back up (or restore-test) the recovery host's LOCAL state for #3800.
#
# The system of record is Neon (Postgres, its own PITR/branching). The only
# local state the minimum stack carries is:
#   - docker volume mira-hub-upload-buffers   (upload retry buffers, transient)
#   - /opt/mira/data                          (empty unless extra services are added)
#   - nginx vhosts + Let's Encrypt material   (rebuildable, but cheap to keep)
#
#   bash tools/recovery/backup.sh backup            -> /var/backups/mira/<utc>.tar.gz
#   bash tools/recovery/backup.sh restore-test <f>  -> extracts into a temp dir and lists it
#   bash tools/recovery/backup.sh restore <f>       -> restores volume + dirs (asks first)
#
# Off-host copy: set BACKUP_SCP_TARGET=user@host:/path to also scp the archive.
set -euo pipefail

MODE="${1:-backup}"
DEST_DIR="${BACKUP_DIR:-/var/backups/mira}"
# Compose prefixes named volumes with the project name (`mira_…` on the
# recovery host, `<dir>_…` elsewhere); resolve it unless BACKUP_VOLUME is set.
VOL="${BACKUP_VOLUME:-$(docker volume ls -q 2>/dev/null | grep -m1 'mira-hub-upload-buffers$' || true)}"
VOL="${VOL:-mira-hub-upload-buffers}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

vol_exists() { docker volume inspect "$VOL" >/dev/null 2>&1; }
# sha256sum on Linux hosts; shasum on a macOS operator box running the test.
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

case "$MODE" in
  backup)
    install -d "$DEST_DIR"
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT
    if vol_exists; then
      # Stream the archive out of the helper container: works even where the
      # host temp dir is not bind-mountable (Colima/Docker Desktop).
      docker run --rm -v "$VOL":/v:ro alpine:3.20 tar -C /v -czf - . > "$WORK/volume.tar.gz"
    fi
    if [ -d /opt/mira/data ]; then tar -C /opt/mira -czf "$WORK/data.tar.gz" data; fi
    if [ -d /etc/nginx/sites-enabled ]; then tar -czf "$WORK/nginx.tar.gz" /etc/nginx/sites-enabled /etc/letsencrypt 2>/dev/null || true; fi
    if ! ls "$WORK"/*.tar.gz >/dev/null 2>&1; then echo "nothing to back up (no volume, no data dir)" >&2; exit 1; fi
    (cd "$WORK" && sha ./*.tar.gz > SHA256SUMS)
    OUT="$DEST_DIR/mira-recovery-$STAMP.tar.gz"
    tar -C "$WORK" -czf "$OUT" .
    echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
    if [ -n "${BACKUP_SCP_TARGET:-}" ]; then
      scp -o StrictHostKeyChecking=yes "$OUT" "$BACKUP_SCP_TARGET/"
      echo "copied to $BACKUP_SCP_TARGET"
    fi
    ;;
  restore-test)
    F="${2:?archive path}"
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT
    tar -C "$WORK" -xzf "$F"
    (cd "$WORK" && sha -c SHA256SUMS)
    echo "archive verified; contents:"
    for t in "$WORK"/*.tar.gz; do echo "== $(basename "$t")"; tar -tzf "$t" | head -20; done
    ;;
  restore)
    F="${2:?archive path}"
    echo "This will overwrite volume $VOL and /opt/mira/data from $F. Type RESTORE to continue:"
    read -r ans; [ "$ans" = "RESTORE" ] || { echo "aborted"; exit 1; }
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT
    tar -C "$WORK" -xzf "$F"
    (cd "$WORK" && sha -c SHA256SUMS)
    if [ -f "$WORK/volume.tar.gz" ]; then
      docker volume create "$VOL" >/dev/null
      docker run --rm -v "$VOL":/v -v "$WORK":/in:ro alpine:3.20 sh -c 'rm -rf /v/* && tar -C /v -xzf /in/volume.tar.gz'
    fi
    [ -f "$WORK/data.tar.gz" ] && tar -C /opt/mira -xzf "$WORK/data.tar.gz"
    echo "restored"
    ;;
  *) echo "usage: $0 backup | restore-test <archive> | restore <archive>" >&2; exit 2 ;;
esac
