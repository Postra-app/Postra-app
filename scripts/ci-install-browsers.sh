#!/usr/bin/env bash
# CI only (GitHub's Ubuntu runner): installs the Playwright browsers named on
# the command line, their system packages, and ffmpeg (the app image has it;
# the stack makes video poster frames with it).
#
#   bash scripts/ci-install-browsers.sh chromium webkit
#
# The browsers come from Playwright's download host; their packages and
# ffmpeg come from the Ubuntu mirror through apt. A slow mirror (139 MB at
# 90 kB/s) once made one unbounded `playwright install --with-deps` take 25
# of the job's 30 minutes, and the job was cancelled before a single test
# ran. So every apt step is bounded (APT_MINUTES each, 5 by default) and
# tried twice, the second time on Ubuntu's primary mirror; when both fail the
# job stops in minutes and says why.
set -euo pipefail

[ $# -gt 0 ] || { echo "usage: ci-install-browsers.sh <browser>..." >&2; exit 2; }
APT_SECONDS=$(( ${APT_MINUTES:-5} * 60 ))

# timeout signals its whole process group, sudo passes the signal on to apt.
timeout -k 20 600 pnpm exec playwright install "$@"

apt_packages() {
  timeout -k 20 "$APT_SECONDS" pnpm exec playwright install-deps "$@" &&
    timeout -k 20 "$APT_SECONDS" sudo apt-get install -y -qq --no-install-recommends ffmpeg
}

# An apt run cut off by the timeout can leave its lock and a half-configured
# package behind.
apt_recover() {
  sudo pkill -x apt-get || true
  sudo dpkg --configure -a || true
}

use_primary_mirror() {
  for f in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list; do
    [ -f "$f" ] && sudo sed -i -E 's#https?://[a-z0-9.-]*archive\.ubuntu\.com/ubuntu#http://archive.ubuntu.com/ubuntu#g' "$f"
  done
}

if apt_packages "$@"; then
  exit 0
fi
echo "::warning::apt did not finish within ${APT_SECONDS}s; trying again on archive.ubuntu.com"
apt_recover
use_primary_mirror
if apt_packages "$@"; then
  exit 0
fi
echo "::error::apt did not finish twice (${APT_SECONDS}s each): the Ubuntu mirrors are too slow or down. Re-run the failed jobs."
exit 1
