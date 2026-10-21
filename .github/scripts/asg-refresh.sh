#!/usr/bin/env bash
# Rolls the app's auto scaling group onto the image named in SSM: starts an
# instance refresh and waits for it. A new instance boots with the image
# (Postra-infra modules/app_asg userdata reads APP_IMAGE), joins the load
# balancer, and the old one goes once the new one is healthy. The refresh
# itself cannot roll back an image change (the launch template did not
# change), so the caller does that: previous image back into SSM, refresh
# again.
#
#   asg-refresh.sh <group name> [minutes to wait, default 25]
#
# Exit 0 only on Status=Successful. One refresh runs at a time: a superseded
# deploy that is still rolling is cancelled first (cancel-in-progress stops
# the workflow, not the refresh it started).
set -euo pipefail

ASG="${1:?auto scaling group name}"
WAIT_MINUTES="${2:-25}"

active_refresh() {
  aws autoscaling describe-instance-refreshes \
    --auto-scaling-group-name "$ASG" --max-records 10 \
    --query "InstanceRefreshes[?Status=='Pending' || Status=='InProgress' || Status=='Cancelling' || Status=='RollbackInProgress'].InstanceRefreshId | [0]" \
    --output text
}

status_of() {
  aws autoscaling describe-instance-refreshes \
    --auto-scaling-group-name "$ASG" --instance-refresh-ids "$1" \
    --query 'InstanceRefreshes[0].[Status,PercentageComplete,StatusReason]' \
    --output text
}

ACTIVE=$(active_refresh)
if [ -n "$ACTIVE" ] && [ "$ACTIVE" != "None" ]; then
  echo "Refresh ${ACTIVE} is still running - cancelling it first"
  aws autoscaling cancel-instance-refresh --auto-scaling-group-name "$ASG" >/dev/null || true
  for _ in $(seq 1 30); do
    case "$(status_of "$ACTIVE")" in
      Cancelled*|Successful*|Failed*|RollbackSuccessful*|RollbackFailed*) break ;;
    esac
    sleep 10
  done
fi

REFRESH_ID=$(aws autoscaling start-instance-refresh \
  --auto-scaling-group-name "$ASG" \
  --preferences '{"MinHealthyPercentage": 100, "MaxHealthyPercentage": 200, "SkipMatching": false, "InstanceWarmup": 120}' \
  --query InstanceRefreshId --output text)
echo "Instance refresh ${REFRESH_ID} started on ${ASG}"

for attempt in $(seq 1 $((WAIT_MINUTES * 6))); do
  STATUS=$(status_of "$REFRESH_ID")
  echo "Attempt ${attempt}: ${STATUS}"
  case "$STATUS" in
    Successful*) exit 0 ;;
    Failed*|Cancelled*|RollbackSuccessful*|RollbackFailed*)
      echo "Instance refresh ${REFRESH_ID} ended with: ${STATUS}"
      exit 1 ;;
  esac
  sleep 10
done

echo "Instance refresh ${REFRESH_ID} did not finish in ${WAIT_MINUTES} minutes"
exit 1
