#!/bin/sh
# PID 1 of the app container. Before this, PID 1 was
# `sh -c "nginx && pnpm run pm2"`: a shell as PID 1 with no handler for
# SIGTERM ignores it, so `docker stop` (deploy, instance replaced) waited out
# its grace and SIGKILLed everything, the Temporal worker mid-activity
# included. This one traps the signal and has pm2 stop the apps: SIGINT to
# each process tree, SIGKILL only after that app's --kill-timeout
# (apps/*/package.json). The container's stop grace period on the host must
# outlast the longest of them.

stop() {
  trap - TERM INT
  echo "[start.sh] $1: stopping the apps"
  pm2 stop all > /dev/null 2>&1
  nginx -s quit 2> /dev/null
  kill "$logs" 2> /dev/null
  echo "[start.sh] apps stopped"
  exit 0
}
trap 'stop SIGTERM' TERM
trap 'stop SIGINT' INT

nginx || exit 1
pnpm run pm2-start || exit 1
# Every app's output on the container's stdout, as before (docker logs,
# Alloy). In the background, so the shell is free to take the signal.
pm2 logs &
logs=$!
wait "$logs"
