#!/bin/bash

API_KEY="<METERED_API_KEY>"
BODY="[]"

# Attempt to fetch the data using curl
RESPONSE=$(curl -s -f -H "Content-Type: application/json" "https://mla2.metered.live/api/v1/turn/credentials?apiKey=${API_KEY}")

# Check if curl was successful
if [ $? -eq 0 ]; then
    BODY="$RESPONSE"
fi

echo "$BODY"
