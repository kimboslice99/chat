#!/bin/bash

TTL='{"ttl":86400}'
TURN_ID="<TURN_ID>"
TURN_KEY="<TURN_KEY>"
BODY="[]"

# Attempt to fetch the data using curl
RESPONSE=$(curl -s -f -X POST "https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_ID}/credentials/generate" \
    -H "Authorization: Bearer ${TURN_KEY}" \
    -H "Content-Type: application/json" \
    -d "$TTL")

# Validate the response
if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
    BODY=$(echo "$RESPONSE" | jq '
        .iceServers as $parent |
        $parent.urls | map({ urls: ., username: $parent.username, credential: $parent.credential })
    ')

    # If jq fails, fallback to empty JSON array
    if [ $? -ne 0 ]; then
        BODY="[]"
    fi
fi

echo "$BODY"
