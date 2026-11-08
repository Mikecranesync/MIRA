#!/data/data/com.termux/files/usr/bin/bash
# hubctl.sh start|stop|restart|status — the MIRA Hub on the tablet (Termux).
# ~/hub is a symlink to the active release (~/mira-edge/releases/<sha12>); settings in ~/hub.env.
# stop kills every node process (the Hub is the only node app here): a pid file alone once
# left an old Hub holding :3000 while the new one died on EADDRINUSE (2026-11-07).
nodes() { ps -A -o pid=,comm= | awk '$2=="node"{print $1}'; }
pg_up() {
  pg_ctl -D ~/pgdata status >/dev/null 2>&1 ||
    pg_ctl -D ~/pgdata -l ~/pg.log -o "-p 5433 -k $PREFIX/tmp" -w start >/dev/null
}
case "$1" in
  stop)
    for p in $(nodes); do kill "$p"; done
    sleep 2
    for p in $(nodes); do kill -9 "$p" 2>/dev/null; done
    rm -f ~/hub.pid
    ;;
  start)
    [ -n "$(nodes)" ] && { echo "already running: $(nodes)"; exit 1; }
    pg_up || { echo "postgres did not start; see ~/pg.log"; exit 1; }
    # Background only node itself, with every fd redirected: backgrounding the whole
    # `cd && . && node` list forks a subshell that keeps the caller's (ssh's) stdout open,
    # so install.sh never returned, and $! named that subshell instead of node.
    cd ~/hub || exit 1
    # shellcheck source=/dev/null
    . ~/hub.env
    setsid nohup node server.js > ~/hub.log 2>&1 < /dev/null &
    echo $! > ~/hub.pid
    ;;
  restart) "$0" stop; "$0" start ;;
  status)
    echo "release: $(readlink ~/hub 2>/dev/null || echo "$HOME/hub (not a symlink)")  sha: $(head -1 ~/hub/BUILD_SHA 2>/dev/null)"
    echo "node pids: $(nodes | tr '\n' ' ')"
    curl -s -L -o /dev/null -w "sign-in page %{http_code}\n" http://127.0.0.1:3000/login
    ;;
  *) echo "usage: $0 start|stop|restart|status"; exit 2 ;;
esac
