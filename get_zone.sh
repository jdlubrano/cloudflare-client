#!/bin/bash
# Get zone information from the Cloudflare API

curl -X GET "https://api.cloudflare.com/client/v4/zones/?name=jdlubrano.work" \
-H "Content-Type:application/json" \
-H "X-Auth-Key:0bcaa0af019075127f76b143f9fb6467e1e34" \
-H "X-Auth-Email:joel.lubrano@gmail.com"

echo ""
