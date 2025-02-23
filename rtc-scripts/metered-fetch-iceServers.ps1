$apikey = "<METERED_API_KEY>"
$body = '[]'
try {
    $iwr = Invoke-WebRequest -UseBasicParsing -Uri "https://mla2.metered.live/api/v1/turn/credentials?apiKey=$($apikey)" -Headers @{'Content-Type'='application/json'}
    $body = $iwr.Content
} catch {
    # do nothing, powershell cant write to stderr nicely.
}
Write-Host $body
