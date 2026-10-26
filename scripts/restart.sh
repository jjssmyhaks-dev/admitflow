#!/usr/bin/env bash
# Restart helper: kill the actual LISTENING process on a port (TIME_WAIT
# sockets are ignored — they don't block bind with reuse).
PORT="${1:-3100}"
PIDS=$(netstat -ano | grep ":$PORT" | grep LISTENING | awk '{print $NF}' | sort -u)
for pid in $PIDS; do
  echo "killing listener $pid"
  taskkill //PID "$pid" //F >/dev/null 2>&1 || true
done
sleep 1
if netstat -ano | grep ":$PORT" | grep -q LISTENING; then
  echo "port $PORT still has a listener"
  exit 1
fi
echo "port $PORT free"
