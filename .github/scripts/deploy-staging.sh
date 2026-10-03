#!/usr/bin/env bash
# Staging deploy (deploy-dev.yml, job "staging"): start the box and its
# database, put IMAGE_URI on it, wait for health, run the Playwright smoke
# against staging.postra.pl, and stop both again whatever happened — staging
# costs ~$10/month only because it is off between deploys.
set -euo pipefail

: "${AWS_REGION:?}" "${ECR_REGISTRY:?}" "${IMAGE_URI:?}"
URL=https://staging.postra.pl
DB=postra-staging-db

INSTANCE_ID=$(aws ec2 describe-instances --region "$AWS_REGION" \
  --filters "Name=tag:Name,Values=postra-staging-app" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query "Reservations[].Instances[].InstanceId" --output text | awk '{print $1}')
[ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "None" ] || { echo "No postra-staging-app instance"; exit 1; }

stop_all() {
  echo "Stopping staging"
  aws ec2 stop-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" >/dev/null || true
  aws rds stop-db-instance --region "$AWS_REGION" --db-instance-identifier "$DB" >/dev/null 2>&1 || true
}
trap stop_all EXIT

# Box and database start in parallel; the database is the slower one.
aws rds start-db-instance --region "$AWS_REGION" --db-instance-identifier "$DB" >/dev/null 2>&1 || true
aws ec2 wait instance-stopped --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" 2>/dev/null || true
aws ec2 start-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" >/dev/null
aws ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$INSTANCE_ID"
aws rds wait db-instance-available --region "$AWS_REGION" --db-instance-identifier "$DB"

for _ in $(seq 1 60); do
  PING=$(aws ssm describe-instance-information --region "$AWS_REGION" \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" --query "InstanceInformationList[0].PingStatus" --output text)
  [ "$PING" = "Online" ] && break
  sleep 5
done
[ "$PING" = "Online" ] || { echo "SSM agent on staging never came online"; exit 1; }

# The same steps as production (deploy-dev.yml "Deploy on EC2 via SSM"),
# minus the rollback bookkeeping: staging has nothing to roll back to.
COMMANDS_JSON=$(jq -nc --arg region "$AWS_REGION" --arg registry "$ECR_REGISTRY" --arg image "$IMAGE_URI" '{
  commands: [
    "set -e",
    "cd /opt/postra",
    "aws ecr get-login-password --region \($region) | docker login --username AWS --password-stdin \($registry)",
    "docker image prune -af || true",
    "docker pull \($image)",
    "aws ssm get-parameters-by-path --path /postra/staging/ --with-decryption --recursive --region \($region) --query \"Parameters[*].[Name,Value]\" --output text | while read -r n v; do echo \"${n#/postra/staging/}=$v\"; done > .env.new",
    "test -s .env.new && mv .env.new .env",
    "cat > docker-compose.override.yml <<EOF\nservices:\n  app:\n    image: \($image)\nEOF",
    "docker compose up -d --force-recreate app",
    "sleep 3 && docker exec -u root postra-app chown -R www:www /uploads || true"
  ]
}')
COMMAND_ID=$(aws ssm send-command --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment "Deploy ${GITHUB_SHA:-?} to staging" \
  --parameters "$COMMANDS_JSON" --query Command.CommandId --output text)

for _ in $(seq 1 120); do
  STATUS=$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || true)
  case "$STATUS" in
    Success) break ;;
    Failed|Cancelled|TimedOut|Cancelling)
      aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --output json
      exit 1 ;;
  esac
  sleep 10
done
[ "$STATUS" = "Success" ] || { echo "Staging deploy command did not finish"; exit 1; }

# A fresh start of a stopped box boots everything at once: allow 15 minutes.
for attempt in $(seq 1 90); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL/api/monitor/queue/main" || true)
  [ "$CODE" = "200" ] && break
  echo "Staging health attempt $attempt: $CODE"
  sleep 10
done
[ "$CODE" = "200" ] || { echo "Staging never turned healthy"; exit 1; }

if [ -z "${E2E_EMAIL:-}" ] || [ -z "${E2E_PASSWORD:-}" ]; then
  echo "::warning::STAGING_E2E_EMAIL / STAGING_E2E_PASSWORD not set — staging checked by health only"
  exit 0
fi
npm install --prefix e2e/playwright --no-save --no-package-lock @playwright/test@1.58.2
e2e/playwright/node_modules/.bin/playwright install --with-deps chromium
E2E_BASE_URL="$URL" e2e/playwright/node_modules/.bin/playwright test -c e2e/playwright --project smoke
