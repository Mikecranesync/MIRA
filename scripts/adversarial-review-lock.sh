#!/usr/bin/env bash
# Shared, re-entrant, per-worktree lock for adversarial review/remediation.
# Callers must set ROOT to the repository root before sourcing this file.

adversarial_review_lock_release() {
  if [ "${ADV_REVIEW_LOCK_OWNED:-0}" != "1" ]; then
    return
  fi
  # Remove only the owner record that still carries this process's token. A
  # missing or replaced owner is left for explicit human recovery.
  node -e '
    const fs=require("node:fs");
    const [owner,token]=process.argv.slice(1);
    let fd;
    try { fd=fs.openSync(owner,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW); }
    catch { process.exit(1); }
    try {
      const st=fs.fstatSync(fd);
      if(!st.isFile() || fs.readFileSync(fd,"utf8")!==token+"\n") process.exit(1);
    } finally { fs.closeSync(fd); }
    fs.unlinkSync(owner);
  ' "$ADV_REVIEW_LOCK_DIR/owner" "$ADV_REVIEW_LOCK_TOKEN" 2>/dev/null || return
  rmdir "$ADV_REVIEW_LOCK_DIR" 2>/dev/null || true
}

adversarial_review_lock_acquire() {
  ADV_REVIEW_LOCK_DIR="$(git rev-parse --git-path adversarial-review.lock)" || {
    echo "ERROR: could not resolve the per-worktree adversarial review lock path." >&2
    return 2
  }
  export ADV_REVIEW_LOCK_DIR

  if [ -n "${ADV_REVIEW_LOCK_TOKEN:-}" ]; then
    if ! [[ "$ADV_REVIEW_LOCK_TOKEN" =~ ^[0-9a-f]{32}$ ]]; then
      echo "ERROR: malformed adversarial review lock ownership token." >&2
      return 2
    fi
    if ! node -e '
      const fs=require("node:fs");
      const [owner,token]=process.argv.slice(1);
      let fd;
      try {
        fd=fs.openSync(owner,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
      } catch { process.exit(1); }
      try {
        const st=fs.fstatSync(fd);
        if(!st.isFile() || (st.mode & 0o777)!==0o600) process.exit(1);
        if(fs.readFileSync(fd,"utf8")!==token+"\n") process.exit(1);
      } finally { fs.closeSync(fd); }
    ' "$ADV_REVIEW_LOCK_DIR/owner" "$ADV_REVIEW_LOCK_TOKEN"; then
      echo "ERROR: missing, malformed, or mismatched adversarial review worktree lock owner state." >&2
      return 2
    fi
    ADV_REVIEW_LOCK_OWNED=0
    export ADV_REVIEW_LOCK_OWNED
    return 0
  fi

  ADV_REVIEW_LOCK_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')" || {
    echo "ERROR: could not generate adversarial review lock ownership token." >&2
    return 2
  }
  if ! mkdir -m 700 "$ADV_REVIEW_LOCK_DIR" 2>/dev/null; then
    echo "ERROR: this worktree already has an active adversarial review/remediation lock:" >&2
    echo "       $ADV_REVIEW_LOCK_DIR" >&2
    return 2
  fi
  if ! node -e '
    const fs=require("node:fs");
    const [owner,token]=process.argv.slice(1);
    const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW;
    const fd=fs.openSync(owner,flags,0o600);
    try {
      fs.writeFileSync(fd,token+"\n","utf8");
      fs.fchmodSync(fd,0o600);
    } finally { fs.closeSync(fd); }
  ' "$ADV_REVIEW_LOCK_DIR/owner" "$ADV_REVIEW_LOCK_TOKEN"; then
    rmdir "$ADV_REVIEW_LOCK_DIR" 2>/dev/null || true
    echo "ERROR: could not publish adversarial review worktree lock owner state." >&2
    return 2
  fi
  ADV_REVIEW_LOCK_OWNED=1
  export ADV_REVIEW_LOCK_TOKEN ADV_REVIEW_LOCK_OWNED
  # Invoked indirectly on shell exit.
  # shellcheck disable=SC2064
  trap 'adversarial_review_lock_release' EXIT
}
