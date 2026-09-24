#!/usr/bin/env bash
set -euo pipefail

: "${HOSTED_RESOURCE_GROUP:?Missing HOSTED_RESOURCE_GROUP}"
: "${HOSTED_CONTAINER_APP:?Missing HOSTED_CONTAINER_APP}"
: "${HOSTED_IMAGE:?Missing HOSTED_IMAGE}"
: "${GITHUB_SHA:?Missing GITHUB_SHA}"
: "${GITHUB_RUN_ID:?Missing GITHUB_RUN_ID}"
: "${GITHUB_RUN_ATTEMPT:?Missing GITHUB_RUN_ATTEMPT}"

state="$(az containerapp show --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" --output json)"
previous="$(jq -er '
  . as $app | .properties.configuration.ingress.traffic |
  if length == 1 and .[0].weight == 100
  then (.[0].revisionName // $app.properties.latestReadyRevisionName)
  else error("Expected one production revision; refusing to overwrite a custom traffic split.")
  end' <<< "$state")"
fqdn="$(jq -er '.properties.configuration.ingress.fqdn' <<< "$state")"
suffix="r-${GITHUB_SHA:0:12}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
candidate="${HOSTED_CONTAINER_APP}--${suffix}"
if [[ "$candidate" == "$previous" ]]; then
  echo "::error::This revision is already production; refusing a duplicate rollout." >&2
  exit 1
fi
completed=false

recover() {
  local status=$?
  if [[ "$status" -ne 0 && "$completed" == false ]]; then
    echo "::error::Hosted rollout failed; preserving the previous production revision."
    if ! az containerapp ingress traffic set --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" --revision-weight "$previous=100" --output none; then
      echo "::error::Traffic restoration failed; inspect Azure revision routing immediately." >&2
    fi
    if az containerapp revision show --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" --revision "$candidate" --output none 2>/dev/null; then
      if ! az containerapp revision deactivate --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" --revision "$candidate" --output none; then
        echo "::error::Failed candidate could not be deactivated; inspect it for continued resource usage." >&2
      fi
    fi
  fi
  exit "$status"
}
trap recover EXIT

wait_for_revision() {
  local hostname=$1
  if [[ ! "$hostname" =~ ^[a-z0-9.-]+\.azurecontainerapps\.io$ ]]; then
    echo "::error::Unexpected Container Apps hostname." >&2
    return 1
  fi
  for attempt in {1..30}; do
    if curl --fail --silent --show-error --max-time 25 "https://$hostname/readyz" |
      jq -e --arg sha "$GITHUB_SHA" '.status == "ready" and .revision == $sha' >/dev/null; then
      return 0
    fi
    sleep 5
  done
  echo "::error::The expected revision did not become ready." >&2
  return 1
}

# Pin the current revision before updating; a "latest" rule would promote too early.
az containerapp ingress traffic set --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" --revision-weight "$previous=100" --output none
az containerapp update --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" \
  --image "$HOSTED_IMAGE" --revision-suffix "$suffix" --set-env-vars "APP_REVISION=$GITHUB_SHA" --output none
candidate_fqdn="$(az containerapp revision show --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" --revision "$candidate" --query properties.fqdn --output tsv)"
wait_for_revision "$candidate_fqdn"
curl --fail --silent --show-error --max-time 25 "https://$candidate_fqdn/" |
  grep -q 'name="flowpilot-runtime" content="hosted"'

az containerapp ingress traffic set --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" --revision-weight "$candidate=100" --output none
wait_for_revision "$fqdn"
completed=true

# Existing streams may run for three minutes; drain before stopping the old replica.
# Agent turns have no deadline, so one still running at deactivation ends as interrupted.
sleep 240
if ! az containerapp revision deactivate --name "$HOSTED_CONTAINER_APP" --resource-group "$HOSTED_RESOURCE_GROUP" --revision "$previous" --output none; then
  echo "::error::The new release is live, but the previous revision still needs deactivation." >&2
  exit 1
fi
echo "Hosted production is serving $GITHUB_SHA."
